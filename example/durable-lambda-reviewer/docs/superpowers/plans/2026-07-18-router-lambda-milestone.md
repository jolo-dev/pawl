# Router Lambda Milestone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the durable reviewer router Lambda into the AWS stack — instantiate a DynamoDB state table, a router Lambda, and a `CodeCommitReviewEvents` construct, with a real `useEventbridgeHandler` composition root that routes native CodeCommit events through the existing `EventRouter`. The reviewer Durable Lambda is referenced by name but not instantiated this milestone.

**Architecture:** Pawl `BasicConstruct` naming uses `${prefix}${id}-…` where `prefix = ${team}-${stage}-` from CDK context. The router Lambda role gets DynamoDB CRUD on the state table, CodeCommit read + config-read, and inline Lambda durable-execution IAM against the future reviewer function's alias/version-derived ARNs. The handler is a thin composition root over the already-implemented `EventRouter`; runtime behavior is unchanged.

**Tech Stack:** Bun 1.3.x, TypeScript 6, `@pawl/cdk` (`DynamoDbTable`, `LambdaFunction`, `CodeCommitReviewEvents`), `@pawl/lambda` (`useEventbridgeHandler`), AWS CDK 2.261 (`aws-cdk-lib`), `constructs`, `cdk-nag`, `cdk-monitoring-constructs`, `esbuild ^0.28.0` (local bundling), Zod 4, Oxlint 1.74.0 / Oxfmt 0.59.0, Bun test, `rtk`

---

## Working directory and conventions

Use the app feature worktree throughout:

```text
APP=/Users/jolo/Development/worktrees/durable-lambda-reviewer-router-milestone
```

- Branch: `feat/router-lambda-milestone`
- Baseline HEAD (post-spec): `09ba6f9384b110075dee50b7afeb426cf854bdc5`
- App baseline tests: 174 passing on 15 files
- Pawl baseline HEAD: `794e286990533ef965f0961f0c3b27e47e09d783` (post-CodeCommit-runtime-package removal); the consumed constructs (`CodeCommitReviewEvents`, `DynamoDbTable`, `LambdaFunction`, `DurableLambdaFunction`, `useEventbridgeHandler`) remain intact and unmodified this milestone.
- Pawl is read-only this milestone; do not modify `../pawl` or `/Users/jolo/Development/pawl`
- All shell commands use the `rtk` extension
- Follow `@superpowers:test-driven-development` for runtime and construct code where a behavior is being asserted; skip TDD only for pure CDK wiring with no observable behavior beyond the synth/cdk-nag output

`cdk synth` and construct tests require local `esbuild` on `PATH`; all CDK commands prepend `PATH="$PWD/node_modules/.bin:$PATH"`.

## File map

### New application files

| Path                                               | Responsibility                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/handlers/event-router-handler.ts`             | EventBridge composition root; exports `buildEventRouter(options?)` (injectable) and `handler` (env-only) |
| `tests/unit/handlers/event-router-handler.test.ts` | Unit test exercising `buildEventRouter` with injected fakes through the EventBridge handler shape        |
| `tests/constructs/reviewer-stack.test.ts`          | Focused CDK assertions for `reviewer-stack.ts` (resources, IAM, env vars, EventBridge rules, cdk-nag)    |

### Modified application files

| Path                       | Responsibility                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stacks/reviewer-stack.ts` | Replace empty stack with `DynamoDbTable` + `LambdaFunction` (router) + `CodeCommitReviewEvents` assembly, Zod-validated context, router env vars, inline durable-execution IAM |
| `cdk.json`                 | Add `repositoryName` context; document `reviewerArn` / `reviewerAlias` / `botArnPatterns` overrides                                                                            |
| `package.json`             | Add `aws-cdk`, `aws-cdk-lib`, `constructs`, `cdk-nag`, `cdk-monitoring-constructs`, `esbuild ^0.28.0` devDependencies; add `cdk:synth` script                                  |
| `bun.lock`                 | Reproducible resolution of the new devDependencies                                                                                                                             |

### Out of scope

- `src/handlers/durable-reviewer-handler.ts`, `src/workflows/reviewer-workflow.ts`, the Bedrock engine, finding reconciler, CodeBuild check runner, and AWS integration tests — all deferred.
- Any Pawl library change. The Pawl constructs are consumed unmodified.

---

### Task 1: Add devDependencies for CDK construct testing and synth

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Capture preservation baseline**

Run:

```bash
APP=/Users/jolo/Development/worktrees/durable-lambda-reviewer-router-milestone
PAWL=/Users/jolo/Development/worktrees/pawl
rtk git -C "$APP" status --short --branch
rtk git -C "$APP" rev-parse HEAD
rtk bun run lint
rtk bun run fmt:check
rtk test bun test
rtk tsc --noEmit
rtk bun install --frozen-lockfile
rtk git -C "$PAWL" rev-parse HEAD
```

Expected: app is clean at `09ba6f9` on `feat/router-lambda-milestone`; lint clean; fmt clean; 174 tests pass; typecheck clean; frozen install clean. Pawl baseline unchanged at `794e286990533ef965f0961f0c3b27e47e09d783` (only untracked `.pi-subagents/` is acceptable).

- [ ] **Step 2: Verify the CDK imports cannot resolve yet (RED)**

Run:

```bash
cd "$APP"
bun -e 'try { require.resolve("aws-cdk-lib"); console.log("aws-cdk-lib RESOLVED") } catch (e) { console.log("aws-cdk-lib NOT at top node_modules") }'
bun -e 'try { require.resolve("esbuild"); console.log("esbuild RESOLVED") } catch (e) { console.log("esbuild NOT at top node_modules") }'
```

Expected: both print `NOT at top node_modules` because they only exist under `node_modules/@pawl/cdk/node_modules/` and are not hoisted. A direct `import { App } from "aws-cdk-lib"` from `stacks/` or `tests/constructs/` would fail to resolve under Bun's workspace unless the app declares them. This is the tooling-migration RED.

- [ ] **Step 3: Add the devDependencies**

Add these to `devDependencies` in `package.json`:

```json
"aws-cdk": "^2.1124.1",
"aws-cdk-lib": "^2.261.0",
"cdk-monitoring-constructs": "^10.0.0",
"cdk-nag": "^2.38.2",
"constructs": "10.6.0",
"esbuild": "^0.28.0"
```

Pinned versions match `@pawl/cdk`'s transitive resolutions (verified via `bun.lock` and `packages/cdk/package.json`); `esbuild ^0.28.0` satisfies `aws-cdk-lib@2.261.0`'s declared `"esbuild": "^0.28.0"` range. Do not add a `catalog:` entry for `esbuild` — it is a devDependency local to this app, not a shared Pawl catalog tool.

Add a `cdk:synth` script:

```json
"cdk:synth": "cdk synth"
```

- [ ] **Step 4: Install and verify resolution**

Run:

```bash
cd "$APP"
rtk bun install
bun -e 'console.log(require.resolve("aws-cdk-lib"))'
bun -e 'console.log(require.resolve("esbuild"))'
rtk run 'ls node_modules/.bin/cdk node_modules/.bin/esbuild'
```

Expected: `aws-cdk-lib` and `esbuild` resolve at top-level `node_modules/`; both `cdk` and `esbuild` binaries exist in `node_modules/.bin/`.

- [ ] **Step 5: Verify nothing else regressed**

Run:

```bash
cd "$APP"
rtk bun run lint
rtk bun run fmt:check
rtk test bun test
rtk tsc --noEmit
rtk bun install --frozen-lockfile
```

Expected: app gates still pass; 174 tests pass; typecheck clean; frozen install clean.

- [ ] **Step 6: Review and commit**

Run:

```bash
rtk git -C "$APP" diff --check
rtk git -C "$APP" diff -- package.json bun.lock
rtk git -C "$APP" add package.json bun.lock
rtk git -C "$APP" commit -m 'build: add CDK devDependencies for stack wiring'
```

Expected: one commit containing only `package.json` and `bun.lock`. No source changes.

---

### Task 2: Implement the router Lambda handler composition root (TDD)

**Files:**

- Create: `src/handlers/event-router-handler.ts`
- Create: `tests/unit/handlers/event-router-handler.test.ts`

- [ ] **Step 1: Write the failing handler test (RED)**

Create `tests/unit/handlers/event-router-handler.test.ts` covering:

1. **routes a normal CodeCommit PR event end-to-end through the handler**: builds `buildEventRouter` with an in-memory state store, a fake `LambdaTransport` that records commands, and a no-op fake `SourceControlProvider` (`getRequest` returns a minimal `ReviewRequest`). Calls `buildEventRouter({ stateStore, lambda, provider, reviewerFunctionName, reviewerArn }).routeCodeCommit(event)` with a synthetic native pull-request `EventBridgeEvent<"CodeCommit Pull Request State Change", ...>` and asserts:
   - the router appended an event to the store,
   - `lambda.send` was called once with a `kind: "invoke"` command,
   - the command's `FunctionName` equals the configured `reviewerFunctionName`,
   - the command's `Qualifier` equals the configured `reviewerAlias` (default `"live"`),
   - the returned `RouteResult.started` is `true`.
2. **drops reviewer-self comment events without invoking Lambda**: builds `buildEventRouter` with `reviewerArn` set equal to the comment author; calls `routeCodeCommit` with a synthetic `CodeCommit Comment on Pull Request` event whose author equals `reviewerArn`; asserts the handler returns `undefined` and no `lambda.send` was called.
3. **handler shape**: `handler` is the return of `useEventbridgeHandler(...)` — assert `typeof handler === "function"` and `handler.length === 1`. (Pawl's `handlerFactory` returns `async (event) => …` with one positional parameter and ignores Lambda's `context`; AWS Lambda still invokes with `(event, context)` at runtime, but the constructed function's `.length` is 1.)

Do not exercise real AWS clients. The test imports the in-memory state store from `tests/fakes/in-memory-state-store`, the fake `LambdaTransport` defined inline in the test, and `buildEventRouter` from `src/handlers/event-router-handler`.

> **Repository scoping is intentionally not asserted here.** Per spec §4.3, the normalizer filters only reviewer-self and configured bot identities; it has no repository filter, and `EventRouter` exposes no `repositoryName` option (Step 2 forbids adding one). Repository scoping is an EventBridge-rule concern, asserted at the CDK layer in Task 3 via `CodeCommitReviewEvents({ repositoryName })`. A CloudTrail `PostCommentForPullRequest` for another repository would normalize and route successfully; that is the documented contract, not a gap.

Run:

```bash
cd "$APP"
rtk test bun test tests/unit/handlers/event-router-handler.test.ts
```

Expected: FAIL because `src/handlers/event-router-handler.ts` does not exist.

- [ ] **Step 2: Implement the composition root**

Create `src/handlers/event-router-handler.ts` with:

- `buildEventRouter(options?)`:
  - When `options` is provided, constructs `new EventRouter({ stateStore: options.stateStore, lambda: options.lambda, provider: options.provider, reviewerFunctionName: options.reviewerFunctionName, reviewerAlias: options.reviewerAlias, reviewerArn: options.reviewerArn, botArnPatterns: options.botArnPatterns })`.
  - When `options` is undefined, reads `process.env.STATE_TABLE_NAME`, `process.env.REVIEWER_FUNCTION_NAME`, `process.env.REVIEWER_FUNCTION_ALIAS`, `process.env.REVIEWER_FUNCTION_ARN`, `process.env.REPOSITORY_NAME`, `process.env.BOT_ARN_PATTERNS` and constructs `DynamoDbStateStore({ transport: DynamoDBDocumentClient.from(new DynamoDBClient({})), tableName: STATE_TABLE_NAME })`, `AwsLambdaTransport()`, `new CodeCommitProvider({ reviewerArn })`, passing the env values into `EventRouter`. Parse `BOT_ARN_PATTERNS` as a comma-separated list.
- `let cachedRouter: EventRouter | undefined` at module scope and `getRouter()` that lazily constructs it once; the exported `handler` calls `getRouter()` then `router.routeCodeCommit(event)` inside the `useEventbridgeHandler("durable-reviewer-router", async (event, logger) => { const router = getRouter(); const result = await router.routeCodeCommit(event); logger.info("routed", { ...(result ?? {}) }); })`.

Use the existing `EventRouter` constructor's option names verbatim:

```ts
export interface EventRouterOptions {
  readonly stateStore: ReviewStateStore;
  readonly lambda?: LambdaTransport;
  readonly provider: SourceControlProvider;
  readonly reviewerFunctionName: string;
  readonly reviewerAlias?: string;
  readonly reviewerArn: string;
  readonly botArnPatterns?: readonly (string | RegExp)[];
  readonly retryPolicy?: RetryPolicy;
  readonly repositoryHash?: (repository: string) => string;
}
```

Do not add new options or change existing method signatures. `CodeCommitProvider` takes `CodeCommitProviderOptions` per `src/adapters/codecommit-provider.ts`; supply `reviewerArn` from env.

- [ ] **Step 3: Run GREEN**

Run:

```bash
cd "$APP"
rtk test bun test tests/unit/handlers/event-router-handler.test.ts
```

Expected: all handler tests pass.

- [ ] **Step 4: Verify typecheck and app regression**

Run:

```bash
cd "$APP"
rtk tsc --noEmit
rtk test bun test
rtk bun run lint
rtk bun run fmt
```

Expected: typecheck clean; 174 baseline tests + the new handler tests all pass; lint clean; Oxfmt normalizes the new files.

- [ ] **Step 5: Review and commit**

Run:

```bash
rtk git -C "$APP" diff --check
rtk git -C "$APP" diff -- src/handlers/event-router-handler.ts tests/unit/handlers/event-router-handler.test.ts
rtk git -C "$APP" add src/handlers/event-router-handler.ts tests/unit/handlers/event-router-handler.test.ts
rtk git -C "$APP" commit -m 'feat: add router Lambda EventBridge handler'
```

Expected: one commit containing only the handler and its unit test.

---

### Task 3: Wire the CDK stack and add CDK context (TDD for the construct test)

**Files:**

- Create: `tests/constructs/reviewer-stack.test.ts`
- Modify: `stacks/reviewer-stack.ts`
- Modify: `cdk.json`
- Modify: `package.json` (add `aws-cdk-lib` import hint only if needed)
- Modify: `tsconfig.json` (no change expected — confirm `tests/**/*.ts` already included; the existing `include` covers `tests/**/*.ts` and `stacks/**/*.ts`)

- [ ] **Step 1: Add cdk.json context and write the failing construct test (RED)**

Add `"repositoryName"` to `cdk.json` `context` with placeholder value `"test-repo"` (overridable by real deployments). Add documentation comments inside `cdk.json` are not valid JSON; instead document overrides in `README.md` is out of scope — keep `cdk.json` minimal and rely on the spec's §6 source-of-truth.

Create `tests/constructs/reviewer-stack.test.ts` covering:

1. **synthesizes exactly one DynamoDB table, one router Lambda, and the expected `CodeCommitReviewEvents` resources**: assert the synthesized template contains exactly one `AWS::DynamoDB::Table`, one `AWS::Lambda::Function` (the router), two native `AWS::Events::Rule`s (PR state + comment), one `AWS::SQS::Queue` (DLQ), and the associated `AWS::Lambda::Permission`s and `AWS::SQS::QueuePolicy`.
2. **DynamoDB table config**: assert the table has partition key `pk`/STRING, sort key `sk`/STRING, TTL attribute `expiresAt`, PITR enabled, and synthesized `DeletionPolicy: Retain` + `UpdateReplacePolicy: Retain` (CDK synthesizes both from `RemovalPolicy=RETAIN`) and `DeletionProtectionEnabled: true`. Table name equals the derived `${team}-${stage}-ReviewerState-table`.
3. **router Lambda env vars (default path)**: assert the router Lambda's `Environment.Variables` includes `STATE_TABLE_NAME` = the derived state table name, `REVIEWER_FUNCTION_NAME` = `${team}-${stage}-Reviewer-lambda`, `REVIEWER_FUNCTION_ALIAS` = `"live"`, `REVIEWER_FUNCTION_ARN` = `arn:aws:lambda:<region>:<account>:function:${team}-${stage}-Reviewer-lambda:live`, `REPOSITORY_NAME` = `"test-repo"`, `BOT_ARN_PATTERNS` = `""` (or absent). Use CloudFormation pseudo-parameter references (`{ "Ref": "AWS::Region" }`, `{ "Ref": "AWS::AccountId" }`) in expected ARN assertions, not literal region/account strings.
4. **router Lambda env vars (override path)**: construct a separate stack with context `reviewerArn = "arn:aws:lambda:eu-west-1:123456789012:function:custom-reviewer:prod-alias"` and assert that the synthesized `REVIEWER_FUNCTION_ARN` equals that override — proving the context override is honored and does not fall back to the derived convention ARN.
5. **router role IAM — CodeCommit**: assert the role has a statement with `Action` = the exact read + config-read action list (`codecommit:GetPullRequest`, `codecommit:GetDifferences`, `codecommit:GetCommentsForPullRequest`, `codecommit:GetCommit`, `codecommit:BatchGetCommits`, `codecommit:GetFile`) scoped to `arn:aws:codecommit:<region>:<account>:test-repo`. Assert no `codecommit:PostCommentForPullRequest` or `codecommit:UpdateComment` action is granted.
6. **router role IAM — DynamoDB**: assert the role has `dynamodb:*` (or the specific CRUD action set Pawl's `grantReadWriteData` produces) scoped to the state table ARN only.
7. **router role IAM — Lambda durable execution**: assert the role has an inline policy with:
   - `lambda:InvokeFunction` scoped to `arn:aws:lambda:<region>:<account>:function:${team}-${stage}-Reviewer-lambda:live`
   - `lambda:ListDurableExecutionsByFunction` scoped to `arn:aws:lambda:<region>:<account>:function:${team}-${stage}-Reviewer-lambda:live`
   - `lambda:GetDurableExecution` scoped to `${team}-${stage}-Reviewer-lambda:live` CloudFormation-version ARN suffixed with `/durable-execution/*/*` (Pawl's helper uses the alias's current-version ARN, not the alias ARN itself; this milestone's inline IAM uses the alias ARN for simplicity, which is permissive-but-correct — next-milestone migration to Pawl's helper will narrow to the version ARN)
   - `lambda:SendDurableExecutionCallbackSuccess` scoped to `"*"`
8. **EventBridge target**: assert both native rules target the router Lambda and use the shared DLQ with retry `MaximumRetryAttempts: 3`, `MaximumEventAgeInSeconds: 3600` (Pawl `CodeCommitReviewEvents` defaults).
9. **cdk-nag**: apply `AwsSolutionsChecks` with `Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }))`; assert that the stack-side `NagSuppressions` entry (Task 3 Step 2) is present and scoped to the inline Lambda policy's `Resource::*` callback statement with the verbatim reason copied from Pawl's `grantSendDurableExecutionCallbacks` helper: `"Lambda callback APIs accept only an opaque CallbackId and do not support resource-level IAM permissions."`. The test does **not** add a duplicate suppression. Assert no other unsuppressed findings.
10. **context validation**: assert that constructing the stack with no `repositoryName` context throws a Zod error (use `expect(() => new DurableLambdaReviewerStack(...)).toThrow()`).

Run:

```bash
cd "$APP"
PATH="$PWD/node_modules/.bin:$PATH" rtk test bun test tests/constructs/reviewer-stack.test.ts
```

Expected: FAIL because `reviewer-stack.ts` is still the empty stack; resources are absent and the assertions fail.

- [ ] **Step 2: Implement the stack**

Replace `stacks/reviewer-stack.ts` with:

- A Zod schema `StackConfigSchema` parsing `this.node.tryGetContext` keys: `repositoryName` (required string), `reviewerAlias` (default `"live"`), `reviewerArn` (optional string), `botArnPatterns` (optional comma-separated string, default `""`).
- Compute `team` and `stage` via the inherited `BasicConstruct`/`Stack` prefix: `this.prefix` is `${team}-${stage}-` (read from the existing `BasicTags` context via the Pawl `Stack`).

  Actually, `prefix` is built into each `BasicConstruct`, not on the `Stack`. To derive `${team}-${stage}-` in the stack, read the same context the same way:

  ```ts
  const team = this.node.getContext("team");
  const stage = this.node.getContext("stage");
  const reviewerFunctionName = `${team}-${stage}-Reviewer-lambda`;
  const reviewerAlias = config.reviewerAlias ?? "live";
  const reviewerFunctionArn = `arn:aws:lambda:${this.region}:${this.account}:function:${reviewerFunctionName}:${reviewerAlias}`;
  const reviewerArn = config.reviewerArn ?? reviewerFunctionArn;
  ```

- Instantiate:

  ```ts
  const stateTable = new DynamoDbTable(this, "ReviewerState", {
    partitionKey: { name: "pk", type: "STRING" },
    sortKey: { name: "sk", type: "STRING" },
    timeToLiveAttribute: "expiresAt",
    pointInTimeRecovery: true,
    retain: true,
  });

  const router = new LambdaFunction(this, "router", {
    entry: path.join(__dirname, "..", "src", "handlers", "event-router-handler.ts"),
    environment: {
      STATE_TABLE_NAME: stateTable.tableName,
      REVIEWER_FUNCTION_NAME: reviewerFunctionName,
      REVIEWER_FUNCTION_ALIAS: reviewerAlias,
      REVIEWER_FUNCTION_ARN: reviewerArn, // honors config.reviewerArn override per spec §4.2/§6
      REPOSITORY_NAME: config.repositoryName,
      BOT_ARN_PATTERNS: config.botArnPatterns ?? "",
    },
  });

  stateTable.grantReadWrite(router);

  const events = new CodeCommitReviewEvents(this, "ReviewEvents", {
    repositoryName: config.repositoryName,
    router,
  });
  events.grantRead(router);
  events.grantConfigRead(router);
  ```

- Add the inline Lambda durable-execution policy to the router role via **one dedicated `aws-iam.Policy` attached to `router.lambda.role`**, not three separate `addToRolePolicy` calls. A single policy document keeps the `NagSuppression` locatable to the specific `"*"`-resource callback statement:

  ```ts
  const durableExecutionPolicy = new Policy(this, "RouterDurableExecutionPolicy", {
    statements: [
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["lambda:InvokeFunction", "lambda:ListDurableExecutionsByFunction"],
        resources: [reviewerFunctionArn],
      }),
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["lambda:GetDurableExecution"],
        resources: [`${reviewerFunctionArn}/durable-execution/*/*`],
      }),
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["lambda:SendDurableExecutionCallbackSuccess"],
        resources: ["*"],
      }),
    ],
  });
  durableExecutionPolicy.attachToRole(router.lambda.role);
  NagSuppressions.addResourceSuppressions(durableExecutionPolicy, [
    {
      id: "AwsSolutions-IAM5",
      reason:
        "Lambda callback APIs accept only an opaque CallbackId and do not support resource-level IAM permissions.",
      appliesTo: ["Resource::*"],
    },
  ]);
  ```

  The `NagSuppression` lives in the **stack**, not the test, so the deployed stack is auditable without the test. The construct test asserts the suppression is present and scoped to the callback statement — it does **not** add a duplicate suppression.

- Export nothing new from the stack; keep `class DurableLambdaReviewerStack extends Stack` with the constructor reading the context and building the constructs.

- [ ] **Step 3: Run GREEN**

Run:

```bash
cd "$APP"
PATH="$PWD/node_modules/.bin:$PATH" rtk test bun test tests/constructs/reviewer-stack.test.ts
```

Expected: all construct assertions pass.

- [ ] **Step 4: Run cdk synth and all app gates**

Run:

```bash
cd "$APP"
PATH="$PWD/node_modules/.bin:$PATH" rtk run 'cdk synth --quiet'
rtk bun run lint
rtk bun run fmt:check
rtk test bun test
rtk tsc --noEmit
rtk bun install --frozen-lockfile
```

Expected: `cdk synth` produces a clean CloudFormation template using local esbuild (no Docker fallback); all gates pass; full test suite (174 baseline + handler + construct) green; typecheck clean; frozen install clean.

- [ ] **Step 5: Review and commit**

Run:

```bash
rtk git -C "$APP" diff --check
rtk git -C "$APP" diff -- stacks/reviewer-stack.ts cdk.json tests/constructs/reviewer-stack.test.ts
rtk git -C "$APP" add stacks/reviewer-stack.ts cdk.json tests/constructs/reviewer-stack.test.ts
rtk git -C "$APP" commit -m 'feat: wire reviewer router stack'
```

Expected: one commit containing the stack wiring, CDK context, and the construct test. No Pawl changes.

---

### Task 4: Verify the milestone against the accepted spec

**Files:**

- Verify: all changed files this milestone

- [ ] **Step 1: Run the final milestone gate**

Run:

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

Expected: all gates pass; synthesized CloudFormation is clean; full suite green; typecheck clean; frozen install clean.

- [ ] **Step 2: Verify acceptance criteria from the spec**

Confirm each criterion in `docs/superpowers/specs/2026-07-18-router-lambda-milestone-design.md` §9 against test names and synth output:

1. Stack instantiates `DynamoDbTable`, `LambdaFunction` (router), `CodeCommitReviewEvents` — verify via `tests/constructs/reviewer-stack.test.ts` assertion 1.
2. Router role has DynamoDB CRUD + CodeCommit read + config-read + Lambda durable IAM — assertions 4, 5, 6.
3. No CodeCommit comment permissions — assertion 4's negative check.
4. Stack reads `repositoryName` from context (Zod-validated); missing required context fails synthesis — assertion 9.
5. `reviewerAlias` defaults `"live"`, `reviewerArn` derived from convention when absent, `botArnPatterns` default empty — assertion 3.
6. `CodeCommitReviewEvents` targets the router Lambda with DLQ/monitoring defaults — assertion 7.
7. Handler exports `buildEventRouter` + `handler` and routes through `EventRouter.routeCodeCommit` — `tests/unit/handlers/event-router-handler.test.ts`.
8. Handler unit test routes a synthetic event with fakes and rejects reviewer-self — assertions 1 and 2.
9. `cdk synth` uses local esbuild, not Docker — `cdk synth --quiet` exited 0 with local esbuild on PATH.
10. `cdk-nag AwsSolutionsChecks` passes with only the documented callback suppression — assertion 8.
11. Existing 174 tests remain green — verified in Task 4 Step 1's `bun test` count (174 + new tests).
12. No Pawl changes and no live AWS calls — verified by `rtk git -C "$PAWL" status --short --branch` showing only the pre-existing untracked `.pi-subagents/`.

- [ ] **Step 3: Reconfirm Pawl boundary**

Run:

```bash
PAWL=/Users/jolo/Development/worktrees/pawl
rtk git -C "$PAWL" status --short --branch
rtk git -C "$PAWL" rev-parse HEAD
```

Expected: Pawl still at `794e286990533ef965f0961f0c3b27e47e09d783`, only `.pi-subagents/` untracked, no tracked changes this milestone.

- [ ] **Step 4: Review commit scope and repository cleanliness**

Run:

```bash
rtk git -C "$APP" status --short --branch
rtk git -C "$APP" log --oneline --decorate -5
rtk git -C "$APP" diff 09ba6f9..HEAD --stat
```

Expected: app is clean with three milestone commits (deps, handler, stack); all changed paths are within the milestone's file map; Pawl baseline unchanged.

- [ ] **Step 5: Request final independent spec + plan + code review**

Use `@superpowers:requesting-code-review` with two reviewer angles:

- **Spec compliance + IAM/cdk-nag**: verify the implemented stack matches the spec's §4–§7 and §9 criteria; all storable-shape and IAM ARNs match Pawl's helper conventions; no undocumented `AwsSolutions-*` findings remain.
- **Tests + behavior parity**: verify the handler composition root is identical to what the spec describes; the handler test covers the four required cases; no existing tests regressed; `cdk synth` is reproducible.

Apply only evidence-backed Critical/Important fixes through one writer, rerun affected gates, and re-request review. Before claiming completion, use `@superpowers:verification-before-completion` and cite fresh command evidence.
