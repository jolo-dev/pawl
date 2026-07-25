# Reviewer Durable Lambda Milestone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instantiate the durable reviewer Lambda (`DurableLambdaFunction` "Reviewer"), wire its IAM via Pawl helpers (replacing the router milestone's inline policy), and implement the replay-safe `ReviewerWorkflow` + `useDurableHandler` composition root with stub review/check/reconcile components. Prove the persist → start → callback-wake → complete lifecycle end-to-end with fakes and the durable SDK testing runner.

**Architecture:** The router milestone left the reviewer referenced by name only with a hand-written inline IAM policy. This milestone constructs the real `DurableLambdaFunction`, sources the router's `REVIEWER_FUNCTION_NAME`/`REVIEWER_FUNCTION_ARN` from it, replaces the inline policy with `grantInvokeDurable`/`grantReadDurableExecutions`/`grantSendDurableExecutionCallbacks`, and builds the reviewer handler + workflow. The workflow drives `ReviewStateStore` through `beginCycle → claimEvents → registerCallback → waitForCallback` using durable SDK `step`/`createCallback`/`waitForCallback`; every store mutation is inside a `context.step` for replay safety. Stub `NoopCheckRunner`/`NoopReviewModel`/`NoopFindingReconciler` satisfy the ports so the deployed reviewer boots; later milestones swap them for real impls.

**Tech Stack:** Bun 1.3.x, TypeScript 6, `@pawl/cdk` (`DurableLambdaFunction`, `DynamoDbTable`, `LambdaFunction`, `CodeCommitReviewEvents`), `@pawl/lambda` (`useDurableHandler`), `@aws/durable-execution-sdk-js` 2.1.x, `@aws/durable-execution-sdk-js-testing` 1.1.x, AWS CDK 2.261, Zod 4, Oxlint/Oxfmt, Bun test, cdk-nag, `rtk`.

---

## Working directory and conventions

```text
APP=/Users/jolo/Development/worktrees/durable-lambda-reviewer-reviewer-milestone
PAWL=/Users/jolo/Development/worktrees/pawl
```

- Branch: `feat/reviewer-durable-lambda-milestone` (from `main` at `249f360`)
- App baseline: 187 tests passing on 17 files; tsc clean; cdk synth clean
- Pawl baseline HEAD: `794e286990533ef965f0961f0c3b27e47e09d783` (read-only this milestone)
- All shell commands use the `rtk` extension
- Follow `@superpowers:test-driven-development` for runtime code where a behavior is asserted; skip TDD only for pure CDK wiring with no observable behavior beyond synth/cdk-nag output
- `cdk synth` and construct tests require local `esbuild` on `PATH`; all CDK commands prepend `PATH="$PWD/node_modules/.bin:$PATH"`

## File map

### New application files

| Path                                                   | Responsibility                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `src/handlers/durable-reviewer-handler.ts`             | `useDurableHandler` composition root; exports `handler` + `buildReviewerWorkflow(options?)` |
| `src/workflows/reviewer-workflow.ts`                   | Replay-safe durable lifecycle loop (`step`/`createCallback`/`waitForCallback`)              |
| `src/services/finding-reconciler.ts`                   | `FindingReconciler` port + `ReconcilerInput` + `NoopFindingReconciler`                      |
| `src/services/noop-check-runner.ts`                    | `NoopCheckRunner` (empty `CheckRunResult`)                                                  |
| `src/services/noop-review-model.ts`                    | `NoopReviewModel` (empty `ModelReviewOutput`)                                               |
| `tests/unit/workflows/reviewer-workflow.test.ts`       | Lifecycle test with fakes + `LocalDurableTestRunner`                                        |
| `tests/unit/handlers/durable-reviewer-handler.test.ts` | Handler shape test (`typeof function`, `.length === 2`)                                     |

### Modified application files

| Path                                      | Responsibility                                                                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stacks/reviewer-stack.ts`                | Add `DurableLambdaFunction` "Reviewer"; source router env vars from it; replace inline policy with Pawl grants; Zod-add timeout/retention; remove `reviewerArn` context |
| `tests/constructs/reviewer-stack.test.ts` | Assert reviewer construct + alias/version; assert inline policy removed; assert helper-owned suppressions; re-verify cdk-nag                                            |
| `cdk.json`                                | Add `reviewerExecutionTimeoutSeconds` (default `2592000`) and `reviewerRetentionDays` (default `14`); remove `reviewerArn` if present                                   |

### Out of scope

- Bedrock review engine, CodeBuild check runner, real finding reconciliation logic, AWS integration tests, repository-config runtime loading (deferred to Tasks 12–14, 17).

---

### Task 1: Add the `FindingReconciler` port and stub implementations

**Files:**

- Create: `src/services/finding-reconciler.ts`
- Create: `src/services/noop-check-runner.ts`
- Create: `src/services/noop-review-model.ts`

- [ ] **Step 1: Define the `FindingReconciler` port**

Create `src/services/finding-reconciler.ts` with:

```ts
import type { ModelReviewCandidate } from "../domain/finding";
import type { RequestKey, ReviewCycleSnapshot } from "../domain/review-request";

export interface ReconcilerInput {
  readonly request: RequestKey;
  readonly generation: number;
  readonly candidates: readonly ModelReviewCandidate[];
  readonly snapshot: ReviewCycleSnapshot;
}

export interface FindingReconciler {
  apply(input: ReconcilerInput): Promise<void>;
}

/** No-op reconciler. Posts no comments; real implementation is Task 14. */
export class NoopFindingReconciler implements FindingReconciler {
  async apply(_input: ReconcilerInput): Promise<void> {
    /* no-op */
  }
}
```

`ModelReviewCandidate` is already exported from `domain/finding.ts` (union of `FindingCandidate | DismissalCandidate`).

- [ ] **Step 2: Create `NoopCheckRunner`**

Create `src/services/noop-check-runner.ts` implementing `CheckRunner` from `../ports/check-runner`:

```ts
export class NoopCheckRunner implements CheckRunner {
  async run(_input: CheckRunInput): Promise<CheckRunResult> {
    return { status: "completed", checks: [] };
  }
}
```

- [ ] **Step 3: Create `NoopReviewModel`**

Create `src/services/noop-review-model.ts` implementing `ReviewModel` from `../ports/review-model`:

```ts
export class NoopReviewModel implements ReviewModel {
  async review(_input: ReviewModelInput): Promise<ReviewModelResult> {
    return {
      output: { candidates: [] },
      modelId: "configured-default",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
```

- [ ] **Step 4: Verify typecheck**

```bash
cd "$APP"
rtk tsc --noEmit
```

Expected: clean. No tests yet (stubs have no behavior to assert).

- [ ] **Step 5: Review and commit**

```bash
rtk git -C "$APP" add src/services/finding-reconciler.ts src/services/noop-check-runner.ts src/services/noop-review-model.ts
rtk git -C "$APP" commit -m 'feat: add FindingReconciler port and noop stub implementations'
```

---

### Task 2: Implement the `ReviewerWorkflow` (TDD)

**Files:**

- Create: `src/workflows/reviewer-workflow.ts`
- Create: `tests/unit/workflows/reviewer-workflow.test.ts`

- [ ] **Step 1: Write the failing workflow test (RED)**

Create `tests/unit/workflows/reviewer-workflow.test.ts` using `@aws/durable-execution-sdk-js-testing`'s `LocalDurableTestRunner`. Setup: `beforeAll` → `LocalDurableTestRunner.setupTestEnvironment({ skipTime: true })`; `afterAll` → `teardownTestEnvironment()`.

The workflow handler under test is `withDurableExecution<ReviewerEvent, void>(async (event, context) => workflow.run(event, context, logger))` — but to keep the workflow test focused on `ReviewerWorkflow.run`, wrap it in a minimal durable handler inside the test file.

Fakes:

- `InMemoryStateStore` from `tests/fakes/in-memory-state-store`, pre-seeded with one `request-opened` event for `{ provider: "codecommit", repository: "repo", requestId: "7" }` at generation 0.
- Fake `SourceControlProvider` returning a minimal `ReviewRequest` (status `"open"`, revisions `"src-rev-1234567"`/`"dst-rev-1234567"`).
- `NoopCheckRunner`, `NoopReviewModel`, `NoopFindingReconciler`.

Cases:

1. **happy path**: `runner.run({ payload: event })` → advance to the `waitForCallback` operation named `"wait-for-next-event"` → `op.waitForData(WaitingOperationStatus.SUBMITTED)` → `op.sendCallbackSuccess()` → `result.getResult()` resolves. Assert: `store` lifecycle reached `WAITING` (via `registerCallback` called), `claimEvents` returned the seeded event, `beginCycle` recorded generation 0. Use a spy on the store fakes or inspect `InMemoryStateStore` state.
2. **stale callback**: after `registerCallback`, call `store.complete(request, 0, { type: "merged" })` to clear the callback, then `op.sendCallbackSuccess()` → assert the workflow returns (does not throw) and does not re-process. The store's `validateCallback` returns false on a cleared callback; the workflow must treat a rejected/missing callback as terminal.

Run:

```bash
cd "$APP"
rtk test bun test tests/unit/workflows/reviewer-workflow.test.ts
```

Expected: FAIL because `src/workflows/reviewer-workflow.ts` does not exist.

- [ ] **Step 2: Implement the workflow**

Create `src/workflows/reviewer-workflow.ts`:

```ts
export interface ReviewerEvent {
  readonly request: RequestKey;
  readonly generation: number;
  readonly reviewerArn: string;
  readonly snapshot?: ReviewRequest;
}

export interface ReviewerWorkflowDeps {
  readonly store: ReviewStateStore;
  readonly provider: SourceControlProvider;
  readonly checkRunner: CheckRunner;
  readonly reviewModel: ReviewModel;
  readonly reconciler: FindingReconciler;
  readonly clock: () => Date;
}

export class ReviewerWorkflow {
  readonly #deps: ReviewerWorkflowDeps;
  constructor(deps: ReviewerWorkflowDeps) {
    this.#deps = deps;
  }

  async run(event: ReviewerEvent, context: DurableContext, logger: Logger): Promise<void> {
    const { request, generation } = event;
    // 1. Load snapshot + begin cycle (idempotent under replay)
    const snapshot = await context.step("load-snapshot", async () => {
      const req = await this.#deps.provider.getRequest(request);
      return {
        request,
        generation,
        cycle: 1,
        sourceRevision: req.sourceRevision,
        destinationRevision: req.destinationRevision,
        configVersion: 1,
        eventWatermark: event.snapshot?.sourceRevision ?? req.sourceRevision,
        startedAt: this.#deps.clock().toISOString(),
      } satisfies ReviewCycleSnapshot;
    });
    await context.step("begin-cycle", () => this.#deps.store.beginCycle(snapshot));

    // 2. Claim pending events
    const claimed = await context.step("claim-events", () =>
      this.#deps.store.claimEvents(request, generation),
    );

    // 3. Review (stub) — no findings this milestone
    if (claimed.events.length > 0) {
      await context.step("run-review", async () => {
        const checks = await this.#deps.checkRunner.run({ request, snapshot, checks: [] });
        const result = await this.#deps.reviewModel.review({
          snapshot,
          changedFiles: [],
          checks,
          repositoryConfig: DEFAULT_REPOSITORY_CONFIG,
          humanComments: [],
        });
        await this.#deps.reconciler.apply({
          request,
          generation,
          candidates: result.output.candidates,
          snapshot,
        });
      });
    }

    // 4. Register callback + wait for the next event
    const callback = await context.createCallback("wait-for-next-event");
    await context.step("register-callback", () =>
      this.#deps.store.registerCallback({
        request,
        generation,
        callbackGeneration: generation,
        callbackId: callback.callbackId,
        registeredAt: this.#deps.clock().toISOString(),
        leaseVersion: 0,
        lifecycleState: "WAITING",
      }),
    );

    // 5. Wait. On wake (router sent callback) the durable SDK resumes; the
    //    handler returns. Termination (merged/closed/timed-out) is driven by
    //    the router/store clearing the callback, which the SDK surfaces as a
    //    rejected/terminal callback — the workflow returns without throwing.
    await context.waitForCallback(callback.callbackId);
  }
}
```

`DEFAULT_REPOSITORY_CONFIG` is `repositoryConfigSchema.parse({})` (the schema's defaults). `DurableContext` and `Logger` types from the durable SDK + Powertools. Use `context.step` for every store mutation so replay skips re-execution.

- [ ] **Step 3: Run GREEN**

```bash
cd "$APP"
rtk test bun test tests/unit/workflows/reviewer-workflow.test.ts
```

Expected: both cases pass. If the testing runner's callback-delivery semantics differ from the design assumption, adjust the workflow's `waitForCallback` usage to match the SDK (e.g. `context.waitForCallback(name, submitterFn)` form) — the SDK's `waitForCallback(callbackId)` shape is confirmed by the `DurableContext` type.

- [ ] **Step 4: Verify typecheck and app regression**

```bash
cd "$APP"
rtk tsc --noEmit
rtk test bun test
rtk bun run lint
rtk bun run fmt
```

Expected: typecheck clean; 187 baseline + new workflow tests pass; lint clean; fmt clean.

- [ ] **Step 5: Review and commit**

```bash
rtk git -C "$APP" add src/workflows/reviewer-workflow.ts tests/unit/workflows/reviewer-workflow.test.ts
rtk git -C "$APP" commit -m 'feat: add replay-safe reviewer durable workflow'
```

---

### Task 3: Implement the reviewer handler composition root

**Files:**

- Create: `src/handlers/durable-reviewer-handler.ts`
- Create: `tests/unit/handlers/durable-reviewer-handler.test.ts`

- [ ] **Step 1: Write the failing handler shape test (RED)**

Create `tests/unit/handlers/durable-reviewer-handler.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { handler } from "../../../src/handlers/durable-reviewer-handler";

describe("durable-reviewer-handler", () => {
  test("handler is a durable handler function with arity 2", () => {
    expect(typeof handler).toBe("function");
    expect(handler.length).toBe(2);
  });
});
```

Run:

```bash
cd "$APP"
rtk test bun test tests/unit/handlers/durable-reviewer-handler.test.ts
```

Expected: FAIL because `src/handlers/durable-reviewer-handler.ts` does not exist.

- [ ] **Step 2: Implement the composition root**

Create `src/handlers/durable-reviewer-handler.ts`:

- `buildReviewerWorkflow(options?)`: undefined → env path (construct `DynamoDbStateStore` from `STATE_TABLE_NAME`, `CodeCommitProvider({ reviewerArn: process.env.REVIEWER_FUNCTION_ARN })`, `NoopCheckRunner`, `NoopReviewModel`, `NoopFindingReconciler`, `() => new Date()`); provided → injected deps for tests.
- `let cachedWorkflow: ReviewerWorkflow | undefined` + `getWorkflow()` lazy cache.
- `export const handler = useDurableHandler<ReviewerEvent, void>("durable-reviewer", async (event, context, { logger }) => { const workflow = getWorkflow(); await workflow.run(event, context, logger); });`

The handler's `.length` is 2 (`(event, context)`) because `useDurableHandler` returns the durable SDK's `DurableLambdaHandler` shape.

- [ ] **Step 3: Run GREEN**

```bash
cd "$APP"
rtk test bun test tests/unit/handlers/durable-reviewer-handler.test.ts
```

Expected: pass.

- [ ] **Step 4: Verify typecheck and app regression**

```bash
cd "$APP"
rtk tsc --noEmit
rtk test bun test
rtk bun run lint
rtk bun run fmt
```

Expected: all green; new handler test added on top of the workflow test.

- [ ] **Step 5: Review and commit**

```bash
rtk git -C "$APP" add src/handlers/durable-reviewer-handler.ts tests/unit/handlers/durable-reviewer-handler.test.ts
rtk git -C "$APP" commit -m 'feat: add durable reviewer handler composition root'
```

---

### Task 4: Wire the `DurableLambdaFunction` into the CDK stack and migrate IAM

**Files:**

- Modify: `stacks/reviewer-stack.ts`
- Modify: `tests/constructs/reviewer-stack.test.ts`
- Modify: `cdk.json`

- [ ] **Step 1: Add cdk.json context and update the failing construct test (RED)**

Add to `cdk.json` context: `"reviewerExecutionTimeoutSeconds": 2592000`, `"reviewerRetentionDays": 14`. Remove `"reviewerArn"` if present (decision 5 — redundant).

Update `tests/constructs/reviewer-stack.test.ts`:

- Resource-count test: now **2** `AWS::Lambda::Function` (router + reviewer), plus 1 `AWS::Lambda::Alias` and 1 `AWS::Lambda::Version`.
- Add a test: reviewer Lambda has `DurableConfig`/alias/version; its physical name is `jolo-dev-Reviewer-lambda`; alias name `live`.
- Add a test: router env `REVIEWER_FUNCTION_NAME` = `jolo-dev-Reviewer-lambda`, `REVIEWER_FUNCTION_ARN` = the reviewer alias ARN (stringify the `Fn::GetAtt`/`Ref` to a comparable form).
- Modify the inline-policy test: assert **no** `AWS::IAM::Policy` named `RouterDurableExecutionPolicy*` exists; assert the router role still has the 4 durable actions (`InvokeFunction`, `ListDurableExecutionsByFunction`, `GetDurableExecution`, `SendDurableExecutionCallbackSuccess`) now sourced from the reviewer construct's grants.
- Modify the cdk-nag test: the helper-owned `AwsSolutions-IAM5` suppressions now live on the `CallbackPolicy` (Pawl-owned) and the router default policy; assert they exist and no `RouterDurableExecutionPolicy` resource remains. Keep the Lambda-fixture (IAM4/L1) test-side suppressions.

Run:

```bash
cd "$APP"
PATH="$PWD/node_modules/.bin:$PATH" rtk test bun test tests/constructs/reviewer-stack.test.ts
```

Expected: FAIL because the reviewer construct is absent and the inline policy is still present.

- [ ] **Step 2: Implement the stack changes**

In `stacks/reviewer-stack.ts`:

- Zod: replace `reviewerArn` with `reviewerExecutionTimeoutSeconds` (default `2_592_000`) and `reviewerRetentionDays` (default `14`).
- Construct the reviewer **before** the router:
  ```ts
  const reviewer = new DurableLambdaFunction(this, "Reviewer", {
    entry: path.join(__dirname, "..", "src", "handlers", "durable-reviewer-handler.ts"),
    executionTimeoutSeconds: config.reviewerExecutionTimeoutSeconds,
    retentionDays: config.reviewerRetentionDays,
    aliasName: config.reviewerAlias,
    environment: {
      STATE_TABLE_NAME: stateTable.tableName,
      REPOSITORY_NAME: config.repositoryName,
      BOT_ARN_PATTERNS: config.botArnPatterns,
      REVIEWER_FUNCTION_NAME: `${team}-${stage}-Reviewer-lambda`,
      REVIEWER_FUNCTION_ARN: reviewer.durableFunctionArn, // self-reference, set after construction if needed
    },
  });
  ```
  Note: `REVIEWER_FUNCTION_ARN` on the reviewer's own env is its own `durableFunctionArn`; if CDK requires it post-construction, set env via a token or a second pass. Prefer sourcing the router's env from `reviewer.lambda.functionName`/`reviewer.durableFunctionArn`.
- Router env: `REVIEWER_FUNCTION_NAME: reviewer.lambda.functionName`, `REVIEWER_FUNCTION_ARN: reviewer.durableFunctionArn`.
- Replace the inline `Policy` + `NagSuppressions` block with:
  ```ts
  reviewer.grantInvokeDurable(router);
  reviewer.grantReadDurableExecutions(router);
  reviewer.grantSendDurableExecutionCallbacks(router);
  ```
- Delete the `RouterDurableExecutionPolicy` and its `NagSuppressions`.
- Reviewer role grants: `stateTable.grantReadWrite(reviewer)`, `events.grantRead(reviewer)`, `events.grantConfigRead(reviewer)`.

- [ ] **Step 3: Run GREEN**

```bash
cd "$APP"
PATH="$PWD/node_modules/.bin:$PATH" rtk test bun test tests/constructs/reviewer-stack.test.ts
```

Expected: all construct assertions pass.

- [ ] **Step 4: Run cdk synth and all app gates**

```bash
cd "$APP"
PATH="$PWD/node_modules/.bin:$PATH" rtk run 'cdk synth --quiet'
rtk bun run lint
rtk bun run fmt:check
rtk test bun test
rtk tsc --noEmit
rtk bun install --frozen-lockfile
```

Expected: synth clean (local esbuild); all gates pass; full suite green; typecheck clean; frozen install clean.

- [ ] **Step 5: Review and commit**

```bash
rtk git -C "$APP" add stacks/reviewer-stack.ts tests/constructs/reviewer-stack.test.ts cdk.json
rtk git -C "$APP" commit -m 'feat: wire durable reviewer construct and migrate router IAM to Pawl helpers'
```

---

### Task 5: Verify the milestone against the accepted spec

**Files:**

- Verify: all changed files this milestone

- [ ] **Step 1: Run the final milestone gate**

```bash
cd "$APP"
rtk bun run lint
rtk bun run fmt:check
rtk test bun test
rtk tsc --noEmit
PATH="$PWD/node_modules/.bin:$PATH" rtk run 'cdk synth --quiet'
rtk bun install --frozen-lockfile
rtk git diff --check
```

Expected: all gates pass; full suite green; typecheck clean; synth clean; frozen install clean.

- [ ] **Step 2: Verify acceptance criteria from the spec**

Confirm each criterion in `docs/superpowers/specs/2026-07-19-reviewer-durable-lambda-milestone-design.md` §9 against test names and synth output:

1. Stack instantiates `DurableLambdaFunction` "Reviewer" — construct test.
2. Router durable IAM via Pawl helpers; inline policy gone — construct test.
3. Router env vars sourced from reviewer construct — construct test.
4. Handler exports `handler` (`.length === 2`) + `buildReviewerWorkflow(options?)` — handler test + source.
5. Workflow drives store through `beginCycle → claimEvents → registerCallback → waitForCallback` with store mutations in `context.step` — workflow test + source.
6. Workflow test passes happy + stale-callback paths — workflow test.
7. `FindingReconciler` port + `NoopFindingReconciler`/`NoopCheckRunner`/`NoopReviewModel` exist — source.
8. `cdk synth` clean with 2 functions + alias + version — synth + construct test.
9. `cdk-nag` passes with only Pawl-helper-owned + Lambda-fixture suppressions — construct test.
10. Existing 187 tests remain green — gate count.
11. No Pawl changes, no live AWS calls — `git -C "$PAWL" status` + no AWS env in tests.
12. `reviewer.durableFunctionArn` matches router `REVIEWER_FUNCTION_ARN` — construct test.

- [ ] **Step 3: Reconfirm Pawl boundary**

```bash
PAWL=/Users/jolo/Development/worktrees/pawl
rtk git -C "$PAWL" status --short --branch
rtk git -C "$PAWL" rev-parse HEAD
```

Expected: Pawl at `794e286`, only `.pi-subagents/` untracked.

- [ ] **Step 4: Review commit scope and repository cleanliness**

```bash
rtk git -C "$APP" status --short --branch
rtk git -C "$APP" log --oneline --decorate -6
rtk git -C "$APP" diff 249f360..HEAD --stat
```

Expected: app clean with milestone commits; all changed paths within the file map; Pawl unchanged.

- [ ] **Step 5: Self-review and request final review**

Perform a self-review against spec §4–§9 (two angles: spec/IAM/cdk-nag compliance, tests/behavior parity). Surface any Critical/Important findings. Apply only evidence-backed fixes through one writer, rerun affected gates. Use `@superpowers:verification-before-completion` and cite fresh command evidence before claiming completion.
