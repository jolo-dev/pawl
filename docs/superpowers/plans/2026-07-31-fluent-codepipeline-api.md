# Fluent CodePipeline API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace constructor-defined CodePipeline sources and stages with the approved fluent source/stage API, preserve durable review behavior, support PR pipelines without an AI reviewer, and migrate the CodePipeline CLI generator.

**Architecture:** Keep `CodePipeline` as the eager CDK construct, but move source planning, action adaptation, artifact flow, naming, and typed errors into focused `pipeline/` modules. `.source()` materializes one validated CodeCommit source; `.stage()` accepts one stage object or an atomic non-empty batch of sequential stage objects. A reusable PR routing path uses the existing exact-revision transport both with and without AutoReviewer, while the CLI emits the same public fluent API.

**Tech Stack:** TypeScript 6 strict mode, Bun test, Zod 4, AWS CDK V2 CodePipeline/CodeCommit/CodeBuild/Lambda/S3/CloudFormation actions, DynamoDB-backed reviewer routing, Biome, Testcontainers LocalStack.

**Specification:** `docs/superpowers/specs/2026-07-31-fluent-codepipeline-api-design.md`

---

## Scope and safety constraints

- This is a deliberate pre-1.0 breaking API change: do not keep deprecated constructor `source`/`stages` overloads.
- Keep `CodePipeline` as the public class name.
- Do not add dependencies.
- Do not modify generated `cdk.out/` or generated TypeDoc trees.
- Keep `team` and deployment `stage` in CDK context; do not add them to `CodePipelineProps`.
- Do not weaken exact-revision, durable callback, timeout, IAM, or sensitive-history tests.
- Do not push or deploy AWS resources during implementation.
- For LocalStack, retrieve `/pawl/localstack/token` from SSM without printing it and expose it only as `LOCALSTACK_AUTH_TOKEN` to the container process.
- Full repository lint/test have known unrelated failures on this branch. The feature must leave every focused gate green and introduce no new full-suite failures; report the pre-existing repository-wide baseline separately.

## File map

### New focused CDK modules

- `packages/cdk/src/pipeline/errors.ts` — public stable `PipelineDefinitionError` codes and paths.
- `packages/cdk/src/pipeline/naming.ts` — stage/default-artifact validation, sanitization, and fixed SHA-256 truncation.
- `packages/cdk/src/pipeline/artifacts.ts` — pure artifact registry/frontier planner.
- `packages/cdk/src/pipeline/source.ts` — CodeCommit source union, Zod validation, ownership planning, and materialization.
- `packages/cdk/src/pipeline/actions.ts` — public action unions, runtime schemas, and AWS action adapters.
- `packages/cdk/src/pipeline/pull-request-router.ts` — CDK resources for PR-only pipeline routing when AutoReviewer is absent.
- `packages/cdk/src/reviewer/router/pipeline-event-router.ts` — reusable PR-to-pipeline routing flow shared by reviewed and non-reviewed PR pipelines.

### Existing CDK modules

- `packages/cdk/src/codepipeline.ts` — eager pipeline lifecycle and fluent orchestration only.
- `packages/cdk/src/reviewer/router/event-router.ts` — delegate pipeline dispatch to the extracted reusable router and allow pipeline-only mode.
- `packages/cdk/src/reviewer/handlers/router.ts` — compose either review+pipeline or pipeline-only routing from environment.
- `packages/cdk/src/reviewer/pipeline-review-common.ts` — retain exact revision arbitration/dispatch; add a no-op reconciler only if the pipeline-only composition needs it.
- `packages/cdk/index.ts` — ensure all approved public types/errors remain exported through `codepipeline.ts`.

### CDK tests

- Create `packages/cdk/tests/pipeline-errors.test.ts`.
- Create `packages/cdk/tests/pipeline-naming.test.ts`.
- Create `packages/cdk/tests/pipeline-artifacts.test.ts`.
- Create `packages/cdk/tests/pipeline-source.test.ts`.
- Create `packages/cdk/tests/pipeline-actions.test.ts`.
- Create `packages/cdk/tests/pipeline-event-router.test.ts`.
- Create `packages/cdk/tests/codepipeline-types.test.ts`.
- Create `packages/cdk/tsconfig.pipeline-types.json`.
- Modify `packages/cdk/tests/codepipeline.test.ts`.
- Modify `packages/cdk/tests/codepipeline-explicit-name.test.ts`.
- Modify `packages/cdk/tests/codepipeline-review-coordination-deployment-phase.test.ts`.
- Modify `packages/cdk/tests/codepipeline-bridge.test.ts`.
- Modify `packages/cdk/tests/integration/codepipeline.test.ts`.
- Modify existing reviewer router/dispatcher tests only where the extracted routing boundary changes imports or composition.

### CLI

- Modify `packages/cli/src/codepipeline-init/cli.ts`.
- Modify `packages/cli/src/codepipeline-init/index.ts`.
- Modify `packages/cli/src/codepipeline-init/generator.ts`.
- Modify `packages/cli/tests/codepipeline-init.test.ts`.
- Create `packages/cli/tests/codepipeline-init-generator.test.ts` if generator assertions would make the orchestration test unwieldy.
- Modify `packages/cli/README.md`.

### Example and docs

- Modify `example/durable-lambda-reviewer/stacks/pipeline-stack.ts`.
- Modify `example/durable-lambda-reviewer/tests/constructs/pipeline-stack.test.ts`.
- Modify `example/durable-lambda-reviewer/README.md` only where it shows or describes the old API.

---

### Task 1: Add typed definition errors and deterministic naming

**Files:**
- Create: `packages/cdk/src/pipeline/errors.ts`
- Create: `packages/cdk/src/pipeline/naming.ts`
- Create: `packages/cdk/tests/pipeline-errors.test.ts`
- Create: `packages/cdk/tests/pipeline-naming.test.ts`

- [ ] **Step 1: Write failing error-contract tests**

Cover stable code/path fields and an unchanged human-readable message:

```ts
const error = new PipelineDefinitionError(
  "ARTIFACT_INPUT_AMBIGUOUS",
  "Artifact input is ambiguous",
  "stages[Checks].actions[Deploy].input",
);
expect(error).toBeInstanceOf(Error);
expect(error.code).toBe("ARTIFACT_INPUT_AMBIGUOUS");
expect(error.path).toBe("stages[Checks].actions[Deploy].input");
expect(error.message).toBe("Artifact input is ambiguous");
```

Declare the complete union from the specification, including source, stage, action, artifact, variable, and pipeline-prop conflicts.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `rtk test bun test packages/cdk/tests/pipeline-errors.test.ts`

Expected: FAIL because `pipeline/errors.ts` does not exist.

- [ ] **Step 3: Implement `PipelineDefinitionError`**

Use this public shape:

```ts
export type PipelineDefinitionErrorCode =
  | "SOURCE_REQUIRED"
  | "SOURCE_ALREADY_DEFINED"
  | "SOURCE_AFTER_STAGE"
  | "STAGE_REQUIRED"
  | "STAGE_EMPTY"
  | "STAGE_NAME_CONFLICT"
  | "ACTION_NAME_CONFLICT"
  | "ARTIFACT_NAME_CONFLICT"
  | "ARTIFACT_NOT_FOUND"
  | "ARTIFACT_INPUT_AMBIGUOUS"
  | "SOURCE_OWNERSHIP_CONFLICT"
  | "AUTO_REVIEW_SOURCE_UNSUPPORTED"
  | "RESERVED_VARIABLE_CONFLICT"
  | "PIPELINE_PROP_CONFLICT";

export class PipelineDefinitionError extends Error {
  readonly code: PipelineDefinitionErrorCode;
  readonly path?: string;

  constructor(code: PipelineDefinitionErrorCode, message: string, path?: string) {
    super(message);
    this.name = "PipelineDefinitionError";
    this.code = code;
    this.path = path;
  }
}
```

- [ ] **Step 4: Write failing naming tests**

Test:

- explicit valid stage names;
- action names joined by `-` when stage name is omitted;
- invalid characters replaced and separators collapsed;
- `Build.App` producing default artifact `Build-AppOutput`;
- exact 100-character boundary;
- truncation to 91 characters plus `-` and the first eight lowercase SHA-256 hex characters of the complete sanitized value;
- empty sanitized names rejected;
- explicit artifact names validated, not rewritten.

Use hard-coded expected hashes so a future refactor cannot silently change physical names.

- [ ] **Step 5: Run naming tests and confirm RED**

Run: `rtk test bun test packages/cdk/tests/pipeline-naming.test.ts`

Expected: FAIL because naming helpers do not exist.

- [ ] **Step 6: Implement pure naming helpers**

Export focused helpers such as:

```ts
export function validateStageName(name: string, path: string): string;
export function deriveStageName(actionNames: readonly string[], path: string): string;
export function validateArtifactName(name: string, path: string): string;
export function deriveDefaultArtifactName(actionName: string, path: string): string;
```

Keep the AWS constraints in one module. Do not use wall-clock values or numeric collision suffixes.

- [ ] **Step 7: Run and commit**

Run:

```bash
rtk test bun test packages/cdk/tests/pipeline-errors.test.ts packages/cdk/tests/pipeline-naming.test.ts
rtk lint bunx biome check packages/cdk/src/pipeline/errors.ts packages/cdk/src/pipeline/naming.ts packages/cdk/tests/pipeline-errors.test.ts packages/cdk/tests/pipeline-naming.test.ts
```

Expected: PASS, zero Biome errors.

Commit:

```bash
rtk git add packages/cdk/src/pipeline packages/cdk/tests/pipeline-errors.test.ts packages/cdk/tests/pipeline-naming.test.ts
rtk git commit -m "feat(cdk): add pipeline definition errors and naming"
```

---

### Task 2: Build the pure artifact frontier planner

**Files:**
- Create: `packages/cdk/src/pipeline/artifacts.ts`
- Create: `packages/cdk/tests/pipeline-artifacts.test.ts`

- [ ] **Step 1: Write failing planner tests**

Model names only; do not instantiate CDK `Artifact` objects in the pure planner. Cover:

- initial `SourceOutput` frontier;
- automatic selection when exactly one artifact is available;
- explicit selection of any previously registered artifact;
- ambiguity with two frontier outputs;
- globally duplicate output rejection;
- parallel actions reading the same pre-stage frontier;
- output-producing stage replacing the frontier;
- Approval/no-output stage carrying the frontier through;
- sequential planning across multiple stage objects in one `.stage([...])` call;
- atomic failure: returned state is unchanged when any stage in a batch is invalid.

Representative assertion:

```ts
const initial = createArtifactPlan("SourceOutput");
const planned = planStageBatch(initial, [
  {
    name: "Builds",
    actions: [
      { name: "Web", inputMode: "required", outputs: ["WebOutput"] },
      { name: "Api", inputMode: "required", outputs: ["ApiOutput"] },
    ],
  },
]);
expect(planned.stages[0]?.actions.map((action) => action.inputs)).toEqual([
  ["SourceOutput"],
  ["SourceOutput"],
]);
expect(planned.state.frontier).toEqual(["WebOutput", "ApiOutput"]);
```

- [ ] **Step 2: Run and confirm RED**

Run: `rtk test bun test packages/cdk/tests/pipeline-artifacts.test.ts`

Expected: FAIL because the planner module is absent.

- [ ] **Step 3: Implement immutable planning types and functions**

Use immutable inputs/outputs:

```ts
export interface ArtifactPlanState {
  readonly registered: ReadonlySet<string>;
  readonly frontier: readonly string[];
}

export type ArtifactInputPlan =
  | { readonly mode: "none" }
  | { readonly mode: "required"; readonly explicit?: readonly string[] }
  | { readonly mode: "optional"; readonly explicit?: readonly string[] | false };
```

`planStageBatch` must clone state, validate the entire batch, and return the new state only after every stage succeeds. Include error paths with stage/action names.

- [ ] **Step 4: Run and commit**

Run:

```bash
rtk test bun test packages/cdk/tests/pipeline-artifacts.test.ts packages/cdk/tests/pipeline-naming.test.ts
rtk lint bunx biome check packages/cdk/src/pipeline/artifacts.ts packages/cdk/tests/pipeline-artifacts.test.ts
```

Expected: PASS.

Commit:

```bash
rtk git add packages/cdk/src/pipeline/artifacts.ts packages/cdk/tests/pipeline-artifacts.test.ts
rtk git commit -m "feat(cdk): plan pipeline artifact flow"
```

---

### Task 3: Add the CodeCommit fluent source adapter

**Files:**
- Create: `packages/cdk/src/pipeline/source.ts`
- Create: `packages/cdk/tests/pipeline-source.test.ts`
- Create: `packages/cdk/tests/codepipeline-types.test.ts`
- Create: `packages/cdk/tsconfig.pipeline-types.json`
- Reference: `packages/cdk/src/codecommit.ts`
- Reference: `packages/cdk/src/codecommit-repository.ts`

- [ ] **Step 1: Write compile-time and runtime source tests**

Define and test these exclusive branches:

```ts
export type CodeCommitPipelineSource =
  | {
      readonly origin: "codecommit";
      readonly create: true;
      readonly repositoryName: string;
      readonly description?: string;
      readonly branchName?: string;
      readonly sync?: string;
    }
  | {
      readonly origin: "codecommit";
      readonly create: false;
      readonly repositoryName: string;
      readonly branchName?: string;
    }
  | {
      readonly origin: "codecommit";
      readonly repository: IRepository;
      readonly repositoryName?: string;
      readonly branchName?: string;
    };
```

Add `// @ts-expect-error` cases for `sync` with imports, `repository` plus `create`, and missing repository ownership to `codepipeline-types.test.ts`. Add runtime casts for the same cases so Zod is proven at runtime.

Create `tsconfig.pipeline-types.json` now with `files: ["tests/codepipeline-types.test.ts"]`, `noEmit: true`, and the package/root strict compiler options. It follows imports into production source while excluding unrelated legacy tests.

- [ ] **Step 2: Add failing materialization tests**

Cover:

- `create: true` creates one Pawl-managed repository;
- `sync` maps to `CodeCommit.create.sourcePath` and seeds the requested branch;
- `create: true` without `sync` does not incorrectly pass `branchName` into CodeCommit seed props;
- `create: false` emits no `AWS::CodeCommit::Repository`;
- supplied `IRepository` is reused;
- concrete supplied/fallback name mismatch fails before Source stage/action children exist;
- tokenized supplied repository names require a literal fallback when AutoReviewer is requested;
- branch defaults to `main`;
- missing/non-directory `sync` path fails without source children.

Use a temporary seed directory created with Bun/Node filesystem APIs and clean it in `finally`.

- [ ] **Step 3: Run and confirm RED**

Run: `rtk test bun test packages/cdk/tests/pipeline-source.test.ts`

Expected: FAIL because source planning/materialization is missing.

- [ ] **Step 4: Implement source schema, planning, and materialization**

Use `CodeCommitRepositoryNameSchema` and `CodeCommitBranchNameSchema`. Return a planned closure/value so all ownership/path/name checks happen before creating CDK children:

```ts
export interface MaterializedPipelineSource {
  readonly repository: IRepository;
  readonly repositoryName: string;
  readonly branchName: string;
}

export function planCodeCommitSource(
  source: CodeCommitPipelineSource,
  options: { readonly requiresConcreteName: boolean },
): {
  materialize(scope: Stack, id: string): MaterializedPipelineSource;
};
```

For managed/imported sources, construct the existing Pawl `CodeCommit` abstraction. For a managed seed, pass `sync` as `create.sourcePath`; otherwise pass only supported create properties. Use `Token.isUnresolved` to distinguish a concrete name from a token before enforcing equality.

- [ ] **Step 5: Typecheck, test, and commit**

Run:

```bash
rtk tsc -p packages/cdk/tsconfig.build.json --noEmit --types bun
rtk tsc -p packages/cdk/tsconfig.pipeline-types.json
rtk test bun test packages/cdk/tests/pipeline-source.test.ts packages/cdk/tests/codecommit.test.ts
rtk lint bunx biome check packages/cdk/src/pipeline/source.ts packages/cdk/tests/pipeline-source.test.ts
```

Expected: PASS.

Commit:

```bash
rtk git add packages/cdk/src/pipeline/source.ts packages/cdk/tests/pipeline-source.test.ts packages/cdk/tests/codepipeline-types.test.ts packages/cdk/tsconfig.pipeline-types.json
rtk git commit -m "feat(cdk): plan CodeCommit pipeline sources"
```

---

### Task 4: Define and adapt every typed pipeline action

**Files:**
- Create: `packages/cdk/src/pipeline/actions.ts`
- Create: `packages/cdk/tests/pipeline-actions.test.ts`
- Modify: `packages/cdk/tests/codepipeline-types.test.ts`
- Reference: `packages/cdk/src/codebuild-project.ts`
- Reference: `packages/cdk/src/lambda-function.ts`

- [ ] **Step 1: Write failing type-contract tests**

Encode the exact spec unions for:

- `codebuild` with `actionType`, optional artifact names, batch/environment options;
- `approval` with notification/link/timeout options;
- `lambda` with ordinary `LambdaFunction`, `inputs: false`, outputs, and user-parameter XOR;
- `s3Deploy` with one inferred/explicit input;
- `cloudFormationDeploy` with inferred/explicit template artifact and permission XOR;
- `custom` with `IAction`.

Use `// @ts-expect-error` to prove:

- durable functions are rejected;
- Lambda object and string user parameters cannot coexist;
- non-admin CloudFormation without `deploymentRole` is rejected;
- admin CloudFormation with a supplied deployment role is rejected;
- `runOrder`, `actionName`, and raw `Artifact` are not public built-in fields.

- [ ] **Step 2: Write failing runtime/action synthesis tests**

For each built-in, synthesize the adapter result in a test stage and assert provider/category/configuration. Also cover:

- CodeBuild omitted outputs become one sanitized default output;
- `outputs: false` creates none; empty outputs reject;
- Lambda omitted inputs use the unambiguous frontier; `inputs: false` creates none; max five;
- Lambda has no default output;
- S3 and CloudFormation infer only a sole frontier input;
- CloudFormation converts named template configuration/extra inputs to artifacts;
- `adminPermissions: true` and explicit non-admin role paths;
- custom action action-name mismatch, unnamed artifacts, and non-default run order reject before stage mutation.

- [ ] **Step 3: Run and confirm RED**

Run:

```bash
rtk test bun test packages/cdk/tests/pipeline-actions.test.ts
rtk tsc -p packages/cdk/tsconfig.build.json --noEmit --types bun
rtk tsc -p packages/cdk/tsconfig.pipeline-types.json
```

Expected: FAIL because action definitions/adapters do not exist.

- [ ] **Step 4: Implement public action types and runtime schemas**

Follow the specification exactly. Introduce aliases for Lambda and CloudFormation XORs rather than relying only on runtime refinements:

```ts
type LambdaUserParameters =
  | { readonly userParameters?: Readonly<Record<string, unknown>>; readonly userParametersString?: never }
  | { readonly userParameters?: never; readonly userParametersString: string };

type CloudFormationPermissions =
  | { readonly adminPermissions: true; readonly deploymentRole?: never }
  | { readonly adminPermissions?: false; readonly deploymentRole: IRole };
```

Name the CodeBuild category property `actionType` so `type` remains the discriminant.

- [ ] **Step 5: Implement a two-phase adapter**

The first phase describes artifact requirements/outputs for the pure planner. The second receives concrete `Artifact` objects only after batch validation:

```ts
export interface PlannedActionAdapter {
  readonly artifactPlan: PlannedActionArtifacts;
  materialize(input: {
    readonly inputs: readonly Artifact[];
    readonly outputs: readonly Artifact[];
  }): IAction;
}
```

Map common role/region/variables namespace only where AWS supports them. Never silently discard a user field.

- [ ] **Step 6: Run and commit**

Run:

```bash
rtk tsc -p packages/cdk/tsconfig.build.json --noEmit --types bun
rtk tsc -p packages/cdk/tsconfig.pipeline-types.json
rtk test bun test packages/cdk/tests/pipeline-actions.test.ts packages/cdk/tests/pipeline-artifacts.test.ts
rtk lint bunx biome check packages/cdk/src/pipeline/actions.ts packages/cdk/tests/pipeline-actions.test.ts
```

Expected: PASS.

Commit:

```bash
rtk git add packages/cdk/src/pipeline/actions.ts packages/cdk/tests/pipeline-actions.test.ts packages/cdk/tests/codepipeline-types.test.ts
rtk git commit -m "feat(cdk): add typed pipeline action adapters"
```

---

### Task 5: Extract reusable exact-revision PR pipeline routing

**Files:**
- Create: `packages/cdk/src/reviewer/router/pipeline-event-router.ts`
- Create: `packages/cdk/tests/pipeline-event-router.test.ts`
- Modify: `packages/cdk/src/reviewer/router/event-router.ts`
- Modify: `packages/cdk/src/reviewer/handlers/router.ts`
- Modify: `packages/cdk/src/reviewer/pipeline-review-common.ts` to expose the exact dispatcher contract needed by both modes
- Modify: corresponding existing router/dispatcher unit tests

- [ ] **Step 1: Write failing pipeline-only routing tests**

Use fakes for `ReviewStateStore`, `SourceControlProvider`, exact pipeline transport, coordination store, and comment poster. Prove:

- opened/revision events fetch the authoritative request and start the exact source revision;
- the six `PAWL_*` values and deterministic client token are supplied by `AwsCodePipelineTransport` unchanged;
- duplicate events do not start duplicate pipeline executions;
- stale revision events do not start a stale commit after authoritative refetch;
- generation comes from the same durable event append lifecycle used by reviewed routing;
- pipeline-only routing completes its event-store generation without invoking a reviewer Lambda;
- merge/close events complete terminal state without a bridge job;
- mapped pipeline terminal events post one idempotent CI summary;
- failures do not leak sensitive exception text into durable records.

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
rtk test bun test packages/cdk/tests/pipeline-event-router.test.ts packages/cdk/tests/pipeline-review-dispatcher.test.ts packages/cdk/tests/reviewer/unit/event-router.test.ts
```

Expected: FAIL because the pipeline flow is still embedded in reviewer routing and requires reviewer environment.

- [ ] **Step 3: Extract reviewed-event dispatch without adding a second append owner**

`EventRouter.routeCodeCommit()` remains the only `appendEvent()` owner in reviewed mode. After its existing `route()` call returns, pass the already-normalized event, authoritative snapshot/refetch callback, and returned generation to `PipelineEventRouter.dispatchReviewedEvent(...)`. The extracted service must never append, claim, recover, or complete review state through this entry point.

Keep exact-revision arbitration in `PipelineReviewDispatcher`; do not duplicate it. Existing reviewed routing retains the sequence:

1. normalize once;
2. append once in `EventRouter.route()`;
3. let the durable reviewer own claim/completion;
4. dispatch the pipeline using that same generation.

- [ ] **Step 4: Implement the pipeline-only append/claim/drain owner loop**

For `PipelineEventRouter.routePipelineOnly(value)`, the extracted service is the sole append owner. Implement and test this exact lifecycle:

1. normalize the event and call `appendEvent()` once;
2. return immediately for a duplicate/non-starting invocation unless `recoveryEligible` permits taking over an expired owner;
3. when ownership is available, call `claimEvents(request, generation)` before dispatch; this transitions `STARTING` to `RUNNING` and decrements pending events;
4. coalesce the claimed page to its latest authoritative open/revision signal, refetch the request, and call `PipelineReviewDispatcher` once for that revision;
5. call `claimEvents()` again until it returns no events, dispatching a newly authoritative revision when concurrent events arrived;
6. attempt `complete(request, generation, { type: "clean" })` only from `RUNNING` with zero pending events;
7. if completion loses a conditional race to a concurrent append, claim/drain again instead of dropping the event;
8. for merged/closed events, call `completeTerminalRequest()` and complete with the matching terminal reason;
9. use bounded contention/recovery attempts and surface a retryable operational error when they are exhausted.

Do not call `recordExecution()` because there is no durable reviewer execution ARN. Lease recovery must use `recoverLease()` only for `recoveryEligible` results and then re-enter the same claim/drain loop. Add a two-invocation concurrency test proving the non-owner returns while the owner drains the newly appended revision.

On failure, persist only this fixed sanitized envelope through `complete(..., { type: "failed", ... })`; never persist the caught message, stack, custom fields, or transport payload:

```ts
{
  type: "operational-failure",
  lifecycleState: "FAILED",
  operation: "pipeline-route",
  reason: "retry-exhausted",
  attempts,
  lastError: {
    name: "PipelineRoutingError",
    message: "Pipeline routing failed",
  },
}
```

Pass the current append result's lease ownership to `complete`, for example `{ kind: "lease", leaseVersion: append.leaseVersion }`; never invent callback ownership in pipeline-only mode. Rethrow a bounded retryable error after recording failure so EventBridge retry behavior remains observable. Test the adapter/store transition, not only an in-memory happy path.

- [ ] **Step 5: Add pipeline-only handler composition**

In `reviewer/handlers/router.ts`, choose composition from environment:

- reviewed mode requires reviewer function values and optional pipeline values and delegates append ownership to `EventRouter`;
- pipeline-only mode requires `STATE_TABLE_NAME`, `PIPELINE_NAME`, and `PIPELINE_SOURCE_ACTION_NAME`, but no reviewer function, and calls `routePipelineOnly` directly;
- pipeline execution state-change handling must not require `REVIEWER_FUNCTION_ARN` merely to construct `CodeCommitProvider`;
- use the existing DynamoDB state/coordination stores and `AwsCodePipelineTransport`;
- provide an inline no-op `PipelineReconcilerInvoker` in pipeline-only composition because there are no bridge jobs.

Keep environment parsing fail-fast and test both composition branches. Assert each incoming CodeCommit event has exactly one append owner in each mode.

- [ ] **Step 6: Run regression tests and commit**

Run:

```bash
rtk test bun test packages/cdk/tests/pipeline-event-router.test.ts packages/cdk/tests/pipeline-review-dispatcher.test.ts packages/cdk/tests/reviewer/unit/event-router.test.ts packages/cdk/tests/reviewer/unit/handlers/router.test.ts packages/cdk/tests/codepipeline-transport.test.ts
rtk lint bunx biome check packages/cdk/src/reviewer/router/pipeline-event-router.ts packages/cdk/src/reviewer/router/event-router.ts packages/cdk/src/reviewer/handlers/router.ts packages/cdk/tests/pipeline-event-router.test.ts
```

Expected: PASS with durable reviewer behavior unchanged.

Commit:

```bash
rtk git add packages/cdk/src/reviewer packages/cdk/tests/pipeline-event-router.test.ts packages/cdk/tests/pipeline-review-dispatcher.test.ts packages/cdk/tests/reviewer/unit
rtk git commit -m "refactor(cdk): separate exact PR pipeline routing"
```

---

### Task 6: Add the PR-only router CDK resources

**Files:**
- Create: `packages/cdk/src/pipeline/pull-request-router.ts`
- Modify: `packages/cdk/tests/codepipeline.test.ts`
- Modify: `packages/cdk/tests/codepipeline-bridge.test.ts`

- [ ] **Step 1: Replace the old no-review PR expectation with failing resource tests**

For `onPullRequest: true` without `autoReviewer`, assert:

- source detection is disabled;
- a router Lambda exists but no Reviewer, Bridge, Reconciler, CodeBuild check project, or Bedrock IAM exists;
- a DynamoDB routing/state table exists with `pk`/`sk` plus GSI2 using `gsi2pk`/`gsi2sk`;
- PR EventBridge rules target the router;
- pipeline execution state changes target the same router;
- the pipeline declares all six `PAWL_*` variables;
- IAM allows exact pipeline start/read and scoped CodeCommit read/comment operations;
- no durable-review Lambda invoke permissions exist.

- [ ] **Step 2: Run and confirm RED**

Run: `rtk test bun test packages/cdk/tests/codepipeline.test.ts packages/cdk/tests/codepipeline-bridge.test.ts`

Expected: FAIL because current PR-only mode disables source detection but creates no router.

- [ ] **Step 3: Implement `PullRequestPipelineRouter` construct**

Create only routing resources needed without AI review:

- DynamoDB state/coordination table compatible with both runtime stores, including mandatory GSI2 (`gsi2pk` partition key and `gsi2sk` sort key) because `PipelineReviewDispatcher.listRequestJobs()` always queries it;
- ordinary router Lambda using the shared handler in pipeline-only mode;
- CodeCommit PR event routing;
- pipeline execution state-change rule;
- least-privilege table, CodeCommit, and CodePipeline grants.

Expose the Lambda only as needed by `CodePipeline`; do not export this as a second public top-level construct unless implementation requires it.

- [ ] **Step 4: Run cdk-nag-focused tests and commit**

Run:

```bash
rtk test bun test packages/cdk/tests/codepipeline.test.ts packages/cdk/tests/codepipeline-bridge.test.ts packages/cdk/tests/codecommit-review-events.test.ts
rtk lint bunx biome check packages/cdk/src/pipeline/pull-request-router.ts packages/cdk/tests/codepipeline.test.ts
```

Expected: PASS; no broad wildcard grants beyond APIs that cannot be resource-scoped, with documented cdk-nag suppression where unavoidable.

Commit:

```bash
rtk git add packages/cdk/src/pipeline/pull-request-router.ts packages/cdk/tests/codepipeline.test.ts packages/cdk/tests/codepipeline-bridge.test.ts
rtk git commit -m "feat(cdk): route PR pipelines without AI review"
```

---

### Task 7: Rewrite `CodePipeline` as the eager fluent orchestrator

**Files:**
- Modify: `packages/cdk/src/codepipeline.ts`
- Modify: `packages/cdk/index.ts` only if re-exports are not already reachable
- Modify: `packages/cdk/tests/codepipeline.test.ts`
- Modify: `packages/cdk/tests/codepipeline-explicit-name.test.ts`
- Modify: `packages/cdk/tests/codepipeline-review-coordination-deployment-phase.test.ts`
- Modify: `packages/cdk/tests/codepipeline-bridge.test.ts`
- Modify: `packages/cdk/tests/codepipeline-types.test.ts`
- Modify: `packages/cdk/tsconfig.pipeline-types.json`

- [ ] **Step 1: Add failing public lifecycle and type tests**

Test the approved signatures:

```ts
interface PipelineStageDefinition {
  readonly name?: string;
  readonly actions: readonly [
    PipelineActionDefinition,
    ...PipelineActionDefinition[],
  ];
}

stage(stage: PipelineStageDefinition): this;
stage(stages: readonly [PipelineStageDefinition, ...PipelineStageDefinition[]]): this;
```

Add `// @ts-expect-error` checks for empty stage arrays, empty actions, constructor `source`, constructor `stages`, `team`, `stage`, raw `pipelineType`, and raw `triggers` in `packages/cdk/tests/codepipeline-types.test.ts`.

Extend the existing `packages/cdk/tsconfig.pipeline-types.json` only if the fluent lifecycle cases need additional compiler options. It must continue to follow imports into production source while excluding every unrelated test, so known legacy test errors cannot mask this contract.

Runtime tests must cover:

- `.source()` and `.stage()` return the same instance;
- missing source and missing user stage fail CDK synthesis validation;
- stage-before-source and duplicate source fail immediately;
- one stage object and one-element stage list synthesize equivalently;
- stage batches preserve order and validate atomically;
- omitted stage names derive from action names;
- duplicate stage/action names reject;
- no implicit default Approval stage remains.

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
rtk test bun test packages/cdk/tests/codepipeline.test.ts packages/cdk/tests/codepipeline-explicit-name.test.ts packages/cdk/tests/codepipeline-review-coordination-deployment-phase.test.ts packages/cdk/tests/codepipeline-bridge.test.ts
rtk tsc -p packages/cdk/tsconfig.build.json --noEmit --types bun
rtk tsc -p packages/cdk/tsconfig.pipeline-types.json
```

Expected: FAIL against the constructor-defined API.

- [ ] **Step 3: Replace `CodePipelineProps` with flattened AWS props**

Use:

```ts
export interface CodePipelineProps
  extends Omit<
    PipelineProps,
    "pipelineType" | "stages" | "triggers" | "variables"
  > {
  readonly variables?: readonly Variable[];
  readonly autoReviewer?: AutoReviewConfig;
  readonly onPullRequest?: boolean;
  readonly artifactEncryptionKey?: IKey;
  readonly pipelineNaming?: CodePipelineNaming;
  readonly reviewCoordinationDeploymentPhase?: ReviewCoordinationDeploymentPhase;
  readonly reviewActionTimeoutMinutes?: number;
}
```

Call `super(scope, id)` so `BasicConstruct` remains the sole owner of team/stage context tags. Do not forward duplicate overrides to AutoReviewer.

- [ ] **Step 4: Inventory and normalize every pinned `PipelineProps` key**

Document this table in `codepipeline.ts` JSDoc and encode it in tests before constructing AWS `Pipeline`:

| Pinned key | Pawl behavior |
|---|---|
| `artifactBucket` | pass through; when absent Pawl supplies its retained KMS bucket |
| `role` | pass through |
| `restartExecutionOnUpdate` | pass through |
| `pipelineName` | pass through after the approved `pipelineNaming` conflict matrix |
| `crossRegionReplicationBuckets` | pass through |
| `stages` | omit from TypeScript and reject JS/spread callers |
| `crossAccountKeys` | pass through |
| `enableKeyRotation` | with external bucket, pass through for CDK-generated cross-region/account keys; with Pawl-owned bucket, allow only `undefined`/`true` because the Pawl key always rotates and reject `false` as a prop conflict |
| `reuseCrossRegionSupportStacks` | pass through |
| `pipelineType` | omit/reject; force V2 |
| `variables` | merge by name, reserving `PAWL_*` |
| `triggers` | omit/reject for CodeCommit-only scope |
| `executionMode` | pass through |
| `usePipelineRoleForActions` | pass through |

Also enforce:

- external artifact bucket is exposed as `IBucket`;
- `artifactEncryptionKey` conflicts with an external bucket;
- Pawl creates retained KMS bucket/key only when no bucket is supplied;
- all six Pawl variables are declared for every PR-routed pipeline, reviewed or not;
- CloudFormation coordination name is required only when the active bridge needs a concrete non-token name.

Preserve existing logical IDs (`ArtifactKey`, `ArtifactBucket`, `Pipeline`) for Pawl-owned resources.

- [ ] **Step 5: Implement `.source()`**

Plan and validate first, then materialize the CodeCommit source and add Source stage/action with `SourceOutput`. Defer AutoReviewer and PR router creation until the repository identity is known.

Four option combinations must be explicit:

| onPullRequest | autoReviewer | Wiring |
|---|---|---|
| false/absent | absent | native source trigger |
| true | absent | PR-only router |
| false/absent | present | native source trigger plus standalone reviewer |
| true | present | reviewer router plus durable pipeline bridge |

When creating AutoReviewer, use the stack context already consumed by BasicConstruct. Keep existing child IDs where possible to avoid unnecessary replacement.

- [ ] **Step 6: Implement `.stage()` batch planning/materialization**

Normalize a single object to a one-element list. Validate names, action schemas, complete artifact flow, and optional AIReview insertion before adding any stage. Then create concrete `Artifact` objects, action adapters, and stages in list order.

AIReview rules:

- only active PR-gated AutoReviewer mode;
- insert into the first user stage object;
- consume `SourceOutput` regardless of that stage's normal frontier;
- keep fixed action name and durable user parameters;
- preparation phases omit it.

- [ ] **Step 7: Add synthesis validation**

Register `node.addValidation` in the constructor. Return stable messages for missing source and missing user stages. Immediate method errors remain `PipelineDefinitionError` with paths.

- [ ] **Step 8: Migrate focused pipeline tests while preserving assertions**

Update helpers to construct, then call `.source(...).stage(...)`. Replace `autoReview` with `autoReviewer`, `manualApproval` with `approval`, and raw Artifact wiring with named/inferred artifacts. Remove old default-stage tests and replace them with completeness-validation tests.

For invalid constructor configuration tests, instantiate first only when constructor validation is under test; otherwise call `.source()`/`.stage()` at the boundary that should throw.

- [ ] **Step 9: Run focused suites, typecheck, and commit**

Run:

```bash
rtk tsc -p packages/cdk/tsconfig.build.json --noEmit --types bun
rtk tsc -p packages/cdk/tsconfig.pipeline-types.json
rtk test bun test packages/cdk/tests/pipeline-errors.test.ts packages/cdk/tests/pipeline-naming.test.ts packages/cdk/tests/pipeline-artifacts.test.ts packages/cdk/tests/pipeline-source.test.ts packages/cdk/tests/pipeline-actions.test.ts packages/cdk/tests/codepipeline.test.ts packages/cdk/tests/codepipeline-explicit-name.test.ts packages/cdk/tests/codepipeline-review-coordination-deployment-phase.test.ts packages/cdk/tests/codepipeline-bridge.test.ts
rtk lint bunx biome check packages/cdk/src/codepipeline.ts packages/cdk/src/pipeline packages/cdk/tests/codepipeline.test.ts packages/cdk/tests/codepipeline-explicit-name.test.ts packages/cdk/tests/codepipeline-review-coordination-deployment-phase.test.ts packages/cdk/tests/codepipeline-bridge.test.ts
```

Expected: PASS.

Commit:

```bash
rtk git add packages/cdk/src/codepipeline.ts packages/cdk/src/pipeline packages/cdk/index.ts packages/cdk/tests
rtk git commit -m "feat(cdk): add fluent CodePipeline construction"
```

---

### Task 8: Migrate durable-review regressions and the maintained example

**Files:**
- Modify: all tracked files returned by `rg -l 'new CodePipeline|PipelineStage|PipelineAction' packages/cdk/tests example/durable-lambda-reviewer`
- Modify: `example/durable-lambda-reviewer/stacks/pipeline-stack.ts`
- Modify: `example/durable-lambda-reviewer/tests/constructs/pipeline-stack.test.ts`
- Modify: `example/durable-lambda-reviewer/README.md`

- [ ] **Step 1: Enumerate every remaining old API call**

Run:

```bash
rtk proxy rg -n 'source:\s*\{|stages:\s*\[|autoReview:|manualApproval|inputArtifact|outputArtifacts|type PipelineStage' packages/cdk/tests example/durable-lambda-reviewer --glob '*.ts' --glob '*.md'
```

Expected: list every migration site; classify genuine `CodeCommit.autoReview` separately and do not rename it.

- [ ] **Step 2: Add/update failing example assertions**

The example should demonstrate managed fluent source ownership and automatic artifacts:

```ts
new CodePipeline(this, "Pipeline", {
  onPullRequest: true,
  autoReviewer: { modelId },
})
  .source({
    origin: "codecommit",
    create: true,
    repositoryName,
    branchName,
    description: "Durable Lambda reviewer example with CodePipeline",
    sync: sourcePath,
  })
  .stage([
    {
      name: "Build",
      actions: [{ name: "Build", type: "codebuild", project: buildProject }],
    },
    {
      name: "Approve",
      actions: [
        {
          name: "Approve",
          type: "approval",
          description: "Review the build output and AI review comment before merging.",
        },
      ],
    },
  ]);
```

Remove the separate raw artifact objects and redundant separate `CodeCommit` source construct from this example.

- [ ] **Step 3: Migrate all durable bridge/phase/naming tests**

Preserve exact assertions for:

- six protected variables;
- exact source revision and deterministic token;
- AIReview user parameters and ordinary bridge target;
- 5–15 minute timeout bounds;
- preparation GSI phases and logical-ID stability;
- callback and supersession precedence;
- IAM and cdk-nag;
- no sensitive durable error history.

Do not “fix” failures by deleting or loosening these assertions.

- [ ] **Step 4: Run broad CDK/reviewer/example suites**

Run:

```bash
rtk test bun test packages/cdk/tests/codepipeline*.test.ts packages/cdk/tests/pipeline-*.test.ts packages/cdk/tests/reviewer packages/cdk/tests/pipeline-bridge.test.ts packages/cdk/tests/pipeline-coordination-store.test.ts packages/cdk/tests/pipeline-reconciler*.test.ts example/durable-lambda-reviewer/tests/constructs/pipeline-stack.test.ts example/durable-lambda-reviewer/tests/security/synth-security.test.ts
rtk tsc -p example/durable-lambda-reviewer/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 5: Verify no stale CodePipeline API remains and commit**

Run the Step 1 search again. Expected: no old CodePipeline calls; only intentional `CodeCommit.autoReview` references remain.

Commit:

```bash
rtk git add packages/cdk/tests example/durable-lambda-reviewer
rtk git commit -m "refactor: migrate pipelines to fluent API"
```

---

### Task 9: Migrate `pawl init codepipeline`

**Files:**
- Modify: `packages/cli/src/codepipeline-init/cli.ts`
- Modify: `packages/cli/src/codepipeline-init/index.ts`
- Modify: `packages/cli/src/codepipeline-init/generator.ts`
- Modify: `packages/cli/tests/codepipeline-init.test.ts`
- Create: `packages/cli/tests/codepipeline-init-generator.test.ts`
- Modify: `packages/cli/README.md`

- [ ] **Step 1: Write failing parser/orchestration tests**

Test:

- `--source codecommit` succeeds;
- any other source value fails before project directory creation;
- removed `--pipeline-stage` is rejected by strict argument parsing;
- generated `cdk.json` retains team and deployment stage context;
- the separate CodeCommit initializer behavior is unchanged.

- [ ] **Step 2: Write failing generator tests**

Assert generated stack text contains:

```ts
new CodePipeline(this, "Pipeline", {
  // optional onPullRequest/autoReviewer only when selected
})
  .source({
    origin: "codecommit",
    create: false,
    repositoryName: "my-repo",
    branchName: "main",
  })
  .stage({
    name: "Approval",
    actions: [
      {
        name: "Approve",
        type: "approval",
        description: "Approve pipeline execution",
      },
    ],
  });
```

Also assert there is no raw `Repository` import, constructor `source`, constructor `stages`, or CodePipeline `autoReview`.

- [ ] **Step 3: Run and confirm RED**

Run:

```bash
rtk test bun test packages/cli/tests/codepipeline-init.test.ts packages/cli/tests/codepipeline-init-generator.test.ts
```

Expected: FAIL against the old generator and accepted dead flag.

- [ ] **Step 4: Remove the dead stage flag and validate source**

Delete `pipelineStage` from `CodePipelineInitFlags`, `parseArgs` options, result construction, help, and README. In `runCodePipelineInit`, reject `flags.source !== "codecommit"` before `resolveCodePipelineInitLayout`.

- [ ] **Step 5: Emit fluent generated source and Approval stage**

Keep `onPullRequest` and `autoReviewer` conditional. Keep team/stage only in generated `cdk.json`. Do not change `packages/cli/src/codecommit-init/generator.ts` from `autoReview` to `autoReviewer`.

- [ ] **Step 6: Add host-side generated-project synthesis**

Create the generated project under a temporary directory inside the repository so workspace package resolution can find local `@pawl/cdk`. Invoke CDK synthesis from the test with `LOCAL=1` and a bounded timeout. The assertion must execute generated output; merely checking the generated test string is insufficient.

Use `try/finally` cleanup and do not leave `.tmp-codepipeline-*`, `cdk.out`, or generated lockfiles behind.

- [ ] **Step 7: Run CLI suites and commit**

Run:

```bash
rtk test bun test packages/cli/tests/codepipeline-init.test.ts packages/cli/tests/codepipeline-init-generator.test.ts packages/cli/tests/codecommit-init-generator.test.ts packages/cli/tests/codecommit-init-cli.test.ts
rtk lint bunx biome check packages/cli/src/codepipeline-init packages/cli/tests/codepipeline-init.test.ts packages/cli/tests/codepipeline-init-generator.test.ts
```

Expected: PASS.

Commit:

```bash
rtk git add packages/cli/src/codepipeline-init packages/cli/tests/codepipeline-init.test.ts packages/cli/tests/codepipeline-init-generator.test.ts packages/cli/README.md
rtk git commit -m "feat(cli): generate fluent CodePipeline projects"
```

---

### Task 10: Update LocalStack integration coverage

**Files:**
- Modify: `packages/cdk/tests/integration/codepipeline.test.ts`
- Verify/modify: `packages/cdk/tests/integration/localstack.setup.ts` only for required service support, never to weaken token containment
- Modify: `packages/cdk/tests/integration/localstack.setup.test.ts` to retain explicit token-containment regression coverage

- [ ] **Step 1: Migrate the integration stack to fluent source/stages**

Use managed CodeCommit source ownership instead of constructing raw `Repository`:

```ts
new CodePipeline(scope, "Pipeline", {
  autoReviewer: { modelId: "eu.amazon.nova-2-lite-v1:0" },
  onPullRequest: true,
})
  .source({
    origin: "codecommit",
    create: true,
    repositoryName: REPO_NAME,
    branchName: "main",
  })
  .stage({
    name: "Build",
    actions: [{ name: "Approve", type: "approval" }],
  });
```

Use a valid non-empty user action; do not preserve the old invalid empty stage.

- [ ] **Step 2: Strengthen integration assertions**

Verify deployed structure includes:

- Source then Build stage;
- SourceOutput and inferred action input/output configuration where LocalStack exposes it;
- AIReview parallel in the first user stage for reviewed PR mode;
- all six pipeline variables;
- no raw token leaked into repository configuration;
- existing reviewer/router/table/event/IAM resources.

Add a synth-level no-review PR variant if deploying two full stacks would make the integration too slow; unit/CDK tests remain authoritative for the four-mode matrix.

- [ ] **Step 3: Retrieve the LocalStack token securely**

Without `set -x`, run:

```bash
export LOCALSTACK_AUTH_TOKEN="$(AWS_PROFILE=jolo AWS_REGION=eu-central-1 rtk proxy aws ssm get-parameter --name /pawl/localstack/token --with-decryption --query Parameter.Value --output text)"
```

Do not echo, persist, log, or place the token in generated child environments. Keep `localstack.setup.test.ts` assertions that `LOCALSTACK_AUTH_TOKEN` is deleted from CDK/AWS child environments and passed only to `LocalstackContainer.withEnvironment`; add any new child-process path to that matrix.

- [ ] **Step 4: Run token-containment and integration tests, then commit**

Run:

```bash
rtk test bun test packages/cdk/tests/integration/localstack.setup.test.ts
rtk test bun test packages/cdk/tests/integration/codepipeline.test.ts
unset LOCALSTACK_AUTH_TOKEN
```

Expected: PASS. If Docker/LocalStack is unavailable, capture the exact infrastructure error and do not claim the gate passed.

Commit:

```bash
rtk git add packages/cdk/tests/integration/codepipeline.test.ts packages/cdk/tests/integration/localstack.setup.ts packages/cdk/tests/integration/localstack.setup.test.ts
rtk git commit -m "test(cdk): validate fluent pipeline in LocalStack"
```

---

### Task 11: Public exports, documentation, and complete verification

**Files:**
- Modify: `packages/cdk/index.ts` if needed
- Modify: JSDoc in `packages/cdk/src/codepipeline.ts`
- Modify: `packages/cli/README.md`
- Modify: `example/durable-lambda-reviewer/README.md`
- Do not modify: `docs/src/content/docs/cdk/` or `docs/src/content/docs/lambda/`

- [ ] **Step 1: Verify public exports and build declarations**

Ensure consumers can import these from `@pawl/cdk`:

- `CodePipeline`, `CodePipelineProps`, and naming types/schemas;
- `CodeCommitPipelineSource`;
- `PipelineStageDefinition` and `PipelineActionDefinition`;
- action member types useful for composition;
- `PipelineDefinitionError` and its code type.

Remove the obsolete public `PipelineSource`, `PipelineStage`, and `PipelineAction` names unless the new approved type intentionally reuses one; do not leave compatibility aliases.

- [ ] **Step 2: Update hand-written documentation**

Document:

- single stage object and sequential stage-list syntax;
- parallel actions inside one stage object;
- automatic artifact inference and ambiguity errors;
- CodeCommit create/import/supplied ownership;
- the four PR/reviewer combinations;
- team/stage via CDK context;
- CLI-generated Approval stage.

Do not edit auto-generated TypeDoc content.

- [ ] **Step 3: Run exact focused verification**

Run:

```bash
rtk tsc -p packages/cdk/tsconfig.build.json --noEmit --types bun
rtk tsc -p packages/cdk/tsconfig.pipeline-types.json
rtk test bun test packages/cdk/tests/pipeline-errors.test.ts packages/cdk/tests/pipeline-naming.test.ts packages/cdk/tests/pipeline-artifacts.test.ts packages/cdk/tests/pipeline-source.test.ts packages/cdk/tests/pipeline-actions.test.ts packages/cdk/tests/pipeline-event-router.test.ts packages/cdk/tests/codepipeline.test.ts packages/cdk/tests/codepipeline-explicit-name.test.ts packages/cdk/tests/codepipeline-review-coordination-deployment-phase.test.ts packages/cdk/tests/codepipeline-bridge.test.ts
rtk test bun test packages/cdk/tests/reviewer packages/cdk/tests/pipeline-bridge.test.ts packages/cdk/tests/pipeline-coordination-store.test.ts packages/cdk/tests/pipeline-reconciler-handler.test.ts packages/cdk/tests/pipeline-reconciler.test.ts packages/cdk/tests/pipeline-review-dispatcher.test.ts packages/cdk/tests/codepipeline-transport.test.ts
rtk test bun test packages/cdk/tests/integration/localstack.setup.test.ts
rtk test bun test packages/cli/tests/codepipeline-init.test.ts packages/cli/tests/codepipeline-init-generator.test.ts packages/cli/tests/codecommit-init-generator.test.ts
rtk test bun test example/durable-lambda-reviewer/tests/constructs/pipeline-stack.test.ts example/durable-lambda-reviewer/tests/security/synth-security.test.ts
rtk bun run --filter @pawl/lambda build
rtk bun run --filter @pawl/cdk build
```

Expected: every command PASS.

- [ ] **Step 4: Run scoped Biome**

Run:

```bash
rtk lint bunx biome check packages/cdk/src/codepipeline.ts packages/cdk/src/pipeline packages/cdk/src/reviewer packages/cdk/tests packages/cli/src/codepipeline-init packages/cli/tests/codepipeline-init*.test.ts example/durable-lambda-reviewer/stacks/pipeline-stack.ts example/durable-lambda-reviewer/tests/constructs/pipeline-stack.test.ts
```

Expected: zero errors and warnings in changed scope.

- [ ] **Step 5: Run repository-wide gates and classify only pre-existing failures**

Run:

```bash
rtk lint bun lint
rtk test bun test
```

Expected target: PASS. If the known unrelated baseline remains red, compare exact failures to the pre-change baseline; fix any new failure caused by this work and report unrelated residuals without claiming repository-wide green.

- [ ] **Step 6: Request independent code review**

Use `superpowers:requesting-code-review` with the spec, this plan, the complete diff, and focused verification evidence. Resolve every Blocker/Important finding through a fresh review cycle.

- [ ] **Step 7: Confirm workspace and protected state**

Run:

```bash
rtk git status --short --branch
rtk git diff --check
rtk git log --oneline --decorate -12
```

Expected: only intentional plan/implementation state; no `.pi-subagents`, LocalStack token files, `cdk.out`, temp generated projects, or unrelated outer-workspace changes.

- [ ] **Step 8: Commit final docs/exports cleanup**

```bash
rtk git add packages/cdk/index.ts packages/cdk/src/codepipeline.ts packages/cli/README.md example/durable-lambda-reviewer/README.md
rtk git commit -m "docs: document fluent CodePipeline API"
```

Do not push, merge, remove the worktree, or reconcile/retrigger external PR/AWS state without explicit authorization.
