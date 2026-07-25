# CodeCommit Init and Source Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `pawl init codecommit` to generate, optionally install, and optionally deploy a Pawl CDK project that creates and initially seeds a retained CodeCommit repository, with optional durable auto-review.

**Architecture:** Extend `@pawl/cdk` from repository-name-only wiring to a shared repository-resource contract, add a security-first source analyzer used by both CDK and CLI, and let the high-level `CodeCommit` construct create or import repositories. Add a focused `packages/cli/src/codecommit-init/` command pipeline for parsing, prompting, path resolution, atomic template generation, preflight, installation, credential validation, and deployment.

**Tech Stack:** TypeScript 5 strict mode, Bun, Zod, AWS CDK v2 (`aws-codecommit`, `aws-s3-assets`), `@clack/prompts`, Bun test, CDK assertions, cdk-nag.

---

## Execution prerequisite

The current worktree contains unrelated uncommitted edits in `bun.lock`, `packages/cdk/src/codebuild-project.ts`, `packages/cdk/src/codecommit-auto-reviewer.ts`, `packages/cdk/src/codecommit.ts`, and `example/durable-lambda-reviewer/`. Those edits are the baseline for this feature and must not be reset, reformatted wholesale, or overwritten.

Implementation must use an isolated feature worktree with an explicit baseline commit, as Task 0 defines. Never commit or stash from the original dirty worktree, and never use `git add .`.

## File structure

### CDK package

- Create `packages/cdk/src/codecommit-repository.ts` — shared repository-name schema, branch schema, exact-one repository target, and normalization.
- Create `packages/cdk/src/codecommit-source.ts` — immutable exclusions, Git-ignore ordering, source enumeration, service-limit errors, and archive-size assertion.
- Create `packages/cdk/tests/codecommit-source.test.ts` — filtering, symlink, and source-limit unit tests.
- Create `packages/cdk/tests/codecommit.test.ts` — create/import/repository-only/router/auto-review synthesis tests.
- Modify `packages/cdk/src/codecommit.ts` — create/import API, source asset, retention, optional event resources.
- Modify `packages/cdk/src/codecommit-review-events.ts` — accept an existing `IRepository` or a repository name.
- Modify `packages/cdk/src/codebuild-project.ts` — accept an existing concrete `Repository` or a repository name without changing the public property type.
- Modify `packages/cdk/src/codecommit-auto-reviewer.ts` — accept validated per-name repository resources and reject duplicates.
- Modify `packages/cdk/tests/codecommit-review-events.test.ts` — exact-one target and supplied-resource coverage.
- Modify `packages/cdk/tests/codebuild-project.test.ts` — supplied-resource and compatibility coverage.
- Modify `packages/cdk/index.ts` — export the new source/repository APIs plus explicit `App`, `CfnOutput`, and `Construct` Pawl entrypoints used by generated code.
- Modify `packages/cdk/package.json` — pre-1.0 minor version bump for the optional-events API change.
- Create `CHANGELOG.md` — release and migration note for the public API change.

### CLI package

- Create `packages/cli/src/codecommit-init/config.ts` — raw flags, Zod validation, and normalized command config.
- Create `packages/cli/src/codecommit-init/cli.ts` — `node:util.parseArgs` parsing for all positive/negative flags.
- Create `packages/cli/src/codecommit-init/layout.ts` — canonical sync/new-root path validation.
- Create `packages/cli/src/codecommit-init/prompts.ts` — TTY-only questions and Anthropic Bedrock model selection.
- Create `packages/cli/src/codecommit-init/generator.ts` — render and atomically rename a temporary generated project.
- Create `packages/cli/src/codecommit-init/source-preflight.ts` — adapt the exported CDK source analyzer to CLI diagnostics.
- Create `packages/cli/src/codecommit-init/deploy.ts` — install, AWS credential/region validation, CDK deployment, and output parsing behind injected subprocess dependencies.
- Create `packages/cli/src/codecommit-init/index.ts` — command orchestration.
- Create `packages/cli/templates/codecommit-init/` — standalone Bun/Pawl template with no LocalStack files.
- Create focused tests under `packages/cli/tests/codecommit-init-*.test.ts`.
- Modify `packages/cli/index.ts` — dispatch `init codecommit` before generic `init`.
- Modify `packages/cli/README.md` — command examples, CLI help, and initial-seeding limitations.

## Task 0: Preserve the dirty baseline in an isolated worktree

**Files:**
- Read/transfer only: current tracked diff and `example/durable-lambda-reviewer/`
- Create outside repository: `/tmp/pawl-codecommit-baseline.patch`

- [ ] **Step 1: Record the original worktree state without changing it**

```bash
git status --short
git diff --binary > /tmp/pawl-codecommit-baseline.patch
git ls-files --others --exclude-standard example/durable-lambda-reviewer > /tmp/pawl-codecommit-untracked.txt
```

Expected: the patch contains the pre-existing tracked edits and the list contains the untracked example files. Record `git rev-parse HEAD` in the execution log.

- [ ] **Step 2: Create a feature worktree from the plan commit**

Use @superpowers:using-git-worktrees to create a branch such as `feat/codecommit-init-sync`. Do not stash, reset, add, or commit anything in the original worktree.

- [ ] **Step 3: Transfer and verify the baseline**

Apply `/tmp/pawl-codecommit-baseline.patch` in the feature worktree and copy only the paths listed in `/tmp/pawl-codecommit-untracked.txt`, preserving modes. Compare `git diff --binary` and file hashes against the recorded original baseline.

- [ ] **Step 4: Commit the transferred baseline separately**

```bash
git add bun.lock packages/cdk/src/codebuild-project.ts packages/cdk/src/codecommit-auto-reviewer.ts packages/cdk/src/codecommit.ts example/durable-lambda-reviewer
git commit -m "chore: preserve CodeCommit reviewer baseline"
```

Expected: this commit exists only on the isolated feature branch; the original worktree remains byte-for-byte dirty and untouched. All later whole-file task commits now stage changes relative to this explicit baseline rather than absorbing unrelated hunks.

## Task 1: Shared CodeCommit validation and repository targeting

**Files:**
- Create: `packages/cdk/src/codecommit-repository.ts`
- Create: `packages/cdk/tests/codecommit-repository.test.ts`
- Modify: `packages/cdk/index.ts`

- [ ] **Step 1: Write failing schema and normalization tests**

Cover:

```ts
expect(CodeCommitRepositoryNameSchema.safeParse("repo-1").success).toBe(true);
expect(CodeCommitRepositoryNameSchema.safeParse("repo.git").success).toBe(false);
expect(CodeCommitRepositoryNameSchema.safeParse("a".repeat(101)).success).toBe(false);

expect(CodeCommitBranchNameSchema.safeParse("feature/review").success).toBe(true);
for (const branch of ["-bad", "has HEAD here", "bad..ref", "bad.lock", "bad@{ref"]) {
  expect(CodeCommitBranchNameSchema.safeParse(branch).success).toBe(false);
}

expect(() => normalizeRepositoryTarget(scope, "Repo", {})).toThrow(/exactly one/i);
expect(() => normalizeRepositoryTarget(scope, "Repo", {
  repositoryName: "repo",
  repository,
})).toThrow(/exactly one/i);
expect(normalizeRepositoryTarget(scope, "Repo", { repository })).toEqual({
  repository,
  repositoryName: "repo",
});
```

Test every branch restriction from the specification: leading `-`; `HEAD`; trailing `.lock`; `..`; `@{`; controls; spaces; `~`, `^`, `:`, `?`, `*`, `[`, `\\`; repeated `/`; and leading/trailing `/` or `.`. Also use `expectTypeOf` to prove `RepositoryTarget` accepts one alternative and rejects both with `// @ts-expect-error` compile fixtures.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun test packages/cdk/tests/codecommit-repository.test.ts
```

Expected: FAIL because `codecommit-repository.ts` does not exist.

- [ ] **Step 3: Implement the schemas and exact-one union**

Use this public shape:

```ts
export const CodeCommitRepositoryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/)
  .refine((name) => !name.endsWith(".git"), "must not end in .git");

export const CodeCommitBranchNameSchema = z
  .string()
  .min(1)
  .max(256)
  .superRefine(validateCodeCommitBranch);

export type RepositoryTarget =
  | { readonly repositoryName: string; readonly repository?: never }
  | { readonly repository: IRepository; readonly repositoryName?: never };

export function normalizeRepositoryTarget(
  scope: Construct,
  id: string,
  target: RepositoryTarget,
): { repository: IRepository; repositoryName: string };
```

`validateCodeCommitBranch` must implement every ref restriction in the design, not just the CloudFormation regex. `normalizeRepositoryTarget` must perform a runtime exact-one check before either validating `repository.repositoryName` or calling `Repository.fromRepositoryName`.

Export the module from `packages/cdk/index.ts`.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
bun test packages/cdk/tests/codecommit-repository.test.ts
bunx tsc -p packages/cdk/tsconfig.build.json --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit only this task**

```bash
git add packages/cdk/src/codecommit-repository.ts packages/cdk/tests/codecommit-repository.test.ts packages/cdk/index.ts
git commit -m "feat(cdk): validate CodeCommit repository targets"
```

## Task 2: Security-first source analysis

**Files:**
- Create: `packages/cdk/src/codecommit-source.ts`
- Create: `packages/cdk/tests/codecommit-source.test.ts`
- Modify: `packages/cdk/index.ts`

- [ ] **Step 1: Write failing ignore-precedence tests**

Create temporary trees that prove:

1. root `.gitignore` patterns are honored;
2. a root `infra/` exclusion is overridden by `forceIncludePath: "infra"`;
3. nested `infra/node_modules`, `infra/.env.example`, nested `.git` directories, and `.git` worktree files remain denied after forced inclusion;
4. ordinary symlink entries are omitted and external symlinks are never read;
5. included paths are repository-relative POSIX paths.

Core assertion:

```ts
const result = analyzeCodeCommitSource({
  sourcePath: root,
  forceIncludePath: "infra",
});
expect(result.files.map(({ relativePath }) => relativePath)).toContain(
  "infra/stacks/codecommit-stack.ts",
);
expect(result.files.map(({ relativePath }) => relativePath)).not.toContain(
  "infra/node_modules/pkg/index.js",
);
```

- [ ] **Step 2: Write failing service-limit tests**

Cover zero files, 101 files, a 6,000,001-byte file, 20,000,001 aggregate bytes, a path over 4,096 characters, and incompressible content whose generated ZIP exceeds 4,000,000 bytes. Assert `CodeCommitSourceLimitError` includes the limit and safe path/size metadata but no file contents.

- [ ] **Step 3: Run the tests and verify RED**

Run:

```bash
bun test packages/cdk/tests/codecommit-source.test.ts
```

Expected: FAIL because the analyzer is missing.

- [ ] **Step 4: Implement patterns and synchronous enumeration**

Expose constants and focused APIs:

```ts
export const CODECOMMIT_SOURCE_LIMITS = {
  archiveBytes: 4_000_000,
  totalBytes: 20_000_000,
  fileBytes: 6_000_000,
  files: 100,
  pathCharacters: 4_096,
} as const;

export const CODECOMMIT_SECURITY_EXCLUDES = [
  "**/.git",
  "**/.git/**",
  "**/node_modules/**",
  "**/cdk.out/**",
  "**/.cdk.staging/**",
  "**/.env",
  "**/.env.*",
  "**/.aws/credentials",
  "**/.aws/config",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/id_rsa",
  "**/id_ed25519",
] as const;

export interface AnalyzeCodeCommitSourceOptions {
  readonly sourcePath: string;
  readonly forceIncludePath?: string;
}

export interface CodeCommitSourceAnalysis {
  readonly files: readonly CodeCommitSourceFile[];
  readonly assetExcludes: readonly string[];
  readonly totalBytes: number;
}

export function analyzeCodeCommitSource(
  options: AnalyzeCodeCommitSourceOptions,
): CodeCommitSourceAnalysis;

export function createCodeCommitSourceArchive(options: {
  readonly analysis: CodeCommitSourceAnalysis;
  readonly outputDirectory: string;
}): { readonly archivePath: string; readonly bytes: number };
```

Read root `.gitignore` when present, append `!/<child>/` and `!/<child>/**`, then append the immutable denylist last. Use CDK `IgnoreStrategy.git` for enumeration. Traverse with `lstatSync`; skip every symbolic link instead of dereferencing it and append each discovered symlink's repository-relative path to `assetExcludes` so CDK packaging omits the entry too. Do not use `any`.

Throw a typed `CodeCommitSourceLimitError` with structured fields. Sort paths before analysis so diagnostics and asset behavior are deterministic.

- [ ] **Step 5: Produce and validate the exact ZIP that CDK uploads**

Do not attempt to infer CDK's later directory-asset packaging from `Asset.assetPath`. Implement a deterministic ZIP writer with Node built-ins (`node:zlib` `deflateRawSync`, `node:crypto`, and a small CRC32 helper): local file headers, UTF-8 file names, deflated bytes, central directory records, and end-of-central-directory record. Fixed DOS timestamps keep output deterministic. The source limits bound memory to 20 MB and 100 files.

`createCodeCommitSourceArchive` writes under the supplied output directory, derives the filename from a SHA-256 of paths/content, and measures that exact file. Throw when it exceeds 4,000,000 bytes. The CLI writes it under an OS temporary directory and deletes it; the construct writes it under `Stage.of(scope).assetOutdir` and passes that same ZIP file to `Asset`.

Add a test-only ZIP reader using `inflateRawSync` to verify every included path and byte sequence round-trips, denied/symlink entries are absent, CRCs match, and incompressible content over the limit fails. This integration test validates the actual `createCodeCommitSourceArchive` → `Asset` file path, not a synthetic unrelated file.

Use decimal bytes. Do not print source content.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
bun test packages/cdk/tests/codecommit-source.test.ts
bunx tsc -p packages/cdk/tsconfig.build.json --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cdk/src/codecommit-source.ts packages/cdk/tests/codecommit-source.test.ts packages/cdk/index.ts
git commit -m "feat(cdk): validate CodeCommit seed assets"
```

## Task 3: Pass repository resources through lower-level constructs

**Files:**
- Modify: `packages/cdk/src/codecommit-review-events.ts`
- Modify: `packages/cdk/src/codebuild-project.ts`
- Modify: `packages/cdk/tests/codecommit-review-events.test.ts`
- Modify: `packages/cdk/tests/codebuild-project.test.ts`

- [ ] **Step 1: Add failing `CodeCommitReviewEvents` resource-target tests**

Create a `Repository` in the test stack and pass it through `repository`. Assert:

- `construct.repository === repository`;
- the synthesized EventBridge resource filter uses the created repository ARN;
- name-only behavior still works;
- neither/both alternatives throw before resources are created.

- [ ] **Step 2: Run the review-events test and verify RED**

```bash
bun test packages/cdk/tests/codecommit-review-events.test.ts
```

Expected: FAIL because `repository` is not accepted.

- [ ] **Step 3: Normalize the event repository target**

Change configuration to omit the repository from Zod-serializable fields:

```ts
export const CodeCommitReviewEventsConfigSchema = z.object({
  commentEventFallback: z.literal("cloudtrail").optional(),
  retryAttempts: z.number().int().min(0).max(10).default(3),
  maxEventAgeMinutes: z.number().int().min(1).max(1440).default(60),
});

export type CodeCommitReviewEventsProps = RepositoryTarget &
  z.input<typeof CodeCommitReviewEventsConfigSchema> &
  BasicConstructProps & { readonly router: LambdaFunction };
```

Destructure `repository`/`repositoryName` before Zod parsing and assign the normalized `IRepository`. Keep public `readonly repository: IRepository` unchanged.

- [ ] **Step 4: Add failing CodeBuild resource-target tests**

Pass a concrete created `Repository`, assert the CodeBuild source references its ARN/clone location, and use `expectTypeOf(construct.repository).toEqualTypeOf<Repository>()` to preserve the public type.

- [ ] **Step 5: Run the CodeBuild test and verify RED**

```bash
bun test packages/cdk/tests/codebuild-project.test.ts
```

Expected: FAIL because `CodeBuildProjectProps` requires `repositoryName`.

- [ ] **Step 6: Add the exact-one CodeBuild target**

Keep `repositoryName` out of `CodeBuildProjectConfigSchema` and define:

```ts
export type CodeBuildRepositoryTarget =
  | { readonly repositoryName: string; readonly repository?: never }
  | { readonly repository: Repository; readonly repositoryName?: never };

export type CodeBuildProjectProps = CodeBuildRepositoryTarget &
  z.input<typeof CodeBuildProjectConfigSchema> &
  BasicConstructProps;
```

Use the supplied concrete repository when present; retain the existing name-only import/cast and `readonly repository: Repository` public property. Reject both/neither at runtime.

- [ ] **Step 7: Run both suites and typecheck**

```bash
bun test packages/cdk/tests/codecommit-review-events.test.ts packages/cdk/tests/codebuild-project.test.ts
bunx tsc -p packages/cdk/tsconfig.build.json --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/cdk/src/codecommit-review-events.ts packages/cdk/src/codebuild-project.ts packages/cdk/tests/codecommit-review-events.test.ts packages/cdk/tests/codebuild-project.test.ts
git commit -m "refactor(cdk): share CodeCommit repository resources"
```

## Task 4: Add repository-resource maps to the auto-reviewer

**Files:**
- Modify: `packages/cdk/src/codecommit-auto-reviewer.ts`
- Create: `packages/cdk/tests/codecommit-auto-reviewer.test.ts`

- [ ] **Step 1: Write failing validation and identity tests**

Cover:

```ts
expect(() => createReviewer({ repositories: ["repo", "repo"] }))
  .toThrow(/duplicate/i);
expect(() => createReviewer({
  repositories: ["repo"],
  repositoryResources: new Map([["other", repository]]),
})).toThrow(/unknown/i);
```

Also reject a map key that differs from `repository.repositoryName`. For a valid map, assert `codeBuildProjects.get("repo")?.repository === repository` and `eventConstructs.get("repo")?.repository === repository`.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
bun test packages/cdk/tests/codecommit-auto-reviewer.test.ts
```

Expected: FAIL because `repositoryResources` is missing.

- [ ] **Step 3: Implement the resource map outside Zod config**

Use:

```ts
export type CodeCommitAutoReviewerProps = z.input<
  typeof CodeCommitAutoReviewerConfigSchema
> & {
  readonly repositoryResources?: ReadonlyMap<string, Repository>;
  readonly team?: string;
  readonly stage?: string;
};
```

Before parsing, destructure `repositoryResources`, `team`, and `stage`. Add a schema refinement rejecting duplicate repository names. Validate every map key against the configured set and matching resource name. In each loop, build an exact target object:

```ts
const repositoryResource = repositoryResources?.get(repo);
const repositoryTarget = repositoryResource
  ? { repository: repositoryResource }
  : { repositoryName: repo };
```

Pass `repositoryTarget` to `CodeBuildProject` and `CodeCommitReviewEvents`; never pass a bare `Repository` where a `RepositoryTarget` is required.

Do not broaden the current `anthropic.*` foundation-model IAM grant.

- [ ] **Step 4: Run focused and regression tests**

```bash
bun test packages/cdk/tests/codecommit-auto-reviewer.test.ts packages/cdk/tests/codebuild-project.test.ts packages/cdk/tests/codecommit-review-events.test.ts
bunx tsc -p packages/cdk/tsconfig.build.json --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cdk/src/codecommit-auto-reviewer.ts packages/cdk/tests/codecommit-auto-reviewer.test.ts
git commit -m "feat(cdk): reuse created repositories in auto-review"
```

## Task 5: Extend the high-level CodeCommit construct

**Files:**
- Modify: `packages/cdk/src/codecommit.ts`
- Create: `packages/cdk/tests/codecommit.test.ts`
- Modify: `packages/cdk/index.ts`
- Modify: `packages/cdk/package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Write failing repository lifecycle tests**

Create temporary source content and cover:

- create with source/branch/description emits one `AWS::CodeCommit::Repository` with `Code`;
- create without source emits a repository without `Code`;
- created repository has `DeletionPolicy: RetainExceptOnCreate` and `UpdateReplacePolicy: Retain`;
- import mode emits no repository resource;
- repository-only mode emits no EventBridge, Lambda, CodeBuild, DynamoDB, or Bedrock resources;
- `router` plus `autoReview` throws;
- `branchName` or `forceIncludePath` without `sourcePath` throws;
- invalid repository/branch names throw;
- unsafe/reserved `forceIncludePath` values (`.`, `..`, separators, `.git`, `node_modules`, `cdk.out`, `.cdk.staging*`) throw for direct CDK consumers;
- ARN, malformed, and non-Anthropic `autoReview.modelId` values throw for direct CDK consumers;
- `events` is defined only for router/auto-review modes.

- [ ] **Step 2: Run the test and verify RED**

```bash
bun test packages/cdk/tests/codecommit.test.ts
```

Expected: FAIL against the repository-name-only wrapper.

- [ ] **Step 3: Add the create schema and public outputs**

Implement:

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

export class CodeCommit {
  readonly repository: IRepository;
  readonly events?: CodeCommitReviewEvents;
  readonly autoReviewer?: CodeCommitAutoReviewer;
}
```

Validate `forceIncludePath` as one safe direct-child name. Parse auto-review model IDs with the Anthropic-only contract from the spec.

- [ ] **Step 4: Create and validate the asset before repository binding**

For `create.sourcePath`:

1. call `analyzeCodeCommitSource`;
2. call `createCodeCommitSourceArchive({ analysis, outputDirectory: Stage.of(scope).assetOutdir })`;
3. create `Asset` from the returned ZIP file path (not from the source directory), and assert `asset.isZipArchive`;
4. pass that exact asset through `Code.fromAsset(asset, branchName ?? "main")` to `Repository`.

Because filtering and symlink omission happen while building the explicit archive, no later CDK directory-packaging phase can re-include a denied entry or change the measured compressed bytes.

Create the repository with `description` and call:

```ts
created.applyRemovalPolicy(RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);
```

Import by name when `create` is absent.

- [ ] **Step 5: Wire optional router and auto-review resources**

For a custom router, pass the same `IRepository` to `CodeCommitReviewEvents`. For auto-review on a newly created concrete repository, pass `new Map([[repositoryName, created]])`; imports use the existing name-only path. Reject simultaneous router and auto-review. Create neither when both are absent.

Add JSDoc migration text stating that `events` is intentionally optional in the pre-1.0 API.

- [ ] **Step 6: Add generated-code entrypoint exports**

In `packages/cdk/index.ts`, export `App` and `CfnOutput` from `aws-cdk-lib` and explicitly `export type { Construct } from "constructs"` so generated consumer source imports only from `@pawl/cdk`. Add a compile test importing all three from the package root; do not rely only on the current indirect `export * from "./src/stack"` re-export.

- [ ] **Step 7: Bump the pre-1.0 CDK package version**

Change `@pawl/cdk` from `0.0.1` to `0.1.0` because `CodeCommit.events` becomes optional, and update only the corresponding `bun.lock` workspace-package version metadata. This makes the generated `^0.1.0` dependency truthful before standalone fixtures are packed.

- [ ] **Step 8: Run CDK tests, cdk-nag, and typecheck**

```bash
bun test packages/cdk/tests/codecommit.test.ts packages/cdk/tests/codecommit-auto-reviewer.test.ts packages/cdk/tests/codecommit-review-events.test.ts packages/cdk/tests/codebuild-project.test.ts packages/cdk/tests/codecommit-source.test.ts
bunx tsc -p packages/cdk/tsconfig.build.json --noEmit
```

Expected: PASS with no unsuppressed cdk-nag findings.

- [ ] **Step 9: Commit**

```bash
git add packages/cdk/src/codecommit.ts packages/cdk/tests/codecommit.test.ts packages/cdk/index.ts packages/cdk/package.json bun.lock
git commit -m "feat(cdk): create and seed CodeCommit repositories"
```

## Task 6: Parse and validate CodeCommit init configuration

**Files:**
- Create: `packages/cli/src/codecommit-init/config.ts`
- Create: `packages/cli/src/codecommit-init/cli.ts`
- Create: `packages/cli/tests/codecommit-init-cli.test.ts`
- Create: `packages/cli/tests/codecommit-init-config.test.ts`

- [ ] **Step 1: Write failing parser tests**

Test the fully flagged command, `--sync .`, all negative flags, omitted boolean choices, unknown options, repeated/contradictory flags, positional rejection, and `--help` returning command-specific usage without starting prompts or generation.

Expected parsed shape:

```ts
{
  repositoryName: "repo",
  syncPath: ".",
  directory: "infra",
  branchName: "main",
  autoReviewer: true,
  modelId: "eu.anthropic.claude-sonnet-4-6",
  team: "platform",
  stage: "dev",
  install: true,
  deploy: true,
  awsProfile: "dev",
  region: "eu-central-1",
}
```

- [ ] **Step 2: Write failing normalized-config tests**

Cover:

- non-TTY requires name, sync/no-sync, auto/no-auto, team, install/no-install, deploy/no-deploy;
- model is required only with auto-review;
- `--model` plus no-auto is rejected;
- only `anthropic.<model>` or `<scope>.anthropic.<model>` is accepted;
- deploy requires install, profile, and region;
- auto-review plus prod is rejected;
- branch/repository schemas come from `@pawl/cdk`;
- stage defaults to `dev` when omitted.

- [ ] **Step 3: Run tests and verify RED**

```bash
bun test packages/cli/tests/codecommit-init-cli.test.ts packages/cli/tests/codecommit-init-config.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement raw flags and `parseArgs`**

Represent positive/negative booleans independently so contradictions can be detected:

```ts
export interface CodeCommitInitFlags {
  repositoryName?: string;
  syncPath?: string;
  noSync?: boolean;
  autoReviewer?: boolean;
  noAutoReviewer?: boolean;
  install?: boolean;
  noInstall?: boolean;
  deploy?: boolean;
  noDeploy?: boolean;
  // remaining scalar options
}
```

Call `parseArgs` on arguments after `init codecommit`. Use strict mode and reject all positionals. Export `formatCodeCommitInitHelp()` containing every flag, defaults, non-TTY requirements, and initial-seeding warning; a help result bypasses config validation and filesystem work.

- [ ] **Step 5: Implement Zod validation and normalization**

Define separate raw/input and normalized types. Keep `IRepository`/construct objects out of Zod. Format all Zod issues into one typed `CodeCommitInitConfigError` without `any`.

- [ ] **Step 6: Run tests and typecheck**

```bash
bun test packages/cli/tests/codecommit-init-cli.test.ts packages/cli/tests/codecommit-init-config.test.ts
bunx tsc -p packages/cli/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/codecommit-init/config.ts packages/cli/src/codecommit-init/cli.ts packages/cli/tests/codecommit-init-cli.test.ts packages/cli/tests/codecommit-init-config.test.ts
git commit -m "feat(cli): validate CodeCommit init options"
```

## Task 7: Resolve safe sync and output layouts

**Files:**
- Create: `packages/cli/src/codecommit-init/layout.ts`
- Create: `packages/cli/tests/codecommit-init-layout.test.ts`

- [ ] **Step 1: Write failing sync-layout tests**

Use temporary directories to cover:

- `--sync .` resolves through `realpath`;
- default/custom direct child resolves under the sync root;
- `.`, `..`, absolute paths, separators, `.git`, `node_modules`, `cdk.out`, `.cdk.staging*`, existing files/directories, and symlinks are rejected;
- the source root remains the sync root and `forceIncludePath` is the child name.

- [ ] **Step 2: Write failing no-sync tests**

Cover default `./<repository-name>`, an explicit output path with an existing canonical parent, and rejection of existing files, empty directories, non-empty directories, and symlinks. Assert the final root itself does not exist.

- [ ] **Step 3: Run tests and verify RED**

```bash
bun test packages/cli/tests/codecommit-init-layout.test.ts
```

Expected: FAIL because layout resolution is missing.

- [ ] **Step 4: Implement canonical layout resolution**

Expose:

```ts
export interface CodeCommitInitLayout {
  readonly sourceRoot: string;
  readonly projectDir: string;
  readonly infrastructureName?: string;
  readonly sourcePathFromStack: ".." | "../..";
}

export async function resolveCodeCommitInitLayout(
  cwd: string,
  config: ValidatedCodeCommitInitConfig,
): Promise<CodeCommitInitLayout>;
```

Use `realpath`, `lstat`, and `access`. In sync mode only accept one basename. In no-sync mode canonicalize the existing parent and require the destination to be absent. Do not create or mutate anything in this module.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
bun test packages/cli/tests/codecommit-init-layout.test.ts
bunx tsc -p packages/cli/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/codecommit-init/layout.ts packages/cli/tests/codecommit-init-layout.test.ts
git commit -m "feat(cli): resolve safe CodeCommit project layouts"
```

## Task 8: Generate the standalone Pawl project atomically

**Files:**
- Create: `packages/cli/src/codecommit-init/generator.ts`
- Create: `packages/cli/templates/codecommit-init/.gitignore`
- Create: `packages/cli/templates/codecommit-init/package.json`
- Create: `packages/cli/templates/codecommit-init/tsconfig.json`
- Create: `packages/cli/templates/codecommit-init/cdk.json`
- Create: `packages/cli/templates/codecommit-init/index.ts`
- Create: `packages/cli/templates/codecommit-init/README.md`
- Create: `packages/cli/templates/codecommit-init/stacks/codecommit-stack.ts`
- Create: `packages/cli/templates/codecommit-init/tests/codecommit-stack.test.ts`
- Create: `packages/cli/tests/codecommit-init-generator.test.ts`

- [ ] **Step 1: Write failing template-manifest tests**

Assert the manifest contains exactly the documented files, excludes `local.dev.ts` and LocalStack dependencies, uses Bun, imports infrastructure only through `@pawl/cdk`, and renders auto-review only when selected. Assert generated `package.json` uses the registry-installable semver range `"@pawl/cdk": "^0.1.0"` and contains no `workspace:`, `file:`, or `link:` specifier.

- [ ] **Step 2: Write failing atomicity tests**

Inject a write failure halfway through generation. Assert the temporary sibling is removed, the final destination is absent, and every pre-existing sync-root file (including root `.gitignore`) remains byte-for-byte unchanged. Also assert successful generation performs one final rename.

- [ ] **Step 3: Run tests and verify RED**

```bash
bun test packages/cli/tests/codecommit-init-generator.test.ts
```

Expected: FAIL because generator/templates are missing.

- [ ] **Step 4: Implement focused template rendering**

The generated stack must have this essential shape:

```ts
import path from "node:path";
import {
  CfnOutput,
  CodeCommit,
  type Construct,
  Stack,
} from "@pawl/cdk";

export class CodeCommitStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    const codeCommit = new CodeCommit(this, "Repository", {
      repositoryName: "{{repositoryName}}",
      create: {
        sourcePath: path.resolve(import.meta.dirname, "{{sourcePathFromStack}}"),
        branchName: "{{branchName}}"{{forceIncludeProperty}},
      }{{autoReviewProperty}},
    });
    new CfnOutput(this, "RepositoryName", { value: codeCommit.repository.repositoryName });
    new CfnOutput(this, "RepositoryCloneUrlGrc", { value: codeCommit.repository.repositoryCloneUrlGrc });
    new CfnOutput(this, "BranchName", { value: "{{branchName}}" });
  }
}
```

Escape all rendered TypeScript/JSON string values with `JSON.stringify`; never interpolate raw input into source. Generated `cdk.json` must include `team` and `stage`. The generated package depends on `@pawl/cdk`, TypeScript, Bun types, and the CDK CLI; it must not depend on `@pawl/lambda`, LocalStack, or raw `aws-cdk-lib`.

- [ ] **Step 5: Implement temporary-sibling generation**

Create a temporary directory under `dirname(projectDir)`, render/write all files there, and call `rename(tempDir, projectDir)` only after every write succeeds. On any failure, recursively remove only the known temporary directory. Never edit the source root `.gitignore`.

- [ ] **Step 6: Run generator tests and a clean standalone package fixture**

```bash
bun test packages/cli/tests/codecommit-init-generator.test.ts
```

Pack `packages/cdk` as a publishable tarball, create a fresh generated project outside the monorepo, record its `package.json` bytes, and install the tarball plus declared tool dependencies with Bun's no-save mode. Do not create a workspace link and do not rewrite the generated manifest. Assert `package.json` is byte-identical before/after installation, then run:

```bash
bunx tsc --noEmit
bunx cdk synth
```

Expected: PASS and synthesized repository includes initial `Code` plus optional auto-review resources. This verifies the package tarball/consumer boundary while the semver dependency remains registry-installable for released use.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/codecommit-init/generator.ts packages/cli/templates/codecommit-init packages/cli/tests/codecommit-init-generator.test.ts
git commit -m "feat(cli): generate CodeCommit Pawl projects"
```

## Task 9: Add TTY prompts and deterministic orchestration

**Files:**
- Create: `packages/cli/src/codecommit-init/prompts.ts`
- Create: `packages/cli/src/codecommit-init/source-preflight.ts`
- Create: `packages/cli/src/codecommit-init/index.ts`
- Create: `packages/cli/tests/codecommit-init-prompts.test.ts`
- Create: `packages/cli/tests/codecommit-init-orchestration.test.ts`

- [ ] **Step 1: Write failing prompt-order tests**

Inject prompt functions and record calls. Verify the exact TTY order from the spec, model selection only for auto-review, stage default `dev`, and cancelled prompts produce a typed cancellation rather than stringifying a symbol.

- [ ] **Step 2: Write failing non-TTY orchestration tests**

Pass every required flag, set `isTTY: false`, and make every prompt dependency throw if called. Assert zero prompts, resolved layout, generation, and initial preflight occur in order. Also assert incomplete non-TTY invocations fail before filesystem writes.

- [ ] **Step 3: Write failing preflight diagnostic tests**

Adapt `analyzeCodeCommitSource` and `createCodeCommitSourceArchive` errors into concise path/size diagnostics. Create the exact ZIP under an OS temporary directory, enforce compressed size, and remove it in `finally`. Assert no content appears and no archive remains. Confirm preflight runs after generation and a second time after an injected installation mutates `bun.lock`.

- [ ] **Step 4: Run tests and verify RED**

```bash
bun test packages/cli/tests/codecommit-init-prompts.test.ts packages/cli/tests/codecommit-init-orchestration.test.ts
```

Expected: FAIL because orchestration is missing.

- [ ] **Step 5: Implement prompt adapters**

Use `@clack/prompts` with `isCancel` checks. Filter `getModels("amazon-bedrock")` to IDs matching the shared Anthropic model schema. Keep all UI behind an injectable `CodeCommitInitPromptDeps` interface.

- [ ] **Step 6: Implement preflight and two-phase command orchestration**

Expose:

```ts
export async function runCodeCommitInit(options: {
  readonly argv: string[];
  readonly cwd: string;
  readonly isTTY: boolean;
  readonly deps?: Partial<CodeCommitInitDeps>;
}): Promise<CodeCommitInitResult>;
```

TTY pipeline:

1. parse flags;
2. prompt only core project choices: repository, sync mode/path, directory, branch, team/stage, auto-review, and model;
3. validate the core config and resolve the canonical layout;
4. render the summary and prompt for confirmation;
5. resolve install: honor supplied `--install`/`--no-install`; otherwise prompt now. When install is false, resolve deploy to false without a deploy prompt (and reject a supplied `--deploy` during final validation);
6. when install is true, honor supplied `--deploy`/`--no-deploy`; otherwise prompt deploy now. When deploy is true, honor supplied `--aws-profile` and `--region`, prompting only for each missing value in profile-then-region order;
7. validate the complete config;
8. atomic generation → preflight → optional installation → final preflight → optional deployment.

Non-TTY has no prompt phases: parse all required flags, validate the complete config, resolve layout, and continue directly to generation. The orchestration function returns structured output; only the top-level CLI prints and exits. Prompt-order tests must assert the phase boundary around summary confirmation.

- [ ] **Step 7: Run focused tests and typecheck**

```bash
bun test packages/cli/tests/codecommit-init-prompts.test.ts packages/cli/tests/codecommit-init-orchestration.test.ts
bunx tsc -p packages/cli/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/codecommit-init/prompts.ts packages/cli/src/codecommit-init/source-preflight.ts packages/cli/src/codecommit-init/index.ts packages/cli/tests/codecommit-init-prompts.test.ts packages/cli/tests/codecommit-init-orchestration.test.ts
git commit -m "feat(cli): orchestrate CodeCommit initialization"
```

## Task 10: Install and optionally deploy

**Files:**
- Create: `packages/cli/src/codecommit-init/deploy.ts`
- Create: `packages/cli/tests/codecommit-init-deploy.test.ts`
- Modify: `packages/cli/src/aws-credentials.ts`

- [ ] **Step 1: Write failing install/deploy tests**

Use injected subprocess and AWS functions. Cover:

- install executes `bun install` in `projectDir`;
- deploy validates profile credentials, performs SSO login when needed, sets profile/region environment, and checks Bedrock in the explicitly selected region only for auto-review;
- a mismatched ambient/default region cannot replace the selected region in the Bedrock client configuration;
- deploy invokes `bunx cdk deploy --all --require-approval never --outputs-file <temp-file>`;
- output file is outside `sourceRoot`, parsed, and removed;
- non-zero subprocess status preserves the generated project and includes an exact retry command;
- output parsing returns repository name, branch, region, clone URL, and auto-review state.

- [ ] **Step 2: Run tests and verify RED**

```bash
bun test packages/cli/tests/codecommit-init-deploy.test.ts
```

Expected: FAIL because deploy support is missing.

- [ ] **Step 3: Add profile-region lookup and explicit Bedrock region input**

Add a small typed `getProfileRegion(profile: string): Promise<string | undefined>` helper to `aws-credentials.ts`, reusing `parseKnownFiles`. Import the already-declared `fromIni` provider and build SDK clients with `credentials: fromIni({ profile })`, never the unsupported inert `profile` client option. Change the helpers to `checkCredentials(profile?: string, region?: string)` and `checkBedrockAccess(profile?: string, region?: string)`, passing both explicit credentials and selected region to `STSClient`/`BedrockClient`. Update existing callers/tests; inject or mock the credential factory to assert the requested profile is `dev` and the client region is `eu-central-1` even when ambient configuration is `us-east-1`. Do not resolve or expose credential contents in tests/logs.

- [ ] **Step 4: Implement subprocess and deployment adapters**

Use `spawn` with `shell: false`, inherited stdio, explicit `cwd`, and an environment merge containing `AWS_PROFILE`, `AWS_REGION`, and `AWS_DEFAULT_REGION`. Create the outputs path with `mkdtemp` under `tmpdir`, not inside the source tree, and remove it in `finally`.

Because `--deploy` is explicit or interactively confirmed, use `--require-approval never` to keep non-TTY execution deterministic. Do not perform a direct Git push.

- [ ] **Step 5: Integrate install/deploy into orchestration**

Wire `installCodeCommitProject` and `deployCodeCommitProject` into Task 9's dependency interface. If install fails, return the `bun install` retry. If deploy fails, return:

```text
AWS_PROFILE=<profile> AWS_REGION=<region> bunx cdk deploy --all
```

- [ ] **Step 6: Run focused tests and typecheck**

```bash
bun test packages/cli/tests/codecommit-init-deploy.test.ts packages/cli/tests/codecommit-init-orchestration.test.ts
bunx tsc -p packages/cli/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/codecommit-init/deploy.ts packages/cli/src/aws-credentials.ts packages/cli/src/codecommit-init/index.ts packages/cli/tests/codecommit-init-deploy.test.ts packages/cli/tests/codecommit-init-orchestration.test.ts
git commit -m "feat(cli): deploy generated CodeCommit projects"
```

## Task 11: Dispatch the new command from the CLI

**Files:**
- Modify: `packages/cli/index.ts`
- Create: `packages/cli/tests/codecommit-init-entrypoint.test.ts`

- [ ] **Step 1: Write a failing dispatch test**

Extract/inject only the init dispatcher so tests do not start the interactive infrastructure agent. Verify:

- `init codecommit` calls `runCodeCommitInit` with arguments after the subcommand;
- generic `init` retains `runPawlInit` behavior;
- non-init arguments fall through to existing AWS/model/TUI startup;
- errors set exit code 1 and do not continue into another command.

- [ ] **Step 2: Run the test and verify RED**

```bash
bun test packages/cli/tests/codecommit-init-entrypoint.test.ts
```

Expected: FAIL because `init codecommit` is consumed by the generic parser.

- [ ] **Step 3: Implement subcommand-first dispatch**

Keep `index.ts` behavior unchanged except for an earlier branch:

```ts
if (argv[0] === "init" && argv[1] === "codecommit") {
  const result = await runCodeCommitInit({
    argv: argv.slice(2),
    cwd: process.cwd(),
    isTTY: process.stdin.isTTY === true && process.stdout.isTTY === true,
  });
  printCodeCommitInitResult(result);
  process.exit(0);
}
```

Move the tiny branch decision into an exported, injected helper if necessary for tests; do not refactor the unrelated model-selection loop.

- [ ] **Step 4: Run CLI regression tests**

```bash
bun test packages/cli/tests/codecommit-init-entrypoint.test.ts packages/cli/tests/scaffold-cli.test.ts packages/cli/tests/scaffold-init.test.ts packages/cli/tests/scaffold-install.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/index.ts packages/cli/tests/codecommit-init-entrypoint.test.ts
git commit -m "feat(cli): dispatch CodeCommit init subcommand"
```

## Task 12: Documentation, migration note, and end-to-end verification

**Files:**
- Modify: `packages/cli/README.md`
- Modify: `packages/cdk/src/codecommit.ts` (JSDoc only if Task 5 did not fully cover it)
- Modify: `packages/cli/templates/codecommit-init/README.md`
- Create: `CHANGELOG.md`

- [ ] **Step 1: Add CLI documentation**

Document interactive and fully flagged examples, `--sync .`, direct-child `--directory` semantics, non-TTY required flags, Anthropic-only auto-review, prod network-policy rejection, source limits, retained repositories, and the initial-seeding-only warning. Compare the README flag table to `formatCodeCommitInitHelp()` in a test so CLI help cannot silently omit a documented option.

- [ ] **Step 2: Add public API migration documentation and versioning**

Create `CHANGELOG.md` with an `Unreleased / 0.1.0` note matching the package version bump from Task 5. In `CodeCommit` JSDoc and the changelog, state that `events` changed from required to optional in the pre-1.0 API and show narrowing:

```ts
if (codeCommit.events === undefined) {
  throw new Error("Expected review event resources");
}
```

Do not edit generated TypeDoc directories. Run `rg -n 'new CodeCommit|\.events' packages example --glob '*.ts'`, inventory every internal consumer, and update/narrow any affected usage in the same task. Record when the inventory is empty rather than assuming it.

- [ ] **Step 3: Live-check AWS initial-import quotas**

Open or fetch the official CloudFormation Code property, CodeCommit quotas, and CreateCommit API pages linked in the specification. Verify 4 MB compressed, 20 MB uncompressed, 100 files, 6 MB per file, and 4,096-character paths. Record the access date and primary links in `CHANGELOG.md` or generated README source-limit documentation. If the current primary documentation differs, stop and update the specification/implementation constants before proceeding.

- [ ] **Step 4: Verify generated synced and new-root fixtures**

Generate both modes in temporary directories. For sync mode, pre-create a root `.gitignore` containing `infra/`, a nested secret, and an existing application file. Assert generated infrastructure is included by analysis, denied content is excluded, and existing bytes are unchanged.

For each generated project, start from an empty external `node_modules`, install the packed `@pawl/cdk` tarball and declared tools with `--no-save`, assert the registry-semver `package.json` is unchanged, then run:

```bash
bun run test
bunx tsc --noEmit
bunx cdk synth
```

Expected: PASS.

- [ ] **Step 5: Run package and repository verification**

Run exactly:

```bash
bun lint
bun test
bun run build
```

Expected: all commands exit 0 with zero lint errors and zero failing tests.

If Docker-only integration tests are unavailable, run every non-Docker suite and report the skipped command explicitly rather than claiming full success.

- [ ] **Step 6: Inspect the final diff for boundaries**

```bash
git diff --check
git status --short
git diff --stat
```

Confirm:

- no changes under `cdk.out/` or generated TypeDoc directories;
- no new monorepo dependency;
- no raw `aws-cdk-lib` imports in generated consumer source;
- no root `.gitignore` mutation in sync fixtures;
- unrelated pre-existing changes remain intact.

- [ ] **Step 7: Commit documentation, package version, and verified lockfile changes**

```bash
git add packages/cli/README.md packages/cdk/src/codecommit.ts packages/cli/templates/codecommit-init/README.md CHANGELOG.md
git commit -m "docs: release CodeCommit project initialization"
```

- [ ] **Step 8: Request final code review**

Use @superpowers:requesting-code-review against the specification and this plan. Address evidence-backed findings, rerun focused tests after each fix, then repeat the full verification commands before claiming completion.
