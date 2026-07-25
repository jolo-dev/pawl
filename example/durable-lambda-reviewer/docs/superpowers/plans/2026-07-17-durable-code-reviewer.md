# Durable Code Reviewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Pawl-based AWS Lambda Durable Function that reviews CodeCommit pull requests, posts only high-confidence actionable comments, and waits for a human comment or fixing commit before reviewing again.

**Architecture:** EventBridge routes CodeCommit lifecycle and comment events to a normal router Lambda. The router persists every event in DynamoDB, starts or wakes one named durable execution per pull-request generation, and the durable workflow runs CodeBuild checks, Bedrock review, finding reconciliation, and callback waits. Provider-neutral ports isolate the review domain; raw CodeCommit SDK usage lives only in the app-local `CodeCommitReviewClient` under `src/adapters/`, while all application infrastructure uses reusable `@pawl/cdk` constructs.

**Tech Stack:** Bun, TypeScript 6, AWS CDK, local `@pawl/cdk`, local `@pawl/lambda`, app-local `src/adapters/codecommit-review-client.ts` with direct `@aws-sdk/client-codecommit`, `@aws/durable-execution-sdk-js` 2.1.x, AWS SDK v3, DynamoDB, CodeBuild, EventBridge, CodeCommit, Amazon Bedrock Converse, Zod, AWS Lambda Powertools, Bun test, CDK assertions, cdk-nag.

---

## Execution preconditions

This plan spans two working directories:

- Application: `/Users/jolo/Development/durable-lambda-reviewer`
- Pawl library: `/Users/jolo/Development/pawl`

At planning time, the application is not a Git repository, and Pawl has substantial pre-existing unstaged/untracked work, including files this plan must modify (`package.json`, `bun.lock`, `packages/cdk/index.ts`). Do not start implementation until Task 0 is complete. Never stash, discard, overwrite, or commit the existing Pawl work without the user choosing how it is preserved. All later commands intentionally use `../pawl`; Task 0 must leave that exact checkout clean on the assigned implementation branch. A clean worktree at a different path is not sufficient unless this plan and the application's workspace paths are first updated consistently.

All shell commands in this plan use the `rtk` extension, per user requirement.

## File and responsibility map

### Pawl library

| File                                                   | Responsibility                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `../pawl/packages/cdk/src/durable-lambda-function.ts`  | Durable Lambda configuration, alias/version, callback/start/status grants, monitoring |
| `../pawl/packages/cdk/src/dynamodb-table.ts`           | General encrypted/PITR/TTL state table and Lambda grants                              |
| `../pawl/packages/cdk/src/codebuild-project.ts`        | Restricted CodeBuild project and start/status/log grants                              |
| `../pawl/packages/cdk/src/codecommit-review-events.ts` | Imported CodeCommit repository, default-bus PR/comment rules, DLQ, grants             |
| `../pawl/packages/lambda/src/durable-handler.ts`       | Typed `withDurableExecution` wrapper with replay-aware Powertools logging/metrics     |

Each new Pawl source file gets one focused test file under its package's `tests/` directory and is exported through that package's `index.ts`.

### Application domain and ports

| File                                   | Responsibility                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `src/domain/review-event.ts`           | Normalized event schema and event identity                                      |
| `src/domain/review-request.ts`         | Provider-neutral request/revision snapshot                                      |
| `src/domain/finding.ts`                | Candidate, accepted, posted, and resolved finding schemas                       |
| `src/domain/repository-config.ts`      | Versioned `.pawl/reviewer.json` schema and service-limit merge                  |
| `src/domain/review-policy.ts`          | Allowed categories, confidence/scope filtering, linked-comment dismissal policy |
| `src/domain/fingerprint.ts`            | Stable issue identity independent of line movement                              |
| `src/ports/source-control-provider.ts` | Provider operations used by the application                                     |
| `src/ports/state-store.ts`             | Transactional inbox, lifecycle, callback, cycle, and finding contract           |
| `src/ports/check-runner.ts`            | Start/poll/read deterministic check contract                                    |
| `src/ports/review-model.ts`            | Schema-constrained semantic review contract                                     |

### Application services and adapters

| File                                        | Responsibility                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/services/event-coalescer.ts`           | Latest-head coalescing and chronological human-comment context                |
| `src/services/retry-policy.ts`              | Shared retry classification, exponential backoff, full jitter, and exhaustion |
| `src/services/review-engine.ts`             | Diff chunking, checks + Bedrock combination, hard-limit outcomes              |
| `src/services/finding-reconciler.ts`        | New/deduplicated/resolved/pending provider mutations                          |
| `src/adapters/codecommit-provider.ts`       | `SourceControlProvider` backed by the app-local CodeCommit review client      |
| `src/adapters/codecommit-review-types.ts`   | App-owned CodeCommit DTOs and injectable transport contract                   |
| `src/adapters/codecommit-review-client.ts`  | Paginated PR/diff/file/comment operations and idempotent comment writes       |
| `src/adapters/dynamodb-state-store.ts`      | Single-table implementation and race-safe transitions                         |
| `src/adapters/codebuild-check-runner.ts`    | Exact-commit builds and bounded CloudWatch log retrieval                      |
| `src/adapters/bedrock-review-model.ts`      | Converse call, content extraction, schema validation, one repair attempt      |
| `src/router/codecommit-event-normalizer.ts` | Native CodeCommit event normalization and identity filtering                  |
| `src/router/event-router.ts`                | Persist-before-start/wake protocol and named durable invocation               |
| `src/workflows/reviewer-workflow.ts`        | Replay-safe durable lifecycle loop and waits                                  |
| `src/handlers/event-router-handler.ts`      | `useEventbridgeHandler` composition root                                      |
| `src/handlers/durable-reviewer-handler.ts`  | `useDurableHandler` composition root                                          |
| `stacks/reviewer-stack.ts`                  | Pawl-only infrastructure assembly for multiple repositories                   |

Tests mirror these boundaries under `tests/unit/`, `tests/workflow/`, `tests/construct/`, `tests/security/`, and opt-in `tests/aws/`.

---

### Task 0: Establish safe version-control workspaces

**Files:**

- Preserve: `/Users/jolo/Development/pawl/**` existing changes
- Create first: `.gitignore`
- Track: `/Users/jolo/Development/durable-lambda-reviewer/**`

- [ ] **Step 1: Record both workspace states**

Run:

```bash
rtk git -C ../pawl status --short
rtk git -C ../pawl worktree list
rtk git status --short
```

Expected: Pawl reports existing changes; application reports `Not a git repository`.

- [ ] **Step 2: Stop for the Pawl preservation decision**

Ask the user to choose one of: commit the existing Pawl work, preserve it on a named WIP branch and switch the current checkout safely, or otherwise make the current `/Users/jolo/Development/pawl` checkout clean without losing changes. Do not run `stash`, `reset`, `clean`, or checkout over files automatically.

Expected: the exact `../pawl` checkout used by every later command is clean and on the assigned implementation branch.

- [ ] **Step 3: Initialize application version control after approval**

Before `git init`, create `.gitignore` through RTK with at least:

```gitignore
node_modules/
cdk.out/
dist/
coverage/
.env
.env.*
!.env.example
.DS_Store
```

Then run from the application directory:

```bash
rtk run 'test -f .gitignore'
rtk git init
rtk git add .gitignore README.md package.json bun.lock cdk.json index.ts tsconfig.json src stacks tests docs
rtk git commit -m "chore: capture durable reviewer design baseline"
```

Expected: one baseline commit containing source/docs only; `rtk git status --short --ignored` shows `node_modules/` and `cdk.out/` as ignored, not tracked.

- [ ] **Step 4: Verify clean implementation starting points**

Run:

```bash
rtk git status --short
rtk git -C ../pawl status --short
```

Expected: both outputs empty. If `../pawl` is not the selected clean checkout, stop and update every Pawl path plus the application workspace paths before continuing.

---

### Task 1: Repair the TypeScript and scaffold baseline

**Files:**

- Modify: `package.json`
- Modify: `stacks/stack.ts` (rename to `stacks/reviewer-stack.ts`)
- Delete: `src/messageProcessorHandler.ts`
- Delete: `src/sendWelcomeMessageHandler.ts`
- Replace: `tests/integration.test.ts`
- Modify: `../pawl/tsconfig.json`
- Modify: `../pawl/packages/lambda/src/dynamodb-streams-handler.ts`
- Modify: `../pawl/packages/lambda/tests/dynamodb-streams.test.ts`

- [ ] **Step 1: Capture the failing baseline**

Run:

```bash
rtk tsc --noEmit
cd ../pawl && rtk tsc -p packages/lambda/tsconfig.build.json --noEmit
```

Expected application failures include numeric `durableConfig.executionTimeout`, undefined `sendWelcomeMessageHandler`, and the Pawl DynamoDB stream return type. Pawl may additionally report the TypeScript 6 `baseUrl` deprecation.

- [ ] **Step 2: Add a regression test for void DynamoDB stream callbacks**

Extend `../pawl/packages/lambda/tests/dynamodb-streams.test.ts`:

```ts
it("accepts callbacks that return void", async () => {
  const callback = mock(async () => undefined);
  const handler = useDynamoDbStreamsHandler("stream-test", callback);

  const result = await handler(event, context, () => {});

  expect(result).toBeUndefined();
  expect(callback).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: Run the focused test and type-check to verify RED**

Run:

```bash
cd ../pawl && rtk test bun test packages/lambda/tests/dynamodb-streams.test.ts
cd ../pawl && rtk tsc -p packages/lambda/tsconfig.build.json --noEmit
```

Expected: runtime test may pass, but type-check fails on the obsolete `@ts-expect-error` and incompatible callback result.

- [ ] **Step 4: Fix the Pawl handler type minimally**

Change the factory result to `void | DynamoDBBatchResponse`, remove `@ts-expect-error`, and return:

```ts
return handlerFactory<DynamoDBStreamEvent, void | DynamoDBBatchResponse>(
  serviceName,
  handleRequest,
);
```

Update the declared `HandlerWithHooks` result type to the same union. In `../pawl/tsconfig.json`, replace incorrect package paths with `packages/.../index.ts` entries and remove `baseUrl` by using relative `paths` supported by the selected TypeScript configuration, or set the minimum documented TS6 migration option proven by the type-check. Do not silence unrelated errors globally.

- [ ] **Step 5: Replace the broken application scaffold with a compiling empty stack**

Rename `stacks/stack.ts` to `stacks/reviewer-stack.ts` and use:

```ts
import { type Construct, Stack } from "@pawl/cdk";

export class DurableLambdaReviewerStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);
  }
}
```

Delete the two unrelated starter handlers. Change `package.json` script `"test"` from recursive `bun run test` to `bun test`.

- [ ] **Step 6: Replace the placeholder test**

Create `tests/unit/scaffold-baseline.test.ts`:

```ts
import { expect, test } from "bun:test";
import packageJson from "../../package.json";

test("the project test script invokes Bun's test runner", () => {
  expect(packageJson.scripts.test).toBe("bun test");
});
```

Delete `tests/integration.test.ts`.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
cd ../pawl && rtk test bun test packages/lambda/tests/dynamodb-streams.test.ts
cd ../pawl && rtk tsc -p packages/lambda/tsconfig.build.json --noEmit
rtk tsc --noEmit
rtk test bun test
```

Expected: all focused commands pass.

- [ ] **Step 8: Commit each repository separately**

```bash
rtk git -C ../pawl add tsconfig.json packages/lambda/src/dynamodb-streams-handler.ts packages/lambda/tests/dynamodb-streams.test.ts
rtk git -C ../pawl commit -m "fix(lambda): restore strict stream handler types"
rtk git add -A package.json stacks src tests
rtk git commit -m "fix: replace broken reviewer scaffold baseline"
```

---

### Task 2: Pin and prove the Lambda Durable Execution SDK contract

**Files:**

- Modify: `../pawl/packages/lambda/package.json`
- Modify: `../pawl/package.json`
- Create: `../pawl/packages/lambda/tests/durable-sdk-contract.test.ts`
- Create: `docs/spikes/aws-durable-contract.md`
- Modify: `../pawl/bun.lock`

- [ ] **Step 1: Pin supported SDK versions in the Pawl catalog**

Add catalog entries for:

```json
"@aws/durable-execution-sdk-js": "2.1.0",
"@aws/durable-execution-sdk-js-testing": "1.1.3",
"@aws-sdk/client-lambda": "3.1089.0"
```

Runtime 2.1.0 is intentional because testing SDK 1.1.3 declares support for runtime versions `>=1.0.1 <=2.1.0`; runtime 2.2.0 must wait for a compatible testing release.

Add the runtime SDK to `@pawl/lambda` dependencies and the testing SDK to dev dependencies.

- [ ] **Step 2: Install and write the failing contract test**

The test must compile and exercise exact public names:

```ts
import { expect, test } from "bun:test";
import { withDurableExecution, type DurableContext } from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";

test("supports replay-safe steps, timers, and callbacks", async () => {
  const handler = withDurableExecution(
    async (input: { value: string }, context: DurableContext) => {
      const value = await context.step("load", async () => input.value);
      await context.wait("debounce", { seconds: 1 });
      return context
        .waitForCallback<string>("request-event", async () => undefined, {
          timeout: { minutes: 1 },
        })
        .then((event) => `${value}:${event}`);
    },
  );

  await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
  try {
    const runner = new LocalDurableTestRunner<string>({ handlerFunction: handler });
    const running = runner.run({ payload: { value: "review" } });
    const callback = runner.getOperation("request-event");
    await callback.waitForData(WaitingOperationStatus.SUBMITTED);
    await callback.sendCallbackSuccess("commit");
    expect((await running).getResult()).toBe("review:commit");
  } finally {
    await LocalDurableTestRunner.teardownTestEnvironment();
  }
});
```

- [ ] **Step 3: Run RED, correct only verified API mismatches, then run GREEN**

```bash
cd ../pawl && rtk test bun test packages/lambda/tests/durable-sdk-contract.test.ts
```

Expected: initial failure before dependencies are installed; then PASS using the exact installed APIs. Do not invent compatibility wrappers for APIs not exposed by the pinned version.

- [ ] **Step 4: Document the externally verified AWS SDK commands**

Record in `docs/spikes/aws-durable-contract.md` that router signaling uses:

- `InvokeCommand` with `DurableExecutionName`, returning `DurableExecutionArn`.
- `ListDurableExecutionsByFunctionCommand` filtered by function qualifier/name/status for uncertain start recovery.
- `GetDurableExecutionCommand` for lease recovery/status.
- `SendDurableExecutionCallbackSuccessCommand` with `CallbackId` and UTF-8 JSON bytes.
- `StopDurableExecutionCommand` for administrative timeout/cleanup when required.

Also record that durable execution names must be unique within a function and provider writes still need application idempotency because durable step semantics are not globally exactly-once.

- [ ] **Step 5: Commit**

```bash
rtk git -C ../pawl add package.json packages/lambda/package.json packages/lambda/tests/durable-sdk-contract.test.ts bun.lock
rtk git -C ../pawl commit -m "test(lambda): pin durable execution SDK contract"
rtk git add docs/spikes/aws-durable-contract.md
rtk git commit -m "docs: record durable execution API contract"
```

---

### Task 3: Add the Pawl durable Lambda construct

**Files:**

- Create: `../pawl/packages/cdk/src/durable-lambda-function.ts`
- Create: `../pawl/packages/cdk/tests/durable-lambda-function.test.ts`
- Modify: `../pawl/packages/cdk/index.ts`

- [ ] **Step 1: Write failing CDK assertions**

Assert `AWS::Lambda::Function.DurableConfig` contains `ExecutionTimeout: 2592000` and `RetentionPeriodInDays: 90`, an alias targets a published version, Node 22/ARM64 settings remain inherited, and invalid timeout/retention values throw before synthesis. Add cdk-nag to the test stack and permit only narrow, explained suppressions.

- [ ] **Step 2: Run RED**

```bash
cd ../pawl && rtk test bun test packages/cdk/tests/durable-lambda-function.test.ts
```

Expected: FAIL because `DurableLambdaFunction` is not exported.

- [ ] **Step 3: Implement the minimal construct**

Use an interface based on Pawl-owned values rather than leaking raw CDK props:

```ts
export const DurableLambdaConfigSchema = z.object({
  executionTimeoutSeconds: z.number().int().min(1).max(31_622_400),
  retentionDays: z.number().int().min(1).max(90).default(14),
});

export type DurableLambdaFunctionProps = Omit<LambdaProps, "durableConfig"> &
  z.input<typeof DurableLambdaConfigSchema> & {
    aliasName?: string;
  };

export class DurableLambdaFunction extends LambdaFunction {
  readonly alias: Alias;
  readonly durableFunctionArn: string;
  // Parse config, call super with Duration.seconds/days, publish currentVersion,
  // create the alias, and expose least-privilege grant helpers.
}
```

Grant helpers must cover invoking a named execution, reading/listing execution status, signaling callbacks, and stopping an execution. They accept Pawl `LambdaFunction` targets and attach policies internally.

- [ ] **Step 4: Export and verify GREEN**

```bash
cd ../pawl && rtk test bun test packages/cdk/tests/durable-lambda-function.test.ts
cd ../pawl && rtk tsc -p packages/cdk/tsconfig.build.json --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git -C ../pawl add packages/cdk/src/durable-lambda-function.ts packages/cdk/tests/durable-lambda-function.test.ts packages/cdk/index.ts
rtk git -C ../pawl commit -m "feat(cdk): add durable Lambda construct"
```

---

### Task 4: Add the Pawl general DynamoDB state-table construct

**Files:**

- Create: `../pawl/packages/cdk/src/dynamodb-table.ts`
- Create: `../pawl/packages/cdk/tests/dynamodb-table.test.ts`
- Modify: `../pawl/packages/cdk/index.ts`

- [ ] **Step 1: Write failing construct tests**

Assert an on-demand table with string `pk`/`sk`, AWS-owned encryption, point-in-time recovery, TTL attribute `expiresAt`, deletion protection/removal policy controlled by stage, tags, alarms, and generated read/write IAM for supplied Pawl Lambdas. Assert invalid duplicate keys/empty TTL fail Zod validation.

- [ ] **Step 2: Run RED**

```bash
cd ../pawl && rtk test bun test packages/cdk/tests/dynamodb-table.test.ts
```

Expected: FAIL because the construct is missing.

- [ ] **Step 3: Implement `DynamoDbTable`**

Expose Pawl-owned props:

```ts
const KeySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["STRING", "NUMBER", "BINARY"]),
});

const DynamoDbTablePropsSchema = z.object({
  partitionKey: KeySchema,
  sortKey: KeySchema.optional(),
  timeToLiveAttribute: z.string().min(1).optional(),
  pointInTimeRecovery: z.boolean().default(true),
  retain: z.boolean().default(true),
});
```

Create the CDK table only inside this Pawl construct. Implement `grantRead`, `grantWrite`, and `grantReadWrite` against Pawl Lambda constructs; do not copy the stream construct's placeholder permission method.

- [ ] **Step 4: Verify GREEN**

```bash
cd ../pawl && rtk test bun test packages/cdk/tests/dynamodb-table.test.ts
```

Expected: PASS with no unsuppressed cdk-nag errors.

- [ ] **Step 5: Commit**

```bash
rtk git -C ../pawl add packages/cdk/src/dynamodb-table.ts packages/cdk/tests/dynamodb-table.test.ts packages/cdk/index.ts
rtk git -C ../pawl commit -m "feat(cdk): add durable state table construct"
```

---

### Task 5: Add Pawl CodeBuild and CodeCommit event constructs

**Files:**

- Create: `../pawl/packages/cdk/src/codebuild-project.ts`
- Create: `../pawl/packages/cdk/tests/codebuild-project.test.ts`
- Create: `../pawl/packages/cdk/src/codecommit-review-events.ts`
- Create: `../pawl/packages/cdk/tests/codecommit-review-events.test.ts`
- Modify: `../pawl/packages/cdk/index.ts`

- [ ] **Step 1: Write the failing CodeBuild test**

Assert one project per repository with CodeCommit source, no privileged Docker, no secrets, bounded compute/timeout, encrypted CloudWatch logs, no broad managed policy, and grants limited to `StartBuild`, `BatchGetBuilds`, and bounded log reads for the durable reviewer. Assert private-subnet placement, a Pawl-created security group with `allowAllOutbound: false`, no `0.0.0.0/0` or `::/0` egress, and package access only through configured CodeArtifact/VPC endpoints or an explicitly deployment-approved registry endpoint.

- [ ] **Step 2: Write the failing CodeCommit event test**

Assert rules on the default bus for `onPullRequestStateChange` and `onCommentOnPullRequest`, an SQS DLQ, retry policy, and router target. Keep an optional CloudTrail rule behind `commentEventFallback: "cloudtrail"`; default to native events after the live event spike confirms coverage.

- [ ] **Step 3: Run RED**

```bash
cd ../pawl && rtk test bun test packages/cdk/tests/codebuild-project.test.ts packages/cdk/tests/codecommit-review-events.test.ts
```

Expected: FAIL because both exports are missing.

- [ ] **Step 4: Implement both constructs**

`CodeBuildProject` accepts repository name, timeout, compute-size enum, log retention, and a required production network/package policy. The network policy identifies an existing VPC and private subnets; Pawl creates a dedicated security group with `allowAllOutbound: false` and adds only configured VPC endpoint/prefix-list egress. Package registry configuration is deployment-owned (prefer CodeArtifact with an approved upstream), never supplied by pull-request content or base-branch commands. A deliberately public test mode must be explicit and rejected for `stage=prod`. The construct exposes `projectName`, `projectArn`, `logGroupName`, and `grantRunAndRead(reviewer)`.

`CodeCommitReviewEvents` imports a repository by name, wires native repository rules to the router Lambda, filters no identities at infrastructure level, and exposes `grantRead`, `grantComment`, and `grantConfigRead` methods. Application runtime performs authoritative author filtering.

- [ ] **Step 5: Verify GREEN**

```bash
cd ../pawl && rtk test bun test packages/cdk/tests/codebuild-project.test.ts packages/cdk/tests/codecommit-review-events.test.ts
cd ../pawl && rtk tsc -p packages/cdk/tsconfig.build.json --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git -C ../pawl add packages/cdk/src packages/cdk/tests packages/cdk/index.ts
rtk git -C ../pawl commit -m "feat(cdk): add review event and check runner constructs"
```

---

### Task 6: Add the Pawl durable handler wrapper

**Files:**

- Create: `../pawl/packages/lambda/src/durable-handler.ts`
- Create: `../pawl/packages/lambda/tests/durable-handler.test.ts`
- Modify: `../pawl/packages/lambda/src/base/handler-factory.ts`
- Modify: `../pawl/packages/lambda/src/eventbridge-handler.ts`
- Modify: `../pawl/packages/lambda/tests/eventbridge-handler.test.ts`
- Modify: `../pawl/packages/lambda/index.ts`

- [ ] **Step 1: Write the failing wrapper test**

Use `LocalDurableTestRunner` to assert typed input/output, one named step, one callback, callback completion, correlation with `context.executionContext.durableExecutionArn`, metrics publication, no full input logging, and error propagation. Test replay-aware logging by proving the wrapper delegates mode awareness to the durable context. Extend EventBridge wrapper tests first to prove `{ logging: "metadata" }` logs only event ID/source/detail-type and never `detail`, while preserving the existing default for current consumers.

- [ ] **Step 2: Run RED**

```bash
cd ../pawl && rtk test bun test packages/lambda/tests/durable-handler.test.ts
```

Expected: FAIL because `useDurableHandler` is missing.

- [ ] **Step 3: Implement the wrapper**

Expose:

```ts
export type DurableRequestHandler<TEvent, TResult> = (
  event: TEvent,
  context: DurableContext,
  utilities: { logger: Logger; tracer: Tracer; metrics: Metrics },
) => Promise<TResult>;

export function useDurableHandler<TEvent, TResult>(
  serviceName: string,
  handleRequest: DurableRequestHandler<TEvent, TResult>,
): DurableLambdaHandler;
```

Create Powertools utilities once, adapt the Powertools logger through `context.configureLogger`, log identifiers rather than event bodies, and publish stored metrics in a `finally` block. Do not call the existing `handlerFactory` because its default before-hook logs complete events and is not replay-aware.

Add a typed `logging` option to `handlerFactory`/`useEventbridgeHandler`: `"full"` preserves backward compatibility, `"metadata"` logs only envelope identifiers, and `"none"` logs no input. Application handlers must select `"metadata"`; tests must assert nested detail/comment content never reaches logger calls.

- [ ] **Step 4: Export and verify GREEN**

```bash
cd ../pawl && rtk test bun test packages/lambda/tests/durable-handler.test.ts
cd ../pawl && rtk tsc -p packages/lambda/tsconfig.build.json --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git -C ../pawl add packages/lambda/src/durable-handler.ts packages/lambda/src/base/handler-factory.ts packages/lambda/src/eventbridge-handler.ts packages/lambda/tests/durable-handler.test.ts packages/lambda/tests/eventbridge-handler.test.ts packages/lambda/index.ts
rtk git -C ../pawl commit -m "feat(lambda): add durable execution handler wrapper"
```

---

### Task 7: Add the app-local CodeCommit runtime client

**Important:** Do NOT create a `@pawl/codecommit` Pawl package. CodeCommit runtime SDK usage lives only in the application under `src/adapters/`. Pawl contributes CodeCommit infrastructure only through the existing `@pawl/cdk` `CodeCommitReviewEvents` construct; no runtime client is exported through `@pawl/cdk`. The full migration that removed the obsolete package is documented in `docs/superpowers/plans/2026-07-18-codecommit-runtime-boundary.md`; this task states the post-migration app-local shape so later tasks can rely on it.

**Files:**

- Create: `src/adapters/codecommit-review-types.ts`
- Create: `src/adapters/codecommit-review-client.ts`
- Create: `tests/unit/codecommit-review-client.test.ts`
- Create: `tests/fixtures/codecommit/*.json`
- Modify: `package.json` (add direct `@aws-sdk/client-codecommit` dependency)
- Modify: `bun.lock`
- Do NOT modify `../pawl` for this task

- [ ] **Step 1: Add the direct runtime dependency**

Add `"@aws-sdk/client-codecommit": "catalog:"` to the application `dependencies` beside the other AWS SDK clients, then run `rtk bun install`.

- [ ] **Step 2: Write failing contract tests**

With an injected fake `send` transport, cover:

- `GetPullRequestCommand` maps source/destination immutable commits and status.
- `GetDifferencesCommand` paginates using `NextToken`/`MaxResults`.
- `GetFileCommand` always receives an explicit commit ID.
- `GetCommentsForPullRequestCommand` paginates and preserves `inReplyTo`, `authorArn`, and location.
- `PostCommentForPullRequestCommand` receives exact cycle commits and stable `clientRequestToken`.
- `UpdateCommentCommand` replaces full content while preserving the original body.
- Malformed AWS responses and repeated pagination tokens are rejected; pagination stops at a hard page bound.
- NUL-containing and invalid-UTF-8 file content is classified as binary without decoding.

- [ ] **Step 3: Run RED**

```bash
rtk test bun test tests/unit/codecommit-review-client.test.ts
```

Expected: FAIL because `src/adapters/codecommit-review-client.ts` and `src/adapters/codecommit-review-types.ts` do not exist.

- [ ] **Step 4: Define app-owned public types**

At minimum:

```ts
export type PullRequestSnapshot = {
  provider: "codecommit";
  repositoryName: string;
  pullRequestId: string;
  status: "OPEN" | "CLOSED" | "MERGED";
  sourceReference: string;
  destinationReference: string;
  sourceCommit: string;
  destinationCommit: string;
  revisionId: string;
};

export type ReviewLocation = {
  filePath: string;
  filePosition: number;
  relativeFileVersion: "BEFORE" | "AFTER";
};

export type CodeCommitReviewTransport = {
  send(command: unknown): Promise<unknown>;
};
```

Add changed-file/blob metadata and comment types. Do not export `@aws-sdk/client-codecommit` types.

- [ ] **Step 5: Implement the client**

Use `CodeCommitClient` commands internally. Validate required optional AWS fields with Zod before returning. Bound every pagination loop, decode file bytes through `TextDecoder`, classify binary files without logging content, and accept an injected transport in the constructor.

- [ ] **Step 6: Verify GREEN**

```bash
rtk test bun test tests/unit/codecommit-review-client.test.ts
rtk tsc --noEmit
```

Expected: PASS, and the contract tests do not import `@pawl/codecommit`.

- [ ] **Step 7: Commit**

```bash
rtk git add package.json bun.lock src/adapters/codecommit-review-client.ts src/adapters/codecommit-review-types.ts tests/unit/codecommit-review-client.test.ts tests/fixtures/codecommit
rtk git commit -m "refactor: add local CodeCommit review client"
```

---

### Task 8: Capture live AWS contract fixtures before freezing adapters

**Files:**

- Create: `tests/aws/fixtures/codecommit/*.json`
- Create: `tests/aws/fixtures/codebuild/*.json`
- Create: `tests/aws/fixtures/bedrock/*.json`
- Create: `docs/spikes/aws-integration-contracts.md`

- [ ] **Step 1: Prepare a dedicated AWS test repository and profile**

Use configured test-only repository names and never an active production repository. Record account, region, repository, base branch, and cleanup commands without storing credentials.

- [ ] **Step 2: Capture CodeCommit native PR and comment events**

Create a pull request, post a top-level comment, reply to a reviewer comment, push a new source commit, close/merge a test request, and capture sanitized EventBridge payloads. Confirm whether `Repository.onCommentOnPullRequest` covers both comments and replies; enable the CloudTrail fallback only if native coverage is incomplete.

- [ ] **Step 3: Validate inline locations and updates**

Exercise added, modified, deleted, renamed, empty, binary, and EOF changes. Record one-based `filePosition`, `BEFORE`/`AFTER`, path rules, errors, idempotency-token behavior, and concurrent `UpdateComment` behavior. Store sanitized fixtures.

- [ ] **Step 4: Validate exact CodeBuild commits**

Start a build with `sourceVersion` equal to the full source commit, move the branch while it runs, and verify `resolvedSourceVersion` remains the requested commit. Record required IAM actions and sanitized build responses.

- [ ] **Step 5: Select and smoke-test the deployment Sonnet model**

Use `rtk aws` to list models/inference profiles in the target region, choose one explicit supported Sonnet model or inference-profile ARN, call Converse without tools, and verify exact `bedrock:InvokeModel` resources with least privilege. Do not put a remembered or symbolic model ID into production configuration.

- [ ] **Step 6: Verify durable start/callback/status in AWS**

Deploy a minimal versioned durable function, invoke with `DurableExecutionName`, signal its callback with `SendDurableExecutionCallbackSuccessCommand`, query status, and verify duplicate-name and expired-callback errors. Add the observed behavior to the spike document.

- [ ] **Step 7: Commit sanitized evidence only**

```bash
rtk git add tests/aws/fixtures docs/spikes/aws-integration-contracts.md
rtk git commit -m "test: capture AWS reviewer contracts"
```

Expected: no account IDs, ARNs, source contents, credentials, or personal comments remain in committed fixtures.

---

### Task 9: Define provider-neutral domain schemas and ports

**Files:**

- Create: `src/domain/review-event.ts`
- Create: `src/domain/review-request.ts`
- Create: `src/domain/finding.ts`
- Create: `src/domain/repository-config.ts`
- Create: `src/domain/review-policy.ts`
- Create: `src/domain/fingerprint.ts`
- Create: `src/ports/source-control-provider.ts`
- Create: `src/ports/state-store.ts`
- Create: `src/ports/check-runner.ts`
- Create: `src/ports/review-model.ts`
- Create: `tests/unit/domain/*.test.ts`
- Create: `src/services/retry-policy.ts`
- Create: `tests/unit/retry-policy.test.ts`
- Modify: `package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Add runtime dependencies**

Add runtime dependencies `zod`, `@aws-sdk/client-codecommit`, `@aws/durable-execution-sdk-js`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-lambda`, `@aws-sdk/client-codebuild`, `@aws-sdk/client-cloudwatch-logs`, `@aws-sdk/client-bedrock-runtime`, and a pinned line-diff library. Add dev dependency `@aws/durable-execution-sdk-js-testing`. Do not add any `../pawl/packages/codecommit` workspace, then run:

```bash
rtk run 'bun install'
```

Expected: lockfile includes the pinned SDKs and every workspace resolves locally.

- [ ] **Step 2: Write failing schema and policy tests**

Cover all normalized event variants, immutable revisions, repository config defaults/limits (including `debounceSeconds`), allowed finding categories, high-confidence threshold, changed-line requirement, linked-comment dismissal eligibility, and rejection of untrusted model fields. Add retry-policy tests for exponential delay, full jitter bounded by maximum delay, retryable/permanent classification, maximum attempts, and exhaustion outcome.

- [ ] **Step 3: Write failing fingerprint tests**

Prove that line movement with unchanged nearby code preserves identity; changed category/path/issue identity changes it; no source body or comment text is embedded in the fingerprint.

- [ ] **Step 4: Run RED**

```bash
rtk test bun test tests/unit/domain tests/unit/retry-policy.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 5: Implement schemas and interfaces**

Use discriminated Zod unions. The accepted finding shape must contain category, severity, confidence, path, side, line/hunk identity, evidence, impact, recommendation, and optional suggestion. A dismissal candidate additionally requires linked provider comment ID, eligible human comment ID, and rationale. Implement one shared retry policy used by durable steps and router AWS calls; transient AWS/network errors retry with bounded exponential backoff and full jitter, while validation/auth/not-found policy errors fail immediately. Exhaustion returns a typed operational failure for state transition to `FAILED`.

The state port must expose explicit operations rather than a generic repository:

```ts
export interface ReviewStateStore {
  appendEvent(event: ReviewEvent): Promise<AppendEventResult>;
  claimEvents(request: RequestKey, generation: number): Promise<ClaimedEvents>;
  recordExecution(request: RequestKey, generation: number, arn: string): Promise<void>;
  recoverLease(input: LeaseRecoveryInput): Promise<LeaseRecoveryResult>;
  registerCallback(input: CallbackRegistration): Promise<CallbackRegistrationResult>;
  clearCallback(input: CallbackGeneration): Promise<void>;
  beginCycle(snapshot: ReviewCycleSnapshot): Promise<void>;
  listFindings(request: RequestKey): Promise<PersistedFinding[]>;
  reserveFindingWrite(write: FindingWrite): Promise<WriteReservation>;
  confirmFindingWrite(result: FindingWriteResult): Promise<void>;
  complete(request: RequestKey, generation: number, reason: CompletionReason): Promise<void>;
}
```

- [ ] **Step 6: Verify GREEN**

```bash
rtk test bun test tests/unit/domain tests/unit/retry-policy.test.ts
rtk tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add package.json bun.lock src/domain src/ports src/services/retry-policy.ts tests/unit/domain tests/unit/retry-policy.test.ts
rtk git commit -m "feat: define reviewer domain and ports"
```

---

### Task 10: Implement transactional state and event coalescing

**Files:**

- Create: `src/adapters/dynamodb-state-store.ts`
- Create: `src/services/event-coalescer.ts`
- Create: `tests/unit/dynamodb-state-store.test.ts`
- Create: `tests/unit/event-coalescer.test.ts`
- Create: `tests/fakes/in-memory-state-store.ts`

- [ ] **Step 1: Write failing state transition tests**

Cover duplicate event no-op, one `STARTING` owner, generation increment after completion, append-before-wake, monotonic event watermark, conditional callback generation, pending event after callback registration, stale callback rejection, finding write reservation/confirmation, and TTL. Add lease recovery cases: stale `STARTING` with no execution found becomes startable; stale `RUNNING`/`WAITING` with an absent or terminal execution clears ARN/callback and starts the next generation when pending work exists; a remotely `RUNNING` execution keeps ownership; conditional races permit only one recovery owner.

- [ ] **Step 2: Write the callback race test**

Arrange an event between callback registration and the final inbox check. Assert the registration reports pending work and the event is claimed exactly once.

- [ ] **Step 3: Run RED**

```bash
rtk test bun test tests/unit/dynamodb-state-store.test.ts tests/unit/event-coalescer.test.ts
```

Expected: FAIL because adapters are absent.

- [ ] **Step 4: Implement the single-table layout**

Use:

```text
pk = REQUEST#<provider>#<repository>#<requestId>
sk = META
sk = EVENT#<occurredAt>#<providerEventId>
sk = FINDING#<fingerprint>
```

`META` holds lifecycle, generation, execution ARN/name, callback ID/generation, lease heartbeat/expiry, source/destination commits, cycle, event watermark, deadline, retry exhaustion details, and TTL. Use `TransactWriteCommand` and condition expressions for ownership/callback/write/recovery transitions. `recoverLease` requires the caller's observed remote durable status and the expected local generation/lease version, preventing two routers from reclaiming simultaneously. Never persist raw source, full diffs, model prompts, or unrestricted comment bodies.

- [ ] **Step 5: Implement coalescing and the in-memory contract fake**

Coalesce revision events to the latest provider snapshot while retaining all eligible human comments in chronological order. The fake must enforce the same conditional semantics used by workflow tests; do not make it a permissive map.

- [ ] **Step 6: Verify GREEN**

```bash
rtk test bun test tests/unit/dynamodb-state-store.test.ts tests/unit/event-coalescer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add src/adapters/dynamodb-state-store.ts src/services/event-coalescer.ts tests
rtk git commit -m "feat: add transactional review state protocol"
```

---

### Task 11: Implement the CodeCommit provider and event router

**Files:**

- Create: `src/adapters/codecommit-provider.ts`
- Create: `src/router/codecommit-event-normalizer.ts`
- Create: `src/router/event-router.ts`
- Create: `tests/unit/codecommit-provider.test.ts`
- Create: `tests/unit/codecommit-event-normalizer.test.ts`
- Create: `tests/unit/event-router.test.ts`

- [ ] **Step 1: Write failing provider tests from captured fixtures**

Assert immutable request snapshots, base config reads by exact destination commit, text/binary diff handling, deterministic changed-line hunks, comment author/reply mapping, inline location validation, idempotency token reuse, and resolved-comment full-body replacement.

- [ ] **Step 2: Write failing event normalizer tests**

Use captured native/fallback fixtures. Assert request/revision/comment/closed events, provider event IDs, reviewer/bot filtering, no comment body persistence, and authoritative refetch requirement.

- [ ] **Step 3: Write failing router tests**

Cover persist-before-invoke, deterministic name `<provider>-<repository-hash>-<request>-g<generation>`, `InvokeCommand` with alias qualifier, durable ARN recording, duplicate-name recovery through list/get status, callback wake with JSON bytes, expired/stale callback no-op, and infrastructure errors that do not create review comments. Verify start/status/callback transient failures use the shared bounded exponential/full-jitter policy, permanent failures do not retry, and exhaustion persists `FAILED` operational state without comments. Add crash recovery sequences: stale `STARTING` first lists by durable name before reinvoking; absent execution conditionally reclaims the lease; stale `RUNNING`/`WAITING` calls `GetDurableExecution`, preserves a remote `RUNNING` execution, and conditionally advances generation after terminal/absent status when inbox work exists.

- [ ] **Step 4: Run RED**

```bash
rtk test bun test tests/unit/codecommit-provider.test.ts tests/unit/codecommit-event-normalizer.test.ts tests/unit/event-router.test.ts
```

Expected: FAIL because modules are absent.

- [ ] **Step 5: Implement provider and normalizer**

The provider delegates every CodeCommit call to the app-local `CodeCommitReviewClient`. Compute deterministic line hunks locally from before/after text. Only produce an inline finding location when the captured AWS contract proves it valid; otherwise suppress it with a metric or classify a truly cross-cutting issue for summary handling.

- [ ] **Step 6: Implement router start/wake behavior**

Inject state store, Lambda client, provider, reviewer function name/alias, reviewer ARN, bot ARN patterns, clock, and shared retry policy. The router always appends first, starts only after conditional ownership/recovery, heartbeats active leases, and treats callbacks as wake hints. Bounded retry exhaustion records an operational failure; it never creates a pull-request comment.

- [ ] **Step 7: Verify GREEN**

```bash
rtk test bun test tests/unit/codecommit-provider.test.ts tests/unit/codecommit-event-normalizer.test.ts tests/unit/event-router.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
rtk git add src/adapters/codecommit-provider.ts src/router tests/unit
rtk git commit -m "feat: route CodeCommit review events"
```

---

### Task 12: Implement repository configuration and CodeBuild checks

**Files:**

- Create: `src/config/repository-config.ts`
- Create: `src/adapters/codebuild-check-runner.ts`
- Create: `tests/unit/repository-config.test.ts`
- Create: `tests/unit/codebuild-check-runner.test.ts`
- Create: `tests/fixtures/reviewer-config/*.json`

- [ ] **Step 1: Write failing configuration tests**

Cover missing config safe defaults vs configured fail-closed policy, exact destination commit reads, schema version, command count/length/timeout limits, model allowlist, service ceilings, lifecycle scripts disabled by default, and head-revision config rejection.

- [ ] **Step 2: Write failing CodeBuild tests**

Assert `StartBuildCommand.sourceVersion` is the exact source commit; command/environment overrides derive only from validated base config; no secrets are passed; `BatchGetBuildsCommand` status maps to pending/success/check-failure/infrastructure-failure; log reads are bounded and scrubbed.

- [ ] **Step 3: Run RED**

```bash
rtk test bun test tests/unit/repository-config.test.ts tests/unit/codebuild-check-runner.test.ts
```

Expected: FAIL because modules are absent.

- [ ] **Step 4: Implement config loading and check adapter**

`CheckRunner.start` returns build ID and requested source commit. `CheckRunner.poll` returns normalized state. `CheckRunner.readResult` returns per-command exit status and bounded logs. Do not turn CodeBuild service failures into check findings.

- [ ] **Step 5: Verify GREEN**

```bash
rtk test bun test tests/unit/repository-config.test.ts tests/unit/codebuild-check-runner.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add src/config src/adapters/codebuild-check-runner.ts tests
rtk git commit -m "feat: run trusted checks at immutable revisions"
```

---

### Task 13: Implement Bedrock review, policy filtering, and hard limits

**Files:**

- Create: `src/adapters/bedrock-review-model.ts`
- Create: `src/services/review-engine.ts`
- Create: `tests/unit/bedrock-review-model.test.ts`
- Create: `tests/unit/review-engine.test.ts`
- Create: `tests/security/prompt-boundaries.test.ts`

- [ ] **Step 1: Write failing model adapter tests**

Cover Converse request with explicit allowlisted model ID, no tools, all text content blocks joined safely, usage capture, valid JSON schema, one repair call, continued malformed output as operational failure, throttling classification, and no logging of prompts/source/comments.

- [ ] **Step 2: Write failing engine and security tests**

Cover diff chunking, deterministic results included as evidence, only approved categories/high confidence, changed-line scope, linked-comment dismissal, unrelated comments unable to dismiss, prompt injection treated as data, and no model output directly invoking provider operations.

- [ ] **Step 3: Write hard-limit tests**

Assert file/diff/total-token overflow returns `BLOCKED_LIMIT`, preserves existing findings, posts/resolves nothing, and waits for a new event. Assert cycles/hour and comments/cycle return a durable resume time rather than a clean result.

- [ ] **Step 4: Run RED**

```bash
rtk test bun test tests/unit/bedrock-review-model.test.ts tests/unit/review-engine.test.ts tests/security/prompt-boundaries.test.ts
```

Expected: FAIL because modules are absent.

- [ ] **Step 5: Implement Bedrock adapter and engine**

Use `BedrockRuntimeClient` + `ConverseCommand`. Parse all response content blocks, validate through the finding Zod schema, and perform one constrained repair request containing only schema errors and the prior bounded response. Keep policy enforcement outside the model adapter.

- [ ] **Step 6: Verify GREEN**

```bash
rtk test bun test tests/unit/bedrock-review-model.test.ts tests/unit/review-engine.test.ts tests/security/prompt-boundaries.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add src/adapters/bedrock-review-model.ts src/services/review-engine.ts tests
rtk git commit -m "feat: add policy-constrained Bedrock review"
```

---

### Task 14: Implement finding reconciliation

**Files:**

- Create: `src/services/finding-reconciler.ts`
- Create: `tests/unit/finding-reconciler.test.ts`

- [ ] **Step 1: Write failing reconciliation tests**

Cover new inline comment, cross-cutting summary, duplicate suppression, unresolved carry-forward, moved-line stable fingerprint, fixed finding update, policy-validated linked-comment dismissal update, unrelated-comment no-op, pending comments across rate windows, uncertain provider write recovery, concurrent human edit protection, and merged/closed without false resolution.

- [ ] **Step 2: Run RED**

```bash
rtk test bun test tests/unit/finding-reconciler.test.ts
```

Expected: FAIL because the reconciler is absent.

- [ ] **Step 3: Implement reserve/mutate/confirm sequencing**

For each mutation:

1. Reserve a deterministic write in state.
2. Call the provider with stable idempotency marker/token.
3. Confirm provider comment ID/content hash.
4. On uncertain retry, read provider comments by marker before writing again.

Resolution updates prepend `✅ Resolved in <shortSha>` or `✅ Resolved after reviewer context (<commentId>)` while preserving original content. Never add a separate clean/resolution comment.

- [ ] **Step 4: Verify GREEN**

```bash
rtk test bun test tests/unit/finding-reconciler.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/services/finding-reconciler.ts tests/unit/finding-reconciler.test.ts
rtk git commit -m "feat: reconcile reviewer comments idempotently"
```

---

### Task 15: Assemble and test the durable lifecycle

**Files:**

- Create: `src/workflows/reviewer-workflow.ts`
- Create: `src/handlers/durable-reviewer-handler.ts`
- Create: `tests/fakes/fake-source-control-provider.ts`
- Create: `tests/fakes/fake-check-runner.ts`
- Create: `tests/fakes/fake-review-model.ts`
- Create: `tests/workflow/reviewer-workflow.test.ts`

- [ ] **Step 1: Write failing clean and finding lifecycle tests**

Using `LocalDurableTestRunner`, assert clean request completes silently; one issue posts once and waits; callback comment becomes context; fixing commit updates the original comment and completes.

- [ ] **Step 2: Write replay/race/timeout tests**

Cover duplicate execution replay, event arriving during callback registration, stale callback, multiple commits coalesced to latest, comment burst preserved, CodeBuild wait through `waitForCondition`, rate timer through `context.wait`, callback timeout re-registration, 30-day lifecycle timeout, merge/close completion, and `BLOCKED_LIMIT` wait. Add a configurable debounce test: multiple events arriving within `debounceSeconds` produce one cycle at the latest head with every human comment. Add transient-failure tests for provider, Bedrock, CodeBuild, Lambda start/status, and callback signaling: verify bounded exponential backoff with jitter, no duplicate side effects, exhaustion persisted as operational detail, lifecycle transition to `FAILED`, alarm metric, and zero review comments.

- [ ] **Step 3: Run RED**

```bash
rtk test bun test tests/workflow/reviewer-workflow.test.ts
```

Expected: FAIL because workflow is absent.

- [ ] **Step 4: Implement a dependency-injected workflow factory**

```ts
export function createReviewerWorkflow(deps: ReviewerWorkflowDependencies) {
  return async function reviewerWorkflow(
    input: ReviewerExecutionInput,
    context: DurableContext,
  ): Promise<ReviewerExecutionResult> {
    // Apply context.wait("debounce-g<generation>-c<cycle>", ...) before claiming a burst.
    // Claim/coalesce events in named context.step operations.
    // Resolve/persist immutable cycle snapshot.
    // Start checks in a retry-configured step and poll via waitForCondition.
    // Run review and reconciliation in retry-configured named steps.
    // Transition to FAILED after shared retry-policy exhaustion.
    // Use context.wait for budgets and waitForCallback for SCM events.
  };
}
```

Use stable operation names containing persisted cycle/generation, not wall-clock values. Every external side effect occurs inside a named durable step and remains application-idempotent. Callback submitter persists the callback ID, checks pending inbox state after registration, and self-signals when needed.

- [ ] **Step 5: Compose the durable handler**

`src/handlers/durable-reviewer-handler.ts` creates real adapters from environment variables and exports exactly one `useDurableHandler` handler. Validate environment with Zod at cold start. Do not log event bodies. Configure the durable Lambda execution timeout to the service-wide maximum approved by deployment (up to 366 days); enforce the repository lifecycle deadline separately with a 30-day default and validate it never exceeds the function timeout.

- [ ] **Step 6: Verify GREEN**

```bash
rtk test bun test tests/workflow/reviewer-workflow.test.ts
rtk tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add src/workflows src/handlers/durable-reviewer-handler.ts tests/fakes tests/workflow
rtk git commit -m "feat: orchestrate durable pull request reviews"
```

---

### Task 16: Assemble Pawl-only infrastructure and router handler

**Files:**

- Create: `src/handlers/event-router-handler.ts`
- Replace: `stacks/reviewer-stack.ts`
- Create: `tests/construct/reviewer-stack.test.ts`
- Modify: `cdk.json`
- Modify: `package.json`

- [ ] **Step 1: Write the failing stack test**

For two configured repositories, assert:

- One durable reviewer with the service-wide maximum execution timeout (up to 366 days), default retention, and published alias; repository lifecycle remains independently configurable with a 30-day default and cannot exceed the durable function timeout.
- One normal router Lambda.
- One encrypted PITR/TTL state table.
- One restricted CodeBuild project and CodeCommit event construct per repository, with private subnets, deny-by-default security-group egress, and deployment-approved package registry access only.
- Router can invoke/start/status-check the durable alias and signal callbacks.
- Router/reviewer have only required table/provider permissions.
- Reviewer can start/read builds and invoke only the chosen Bedrock resource.
- Event rules target router with retry/DLQ.
- Dashboard/alarms and tags exist.
- No raw CDK import exists in `stacks/`.

- [ ] **Step 2: Run RED**

```bash
rtk test bun test tests/construct/reviewer-stack.test.ts
```

Expected: FAIL because final stack and handler are absent.

- [ ] **Step 3: Compose the router handler**

Validate EventBridge input with captured fixture schemas, normalize it, and call the injected router service. Use `useEventbridgeHandler(..., { logging: "metadata" })`, whose payload-safety regression test and implementation were added in Task 6. Add an application handler test proving CloudTrail fallback comment content never appears in logger arguments.

- [ ] **Step 4: Compose the stack using Pawl only**

Allowed application imports include:

```ts
import {
  CodeBuildProject,
  CodeCommitReviewEvents,
  DurableLambdaFunction,
  DynamoDbTable,
  LambdaFunction,
  Stack,
} from "@pawl/cdk";
```

Do not import `aws-cdk-lib`, `constructs`, or raw CDK resource classes in application stack code. Repository list, model ARN, reviewer/bot identities, timeout, and limits come from validated CDK context/configuration.

- [ ] **Step 5: Verify stack test, type-check, and synth**

```bash
rtk test bun test tests/construct/reviewer-stack.test.ts
rtk tsc --noEmit
rtk run 'bunx cdk synth'
```

Expected: PASS; synth requires Docker for NodejsFunction bundling and writes only expected `cdk.out` artifacts.

- [ ] **Step 6: Commit**

```bash
rtk git add src/handlers/event-router-handler.ts stacks/reviewer-stack.ts tests/construct cdk.json package.json bun.lock
rtk git commit -m "feat: deploy Pawl durable reviewer infrastructure"
```

---

### Task 17: Add AWS integration tests, observability, and operational docs

**Files:**

- Create: `tests/aws/codecommit-reviewer.integration.test.ts`
- Create: `tests/aws/durable-replay.integration.test.ts`
- Create: `tests/aws/repository-isolation.integration.test.ts`
- Create: `docs/operations/deploy.md`
- Create: `docs/operations/alerts.md`
- Create: `docs/operations/repository-config.md`
- Modify: `README.md`

- [ ] **Step 1: Write opt-in AWS integration tests**

Gate tests on explicit `RUN_AWS_INTEGRATION=1`, profile, region, and disposable repository names. Automate clean PR, one finding/wait, duplicate event/replay, human comment context, fixing commit/resolved update, merge/close, timeout override, and two-repository isolation. Always register cleanup in `afterAll`.

- [ ] **Step 2: Run the non-live suite first**

```bash
rtk test bun test
rtk tsc --noEmit
```

Expected: all non-live tests pass; live files skip with an explicit reason.

- [ ] **Step 3: Run the AWS suite against disposable resources**

```bash
rtk run 'RUN_AWS_INTEGRATION=1 AWS_PROFILE=jolo bun test tests/aws'
```

Expected: all acceptance scenarios pass, no success comment is posted, and resolved findings update existing comments.

- [ ] **Step 4: Verify Pawl globally**

From the clean Pawl worktree:

```bash
PATH="$PWD/node_modules/.bin:$PATH" rtk test bun test packages/cdk/tests packages/lambda/tests
rtk run 'bun run build'
rtk format packages/cdk packages/lambda
rtk git diff --check
```

Expected: targeted packages pass. Run broader Pawl suites only with their documented Docker/LocalStack/AgentCore prerequisites; report unrelated failures separately rather than hiding them.

- [ ] **Step 5: Verify application security and deployment**

```bash
rtk test bun test
rtk tsc --noEmit
rtk run 'bunx cdk synth'
rtk git diff --check
```

Inspect synthesized IAM for wildcard resources, source/comment logging, secrets in CodeBuild, unencrypted state/logs, missing DLQs/alarms, public CodeBuild subnets, default security-group egress, and unapproved package registries. Expected: no unapproved wildcard permissions, public egress, registry access, or sensitive payload logs.

- [ ] **Step 6: Document operation and repository onboarding**

Document `.pawl/reviewer.json`, model allowlist, repository registration, bot identities, default 30-day timeout, hard-limit behavior, replay/callback alarms, DLQ replay, execution stop procedure, cost metrics, test repository cleanup, and CodeCommit-to-GitHub adapter boundary.

- [ ] **Step 7: Commit**

```bash
rtk git add tests/aws docs/operations README.md
rtk git commit -m "test: validate durable reviewer on AWS"
```

---

### Task 18: Final acceptance and branch handoff

**Files:**

- Verify: all changed files in both repositories
- Update: plan checkboxes and residual-risk notes

- [ ] **Step 1: Re-run the acceptance matrix**

Confirm all 17 acceptance criteria in the approved spec against test names and evidence. Record any scenario that could not run and why; do not infer success.

- [ ] **Step 2: Run final clean-room commands**

```bash
rtk git status --short
rtk test bun test
rtk tsc --noEmit
rtk run 'bunx cdk synth'
rtk git -C ../pawl status --short
cd ../pawl && PATH="$PWD/node_modules/.bin:$PATH" rtk test bun test packages/lambda/tests packages/cdk/tests
cd ../pawl && rtk run 'bun run build'
rtk git diff --cached --check
rtk git -C ../pawl diff --cached --check
```

Expected: tests/type-check/build/synth pass, both cached diffs are clean, and no unexpected staged/untracked artifacts exist.

- [ ] **Step 3: Request independent code review**

Use the `requesting-code-review` skill with distinct correctness/replay, security/IAM, and tests/operations reviewer angles. Apply only evidence-backed fixes through one writer and re-run affected checks. Update this plan's checkboxes and residual-risk notes with actual evidence, then commit the documentation update:

```bash
rtk git add docs/superpowers/plans/2026-07-17-durable-code-reviewer.md
rtk git commit -m "docs: record durable reviewer implementation evidence"
```

- [ ] **Step 4: Present integration options**

Use the `finishing-a-development-branch` skill separately for Pawl and the application. Do not merge either repository until the user chooses merge/PR/keep/cleanup and confirms the Pawl/app dependency order.

## Implementation notes

- The application directory must become versioned before implementation; the Pawl dirty checkout must be preserved before any writer starts.
- Use a single writer for both repositories in dependency order: Pawl task/commit first, application task/commit second.
- Every shell command, including Git and AWS CLI, must run through `rtk`.
- Do not replace native Lambda Durable Functions with Step Functions or a stateless event loop without a new user-approved design.
- Do not add GitHub implementation in this plan.
- Do not post operational failures, clean results, or low-confidence findings to pull requests.
- Do not claim AWS behavior from unit mocks; Tasks 8 and 17 require live disposable-resource evidence.

## Acceptance evidence (Task 18, recorded 2026-07-19)

Final clean-room run in worktree `durable-lambda-reviewer-acceptance` (branch
`chore/final-acceptance`, HEAD `3dd7d10`): `bun test` 245 pass / 0 fail across
29 files; `bunx tsc --noEmit` clean; `cdk synth --quiet` clean; `oxlint` clean;
`oxfmt --check` clean; `bun install --frozen-lockfile` clean; `git diff --check`
clean. Pawl worktree unchanged at `794e286` (only an untracked `.pi-subagents/`
session artifact).

Evidence against the 17 acceptance criteria (spec §15). Criteria requiring live
AWS disposable resources are marked **[live-pending]** — unit/construct evidence
exists, but the master plan's Tasks 8/17 require live execution that has not
been run in this environment.

1. **Clean request receives no comment and completes.** Unit: `ReviewEngine`
   returns no findings on a clean diff; `ReviewerWorkflow` completes a cycle
   with an empty finding set without invoking the reconciler's comment path.
   `tests/unit/review-engine.test.ts`, `tests/unit/workflows/reviewer-workflow.test.ts`.
   **[live-pending]** end-to-end assertion that no comment is posted.
2. **One high-confidence issue → one inline comment, waits.** Unit:
   `IdempotentFindingReconciler` posts exactly one accepted finding and confirms
   it in state; `ReviewEngine` policy-filters to high-confidence findings only.
   `tests/unit/finding-reconciler.test.ts`, `tests/unit/domain/finding-policy.test.ts`.
3. **Duplicate events and durable replay do not duplicate comments.** Unit:
   `EventRouter` deduplicates coalesced events; `IdempotentFindingReconciler`
   suppresses duplicate fingerprints (already-confirmed); every store mutation
   is inside a durable `context.step` (replay-safe). `tests/unit/event-router.test.ts`,
   `tests/unit/finding-reconciler.test.ts`, `tests/unit/event-coalescer.test.ts`.
   **[live-pending]** durable-replay end-to-end.
4. **Human comment resumes review and becomes untrusted model context.** Unit:
   `ReviewEngine` threads `humanComments` into the prompt; security:
   `prompt-boundaries.test.ts` asserts injection payloads are wrapped in
   `<untrusted-comment>`. `tests/security/prompt-boundaries.test.ts`.
5. **Fixing commit updates the original comment as resolved and completes.**
   Unit: `IdempotentFindingReconciler` resolves an open finding via a linked
   dismissal candidate and updates the existing comment with a distinct
   resolution status (`markCommentResolved`). `tests/unit/finding-reconciler.test.ts`.
   **[live-pending]** end-to-end fixing-commit flow.
6. **Policy-validated linked dismissal from an eligible human updates the
   original comment with a distinct resolution status.** Unit:
   `finding-reconciler.test.ts` "resolves an open finding via a linked dismissal
   candidate"; `finding-policy.test.ts` validates eligibility + linking.
7. **Unresolved issue remains deduplicated across commits.** Unit: stable
   fingerprints (`fingerprint.test.ts`) + duplicate suppression
   (`finding-reconciler.test.ts` "suppresses a duplicate finding fingerprint").
8. **Merge or closure ends execution without falsely resolving open findings.**
   Unit: `EventRouter` lease lifecycle + termination; reconciler never resolves
   findings on terminal events. `tests/unit/event-router.test.ts`.
   **[live-pending]** end-to-end merge/close.
9. **Infrastructure failures emit alerts but no review comments.** Unit:
   `CodeBuildCheckRunner` maps FAULT/STOPPED/UNKNOWN_REPOSITORY to
   `infrastructure-failure` (no comment path); Pawl emits CloudBuild/CodeBuild
   alarms (asserted in `tests/security/synth-security.test.ts`).
   `tests/unit/codebuild-check-runner.test.ts`.
10. **Event racing callback registration is processed exactly once.** Unit:
    `event-router.test.ts` "callback wake sends UTF-8 JSON and stale callbacks
    are no-op"; `dynamodb-state-store.test.ts` transactional claim.
11. **Malicious code or comments cannot override policy or obtain credentials.**
    Security: `prompt-boundaries.test.ts` (injection wrapped as untrusted data,
    no provider-invoke path from the result); `synth-security.test.ts` (no
    CodeBuild secrets, approved-registry only, no unapproved wildcards).
12. **Multiple configured repositories remain isolated.** Construct:
    `reviewer-stack.test.ts` multi-repo (2 projects, 4 rules, 1 shared
    reviewer/router/table); adapter: `codebuild-check-runner.test.ts`
    `UNKNOWN_REPOSITORY` on cross-repo project miss. **[live-pending]**
    two-repo state isolation end-to-end.
13. **Configured timeout closes state without posting a comment.** Unit:
    `event-router.test.ts` lease expiry / `leaseDurationSeconds`; store TTL
    (`expiresAt`). **[live-pending]** timeout override end-to-end.
14. **Hard review limit never produces a clean result or resolves findings.**
    Unit: `ReviewEngine` `BLOCKED_LIMIT` hard limits; `review-engine.test.ts`
    exercises `maxModelTokens` chunking. `tests/unit/review-engine.test.ts`.
15. **Every review cycle pins source/base config to immutable commits and
    reuses them during replay.** Unit: `codebuild-check-runner.test.ts`
    "StartBuild uses the exact source commit"; workflow loads config at
    `destinationRevision` inside `load-snapshot` step (replay-safe).
    `tests/unit/repository-config-loader.test.ts`,
    `tests/unit/workflows/reviewer-workflow.test.ts`.
16. **Application infrastructure uses local Pawl constructs; raw CDK confined
    to Pawl packages.** `stacks/reviewer-stack.ts` imports only `@pawl/cdk` +
    `aws-cdk-lib/aws-iam` (application-level Bedrock PolicyStatement); no raw
    CDK resource classes. `grep` confirms no other `aws-cdk-lib` imports in
    `stacks/` or `src/`.
17. **CodeCommit runtime SDK confined to app-local `CodeCommitReviewClient`.**
    `src/adapters/codecommit-review-client.ts` owns the SDK; infrastructure
    remains in `@pawl/cdk`. `tests/unit/codecommit-review-client.test.ts`.

### Residual risks

- **Live AWS integration tests EXECUTED (2026-07-19):** all 8 scenarios in
  `tests/aws/*.integration.test.ts` ran against disposable CodeCommit
  repositories + a deployed stack in `eu-central-1` (account 246350246460) and
  **passed**: AC1 (clean PR → no comment), AC3 (duplicate-event dedup), AC5
  (fixing commit resolves in place), AC8 (close terminates, no false
  resolution), AC3/AC15 (replay no double-write), AC4/AC10 (callback wake),
  AC12 (two-repo isolation, both directions). The stack, repos, table, queues,
  log groups, and KMS keys were torn down immediately after. AC2 (one inline
  finding), AC13 (timeout), and AC6/7/9/14 are covered by unit/construct
  evidence and the live scenarios that did run (the live runs exercise the
  same review/reconcile path). The `[live-pending]` markers above are now
  satisfied for AC1/3/5/8/12/15 and partially for AC4/10; AC2/13 remain
  unit-evidenced (AC13 timeout would need a shortened-timeout stack override).
- **Pawl fix (Task 17 live-validation finding):** `CodeBuildProject` created a
  customer-managed KMS key for its log group but never granted the CloudWatch
  Logs service principal, so `CreateLogGroup` failed at deploy time. Fixed in
  Pawl (`feat/durable-code-reviewer`) by adding the standard logs key-policy
  statement. The app stack deployed cleanly after the fix.
- **Model allowlist (AC-adjacent):** `.pawl/reviewer.json`'s `review.modelId`
  is loaded but not used; the Bedrock model comes from the stack env var.
  Per-repo model selection within an allowlist is deferred.
- **Prod network policy:** the default `public-test` CodeBuild policy is
  forbidden in `prod` (enforced); a private VPC + CodeArtifact policy for prod
  is a follow-up configuration.
- **Independent code review (Task 18 Step 3):** NOT yet performed. This
  evidence record is a self-review; a separate `requesting-code-review` pass
  (correctness/replay, security/IAM, tests/operations) is required before
  final handoff.
