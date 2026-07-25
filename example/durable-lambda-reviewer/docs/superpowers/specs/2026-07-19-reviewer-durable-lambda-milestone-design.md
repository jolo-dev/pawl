# Reviewer Durable Lambda Milestone Design

**Date:** 2026-07-19
**Status:** Draft — pending user approval
**Milestone:** Second of the durable reviewer feature implementation (master plan Tasks 15 + 16-reviewer slice)

## 1. Purpose

Instantiate the durable **reviewer** Lambda and prove the full persist → start → callback-wake → complete lifecycle end-to-end, without yet building Bedrock, CodeBuild, or finding reconciliation. The router milestone (merged) left the reviewer referenced _by name only_ with a hand-written inline IAM policy. This milestone replaces that policy with the real `DurableLambdaFunction` construct, wires the reviewer handler composition root, and exercises the durable execution lifecycle with **stub** review/check/reconcile components behind the existing ports. Subsequent milestones fill in Bedrock (Task 13), CodeBuild (Task 12), and the reconciler (Task 14).

The milestone produces a `cdk synth`-clean stack that deploys a working reviewer `DurableLambdaFunction` with valid IAM, and a replay-safe durable workflow that drives the `ReviewStateStore` lifecycle through `STARTING → RUNNING → WAITING → COMPLETED` using the durable SDK's `step`/`waitForCallback`/`wait` primitives, verified by a focused unit test with fakes.

## 2. Confirmed decisions

- The reviewer is a Pawl `DurableLambdaFunction` constructed with `id: "Reviewer"`, yielding physical name `${team}-${stage}-Reviewer-lambda` and alias `${team}-${stage}-Reviewer-lambda:${aliasName}` — exactly matching the router milestone's invoke target, IAM scope, and bot-filter ARN convention (spec §6 of the router milestone). This is the alignment the prior milestone explicitly deferred.
- The router milestone's hand-written inline `RouterDurableExecutionPolicy` is **replaced** by Pawl's `grantInvokeDurable` + `grantReadDurableExecutions` + `grantSendDurableExecutionCallbacks` helpers, keeping one IAM source of truth. The `AwsSolutions-IAM5` suppressions move onto the reviewer construct (Pawl's helpers own them), and the router-side inline policy is deleted.
- The reviewer handler is a `useDurableHandler` composition root (`src/handlers/durable-reviewer-handler.ts`) over a `ReviewerWorkflow` (`src/workflows/reviewer-workflow.ts`). The workflow consumes the existing `ReviewStateStore`, `SourceControlProvider`, `CheckRunner`, `ReviewModel`, and a new `FindingReconciler` port — all injected, with **stub** implementations this milestone.
- The durable SDK's `context.step`, `context.waitForCallback`, and `context.wait` are the only orchestration primitives used. No raw checkpoint manipulation; no `invoke`/`map`/`parallel` this milestone.
- The reviewer's durable execution event payload is exactly what the router already sends: `{ request, generation, reviewerArn, snapshot? }` (see `EventRouter.#start`). The reviewer does **not** re-fetch the snapshot on cold start when one is present; it re-fetches only on replay/refresh via the provider port (existing `route` loadSnapshot seam).
- Callback wake-ups: the router already calls `router.wake(CallbackWake)` on `callback`-kind appended events. This milestone does **not** add a second EventBridge rule for callback deliveries — the durable SDK's `SendDurableExecutionCallbackSuccess` is invoked by the _router_ (via `AwsLambdaTransport`'s `callback` command) against the durable execution, not by EventBridge. The reviewer's `waitForCallback` resumes inside the durable execution; no reviewer-side HTTP/EventBridge listener is needed.
- Stub review/check/reconcile components are **test-only fakes** plus thin no-op prod defaults gated behind env, so the deployed reviewer can boot without crashing but produces no real findings until later milestones. The unit test exercises the workflow with deterministic fakes.
- `reviewerArn` (bot filter) is now sourced from the **real** reviewer construct's `durableFunctionArn` rather than a derived convention string, removing the router-milestone's "Important uncertainty" about the ARN. (Live-AWS validation of the _author_ ARN CodeCommit records remains deferred, but the stack no longer guesses.)
- No live-AWS integration tests this milestone; verification is `cdk synth`, focused unit tests, frozen install, and cdk-nag.

## 3. Scope

### 3.1 In scope

- `src/handlers/durable-reviewer-handler.ts`: `useDurableHandler` composition root exporting `handler`. Builds a `ReviewerWorkflow` from env (AWS SDK transports + stub review/check/reconcile) and runs it.
- `src/workflows/reviewer-workflow.ts`: replay-safe durable lifecycle loop using `context.step` / `context.waitForCallback` / `context.wait`. Drives `ReviewStateStore` through `beginCycle → claimEvents → (review-engine stub) → registerCallback → waitForCallback → complete`.
- `src/services/finding-reconciler.ts`: **new port** `FindingReconciler` (the master plan's Task 14 interface) + a no-op stub implementation this milestone. The workflow depends on the port, not the implementation.
- `tests/unit/workflows/reviewer-workflow.test.ts`: focused unit test exercising the lifecycle with fakes (in-memory state store, fake provider, stub check runner, stub review model, stub reconciler) using the durable SDK's **testing** package (`@aws/durable-execution-sdk-js-testing`) `TestRunner` to drive replay without AWS.
- `tests/unit/handlers/durable-reviewer-handler.test.ts`: handler shape test (`typeof handler === "function"`, `handler.length === 2` for `(event, context)`).
- `stacks/reviewer-stack.ts`: instantiate `DurableLambdaFunction(this, "Reviewer", {...})`; replace the inline `RouterDurableExecutionPolicy` with `reviewer.grantInvokeDurable(router)` + `reviewer.grantReadDurableExecutions(router)` + `reviewer.grantSendDurableExecutionCallbacks(router)`. Set reviewer env vars (`REVIEWER_FUNCTION_NAME`/`REVIEWER_FUNCTION_ARN` on the _router_ now come from `reviewer.durableFunctionArn`/`reviewer.lambda.functionName`).
- `tests/constructs/reviewer-stack.test.ts`: extend the existing construct test to assert the reviewer `DurableLambdaFunction` exists, its alias/version exist, the router role's durable IAM is now granted via the reviewer construct (not an inline policy), and the old `RouterDurableExecutionPolicy` resource is gone. Re-verify cdk-nag.
- `cdk.json`: add `reviewerExecutionTimeoutSeconds` (default `2592000` = 30 days, ≤ master plan's 90-day cap) and `reviewerRetentionDays` (default `14`) context. `reviewerAlias` already exists.

### 3.2 Out of scope

- Bedrock review engine (Task 13): the `ReviewModel` port is satisfied by a no-op stub returning an empty `ModelReviewOutput`.
- CodeBuild check runner (Task 12): the `CheckRunner` port is satisfied by a no-op stub returning an empty `CheckRunResult` (`status: "completed"`, no checks).
- Finding reconciliation logic (Task 14): the `FindingReconciler` port is satisfied by a no-op stub that posts no comments.
- Repository `.pawl/reviewer.json` loading at runtime (Task 12): the stub review model uses the config-default `modelId: "configured-default"`.
- AWS integration tests (Task 17).
- Reviewer-side CloudWatch custom metrics/alarms beyond Pawl construct defaults.
- The `reviewer-workflow.ts` debounce/coalescing of rapid events: the router already coalesces via `EventRouter.route`/`event-coalescer`; this milestone's workflow processes one claimed batch per cycle.

## 4. Architecture

### 4.1 Stack composition (delta from router milestone)

`DurableLambdaReviewerStack` constructs, in order:

1. `DynamoDbTable` "ReviewerState" — unchanged.
2. `LambdaFunction` "router" — unchanged, except its env vars `REVIEWER_FUNCTION_NAME` and `REVIEWER_FUNCTION_ARN` are now sourced from the reviewer construct (step 3) rather than derived convention strings. Construction order shifts: the reviewer is constructed **before** the router so its names feed the router env.
3. `DurableLambdaFunction` "Reviewer" — **new**. `entry` points to `src/handlers/durable-reviewer-handler.ts`. `executionTimeoutSeconds` and `retentionDays` from CDK context (Zod-validated, defaulted). `aliasName` from `reviewerAlias` context (default `"live"`). Env: `STATE_TABLE_NAME`, `REPOSITORY_NAME`, `BOT_ARN_PATTERNS`, plus `REVIEWER_FUNCTION_NAME`/`REVIEWER_FUNCTION_ARN` set to its own name/ARN (so the reviewer can self-identify for bot filtering if needed). Role gets `stateTable.grantReadWrite`, `events.grantRead`+`grantConfigRead` (reviewer also reads the repo), and reviewer-side durable grants are **not** self-granted.
4. `CodeCommitReviewEvents` "ReviewEvents" — unchanged, targets the router.
5. Router durable IAM: **replace** the inline `Policy` + `NagSuppressions` block with:
   ```ts
   reviewer.grantInvokeDurable(router);
   reviewer.grantReadDurableExecutions(router);
   reviewer.grantSendDurableExecutionCallbacks(router);
   ```
   The `AwsSolutions-IAM5` suppressions for `Resource::*` (callback) and `durable-execution/*/*` now live on Pawl's `CallbackPolicy`/router default policy via the helper's own `NagSuppressions.addResourceSuppressions` calls — no stack-side suppression needed for these. The construct test asserts no `RouterDurableExecutionPolicy` resource remains.

### 4.2 Reviewer handler composition root

`src/handlers/durable-reviewer-handler.ts` exports `handler = useDurableHandler<ReviewerEvent, void>("durable-reviewer", async (event, context, { logger }) => { ... })`. The handler:

1. Parses `event` as `{ request: RequestKey, generation: number, reviewerArn: string, snapshot?: ReviewRequest }` with a Zod schema (defensive; the router produces this shape).
2. Lazily builds (module-scoped cache, like the router handler) a `ReviewerWorkflow` from env: `DynamoDbStateStore`, `AwsLambdaTransport` (only if the reviewer itself needs to send callbacks — this milestone it does **not**, since the router sends callbacks; keep the transport out of the reviewer), `CodeCommitProvider({ reviewerArn })`, stub `CheckRunner`, stub `ReviewModel`, stub `FindingReconciler`.
3. Calls `await workflow.run(event, context, logger)`.

The handler's `.length` is 2 (`(event, context)`) — matching the durable SDK's `DurableLambdaHandler` signature `(event, context) => Promise<...>`, distinct from the router's `useEventbridgeHandler` `.length === 1`.

### 4.3 Reviewer workflow (durable lifecycle)

`ReviewerWorkflow.run(event, context, logger)` executes a replay-safe loop. The durable SDK guarantees that on replay, already-completed `step`/`waitForCallback`/`wait` calls return their cached result without re-executing the body. The workflow:

```
run(event, context, logger):
  request = event.request
  generation = event.generation

  # 1. Begin cycle (idempotent under replay — beginCycle is a no-op if the cycle already exists)
  snapshot = await context.step("load-snapshot", async () => {
    const req = await provider.getRequest(request)
    return { request, generation, cycle: <derived>, sourceRevision: req.sourceRevision,
             destinationRevision: req.destinationRevision, configVersion: 1,
             eventWatermark: event.snapshot?.sourceRevision ?? req.sourceRevision,
             startedAt: now() }
  })
  await store.beginCycle(snapshot)

  # 2. Claim pending events for this generation
  claimed = await context.step("claim-events", () => store.claimEvents(request, generation))

  # 3. Review (stub) — produce no findings this milestone
  await context.step("run-review", async () => {
    const checks = await checkRunner.run({ request, snapshot, checks: [] })   # stub: empty
    const result = await reviewModel.review({ snapshot, changedFiles: [], checks,
                                              repositoryConfig: DEFAULT_CONFIG, humanComments: [] })
    await reconciler.apply({ request, generation, candidates: result.output.candidates,
                             snapshot, store, provider })                      # stub: no-op
  })

  # 4. Register a callback and wait for the next event (human comment or fixing commit)
  const callback = await context.createCallback("wait-for-next-event")
  await context.step("register-callback", () =>
    store.registerCallback({ request, generation, callbackGeneration: <cbGen>,
                             callbackId: callback.callbackId, registeredAt: now(),
                             leaseVersion: <lease>, lifecycleState: "WAITING" }))

  # 5. Wait for the router to send a callback when a new event arrives
  await context.waitForCallback(callback.callbackId)

  # 6. On wake: re-claim. If merged/closed/timed-out → complete. Else loop (new cycle).
  #    The durable SDK's waitForCallback resumption is the loop primitive.
```

**Replay safety:** every store mutation is inside a `context.step`, so on replay the step is skipped (cached result returned) and the store is not double-written. `beginCycle`, `claimEvents`, `registerCallback` are all idempotent under the existing state-store contract (they use conditional writes). The workflow does **not** call `store.complete` itself on the happy path; completion is driven by the router's `route` observing a `merged`/`closed` event or a timeout, which calls `store.complete` directly (existing `EventRouter` behavior). The workflow's job is to process the claimed batch and then wait.

**Termination conditions** (the workflow `waitForCallback` resolves and the workflow returns `void`):

- The router observes `request-merged`/`request-closed` → `store.complete({ type: "merged" | "closed" })` → the registered callback is cleared → `waitForCallback` rejects with a stale/generation-changed signal → workflow returns.
- Timeout: the durable execution hits `executionTimeoutSeconds` → durable SDK terminates the execution; the router's lease-recovery observes `TIMED_OUT` → `store.complete({ type: "timed-out" })`.

This milestone's unit test exercises the **happy path** (begin → claim → review-stub → register → wait → wake → return) and one **stale-callback** path, using the testing SDK's `TestRunner` to simulate a callback delivery and a generation change.

### 4.4 The `FindingReconciler` port (new, minimal)

```ts
export interface ReconcilerInput {
  readonly request: RequestKey;
  readonly generation: number;
  readonly candidates: readonly ModelReviewCandidate[];
  readonly snapshot: ReviewCycleSnapshot;
}

export interface FindingReconciler {
  apply(input: ReconcilerInput): Promise<void>;
}
```

`ModelReviewCandidate = FindingCandidate | DismissalCandidate` (already defined in `domain/finding.ts`). The stub `NoopFindingReconciler` logs and returns. The real implementation (Task 14) will call `store.reserveFindingWrite`/`confirmFindingWrite` and `provider.postInlineFinding`/`markCommentResolved`. The port is intentionally narrow so the workflow depends on it, not on the store+provider directly for finding writes.

### 4.5 Stub implementations (prod + test)

- `NoopCheckRunner implements CheckRunner`: returns `{ status: "completed", checks: [] }`.
- `NoopReviewModel implements ReviewModel`: returns `{ output: { candidates: [] }, modelId: "configured-default", usage: { inputTokens: 0, outputTokens: 0 } }`.
- `NoopFindingReconciler implements FindingReconciler`: returns `void`.

These live in `src/services/` (not `tests/fakes/`) because the deployed reviewer needs them to boot. Later milestones swap them for real implementations behind the same ports; no workflow change.

## 5. File responsibilities

### 5.1 New application files

- `src/handlers/durable-reviewer-handler.ts`: `useDurableHandler` composition root. Exports `handler` and `buildReviewerWorkflow(options?)` (injectable for tests, mirroring the router handler's `buildEventRouter` seam).
- `src/workflows/reviewer-workflow.ts`: `ReviewerWorkflow` class with `run(event, context, logger)`. Constructor takes `{ store, provider, checkRunner, reviewModel, reconciler, clock }`.
- `src/services/finding-reconciler.ts`: `FindingReconciler` port + `ReconcilerInput`. `NoopFindingReconciler` lives here too.
- `src/services/noop-check-runner.ts`: `NoopCheckRunner`.
- `src/services/noop-review-model.ts`: `NoopReviewModel`.

### 5.2 Modified application files

- `stacks/reviewer-stack.ts`: add `DurableLambdaFunction` "Reviewer"; source router env vars from it; replace inline policy with Pawl grants; Zod-add `reviewerExecutionTimeoutSeconds`/`reviewerRetentionDays`.
- `tests/constructs/reviewer-stack.test.ts`: add reviewer construct assertions; assert inline policy removed; re-verify cdk-nag with the helper-owned suppressions.
- `cdk.json`: add `reviewerExecutionTimeoutSeconds` (default `2592000`) and `reviewerRetentionDays` (default `14`) to context.

### 5.3 New test files

- `tests/unit/workflows/reviewer-workflow.test.ts`: lifecycle test with fakes + durable SDK `TestRunner`.
- `tests/unit/handlers/durable-reviewer-handler.test.ts`: handler shape test.

### 5.4 Out-of-scope files

- `src/adapters/bedrock-review-model.ts` (Task 13), `src/adapters/codebuild-check-runner.ts` (Task 12), real `finding-reconciler.ts` logic (Task 14), `tests/aws/*` (Task 17).

## 6. CDK context surface (delta)

New optional context keys:

- `reviewerExecutionTimeoutSeconds` (number, default `2_592_000` = 30 days; ≤ `REPOSITORY_CONFIG_LIMITS.maxTimeoutDays` × 86400 = 90 days per master plan §4.1).
- `reviewerRetentionDays` (number, default `14`; Pawl's `DurableLambdaConfigSchema` enforces 1–90).

Existing keys unchanged: `repositoryName`, `reviewerAlias`, `reviewerArn` (now optional and unused — the reviewer's own ARN is the construct's `durableFunctionArn`; kept for backward compat but the stack prefers the construct value), `botArnPatterns`.

## 7. IAM (delta)

### 7.1 Removed

The router milestone's inline `RouterDurableExecutionPolicy` (Invoke+List, GetDurableExecution, SendCallback) and its two stack-side `AwsSolutions-IAM5` suppressions are deleted.

### 7.2 Added (via Pawl helpers, on the reviewer construct)

- `reviewer.grantInvokeDurable(router)`: `lambda:InvokeFunction` on `reviewer.alias.functionArn`.
- `reviewer.grantReadDurableExecutions(router)`: `lambda:ListDurableExecutionsByFunction` on the alias ARN; `lambda:GetDurableExecution`+`GetDurableExecutionHistory` on `${alias.version.functionArn}/durable-execution/*/*`; `AwsSolutions-IAM5` suppression on the router's default policy for the version-ARN wildcard (Pawl-owned).
- `reviewer.grantSendDurableExecutionCallbacks(router)`: a dedicated `CallbackPolicy` attached to the router role with `SendDurableExecutionCallbackSuccess/Failure/Heartbeat` on `"*"`; `AwsSolutions-IAM5` suppression on that policy (Pawl-owned, verbatim reason).

### 7.3 Reviewer role

The reviewer's own role gets `stateTable.grantReadWrite(reviewer)` and `events.grantRead(reviewer)` + `events.grantConfigRead(reviewer)` (the reviewer reads the repo to load snapshots). It does **not** self-grant durable IAM. It does **not** get Bedrock or CodeBuild IAM this milestone (stubs make no calls).

### 7.4 cdk-nag

The construct test continues to suppress the Lambda-fixture findings (IAM4/L1) test-side per the router-milestone convention. The durable-execution IAM5 suppressions are now owned by Pawl's helpers on the construct resources — the test asserts they exist on the `CallbackPolicy` and the router's default policy, and that no `RouterDurableExecutionPolicy` resource remains. Zero unsuppressed findings.

## 8. Testing strategy

### 8.1 Workflow unit test (`tests/unit/workflows/reviewer-workflow.test.ts`)

Uses `@aws/durable-execution-sdk-js-testing`'s `TestRunner` to execute the workflow handler with a controlled event and context, advancing through steps and delivering callbacks synchronously. Fakes:

- `InMemoryStateStore` (existing) — pre-seeded with an initial event so `claimEvents` returns one batch.
- Fake `SourceControlProvider` returning a minimal `ReviewRequest`.
- `NoopCheckRunner`, `NoopReviewModel`, `NoopFindingReconciler`.

Cases:

1. **Happy path**: begin → claim → review (no findings) → register callback → wait → callback delivered → workflow returns. Assert `beginCycle` called, `registerCallback` called with `WAITING`, `claimEvents` returned the seeded event, store lifecycle reached `WAITING`.
2. **Stale callback / generation change**: after `registerCallback`, simulate a `complete({ type: "merged" })` on the store, then deliver the callback — assert the workflow returns without re-processing and without throwing (the store's `validateCallback` returns false on a cleared callback).

No real AWS clients. No real durable execution service.

### 8.2 Handler shape test

Assert `typeof handler === "function"` and `handler.length === 2`.

### 8.3 Construct test (extended)

Add to the existing `tests/constructs/reviewer-stack.test.ts`:

- One `AWS::Lambda::Function` for the reviewer **in addition to** the router (now 2 functions total). Wait — the router milestone asserted exactly 1 Lambda. This milestone adds the reviewer, so the assertion becomes 2.
- The reviewer has an `AWS::Lambda::Alias` and `AWS::Lambda::Version`.
- Router role's durable IAM statements still cover Invoke/List/Get/Callback — now sourced from the reviewer construct's grants, not an inline policy. Assert no `AWS::IAM::Policy` named `RouterDurableExecutionPolicy*` exists.
- `REVIEWER_FUNCTION_NAME`/`REVIEWER_FUNCTION_ARN` env vars on the router equal the reviewer's physical name/alias ARN.
- cdk-nag still passes (helper-owned suppressions; Lambda-fixture suppressed test-side).

### 8.4 Verification commands

- `rtk test bun test tests/unit/workflows tests/unit/handlers/durable-reviewer-handler.test.ts tests/constructs/reviewer-stack.test.ts`
- `rtk tsc --noEmit`
- `PATH="$PWD/node_modules/.bin:$PATH" rtk run 'cdk synth --quiet'`
- `rtk bun run lint && rtk bun run fmt:check`
- `rtk bun install --frozen-lockfile`

## 9. Acceptance criteria

1. `stacks/reviewer-stack.ts` instantiates `DurableLambdaFunction` "Reviewer" with `id: "Reviewer"`, alias from `reviewerAlias`, timeout/retention from context.
2. The router's durable-execution IAM is granted via `reviewer.grantInvokeDurable`/`grantReadDurableExecutions`/`grantSendDurableExecutionCallbacks`; the inline `RouterDurableExecutionPolicy` is gone.
3. `REVIEWER_FUNCTION_NAME`/`REVIEWER_FUNCTION_ARN` on the router equal the reviewer construct's physical name/alias ARN (no more derived convention string).
4. `src/handlers/durable-reviewer-handler.ts` exports `handler` (`useDurableHandler`, `.length === 2`) and a `buildReviewerWorkflow(options?)` seam.
5. `src/workflows/reviewer-workflow.ts` drives `ReviewStateStore` through `beginCycle → claimEvents → registerCallback → waitForCallback` using durable SDK `step`/`createCallback`/`waitForCallback`, with every store mutation inside a `context.step`.
6. The workflow unit test passes for the happy path and the stale-callback path using the durable SDK testing `TestRunner` + fakes.
7. `src/services/finding-reconciler.ts` defines the `FindingReconciler` port + `NoopFindingReconciler`; `NoopCheckRunner` and `NoopReviewModel` exist.
8. `cdk synth` produces a clean template with 2 Lambda functions (router + reviewer), 1 alias, 1 version, the state table, and the EventBridge wiring; synth uses local esbuild, not Docker.
9. `cdk-nag AwsSolutionsChecks` passes with only Pawl-helper-owned and Lambda-fixture suppressions; no stack-side inline-policy suppression remains.
10. Existing 187 tests remain green (no regression); new workflow/handler/construct tests added on top.
11. No Pawl library changes and no live AWS calls.
12. The reviewer's `durableFunctionArn` matches the router's `REVIEWER_FUNCTION_ARN` env var exactly (alignment the prior milestone deferred).

## 10. Decisions (approved by user — use judgment on all 5)

1. **Callback-delivery model.** Confirmed: the _router_ sends `SendDurableExecutionCallbackSuccess` via `AwsLambdaTransport`'s `callback` command when a new event arrives for a waiting generation (existing `EventRouter.#wake` behavior). No reviewer-side EventBridge listener.
2. **Workflow loop primitive.** `waitForCallback` is the wait/resumption point. The durable SDK replays the handler from the top on resumption, skipping already-completed `step`/`waitForCallback` calls and returning their cached results. Verified feasible against the testing SDK (§11).
3. **Stub placement.** Flat in `src/services/` — `NoopCheckRunner`, `NoopReviewModel`, `NoopFindingReconciler` are real (if trivial) prod-bootable implementations, not test fakes. A `stubs/` subdir would over-signal; they get swapped in-place for real impls in later milestones.
4. **Timeout default.** 30 days (`2_592_000`s) for `reviewerExecutionTimeoutSeconds`, matching the repository-config default `timeoutDays: 30`. The master plan's 90-day cap remains the Zod max.
5. **`reviewerArn` context key.** Removed. The reviewer construct's `durableFunctionArn` is the single source of truth; the router-milestone's overrideable `reviewerArn` context key is deleted from the Zod schema and `cdk.json`.

## 11. Testing SDK feasibility (verification)

The `@aws/durable-execution-sdk-js-testing` package exposes a `TestRunner` that executes a `DurableLambdaHandler` with a controlled `DurableExecutionInvocationInput`, advancing through steps and delivering callbacks synchronously without AWS. The workflow test constructs a `TestRunner`, registers the workflow handler, invokes it with a synthetic event, advances to the `waitForCallback`, delivers a callback (or simulates a stale/generation-changed rejection), and asserts the store state. Confirmed against the package's `test-runner` types.

---

**Once approved, I'll write the implementation plan** (`docs/superpowers/plans/2026-07-19-reviewer-durable-lambda-milestone.md`) task-by-task, then implement it in a fresh worktree on `feat/reviewer-durable-lambda-milestone` branched from `main`, mirroring the router milestone's flow.
