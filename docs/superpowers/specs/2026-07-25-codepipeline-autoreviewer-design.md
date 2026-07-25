# CodePipeline with Auto-Reviewer Design

**Date:** 2026-07-25
**Status:** Approved design; spec review in progress

## Goal

Add a standalone `pawl init codepipeline` CLI command and a `CodePipeline` `@pawl/cdk` construct that creates a CI/CD pipeline for a CodeCommit repository, with optional durable auto-review. The pipeline runs CI stages on branch pushes (default) or PR events (`--on-pr`), and optionally runs AI review in parallel — all coordinated through an extended router Lambda backed by a shared runtime module.

## Decisions

- **Single `CodePipeline` construct:** One construct handles CI/CD with optional `autoReview`. No separate pipeline+reviewer construct. When `autoReview` is enabled, the construct creates the pipeline, reviewer Lambda, router, state table, and event routing — all wired together.
- **Trigger mode (`onPullRequest`):** Default is push-triggered (standard CodePipeline source detection on branch pushes). When `onPullRequest: true`, the pipeline's CodeCommit source uses `trigger: CodeCommitTrigger.NONE` and the router starts executions explicitly on PR events with `sourceRevision` set to the PR's source commit.
- **Parallel execution in `--on-pr` mode:** When `onPullRequest` and `autoReview` are both enabled, the router starts the pipeline execution and invokes the durable reviewer simultaneously on PR events via `Promise.allSettled`. Each settles independently; a failure in one does not block the other. Results posted as separate comments.
- **Independent operation in push mode:** When `onPullRequest` is false (default) and `autoReview` is enabled, the pipeline triggers on branch pushes independently, while the reviewer operates on PR events via EventBridge as before. No coordination between pipeline and reviewer — they coexist without wiring.
- **Common runtime module:** Shared runtime dispatch logic (not CDK synthesis code) extracted into `pipeline-review-common.ts`. Accepts runtime interfaces (pipeline transport, state store, comment poster) — not CDK construct objects. Both the `CodePipeline` router (when `onPullRequest` + `autoReview`) and the existing `CodeCommitAutoReviewer` router use it.
- **Refactor existing:** `CodeCommitAutoReviewer`'s router is refactored to delegate pipeline-start and comment-post to the common module with `pipeline: undefined` (event-only mode). The existing `EventRouter` state machine is preserved — the common module extends it, not replaces it.
- **PR-to-pipeline mapping via DynamoDB:** `StartPipelineExecution` has no metadata parameter. The router persists `executionId → { pullRequestId, repositoryName, sourceCommitId, destinationCommitId }` in the DynamoDB state table after starting an execution. Pipeline execution state change events are resolved through this mapping.
- **Pipeline-compatible build projects:** The existing `CodeBuildProject` uses `Source.codeCommit(...)` which is incompatible with CodePipeline. A `pipelineMode` option on `CodeBuildProject` uses a placeholder `Source.s3(...)` (CodeBuild requires a source prop, but CodePipeline's `CodeBuildAction` overrides it at execution time) and suppresses the internal buildspec.
- **Initial action set:** `codebuild`, `manualApproval`, `lambda`, `s3Deploy`, `cloudFormationDeploy`. `codeBuildDeploy`, `ecsDeploy`, `appConfig` deferred.
- **Separate CLI command:** `pawl init codepipeline` imports an existing CodeCommit repository by name.

## Non-goals

- Replacing the existing event-only `CodeCommitAutoReviewer` (it's refactored, not removed).
- Adding a `--pipeline` flag to `pawl init codecommit` (separate command instead).
- CodePipeline cross-account deployments in the initial version.
- `codeBuildDeploy`, `ecsDeploy`, or `appConfig` actions in the initial version.
- Local source seeding (the pipeline command imports an existing repository).

## Common Runtime Module

### `packages/cdk/src/reviewer/pipeline-review-common.ts`

A **runtime-only** module (imported by Lambda handlers, not by CDK construct code). It accepts runtime interfaces, not CDK construct objects.

#### Runtime interfaces

```ts
/** Runtime transport for starting and monitoring pipeline executions. */
interface PipelineTransport {
  startExecution(params: {
    readonly pipelineName: string;
    readonly sourceRevision?: string;
  }): Promise<{ readonly executionId: string }>;
  getExecution(params: {
    readonly pipelineName: string;
    readonly executionId: string;
  }): Promise<PipelineExecutionSummary>;
}

interface PipelineExecutionSummary {
  readonly status: "Succeeded" | "Failed" | "Stopped" | "InProgress" | "Stopping" | "Superseded" | string;
  readonly stageSummaries: ReadonlyArray<{
    readonly stageName: string;
    readonly actionStates: ReadonlyArray<{
      readonly actionName: string;
      readonly status: string;
    }>;
  }>;
}

/** Runtime store for execution-to-PR mapping. */
interface PipelineMappingStore {
  putMapping(params: {
    readonly executionId: string;
    readonly pullRequestId: string;
    readonly repositoryName: string;
    readonly sourceCommitId: string;
    readonly destinationCommitId: string;
  }): Promise<void>;
  getMapping(executionId: string): Promise<{
    readonly pullRequestId: string;
    readonly repositoryName: string;
    readonly sourceCommitId: string;
    readonly destinationCommitId: string;
  } | undefined>;
}

/** Runtime comment poster (shared with existing review comment posting). */
interface PrCommentPoster {
  postComment(params: {
    repositoryName: string;
    pullRequestId: string;
    content: string;
  }): Promise<void>;
}
```

#### Pipeline dispatch coordinator

```ts
interface PipelineDispatchConfig {
  readonly pipelineTransport?: PipelineTransport;
  readonly pipelineName?: string;
  readonly mappingStore: PipelineMappingStore;
  readonly commentPoster: PrCommentPoster;
}

/**
 * Start a pipeline execution for a PR and persist the mapping.
 * No-op when pipelineTransport is undefined (event-only mode).
 */
async function startPipelineForPr(
  params: {
    readonly pullRequestId: string;
    readonly repositoryName: string;
    readonly sourceCommitId: string;
    readonly destinationCommitId: string;
  },
  config: PipelineDispatchConfig,
): Promise<void>;

/**
 * Handle a CodePipeline Execution State Change event.
 * Resolves the PR mapping, formats results, and posts a comment.
 * Ignores events without a mapping (manual triggers, non-PR pushes).
 */
async function handlePipelineExecutionEvent(
  event: { readonly executionId: string; readonly pipelineName: string },
  config: PipelineDispatchConfig,
): Promise<void>;
```

The existing `EventRouter` in `packages/cdk/src/reviewer/router/event-router.ts` is **extended**, not replaced. The common module adds `startPipelineForPr` and `handlePipelineExecutionEvent` as separate functions called alongside the existing dispatch logic.

## Pipeline-Compatible Build Project

### Problem

The existing `CodeBuildProject` uses `Source.codeCommit({ repository })` which hardwires the source to CodeCommit direct checkout. CodePipeline build actions override the project's source at execution time via `CodeBuildAction`, so the project's own `source` prop is irrelevant — but CodeBuild's `Project` construct still requires a `source` prop. A placeholder `Source.s3(...)` satisfies this requirement without creating a real S3 dependency. The existing project also generates a no-op buildspec internally, which must be suppressed in pipeline mode since the pipeline action supplies the buildspec.

### Solution

Add a `pipelineMode` option to `CodeBuildProjectProps`:

```ts
export interface CodeBuildProjectProps {
  // ... existing props ...
  /** When true, configures the project for CodePipeline artifact input. */
  readonly pipelineMode?: boolean;
}
```

When `pipelineMode` is true:
- Source is `Source.s3({ bucket: artifactBucket, path: 'pipeline-placeholder' })` as a required placeholder. The placeholder S3 source is never read in practice.
- No internal buildspec is generated — the pipeline action supplies the buildspec via `buildspecOverride`.
- The project still inherits all existing security (KMS, network policy, retention, cdk-nag).
- The `repository`/`repositoryName` props are optional. The `CodeBuildRepositoryTarget` intersection is relaxed: when `pipelineMode` is true, neither is required, and `normalizeCodeBuildRepositoryTarget` is skipped.

When `pipelineMode` is false or omitted (existing behavior): unchanged.

## `CodePipeline` Construct

### API

```ts
export interface CodePipelineProps {
  /** Source configuration — CodeCommit, S3, or GitHub. */
  readonly source: PipelineSource;
  /** Ordered stage definitions. Defaults to Source → Build → ManualApproval. */
  readonly stages?: PipelineStage[];
  /** Cross-account artifact bucket KMS key (auto-created by default). */
  readonly artifactEncryptionKey?: IKey;
  /** When true, pipeline only triggers on PR events (router starts executions). Default: false (push-triggered). */
  readonly onPullRequest?: boolean;
  /** When set, deploys the durable auto-reviewer and wires it to the pipeline. */
  readonly autoReview?: AutoReviewConfig;
  /** Team/stage overrides (required when autoReview is set). */
  readonly team?: string;
  readonly stage?: string;
}
```

### Source configuration

```ts
export type PipelineSource =
  | { readonly type: "codecommit"; readonly repository: IRepository; readonly branchName?: string }
  | { readonly type: "s3"; readonly bucket: IBucket; readonly objectKey: string }
  | { readonly type: "github"; readonly repository: string; readonly branch: string; readonly connectionArn: string };
```

### Stage and action configuration (initial set)

```ts
export interface PipelineStage {
  readonly name: string;
  readonly actions: PipelineAction[];
}

export type PipelineAction =
  | {
      readonly type: "codebuild";
      readonly name?: string;
      readonly project: CodeBuildProject;
      readonly inputArtifact?: string;
      readonly outputArtifacts?: readonly string[];
    }
  | {
      readonly type: "manualApproval";
      readonly name?: string;
      readonly description?: string;
    }
  | {
      readonly type: "lambda";
      readonly name?: string;
      readonly handler: LambdaFunction;
      readonly inputs?: Record<string, string>;
    }
  | {
      readonly type: "s3Deploy";
      readonly name?: string;
      readonly bucket: IBucket;
      readonly inputArtifact: string;
      readonly objectKey: string;
    }
  | {
      readonly type: "cloudFormationDeploy";
      readonly name?: string;
      readonly stackName: string;
      readonly templatePath: string;
      readonly inputArtifact: string;
      readonly actionMode?: "CREATE_UPDATE" | "REPLACE_ON_FAILURE";
      readonly capabilities?: readonly ("CAPABILITY_IAM" | "CAPABILITY_NAMED_IAM" | "CAPABILITY_AUTO_EXPAND")[];
    };
```

Each action explicitly models artifact dependencies. The construct creates the underlying CDK action with correct artifact wiring. For `codebuild` actions, the user supplies a pre-created `CodeBuildProject` with `pipelineMode: true`.

### Default pipeline

When `stages` is omitted:
- **Source stage** — CodeCommit source action.
- **Build stage** — a `CodeBuildProject` with `pipelineMode: true` and safe defaults.
- **ManualApproval stage** — human approval gate.

### Internal structure

```
CodePipeline (extends BasicConstruct)
├── artifactBucket (S3, KMS-encrypted, customer-managed key)
├── pipeline (aws-codepipeline.Pipeline)
│   ├── SourceStage
│   ├── [user stages or default Build + ManualApproval]
├── [when onPullRequest] CodeCommitTrigger.NONE on source action
├── [when autoReview] DynamoDbTable (state + execution-to-PR mapping)
├── [when autoReview] DurableLambdaFunction (reviewer)
├── [when autoReview] LambdaFunction (router, extended)
├── [when autoReview] CodeBuildProject[] (review checks)
├── [when autoReview] CodeCommitReviewEvents[] (PR EventBridge rules)
├── [when autoReview + onPullRequest] EventBridge Rule (pipeline execution state change)
└── [when autoReview] Bedrock IAM (anthropic.* grant)
```

### Trigger modes

**Push mode (default, `onPullRequest: false`):**
- Pipeline uses standard CodePipeline source detection — triggers on branch pushes.
- If `autoReview` is enabled, the reviewer operates independently on PR events via EventBridge. Pipeline and reviewer coexist without coordination.

**PR mode (`onPullRequest: true`):**
- Pipeline's CodeCommit source uses `trigger: CodeCommitTrigger.NONE` — no automatic detection.
- Router starts executions explicitly via `StartPipelineExecution` with `sourceRevision` set to the PR's source commit.
- If `autoReview` is enabled, router starts pipeline and invokes durable reviewer in parallel via `Promise.allSettled`.
- CI results posted as PR comments via the common module.

### What `autoReview` creates

When `autoReview` is set, the construct creates the same infrastructure as `CodeCommitAutoReviewer` (reviewer Lambda, router, state table, CodeBuild review projects, Bedrock IAM, CodeCommit EventBridge rules) plus:
- When `onPullRequest: true`: pipeline EventBridge rule, `codepipeline:StartPipelineExecution`/`GetPipelineExecution` IAM grants, `@aws-sdk/client-codepipeline` runtime transport in router.
- When `onPullRequest: false`: no pipeline-specific router wiring — reviewer operates independently.

### Runtime transports (onPullRequest + autoReview only)

The router handler is extended with:
- `CodePipelineClient` from `@aws-sdk/client-codepipeline` (new dependency, requires explicit approval per AGENTS.md) — wrapped in a `PipelineRuntimeTransport` implementing `PipelineTransport`.
- DynamoDB mapping store — `PK=EXEC#<executionId>`, `SK=META` item format.
- CodeCommit comment poster — existing client wrapped to implement `PrCommentPoster`.

IAM grants added to the router role (onPullRequest + autoReview only):
- `codepipeline:StartPipelineExecution` scoped to the pipeline ARN.
- `codepipeline:GetPipelineExecution` scoped to the pipeline ARN.

### Relationship to existing constructs

- **`CodeCommitAutoReviewer`** (refactored) — event-only review, no pipeline. Uses common module with `pipeline: undefined`. API preserved.
- **`CodePipeline`** — pipeline + optional review. Single construct for all combinations.
- **`CodeCommit`** — unchanged, still uses `CodeCommitAutoReviewer` for `autoReview`.

## Refactoring Existing Constructs

### `CodeCommitAutoReviewer`

The existing router handler is refactored to:
1. Compose `PipelineDispatchConfig` with `pipelineTransport: undefined` from environment variables.
2. Call `startPipelineForPr` (no-op) alongside existing durable reviewer invocation.
3. Register `handlePipelineExecutionEvent` as a handler for pipeline EventBridge events (no events arrive since no rule is created).

The existing `EventRouter` state machine is preserved. The construct's public API is unchanged.

### `CodeCommit` and `CodeBuildProject`

`CodeCommit` is unchanged. `CodeBuildProject` gains the optional `pipelineMode` prop. Existing review-mode usage is unchanged.

### New exports

```ts
export * from "./src/reviewer/pipeline-review-common";
export * from "./src/codepipeline";
```

## CLI — `pawl init codepipeline`

### Command

```bash
pawl init codepipeline \
  --source codecommit \
  --source-name my-repo \
  --source-branch main \
  --pipeline-stage codebuild \
  --pipeline-stage manualApproval \
  --on-pr \
  --autoreviewer \
  --model eu.anthropic.claude-sonnet-4-6 \
  --team platform \
  --stage dev \
  --install \
  --deploy \
  --aws-profile dev \
  --region eu-central-1
```

### Flags

| Flag | Behavior |
|---|---|
| `--source <type>` | Source type: `codecommit` (required). |
| `--source-name <name>` | CodeCommit repository name (import existing). Required. |
| `--source-branch <name>` | Source branch. Default: `main`. |
| `--pipeline-stage <spec>` | Repeatable. Pipeline stage action. Optional — defaults to Build + ManualApproval. |
| `--on-pr` / `--on-pull-request` | PR-gated mode: pipeline only triggers on PR events. Default: push-triggered. |
| `--autoreviewer` / `--no-autoreviewer` | Enable/disable auto-review. |
| `--model <model-id>` | Anthropic Bedrock model ID. Required with `--autoreviewer` in non-TTY. |
| `--team <team>` | Pawl resource tag. Required in non-TTY. |
| `--stage <dev\|qa\|prod>` | Pawl stage. Default: `dev`. |
| `--install` / `--no-install` | Install dependencies. |
| `--deploy` / `--no-deploy` | Deploy after installation. |
| `--aws-profile <profile>` | Deployment profile. |
| `--region <region>` | Deployment region. |
| `--help` | Show help. |

### CLI action grammar

`--pipeline-stage` accepts:
- `codebuild` — generates a build stage with a pipeline-mode CodeBuildProject and safe defaults.
- `manualApproval` — generates a manual approval gate.
- `lambda:<handlerName>` — generates a Lambda invoke action.
- `s3Deploy:<bucketName>:<objectKey>` — generates an S3 deploy action.
- `cloudFormationDeploy:<stackName>` — generates a CloudFormation deploy action.

### Non-TTY requirements

`--source`, `--source-name`, `--team`, exactly one of `--autoreviewer`/`--no-autoreviewer`, exactly one of `--install`/`--no-install`, exactly one of `--deploy`/`--no-deploy`. `--model` required with `--autoreviewer`. `--aws-profile` and `--region` required with `--deploy`. `--pipeline-stage` and `--on-pr` optional.

### Generated project

```ts
// Push-triggered with auto-review (pipeline on push, reviewer on PR):
new CodePipeline(this, "Pipeline", {
  source: {
    type: "codecommit",
    repository: Repository.fromRepositoryName(this, "Repo", "my-repo"),
    branchName: "main",
  },
  autoReview: { modelId: "eu.anthropic.claude-sonnet-4-6" },
});

// PR-gated with auto-review (parallel CI + AI review on PR):
new CodePipeline(this, "Pipeline", {
  source: {
    type: "codecommit",
    repository: Repository.fromRepositoryName(this, "Repo", "my-repo"),
    branchName: "main",
  },
  onPullRequest: true,
  autoReview: { modelId: "eu.anthropic.claude-sonnet-4-6" },
});

// Push-triggered, no review:
new CodePipeline(this, "Pipeline", {
  source: {
    type: "codecommit",
    repository: Repository.fromRepositoryName(this, "Repo", "my-repo"),
    branchName: "main",
  },
});
```

### Module structure

```
packages/cli/src/codepipeline-init/
├── cli.ts
├── config.ts
├── prompts.ts
├── generator.ts
└── index.ts
```

Reuses `layout.ts` and `deploy.ts` from `codecommit-init/`. CLI entrypoint dispatches `pawl init codepipeline` before generic `pawl init`.

## Error Handling

### Pipeline failures

In `onPullRequest` mode, execution failures are surfaced via the Execution State Change event. The router fetches execution details, formats a failure summary, and posts it as a PR comment. If the router fails to start a pipeline execution, it logs the error; AI review still runs independently via `Promise.allSettled`.

In push mode, pipeline failures are visible in the CodePipeline console. No PR comment posting since there is no PR context.

### Metadata resolution

If a pipeline execution state change arrives without a DynamoDB mapping (manual trigger, non-PR push, expired mapping), the router ignores it. If the PR no longer exists, the router catches the CodeCommit exception and logs without retrying.

### Race conditions

Pipeline execution mode is `SUPERSEDED`. The router starts a new execution with the latest commit; the old execution's terminal event is handled but marked as superseded via a generation counter. Mapping items include an `expiresAt` TTL.

### CI result formatting

The router fetches execution details via `GetPipelineExecution`. The formatted comment includes overall status, per-stage status, and failed action name. CodeBuild logs are not fetched in the initial version — linked via the CodePipeline console URL instead.

## Testing

### CDK tests

- `CodePipeline` push mode — synthesize with CodeCommit source, default stages. Assert pipeline structure, source detection enabled, no router/reviewer when `autoReview` is absent.
- `CodePipeline` push mode + autoReview — assert pipeline + reviewer + EventBridge PR rules, no pipeline EventBridge rule, no `codepipeline:*` grants.
- `CodePipeline` PR mode + autoReview — assert `CodeCommitTrigger.NONE`, pipeline EventBridge rule, `codepipeline:StartPipelineExecution`/`GetPipelineExecution` grants scoped to pipeline ARN.
- `CodeBuildProject` pipeline mode — assert `Source.s3` placeholder, no internal buildspec, optional repository target, existing mode unchanged.
- Common module — unit test `startPipelineForPr` and `handlePipelineExecutionEvent` with mock transports.
- Refactored `CodeCommitAutoReviewer` — regression test: no pipeline EventBridge rule, existing behavior unchanged.
- Action union — each action type creates correct CDK action with correct props.
- cdk-nag compliance.

### CLI tests

- Parse all flags including `--on-pr` and repeatable `--pipeline-stage`.
- Non-TTY validation matrix.
- Generated project typechecks and synthesizes for all combinations.
- Generated project with `--on-pr --autoreviewer` includes `CodePipeline` with `onPullRequest: true` and `autoReview`.

## Security

- Pipeline artifact bucket is KMS-encrypted with a customer-managed key.
- `CodeBuildProject` with `pipelineMode: true` inherits all existing security.
- Router's `codepipeline:*` grants scoped to the specific pipeline ARN (onPullRequest mode only).
- Router's `codecommit:PostCommentForPullRequest` grant scoped to the repository ARN (existing).
- Pipeline EventBridge rule scoped to the specific pipeline ARN (onPullRequest mode only).
- cdk-nag suppressions narrowly scoped with documented reasons.

## Documentation

- JSDoc on all exported constructs, interfaces, action types, and common module functions.
- CLI README section for `pawl init codepipeline`.
- CHANGELOG entry.
- Generated project README explains the pipeline structure, stages, trigger modes, and CI result comment format.
