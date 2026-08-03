# durable-lambda-reviewer

Two example stacks demonstrating Pawl's durable auto-review constructs:

1. **`DurableLambdaReviewerStack`** — Event-only review using `CodeCommitAutoReviewer`
2. **`CodePipelineReviewerStack`** — PR-gated CI + AI review using `CodePipeline`

## Stack 1: Event-only review (`CodeCommitAutoReviewer`)

A durable CodeCommit pull-request reviewer built on AWS Lambda Durable
Execution, Pawl CDK constructs, Amazon Bedrock, CodeBuild, and DynamoDB.

```
CodeCommit PR/comment events
        │
        ▼
 EventBridge ──► router Lambda ──► (invoke) ──► durable reviewer Lambda
 (per-repo rules, DLQ)            (claim/dedupe)    │
                                                    ▼
                          ┌─────────────────────────┴──────────────────────┐
                          ▼                  ▼                  ▼            ▼
                     CodeBuild checks   Bedrock review    reconciler    DynamoDB state
                     (per-repo project) (Claude)          (post/update   table (shared)
                                                          comments)
```

- **Router** — normal Lambda; normalizes + deduplicates CodeCommit events,
  claims them per generation, and invokes the durable reviewer.
- **Reviewer** — durable Lambda; loads the PR snapshot + `.pawl/reviewer.json`,
  runs CodeBuild checks, calls Bedrock for review, and reconciles findings
  (post/update comments). Replays are safe: every store mutation is inside a
  durable `step`.
- **Per repository** — one CodeBuild project + one CodeCommit event construct.
- **Shared** — one reviewer, one router, one DynamoDB state table.

## Stack 2: PR-gated CI + AI review (`CodePipeline`)

A CodePipeline CI/CD pipeline with durable auto-review. When a pull request is
opened, the router starts a pipeline execution and invokes the durable
reviewer in parallel. CI build results and AI review comments are posted
independently as they complete.

```
CodeCommit PR event
        │
        ▼
 router Lambda
  ├──► StartPipelineExecution (sourceRevision = PR commit)
  │         │
  │         ▼
  │    Source → Build + AIReview bridge → Approve
  │               │          │
  │               │          └──► register pending pipeline job
  │               └──► CodeBuild
  │
  └──► start/wake durable reviewer ──► Bedrock/comments ──► outcome
                                                            │
                         AIReview callback ◄── reconciler ◄──┘
```

- **Managed source** — Fluent `CodePipeline.source()` creates and initially
  seeds the CodeCommit repository directly from this example; `sync` is a seed
  asset, not ongoing synchronization.
- **Pipeline** — `CodePipeline` with `onPullRequest: true` and
  `autoReviewer: { modelId }` disables the native source trigger. The router
  starts executions explicitly with the PR's source commit.
- **Build stage** — `CodeBuildProject` in `pipelineMode` runs the repo's
  `buildspec.yml`; fluent artifact inference wires `SourceOutput` to the build
  and creates `BuildOutput` automatically. In active review coordination, Pawl
  also inserts `AIReview` into this first user stage as a parallel action.
- **Approve stage** — A later stage provides a sequential manual approval gate
  before merge.
- **Auto-review** — The bridge coordinates the durable reviewer with the
  pipeline while review comments remain replay-safe.

### Fluent stages and artifacts

`.stage({ ... })` adds one stage. `.stage([{ ... }, { ... }])`, as used by this
example, adds its stage objects sequentially in list order. Actions in the same
stage object run in parallel against the same pre-stage artifacts, so an
approval and the deployment it protects belong in separate stage objects.

Input inference is safe while there is exactly one current artifact. A
CodeBuild action also creates `<SanitizedActionName>Output` unless `outputs` is
set explicitly or disabled. When parallel producers leave more than one
artifact, a downstream consumer must use explicit artifact names, for example
`input: "WebOutput"`; otherwise Pawl throws `PipelineDefinitionError` with code
`ARTIFACT_INPUT_AMBIGUOUS`.

CodeCommit source ownership is explicit:

- `{ create: true, repositoryName, sync? }` creates a Pawl-owned repository and
  can seed it during deployment;
- `{ create: false, repositoryName }` imports an existing repository by name;
- `{ repository }` reuses a supplied `IRepository` construct (with an optional
  literal `repositoryName` fallback for tokenized names used by auto-review).

These ownership forms cannot be combined. `branchName` defaults to `main` in
all three forms.

### Trigger and reviewer modes

`onPullRequest` and `autoReviewer` are independent:

| `onPullRequest` | `autoReviewer` | Behavior |
|---|---|---|
| omitted/false | omitted | Native default-branch pipeline trigger |
| true | omitted | Exact-revision PR pipeline router, no AI reviewer |
| omitted/false | present | Native pipeline trigger plus standalone AI reviewer |
| true | present | PR router plus durable `AIReview` bridge in the pipeline |

Team and deployment stage are CDK context values (`team` and `stage`) consumed
by `BasicConstruct` for naming, tags, and reviewer identity. They are not
`CodePipeline` props. `pawl init codepipeline` writes this context and generates
an editable `Approval` stage so a new pipeline is synthesis-complete without
inventing a build or deployment target.

### Deploy Stack 2

```bash
bunx cdk deploy CodePipelineReviewerStack
```

## Package manager

- bun

## AWS

- Profile: `jolo`

## Quick start

```bash
bun install
bun run deploy        # AWS_PROFILE=jolo bunx cdk deploy --all
```

See [docs/operations/deploy.md](./docs/operations/deploy.md) for context
variables, multi-repo onboarding, and production constraints.

## Testing

### Unit, construct, and security tests (default suite)

```bash
bun test              # unit + construct + synth-security
bunx tsc --noEmit
bunx cdk synth
bun run lint
bun run fmt:check
```

### AWS integration tests (opt-in, live)

These exercise the full pipeline against disposable CodeCommit repositories and
a deployed stack. They are **skipped** unless explicitly enabled.

```bash
RUN_AWS_INTEGRATION=1 \
AWS_PROFILE=jolo \
AWS_REGION=eu-central-1 \
PAWL_TEST_REPO_A=<disposable-repo> \
PAWL_TEST_REPO_B=<disposable-repo-2> \
PAWL_TEST_STACK_NAME=<deployed-stack> \
bun test tests/aws
```

See [tests/aws/integration-harness.ts](./tests/aws/integration-harness.ts) for
the required environment variables.

## Operations

- [Deployment & onboarding](./docs/operations/deploy.md)
- [Alerts & runbooks](./docs/operations/alerts.md)
- [Repository configuration (`.pawl/reviewer.json`)](./docs/operations/repository-config.md)
