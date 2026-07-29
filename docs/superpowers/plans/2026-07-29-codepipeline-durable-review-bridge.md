# CodePipeline Durable Review Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the invalid direct CodePipeline-to-durable-Lambda `AIReview` action with an ordinary bridge Lambda, persisted review outcomes, and an idempotent reconciler that completes CodePipeline jobs.

**Architecture:** PR-gated CodeCommit events start both the durable reviewer and an exact-revision CodePipeline execution with Pawl pipeline variables. The `AIReview` Lambda action invokes a non-durable bridge that registers the job; a central reconciler observes jobs and review outcomes, then calls `PutJobSuccessResult` or `PutJobFailureResult` with immutable intent and lease-based redrive.

**Tech Stack:** TypeScript, Bun test, Zod, AWS CDK v2, AWS Lambda Powertools, AWS SDK v3 (`@aws-sdk/client-codepipeline` runtime dependency), DynamoDB single-table records + GSIs, EventBridge scheduled rule.

---

## Source files and responsibilities

### Existing files to modify

- `packages/lambda/src/codepipeline-handler.ts` — new typed CodePipeline Lambda-action handler wrapper.
- `packages/lambda/index.ts` — export `useCodePipelineHandler` and public event types.
- `packages/lambda/tests/codepipeline-handler.test.ts` — wrapper metadata/logging test.
- `packages/cdk/package.json` — move `@aws-sdk/client-codepipeline` from dev dependency to runtime dependency; do **not** add `@aws-sdk/client-scheduler`.
- `packages/cdk/src/dynamodb-table.ts` — add Zod-validated GSI support to Pawl `DynamoDbTable`.
- `packages/cdk/src/codepipeline.ts` — inject bridge action, pipeline variables, static reconciler rule, timeout validation, and grants; remove durable Lambda proxy for `AIReview`.
- `packages/cdk/src/codecommit-auto-reviewer.ts` — create bridge/reconciler handlers and pass pipeline coordination env/config when used by `CodePipeline`.
- `packages/cdk/src/reviewer/handlers/router.ts` — replace pipeline placeholders with production adapters and exact-revision PR-gated pipeline start.
- `packages/cdk/src/reviewer/handlers/reviewer.ts` — wire no-op or DynamoDB-backed cycle observer.
- `packages/cdk/src/reviewer/workflows/reviewer-workflow.ts` — add optional cycle observer and outcome reporting without importing CodePipeline SDK types.
- `packages/cdk/src/reviewer/ports/state-store.ts` — add/extend port types for pipeline jobs/outcomes if colocated with existing state-store contracts.
- `packages/cdk/src/reviewer/adapters/dynamodb-state-store.ts` — implement execution mappings, jobs, outcomes, GSIs, idempotent transitions, request-scoped pagination, and reconciliation store operations.
- `packages/cdk/src/reviewer/pipeline-review-common.ts` — extend runtime pipeline ports/adapters/types, exact source revisions, variables, job callback transport, and formatting helpers.
- `packages/cdk/tests/codepipeline.test.ts` — CDK synthesis coverage for bridge action, variables, timeout validation, grants, no durable ARN/`$LATEST`.
- `packages/cdk/tests/integration/codepipeline.test.ts` — adjust LocalStack expectations from direct durable action to bridge action and user parameters.

### New files to create

- `packages/cdk/src/reviewer/handlers/pipeline-bridge.ts` — CodePipeline Lambda action bridge handler.
- `packages/cdk/src/reviewer/handlers/pipeline-reconciler.ts` — central reconciler handler invoked by bridge/router/reviewer/rule.
- `packages/cdk/src/reviewer/pipeline/codepipeline-job-event.ts` — Zod schemas for safe CodePipeline job envelope and sanitized user parameters.
- `packages/cdk/src/reviewer/pipeline/pipeline-coordination-store.ts` — domain types and pure state transition helpers for jobs/outcomes/intents.
- `packages/cdk/src/reviewer/adapters/codepipeline-transport.ts` — AWS SDK v3 transport for `StartPipelineExecution`, `GetPipelineExecution`, `PutJobSuccessResult`, `PutJobFailureResult`.
- `packages/cdk/tests/pipeline-bridge.test.ts` — bridge parsing/persistence tests.
- `packages/cdk/tests/pipeline-reconciler.test.ts` — intent precedence, leases, retries, timeout, supersession, merge/close tests.
- `packages/cdk/tests/pipeline-coordination-store.test.ts` — pure transition and key-schema tests.
- `packages/cdk/tests/codepipeline-transport.test.ts` — exact source revision, variables, token, callback command mapping tests.

## Important constraints

- Do not modify unrelated user changes currently present in `AGENTS.md` or `packages/cdk/tests/codepipeline.test.ts` beyond the planned CodePipeline test edits.
- Use Pawl constructs and handler wrappers where public abstractions exist.
- No raw `aws-cdk-lib` imports in consumer/example stack files; tests may use CDK assertions.
- No `any`; use Zod, `unknown`, and narrowing.
- Do not store or log artifact credentials, raw CodePipeline events, raw user parameters, prompts, diffs, comments, or model output.
- Do not add `@aws-sdk/client-scheduler`; the approved design uses a static EventBridge rule.

## Task 1: `@pawl/lambda` CodePipeline handler wrapper

**Files:**
- Create: `packages/lambda/src/codepipeline-handler.ts`
- Modify: `packages/lambda/index.ts`
- Create: `packages/lambda/tests/codepipeline-handler.test.ts`

- [ ] **Step 1: Write failing wrapper tests**

  Add tests that import `useCodePipelineHandler`, call it with a minimal CodePipeline job envelope, and verify:
  - the callback receives the event and logger;
  - returned handler resolves `void`;
  - metadata logging excludes `artifactCredentials`, `inputArtifacts`, and raw `UserParameters`.

  Run:
  ```bash
  bun test packages/lambda/tests/codepipeline-handler.test.ts
  ```
  Expected: fail because `useCodePipelineHandler` is not exported.

- [ ] **Step 2: Implement the wrapper**

  Create `codepipeline-handler.ts` using `handlerFactory` with `logging: "metadata"`. Define exported structural event types for the CodePipeline job envelope. Metadata projector should include only job ID, action type/category/provider, and counts of artifacts.

- [ ] **Step 3: Export the wrapper**

  Update `packages/lambda/index.ts` with named exports.

- [ ] **Step 4: Verify green**

  Run:
  ```bash
  bun test packages/lambda/tests/codepipeline-handler.test.ts
  bunx biome check packages/lambda/src/codepipeline-handler.ts packages/lambda/index.ts packages/lambda/tests/codepipeline-handler.test.ts
  ```
  Expected: pass.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/lambda/src/codepipeline-handler.ts packages/lambda/index.ts packages/lambda/tests/codepipeline-handler.test.ts
  git commit -m "feat(lambda): add CodePipeline handler wrapper"
  ```

## Task 2: Pipeline coordination domain and schemas

**Files:**
- Create: `packages/cdk/src/reviewer/pipeline/codepipeline-job-event.ts`
- Create: `packages/cdk/src/reviewer/pipeline/pipeline-coordination-store.ts`
- Create: `packages/cdk/tests/pipeline-coordination-store.test.ts`

- [ ] **Step 1: Write failing schema/transition tests**

  Tests must cover:
  - parsing sanitized `UserParameters` with `pipelineExecutionId`, static pipeline/stage/action, and six `PAWL_*` values;
  - rejecting raw/extra fields;
  - job states `PENDING`, `COMPLETING`, `SUCCEEDED`, `FAILED`;
  - immutable intent precedence: existing intent > superseded > outcome > merge/close > timeout > no candidate;
  - merge/close cannot overwrite `COMPLETING` or existing failure;
  - generation is part of outcome identity.

  Run:
  ```bash
  bun test packages/cdk/tests/pipeline-coordination-store.test.ts
  ```
  Expected: fail because modules do not exist.

- [ ] **Step 2: Implement Zod schemas**

  Define safe schemas for:
  - outer CodePipeline job with minimally parsed `id` and `data.actionConfiguration.configuration.UserParameters`;
  - sanitized user-parameter payload;
  - callback intents and failure categories.

- [ ] **Step 3: Implement pure transition helpers**

  Implement key builders and pure functions such as `selectTerminalCandidate`, `canClaimCompletion`, `nextRetryAt`, and `isCompletionLeaseExpired`. Keep AWS SDK/DynamoDB out of this file.

- [ ] **Step 4: Verify green**

  Run:
  ```bash
  bun test packages/cdk/tests/pipeline-coordination-store.test.ts
  bunx biome check packages/cdk/src/reviewer/pipeline/codepipeline-job-event.ts packages/cdk/src/reviewer/pipeline/pipeline-coordination-store.ts packages/cdk/tests/pipeline-coordination-store.test.ts
  ```
  Expected: pass.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/cdk/src/reviewer/pipeline packages/cdk/tests/pipeline-coordination-store.test.ts
  git commit -m "feat(cdk): add pipeline review coordination domain"
  ```

## Task 3: DynamoDB GSI support

**Files:**
- Modify: `packages/cdk/src/dynamodb-table.ts`
- Add/modify: `packages/cdk/tests/dynamodb-table.test.ts` if present, otherwise create `packages/cdk/tests/dynamodb-table.test.ts`

- [ ] **Step 1: Write failing construct test**

  Test that `DynamoDbTable` accepts GSI definitions with partition/sort keys and synthesizes `GlobalSecondaryIndexes` for `GSI1` and `GSI2`. Test Zod rejects duplicate index names and invalid key definitions.

  Run:
  ```bash
  bun test packages/cdk/tests/dynamodb-table.test.ts
  ```
  Expected: fail.

- [ ] **Step 2: Implement GSI props**

  Extend `DynamoDbTablePropsSchema` with optional `globalSecondaryIndexes`. Use CDK `TableV2` GSI support and preserve existing defaults.

- [ ] **Step 3: Verify green**

  Run:
  ```bash
  bun test packages/cdk/tests/dynamodb-table.test.ts
  bunx biome check packages/cdk/src/dynamodb-table.ts packages/cdk/tests/dynamodb-table.test.ts
  ```
  Expected: pass.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/cdk/src/dynamodb-table.ts packages/cdk/tests/dynamodb-table.test.ts
  git commit -m "feat(cdk): support DynamoDB table GSIs"
  ```

## Task 4: AWS CodePipeline transport and runtime dependency

**Files:**
- Modify: `packages/cdk/package.json`
- Create: `packages/cdk/src/reviewer/adapters/codepipeline-transport.ts`
- Create: `packages/cdk/tests/codepipeline-transport.test.ts`

- [ ] **Step 1: Write failing transport tests**

  Use a fake sender to assert:
  - `StartPipelineExecutionCommand` includes deterministic `clientRequestToken`, `sourceRevisions` with `actionName: "Source"`, `revisionType: "COMMIT_ID"`, and all six variables;
  - `PutJobSuccessResultCommand` and `PutJobFailureResultCommand` are constructed with job ID and bounded failure details.

- [ ] **Step 2: Move dependency**

  Move `@aws-sdk/client-codepipeline` from `devDependencies` to `dependencies` in `packages/cdk/package.json`. Do not add Scheduler.

- [ ] **Step 3: Implement transport**

  Implement a narrow transport class and interfaces used by router/reconciler. Keep AWS SDK types inside the adapter.

- [ ] **Step 4: Verify green**

  Run:
  ```bash
  bun test packages/cdk/tests/codepipeline-transport.test.ts
  bun install --frozen-lockfile
  bunx biome check packages/cdk/package.json packages/cdk/src/reviewer/adapters/codepipeline-transport.ts packages/cdk/tests/codepipeline-transport.test.ts
  ```
  Expected: pass and lockfile stays consistent or is updated deliberately if Bun requires it.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/cdk/package.json bun.lock packages/cdk/src/reviewer/adapters/codepipeline-transport.ts packages/cdk/tests/codepipeline-transport.test.ts
  git commit -m "feat(cdk): add CodePipeline review transport"
  ```

## Task 5: DynamoDB-backed coordination store

**Files:**
- Modify: `packages/cdk/src/reviewer/adapters/dynamodb-state-store.ts`
- Modify: `packages/cdk/src/reviewer/ports/state-store.ts` or create a focused port file if cleaner.
- Create: `packages/cdk/tests/pipeline-reconciler.test.ts` for store/reconciler fakes as needed.

- [ ] **Step 1: Write failing store tests**

  Tests must cover:
  - bridge registration stores only approved metadata and GSI attributes;
  - duplicate registration is idempotent;
  - outcome writes are immutable by request/generation/revision;
  - request-scoped query paginates;
  - supersession marks older `PENDING` jobs only;
  - merge/close marks genuinely pending jobs success only;
  - `PENDING -> COMPLETING` claim stores immutable intent/lease;
  - expired `COMPLETING` lease can be reclaimed with same intent only;
  - terminal update removes actionable GSI attributes.

- [ ] **Step 2: Implement focused store methods**

  Add methods such as `registerPipelineJob`, `recordPipelineExecutionMapping`, `recordReviewOutcome`, `listDuePipelineJobs`, `markSuperseded`, `markTerminalRequestSuccess`, `claimPipelineJobCompletion`, and `finishPipelineJobCompletion`.

- [ ] **Step 3: Verify green**

  Run:
  ```bash
  bun test packages/cdk/tests/pipeline-reconciler.test.ts packages/cdk/tests/reviewer/unit/dynamodb-state-store.test.ts
  bunx biome check packages/cdk/src/reviewer/adapters/dynamodb-state-store.ts packages/cdk/src/reviewer/ports/state-store.ts packages/cdk/tests/pipeline-reconciler.test.ts
  ```
  Expected: pass.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/cdk/src/reviewer/adapters/dynamodb-state-store.ts packages/cdk/src/reviewer/ports/state-store.ts packages/cdk/tests/pipeline-reconciler.test.ts
  git commit -m "feat(cdk): persist pipeline review coordination state"
  ```

## Task 6: Bridge and reconciler handlers

**Files:**
- Create: `packages/cdk/src/reviewer/handlers/pipeline-bridge.ts`
- Create: `packages/cdk/src/reviewer/handlers/pipeline-reconciler.ts`
- Extend: `packages/cdk/tests/pipeline-bridge.test.ts`
- Extend: `packages/cdk/tests/pipeline-reconciler.test.ts`

- [ ] **Step 1: Write failing bridge tests**

  Cover documented CodePipeline envelopes, expanded Pawl user parameters, invalid payload with job ID, invalid payload without job ID, no raw credential persistence, and async reconciler invocation.

- [ ] **Step 2: Implement bridge handler**

  Use `useCodePipelineHandler`, Zod schemas, `DynamoDbStateStore`, and Lambda invoke transport for reconciler. Log only metadata.

- [ ] **Step 3: Write failing reconciler tests**

  Cover candidate precedence, timeout, success/failure callbacks, ambiguous callback retry, already-completed response, completion lease recovery, continuing after one bad job, and bounded sanitized failure details.

- [ ] **Step 4: Implement reconciler handler**

  Query due jobs, process independently, claim leases, call CodePipeline transport, finish terminal state, and use bounded retry scheduling via `nextActionAt`.

- [ ] **Step 5: Verify green**

  Run:
  ```bash
  bun test packages/cdk/tests/pipeline-bridge.test.ts packages/cdk/tests/pipeline-reconciler.test.ts
  bunx biome check packages/cdk/src/reviewer/handlers/pipeline-bridge.ts packages/cdk/src/reviewer/handlers/pipeline-reconciler.ts packages/cdk/tests/pipeline-bridge.test.ts packages/cdk/tests/pipeline-reconciler.test.ts
  ```
  Expected: pass.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/cdk/src/reviewer/handlers/pipeline-bridge.ts packages/cdk/src/reviewer/handlers/pipeline-reconciler.ts packages/cdk/tests/pipeline-bridge.test.ts packages/cdk/tests/pipeline-reconciler.test.ts
  git commit -m "feat(cdk): add pipeline review bridge and reconciler"
  ```

## Task 7: Reviewer cycle observer

**Files:**
- Modify: `packages/cdk/src/reviewer/workflows/reviewer-workflow.ts`
- Modify: `packages/cdk/src/reviewer/handlers/reviewer.ts`
- Add/modify: `packages/cdk/tests/reviewer/unit/workflows/reviewer-workflow.test.ts`
- Add/modify: `packages/cdk/tests/reviewer/unit/handlers/reviewer.test.ts`

- [ ] **Step 1: Write failing workflow tests**

  Cover reviewed outcome, blocked-limit outcome, empty wake no outcome, merged/closed success behavior through observer/store seam, and handler recording failure outcome on thrown workflow error.

- [ ] **Step 2: Add observer port**

  Add optional `cycleObserver` dependency with no-op default. Report sanitized data only after feedback/reconciliation and before waiting.

- [ ] **Step 3: Wire deployed observer**

  In handler composition, construct DynamoDB-backed observer only when pipeline coordination env is present; otherwise use no-op.

- [ ] **Step 4: Verify green**

  Run:
  ```bash
  bun test packages/cdk/tests/reviewer/unit/workflows/reviewer-workflow.test.ts packages/cdk/tests/reviewer/unit/handlers/reviewer.test.ts
  bunx biome check packages/cdk/src/reviewer/workflows/reviewer-workflow.ts packages/cdk/src/reviewer/handlers/reviewer.ts
  ```
  Expected: pass.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/cdk/src/reviewer/workflows/reviewer-workflow.ts packages/cdk/src/reviewer/handlers/reviewer.ts packages/cdk/tests/reviewer/unit/workflows/reviewer-workflow.test.ts packages/cdk/tests/reviewer/unit/handlers/reviewer.test.ts
  git commit -m "feat(cdk): record durable review cycle outcomes"
  ```

## Task 8: Router PR-gated pipeline start

**Files:**
- Modify: `packages/cdk/src/reviewer/handlers/router.ts`
- Modify: `packages/cdk/src/reviewer/router/event-router.ts`
- Modify: `packages/cdk/src/reviewer/pipeline-review-common.ts`
- Modify/add tests: `packages/cdk/tests/reviewer/unit/event-router.test.ts`, `packages/cdk/tests/pipeline-review-common.test.ts`

- [ ] **Step 1: Write failing router/pipeline tests**

  Cover request-opened/reopened/revision-updated start exact-revision pipeline with variables, human-comment no start, stale old revision no start, merged/closed no start plus pending success candidate, duplicate delivery idempotency, and supersession of older pending jobs.

- [ ] **Step 2: Implement production adapters in router composition**

  Replace `pipelineTransport: undefined` placeholders when `PIPELINE_NAME` and coordination env are present. Use CodePipeline transport and DynamoDB store.

- [ ] **Step 3: Integrate exact start into routing flow**

  After authoritative provider refetch and state append, start pipeline once per request/generation/source revision. Ensure router still starts/wakes durable reviewer as before.

- [ ] **Step 4: Verify green**

  Run:
  ```bash
  bun test packages/cdk/tests/reviewer/unit/event-router.test.ts packages/cdk/tests/pipeline-review-common.test.ts
  bunx biome check packages/cdk/src/reviewer/handlers/router.ts packages/cdk/src/reviewer/router/event-router.ts packages/cdk/src/reviewer/pipeline-review-common.ts
  ```
  Expected: pass.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/cdk/src/reviewer/handlers/router.ts packages/cdk/src/reviewer/router/event-router.ts packages/cdk/src/reviewer/pipeline-review-common.ts packages/cdk/tests/reviewer/unit/event-router.test.ts packages/cdk/tests/pipeline-review-common.test.ts
  git commit -m "feat(cdk): start PR-gated pipelines from review router"
  ```

## Task 9: CDK wiring for bridge gate

**Files:**
- Modify: `packages/cdk/src/codepipeline.ts`
- Modify: `packages/cdk/src/codecommit-auto-reviewer.ts`
- Modify: `packages/cdk/tests/codepipeline.test.ts`
- Modify: `packages/cdk/tests/integration/codepipeline.test.ts`

- [ ] **Step 1: Write failing CDK tests**

  Cover:
  - pipeline declares six variables;
  - PR-gated auto-review injects `AIReview` targeting bridge function name, not durable ARN/`$LATEST`;
  - user parameters contain only execution ID and Pawl variable references;
  - bridge/reconciler Lambdas and one-minute EventBridge rule synthesize;
  - state table has GSI1/GSI2;
  - timeout validation default/accept/reject cases;
  - push-triggered auto-review creates no gate;
  - `PutJob*` wildcard suppression exists.

- [ ] **Step 2: Implement construct props and validation**

  Add `reviewActionTimeoutMinutes?: number` with Zod or explicit validation: default 60, min 5, max 1380, allowed only for PR-gated auto-review.

- [ ] **Step 3: Create bridge/reconciler resources**

  In auto-review/pipeline wiring, create bridge and reconciler ordinary `LambdaFunction`s, env vars, state table GSIs, and static EventBridge rule.

- [ ] **Step 4: Inject bridge action**

  Replace direct durable reviewer `LambdaInvokeAction` with bridge `LambdaInvokeAction`. Set sanitized `userParameters`. Remove durable ARN proxy for pipeline actions.

- [ ] **Step 5: Add IAM grants and suppressions**

  Apply matrix: pipeline invokes bridge; bridge/router/reviewer invoke reconciler; table/index read/write; router pipeline start/read; reconciler `PutJob*` with documented wildcard suppression; EventBridge invokes reconciler.

- [ ] **Step 6: Update integration expectations**

  LocalStack test should assert bridge action config, not direct durable target. Keep LocalStack limitations isolated.

- [ ] **Step 7: Verify green**

  Run:
  ```bash
  bun test packages/cdk/tests/codepipeline.test.ts packages/cdk/tests/integration/codepipeline.test.ts
  bunx biome check packages/cdk/src/codepipeline.ts packages/cdk/src/codecommit-auto-reviewer.ts packages/cdk/tests/codepipeline.test.ts packages/cdk/tests/integration/codepipeline.test.ts
  ```
  Expected: unit tests pass; integration tests may require `run-aws-integration=1` and LocalStack token and should skip or fail only for documented environment prerequisites.

- [ ] **Step 8: Commit**

  ```bash
  git add packages/cdk/src/codepipeline.ts packages/cdk/src/codecommit-auto-reviewer.ts packages/cdk/tests/codepipeline.test.ts packages/cdk/tests/integration/codepipeline.test.ts
  git commit -m "feat(cdk): wire CodePipeline review bridge gate"
  ```

## Task 10: Full verification and documentation notes

**Files:**
- Modify docs only if existing README/example docs mention direct durable `AIReview` action.

- [ ] **Step 1: Run targeted reviewer suite**

  ```bash
  bun test packages/cdk/tests/pipeline-coordination-store.test.ts packages/cdk/tests/pipeline-bridge.test.ts packages/cdk/tests/pipeline-reconciler.test.ts packages/cdk/tests/pipeline-review-common.test.ts packages/cdk/tests/codepipeline.test.ts packages/lambda/tests/codepipeline-handler.test.ts
  ```
  Expected: pass.

- [ ] **Step 2: Run package build/lint checks**

  ```bash
  bunx biome check packages/lambda packages/cdk/src packages/cdk/tests
  bun run --filter '@pawl/lambda' build
  bun run --filter '@pawl/cdk' build
  ```
  Expected: pass, except note any pre-existing TypeScript 6/rootDir issue if still present and unchanged.

- [ ] **Step 3: Run broader tests as feasible**

  ```bash
  bun test packages/lambda packages/cdk/tests/reviewer packages/cdk/tests/codepipeline.test.ts
  ```
  Expected: pass. Do not claim repository-wide `bun test` passes unless run fresh and it passes; current baseline has unrelated failures.

- [ ] **Step 4: Real AWS follow-up note**

  Document in final report that a real-AWS end-to-end verification is still required for CodePipeline callback timing, exact source variables, supersession, timeout, and merge/close lifecycle.

- [ ] **Step 5: Commit docs if changed**

  ```bash
  git add <docs changed>
  git commit -m "docs: update CodePipeline review bridge notes"
  ```
