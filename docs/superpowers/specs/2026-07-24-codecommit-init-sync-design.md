# CodeCommit Init and Source Seeding Design

**Date:** 2026-07-24
**Status:** Approved design; reviewer-cap findings addressed; awaiting user spec review

## Goal

Add a standalone CodeCommit project generator to the Pawl CLI:

```bash
pawl init codecommit \
  --sync /path/to/project \
  --directory infra \
  --autoreviewer \
  --model eu.anthropic.claude-sonnet-4-6
```

The command generates a Pawl CDK project that creates a CodeCommit repository, initializes it from local project content, and optionally deploys the durable CodeCommit auto-reviewer.

## Decisions

- Extend the existing `@pawl/cdk` `CodeCommit` construct rather than adding a parallel construct or creating AWS resources imperatively from the CLI.
- Repository creation and initial content remain reproducible through CDK.
- `--sync` accepts a readable directory, including `.`.
- With `--sync`, the selected directory is the CodeCommit repository root. Pawl infrastructure is generated in a direct child directory named `infra` by default and is included in the initial commit.
- With `--sync`, `--directory` only renames that direct child; it cannot relocate it outside the synced root.
- Without `--sync`, a new Pawl project is generated directly at `--directory`, defaulting to `./<repository-name>`; no extra `infra` directory is created.
- The initial branch defaults to `main`; `--branch` can override it.
- Auto-review is optional. When enabled, `--model` may provide an Anthropic Bedrock model or inference-profile ID supported by the current reviewer IAM policy; otherwise the CLI prompts from Anthropic models.
- Installation and immediate deployment are optional.
- Deployment reuses the CLI's AWS profile and region selection.
- This feature seeds initial repository content; it does not continuously or bidirectionally synchronize files.
- CodePipeline is out of scope.

## Non-goals

- Continuous filesystem watching or mirroring.
- Synchronizing later local changes through CloudFormation. AWS ignores changes to the CodeCommit initial `Code` property after resource creation.
- Building a CodePipeline workflow.
- Replacing generic `pawl init`.
- Adding raw `aws-cdk-lib` use to generated consumer code.
- Deploying auto-review infrastructure when auto-review is disabled.
- LocalStack support for this generator.

## CLI interface

### Fully flagged example

```bash
pawl init codecommit \
  --name my-repository \
  --sync . \
  --directory infra \
  --branch main \
  --autoreviewer \
  --model eu.anthropic.claude-sonnet-4-6 \
  --team platform \
  --stage dev \
  --install \
  --deploy \
  --aws-profile my-profile \
  --region eu-central-1
```

### Flags

| Flag | Behavior |
|---|---|
| `--name <name>` | CodeCommit repository name. Prompt when omitted. |
| `--sync <path>` | Existing repository root, including `.`. |
| `--no-sync` | Explicitly generate a new root project instead of prompting for a source path. |
| `--directory <path-or-name>` | With `--sync`, a direct child name, default `infra`. Without `--sync`, the output root, default `./<repository-name>`. |
| `--branch <name>` | Initial branch, default `main`. |
| `--autoreviewer` / `--no-autoreviewer` | Explicitly enable or disable auto-review. |
| `--model <model-id>` | Bedrock model/inference-profile ID when auto-review is enabled. |
| `--team <team>` | Pawl resource-tag/name prefix. Prompt when required and omitted. |
| `--stage <dev|qa|prod>` | Pawl stage, default/prompt `dev`. |
| `--install` / `--no-install` | Explicitly enable or disable dependency installation. |
| `--deploy` / `--no-deploy` | Explicitly enable or disable immediate deployment. |
| `--aws-profile <profile>` | Deployment profile override. |
| `--region <region>` | Deployment region override. |

### Interactive and non-interactive behavior

In a TTY, omitted choices are prompted in this order:

1. repository name;
2. whether to use an existing directory;
3. sync path when applicable;
4. infrastructure child name or new output root;
5. branch, default `main`;
6. team and stage;
7. whether to enable auto-review;
8. model when auto-review is enabled;
9. summary confirmation;
10. dependency installation;
11. immediate deployment;
12. AWS profile and region when deployment is selected.

In a non-TTY, no prompts are allowed. The command requires:

- `--name`;
- exactly one of `--sync` or `--no-sync`;
- exactly one of `--autoreviewer` or `--no-autoreviewer`;
- `--team` for generated Pawl context;
- `--model` when auto-review is enabled;
- exactly one of `--install` or `--no-install`;
- exactly one of `--deploy` or `--no-deploy`;
- `--aws-profile` and `--region` when deployment is enabled.

This makes automation deterministic. `--model` with `--no-autoreviewer`, contradictory positive/negative flags, and `--deploy --no-install` are rejected. A newly generated project cannot deploy before its dependencies are installed. Selecting no installation interactively disables immediate deployment and prints the later install/deploy commands.

### Validation contracts

#### Repository name

- 1–100 characters;
- letters, digits, `.`, `_`, and `-` only;
- must not end in `.git`.

#### Branch

- 1–256 characters;
- satisfies CodeCommit's branch pattern and Git ref safety checks;
- cannot begin with `-`, contain `HEAD`, end in `.lock`, contain `..`, `@{`, control characters, spaces, `~`, `^`, `:`, `?`, `*`, `[`, `\`, repeated `/`, or begin/end with `/` or `.`.

#### Model

- accepts an Anthropic Bedrock model ID or inference-profile ID, not an ARN;
- 2–256 characters and must be either `anthropic.<model>` or `<scope>.anthropic.<model>`;
- matches `^(?:[A-Za-z0-9-]+\.)?anthropic\.[A-Za-z0-9][A-Za-z0-9._:-]*$` and therefore rejects `/`, whitespace, malformed ARN-like input, and providers not covered by the current `anthropic.*` foundation-model IAM grant;
- interactive selection filters the available Bedrock models to the same Anthropic contract;
- syntax validation does not claim the model exists or is accessible;
- immediate deployment runs the existing Bedrock-access check for the selected profile and region;
- ARN and additional-provider support are deferred until `CodeCommitAutoReviewer` can normalize ARN inputs and synthesize provider-specific least-privilege foundation-model resources.

#### Paths

- Resolve the sync root with `realpath`; it must be a readable directory.
- With `--sync`, `--directory` must be one new direct child name.
- Reject empty names, `.`, `..`, absolute paths, `/`, `\`, path separators, `.git`, `node_modules`, `cdk.out`, and any name beginning with `.cdk.staging`.
- The generated child must not already exist. This rejects files, directories, and symlinks uniformly and prevents writing through an external symlink.
- Without `--sync`, the output root must not exist. Existing files, directories (including empty directories), and symlinks are rejected so atomic sibling-directory rename has a single safe contract.
- Existing synced files are never changed. The CLI creates only the new infrastructure child. It does not edit the synced root `.gitignore`.

### Stage/network constraint

`CodeCommitAutoReviewer` requires `team` and `stage`. Generated `cdk.json` supplies both. The CLI supports `dev`, `qa`, and `prod` consistently with `BasicTags`.

The generated auto-reviewer uses the existing `public-test` CodeBuild network policy. Because that policy is prohibited in `prod`, `--autoreviewer --stage prod` is rejected with guidance that production auto-review requires an explicitly designed private VPC/CodeArtifact configuration. Repository-only creation remains valid in `prod`.

## Generated layouts

### Existing project with `--sync .`

```text
existing-project/                 # CodeCommit repository root
├── package.json                  # existing, unchanged
├── src/                          # existing, unchanged
├── tests/                        # existing, unchanged
├── README.md                     # existing, unchanged
├── .gitignore                    # existing, unchanged
└── infra/                        # generated Pawl project; configurable name
    ├── .gitignore
    ├── package.json
    ├── bun.lock                  # only after installation
    ├── tsconfig.json
    ├── cdk.json
    ├── index.ts
    ├── README.md
    ├── stacks/
    │   └── codecommit-stack.ts
    └── tests/
        └── codecommit-stack.test.ts
```

### New project without `--sync`

```text
my-repository/                    # generated Pawl and repository root
├── .gitignore
├── package.json
├── bun.lock                      # only after installation
├── tsconfig.json
├── cdk.json
├── index.ts
├── README.md
├── stacks/
│   └── codecommit-stack.ts
└── tests/
    └── codecommit-stack.test.ts
```

`local.dev.ts` and LocalStack dependencies are omitted because this generator has no local CodeCommit deployment contract. Auto-review handlers remain encapsulated in `@pawl/cdk`; no generated handler source is required.

## CDK API

### High-level create mode

```ts
export interface CodeCommitCreateProps {
  readonly sourcePath?: string;
  readonly branchName?: string;
  readonly description?: string;
  readonly forceIncludePath?: string;
}

export interface CodeCommitProps {
  readonly repositoryName: string;
  readonly create?: CodeCommitCreateProps;
  readonly router?: LambdaFunction;
  readonly autoReview?: AutoReviewConfig;
}
```

`forceIncludePath` is the generated infrastructure path relative to `sourcePath`. The CLI supplies it only in sync mode. It is validated as the same safe direct child name accepted by the CLI.

The construct exposes:

```ts
readonly repository: IRepository;
readonly events?: CodeCommitReviewEvents;
readonly autoReviewer?: CodeCommitAutoReviewer;
```

### Supported combinations

| `create` | `router` | `autoReview` | Result |
|---|---:|---:|---|
| yes | no | no | New repository only |
| yes | yes | no | New repository with custom router |
| yes | no | yes | New repository with Pawl auto-reviewer |
| no | no | no | Imported repository only |
| no | yes | no | Existing repository with custom router |
| no | no | yes | Existing repository with Pawl auto-reviewer |

`router` and `autoReview` are mutually exclusive.

### Public API compatibility

`CodeCommit.events` is currently always defined because repository-only mode does not exist. Making it optional is an intentional pre-1.0 source change in `@pawl/cdk@0.0.x`, not a backward-compatible type change. Runtime behavior for existing router and auto-review combinations is preserved.

Migration:

```ts
const codeCommit = new CodeCommit(/* existing router or autoReview props */);
const events = codeCommit.events;
if (events === undefined) throw new Error("expected review events");
```

Release notes must call out the optional property. Existing internal consumers and examples are updated in the same change.

### Shared repository input contracts

Use an exact-one union for lower-level constructs:

```ts
type RepositoryTarget =
  | { repositoryName: string; repository?: never }
  | { repository: IRepository; repositoryName?: never };
```

Normalization validates the selected resource name with the repository-name schema and returns `{ repository, repositoryName }`.

- `CodeCommitReviewEventsProps` becomes `RepositoryTarget & EventConfig & BasicConstructProps & { router }`. Its existing public `repository: IRepository` remains unchanged.
- `CodeBuildProjectProps` accepts either `repositoryName` or a concrete created `Repository`. Its existing public `repository: Repository` property remains unchanged; name-only import behavior and its compatibility cast remain unchanged.
- `CodeCommitAutoReviewerProps` retains `repositories: string[]` and adds `repositoryResources?: ReadonlyMap<string, Repository>` outside its Zod-serializable configuration. Unknown map keys or a resource whose `repositoryName` differs from its key are rejected. Missing keys fall back to existing name-only import behavior.
- The high-level `CodeCommit` passes the concrete created `Repository` through this map. Imported repositories retain the existing name-only path.
- Duplicate repository names in `CodeCommitAutoReviewer.repositories` are rejected before map/construct creation.

This makes created-resource dependencies explicit without changing lower-level name-only consumers.

### Repository lifecycle

- Create mode uses `aws-codecommit.Repository` internally.
- Import mode preserves `Repository.fromRepositoryName`.
- Created repositories use `RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE`: failed initial creation rolls back, while established repositories survive stack deletion or replacement.
- Neither `router` nor `autoReview` is required, allowing repository-only creation without EventBridge, Lambda, CodeBuild, DynamoDB, or Bedrock resources.

## Initial source asset

### Source root

- With `--sync`: the parent of the generated infrastructure child.
- Without `--sync`: the generated project root.

The generated stack passes the absolute source root to `CodeCommit.create.sourcePath`. `CodeCommit` creates an `aws-s3-assets.Asset` and initializes the repository with `Code.fromAsset`.

### Ignore precedence

Asset exclusion patterns are ordered and immutable:

1. root `.gitignore` patterns supplied by the user;
2. when `forceIncludePath` is set, `!/<path>/` and `!/<path>/**` so a pre-existing `infra/` ignore rule cannot omit generated Pawl infrastructure;
3. the immutable security denylist, applied last so user negations and forced inclusion cannot re-include denied files.

The immutable denylist is:

```text
**/.git
**/.git/**
**/node_modules/**
**/cdk.out/**
**/.cdk.staging/**
**/.env
**/.env.*
**/.aws/credentials
**/.aws/config
**/*.pem
**/*.key
**/*.p12
**/*.pfx
**/id_rsa
**/id_ed25519
```

`.env.example` is intentionally excluded by `**/.env.*`; this is a safety-first rule and is documented in generated output. The asset uses CDK's Git ignore mode. Symlink following is disabled.

No new third-party ignore dependency is needed; CDK already provides Git-pattern handling for asset exclusions.

### Initial-import limits

CloudFormation's initial CodeCommit S3 ZIP is creation-only and is constrained to:

- at most 100 included files;
- at most 6,000,000 bytes per included file;
- at most 20,000,000 bytes total uncompressed content;
- at most 4,000,000 bytes for the staged ZIP;
- repository-relative file paths of 1–4,096 characters;
- at least one included file.

Decimal-byte thresholds are deliberately used as the conservative interpretation of AWS's documented MB values.

The construct enumerates the filtered source set with the same exported Git-ignore/preflight helper before creating the asset, validates file count, individual size, aggregate size, and path length, then validates the staged ZIP size. The CLI imports that helper from `@pawl/cdk` so command and construct filtering cannot drift. It runs once after generation, and again after optional dependency installation because installation may add `bun.lock` or mutate package metadata. The construct remains the final deployment-time safeguard.

When limits are exceeded, the error reports the violated limit and largest/count-driving paths without printing contents. It recommends creating the repository without initial source and using a normal Git push, whose limits differ from the CloudFormation initial-import path. The CLI must not claim every readable directory is seedable.

Primary references:

- [CloudFormation CodeCommit Code property](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-codecommit-repository-code.html)
- [CodeCommit quotas](https://docs.aws.amazon.com/codecommit/latest/userguide/limits.html)
- [CreateCommit API](https://docs.aws.amazon.com/codecommit/latest/APIReference/API_CreateCommit.html)

The numeric limits receive a live-document check during implementation because design research could only corroborate CloudFormation behavior against the installed CDK declarations.

## CLI components

Keep the feature isolated under `packages/cli/src/codecommit-init/`:

| Module | Responsibility |
|---|---|
| `cli.ts` | Parse positive/negative flags and reject invalid combinations. |
| `config.ts` | Zod schemas and normalized configuration. |
| `prompts.ts` | TTY-only interactive questions. |
| `layout.ts` | Canonicalize paths and enforce sync/new-root boundaries. |
| `generator.ts` | Render the root or child Pawl project atomically. |
| `source-preflight.ts` | Apply the shared documented limits and surface safe diagnostics. |
| `deploy.ts` | Select credentials/region and run install/deploy through injected subprocess interfaces. |

`packages/cli/index.ts` dispatches `pawl init codecommit` before generic `pawl init`. Existing generic initialization and interactive agent startup remain unchanged.

The generated project uses Bun and depends on `@pawl/cdk`; it does not add `@pawl/lambda` because generated code does not import it directly.

## Data flow

```text
CLI flags
  → TTY prompts or strict non-TTY validation
  → Zod validation
  → canonical layout resolution
  → atomic Pawl project generation
  → source preflight
  → optional dependency installation
  → final source preflight
  → optional AWS profile/region selection and validation
  → CDK synth/deploy
  → filtered source asset upload
  → CodeCommit repository initialization
  → optional auto-reviewer deployment
```

No separate Git push is required for initial content. Later changes use normal Git workflows because CloudFormation ignores updates to initial `Code`.

## Failure handling and filesystem atomicity

- Validate flags, names, model syntax, stage constraints, canonical paths, destination availability, and source limits before deployment.
- In sync mode, write generated files to a temporary sibling directory and atomically rename it to the requested child only after generation succeeds.
- Existing synced files, including root `.gitignore`, are never modified.
- In new-root mode, generate into a temporary sibling and atomically rename it to the final root.
- Installation occurs after the atomic rename. Installation failure leaves a valid generated project and reports the retry command.
- Deployment failure leaves the generated project and reports the exact retry command.
- `RETAIN_ON_UPDATE_OR_DELETE` avoids orphaning a repository on failed initial stack creation while protecting established repository data.
- Successful deployment prints repository name, branch, region, clone URL, auto-review status, and a warning that CDK initial seeding is not ongoing synchronization.

## Security

- Immutable deny patterns cannot be negated by user `.gitignore` rules or forced infrastructure inclusion, and nested Git repositories/worktree `.git` files are excluded at every depth.
- Generated directories cannot be reserved names or symlinks.
- Asset packaging never follows symlinks.
- Diagnostics print paths and sizes, never file contents.
- Credentials, model prompts, and file contents are not logged.
- Existing least-privilege CodeCommit, CodeBuild, Lambda, DynamoDB, and Bedrock grants remain in Pawl constructs.
- Generated consumer code uses Pawl abstractions rather than raw CDK constructs.

## Testing

### CDK tests

- Create a repository with and without source.
- Import an existing repository without emitting `AWS::CodeCommit::Repository`.
- Assert `RetainExceptOnCreate`/retain update semantics in the synthesized template.
- Cover repository-only, router, and auto-review combinations.
- Reject `router` plus `autoReview`.
- Test exact-one `repository`/`repositoryName` contracts and map-key/resource-name validation.
- Preserve `CodeBuildProject.repository` and `CodeCommitReviewEvents.repository` public types.
- Verify created CodeBuild/EventBridge resources use the supplied repository.
- Validate repository and branch constraints.
- Prove ignore precedence: user excludes infrastructure, forced include restores it, immutable denylist still removes nested dependencies/secrets.
- Prove symlinks are not followed.
- Test empty, >100-file, oversized-file, oversized-uncompressed, oversized-ZIP, and overlong-path failures.

### CLI tests

- Parse all positive and negative flags.
- Prove fully flagged non-TTY execution never prompts.
- Reject incomplete or contradictory non-TTY invocations.
- Support `--sync .`.
- Generate default `infra` and custom safe child names.
- Reject `.`, separators, reserved names, existing destinations, and symlinks.
- Generate directly at root without `--sync`.
- Preserve every existing synced file and root `.gitignore` byte-for-byte.
- Verify atomic cleanup on generation failure.
- Validate repository, branch, Anthropic-model-ID-only, required non-TTY team, stage, prod auto-review, and deploy/install constraints.
- Verify generated projects typecheck and synthesize.
- Test source-limit diagnostics without exposing content and rerun preflight after installation mutations.
- Test install/deploy orchestration through injected fakes.

### Integration policy

- Default tests require no live AWS.
- Generated-project synth tests verify source asset, repository, retention, and optional auto-review wiring.
- Any live CodeCommit creation test is opt-in and uses disposable repositories.
- Live verification must account for CodeCommit's availability restrictions for new AWS customers.

## Documentation

Update:

- CLI help and README with interactive and fully non-interactive examples.
- `@pawl/cdk` CodeCommit API docs, repository-only behavior, and optional `events` migration note.
- Generated README with deployment, retention, cloning, service limits, secret exclusions, and initial-seeding semantics.
- Explicit warning that `--sync` performs initial seeding only, not ongoing synchronization.
