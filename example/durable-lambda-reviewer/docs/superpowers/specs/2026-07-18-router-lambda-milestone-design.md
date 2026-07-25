# Router Lambda Milestone Design

**Date:** 2026-07-18  
**Status:** User-approved design; pending written-spec review  
**Milestone:** First of the durable reviewer feature implementation (bigger plan Task 11 scope)

## 1. Purpose

Wire the durable reviewer router Lambda into the AWS stack so that native CodeCommit pull-request and comment events route to a real Lambda function that persists events to DynamoDB and invokes the future durable reviewer execution by name. The reviewer's durable Lambda, workflow, Bedrock engine, and reconciler are out of scope for this milestone.

The milestone produces a `cdk synth`-clean stack that deploys a working router Lambda with valid IAM and EventBridge wiring, and a handler composition root that exercises the already-implemented `EventRouter` with AWS SDK transports.

## 2. Confirmed decisions

- Router Lambda instantiates a real `useEventbridgeHandler` composition root backed by `EventRouter`; reviewer Durable Lambda is referenced by name without being instantiated this milestone.
- DynamoDB state table uses `partitionKey = pk (STRING)`, `sortKey = sk (STRING)`, `timeToLiveAttribute = "expiresAt"`, PITR on, retention on; table name derived from `team`+`stage` via the Pawl `BasicConstruct` prefix.
- Router role gets DynamoDB CRUD on the state table + CodeCommit `grantRead` + `grantConfigRead`; no `grantComment` this milestone.
- Router role gets Lambda invoke/list/status/callback IAM against the future reviewer function ARN, derived from the `team`+`stage` + `id: "Reviewer"` convention.
- Single CodeCommit repository from CDK context (`repositoryName`); multi-repo deferred.
- Stack configuration comes from CDK context (Zod-validated inside the stack), not stack props.
- `reviewerFunctionName` is derived from `team`+`stage` + `id: "Reviewer"` (not from context); `reviewerArn` defaults to the derived alias ARN; `reviewerAlias` defaults `"live"`; `botArnPatterns` optional, empty by default; TTL and lease settings left to adapter defaults.
- Observability relies on Pawl construct defaults (DLQ depth, Lambda P99); no custom router metrics or alarms this milestone.
- No live-AWS integration tests this milestone; verification is `cdk synth`, focused unit tests, and frozen install.

## 3. Scope

### 3.1 In scope

- `src/handlers/event-router-handler.ts`: EventBridge composition root that reads config from env and builds an `EventRouter` with AWS SDK transports.
- A testable composition seam (`buildEventRouter`) that accepts injected transports for unit tests.
- `stacks/reviewer-stack.ts`: instantiate `DynamoDbTable`, `LambdaFunction` (router), and `CodeCommitReviewEvents`, wire grants, and configure router environment variables.
- `cdk.json`: add the new context surface (`repositoryName` required; `reviewerAlias`, `reviewerArn`, `botArnPatterns` optional). `reviewerFunctionName` is derived, not in context (§6).
- `index.ts`: no change required; existing auto-discovery loads `reviewer-stack.ts`.
- A focused handler unit test exercising the composition root with injected fakes through the EventBridge handler wrapper.
- A focused CDK construct test for `reviewer-stack.ts` asserting resource counts, IAM actions/resources, EventBridge rule patterns, DLQ, environment variables, and cdk-nag compliance.

### 3.2 Out of scope

- Reviewer Durable Lambda instantiation (deferred to the next milestone).
- The durable reviewer handler, workflow, Bedrock engine, finding reconciler, CodeBuild check runner, and AWS integration tests.
- Custom CloudWatch metrics, dashboards, and alarms beyond Pawl construct defaults.
- Multi-repository support.
- Live AWS deployment or live CodeCommit event validation.
- Repository configuration schema enforcement (`.pawl/reviewer.json`) and check runner.

## 4. Architecture

### 4.1 Stack composition

`DurableLambdaReviewerStack` reads configuration from CDK context, validates it with a Zod schema, and instantiates three constructs in this order:

1. `DynamoDbTable` named `${team}-${stage}-ReviewerState-table`, granted CRUD to the router Lambda role.
2. `LambdaFunction` named `${projectName}-router`, with the handler entry pointing to `src/handlers/event-router-handler.ts`, environment variables for table name, reviewer function name/alias, reviewer ARN, repository name, and bot-ARN patterns.
3. `CodeCommitReviewEvents` targeting the router, with `grantRead(router)` and `grantConfigRead(router)` applied. No `grantComment` this milestone.

The router role additionally gets an inline IAM policy granting durable-execution Lambda invoke/list/status/callback against the future reviewer function's physical name. Physical names follow Pawl's `BasicConstruct` convention `${prefix}${id}-lambda`, where `prefix = ${team}-${stage}-` is derived from `BasicTags` (`team` and `stage` CDK context, not `projectName`). The future reviewer `DurableLambdaFunction` will be constructed with `id: "Reviewer"`, yielding physical name `${team}-${stage}-Reviewer-lambda` and alias `${team}-${stage}-Reviewer-lambda:${reviewerAlias}`. The next milestone's reviewer construct must use this exact `id` and `aliasName` so the IAM scope and bot-filter ARN match. This milestone does not instantiate the reviewer construct.

### 4.2 Handler composition root

`src/handlers/event-router-handler.ts` exports two artifacts:

- `buildEventRouter(options?)`: a pure composition function. When called with no arguments, it reads AWS SDK clients and configuration from `process.env` and constructs an `EventRouter` with `DynamoDbStateStore`, `AwsLambdaTransport`, `CodeCommitProvider`, reviewer name/alias/Arn, and bot-ARN patterns. When called with `options`, it accepts injected transports for deterministic tests.
- `handler`: the result of `useEventbridgeHandler("durable-reviewer-router", ...)` that calls `router.routeCodeCommit(event)` for each EventBridge event, logging the route outcome.

The handler memoizes a single `EventRouter` at module scope (`let cachedRouter: EventRouter | undefined`) and constructs it lazily on the first invocation, because `useEventbridgeHandler`'s `handleRequest` runs per EventBridge delivery, not once per cold start. Re-instantiating transports and SDK clients on every event would be wasteful and would create non-reused HTTP connection pools.

Environment variables (set by the stack):

- `STATE_TABLE_NAME`: the DynamoDB state table name.
- `REVIEWER_FUNCTION_NAME`: the future reviewer's Lambda function name.
- `REVIEWER_FUNCTION_ALIAS`: the reviewer's alias qualifier (default `"live"`).
- `REVIEWER_FUNCTION_ARN`: the reviewer's full ARN, used for bot-identity filtering.
- `REPOSITORY_NAME`: the CodeCommit repository name (used for `CodeCommitProvider` and bot filtering).
- `BOT_ARN_PATTERNS`: optional comma-separated list of additional bot author-ARN glob patterns.

### 4.3 Runtime flow

1. EventBridge delivers a CodeCommit pull-request or comment event to the router Lambda.
2. `useEventbridgeHandler` extracts metadata and invokes the handler body with the event and a Powertools logger.
3. The handler calls `router.routeCodeCommit(event)`.
4. `EventRouter.normalizeCodeCommitEvent` filters reviewer-self and configured bot identities, returning `undefined` for irrelevant events.
5. For a relevant event, the router appends to the state store, then either wakes a registered callback or starts a new durable execution via `AwsLambdaTransport.send({ kind: "invoke" })` against the future reviewer function by physical name and alias.
6. The router records the durable execution ARN in state and returns; the handler logs and completes.
7. Failed external calls follow the existing `RetryPolicy` and `failureFor` behavior already implemented in `EventRouter`; no new failure handling is added this milestone.

### 4.4 Race-free guarantees

The router inherits the existing `EventRouter` race-free protocol (persist-before-wake, conditional ownership, stale callback rejection). No new race handling is added this milestone; the existing `event-router.test.ts` already covers those interleavings with the in-memory state store fake.

## 5. File responsibilities

### 5.1 New application files

- `src/handlers/event-router-handler.ts`: EventBridge composition root. Imports `useEventbridgeHandler` from `@pawl/lambda`, `EventRouter` from `../router/event-router`, `DynamoDbStateStore` from `../adapters/dynamodb-state-store`, `AwsLambdaTransport` from `../router/lambda-transport`, `CodeCommitProvider` from `../adapters/codecommit-provider`. Exports `buildEventRouter` and `handler`. The `EventRouter` method used is `routeCodeCommit(value)` (the existing public API; there is no `routeCodeCommitEvent`).
- `tests/unit/handlers/event-router-handler.test.ts`: focused unit test using `buildEventRouter` with injected fakes; verifies the handler routes a native CodeCommit event, deduplicates irrelevant events, and logs the outcome.

### 5.2 Modified application files

- `stacks/reviewer-stack.ts`: replace the empty stack with construct assembly per §4.1.
- `tests/constructs/reviewer-stack.test.ts` (create): focused CDK assertions. New tests directory `tests/constructs/`.
- `cdk.json`: add `repositoryName` context key (required). Per §6, `reviewerFunctionName` is **not** configurable — it is derived from `team`+`stage` + `id: "Reviewer"`.
- `package.json`: add `aws-cdk`, `aws-cdk-lib`, `constructs`, `cdk-nag`, `cdk-monitoring-constructs`, and `esbuild` as devDependencies so the construct test imports resolve and `cdk synth` bundles with local esbuild (CDK's `aws-lambda-nodejs` Bundling falls back to Docker when esbuild is missing — explicitly avoided per §9 criterion 9). Version pins match `@pawl/cdk`'s transitive resolutions; `esbuild` is pinned to `^0.28.0` to satisfy `aws-cdk-lib@2.261.0`'s declared `"esbuild": "^0.28.0"` range. Add a `cdk:synth` script for verification convenience if absent. `@aws-lambda-powertools/logger` etc. are already transitive through `@pawl/lambda` and need not be added directly.

### 5.3 Out-of-scope files

- `src/handlers/durable-reviewer-handler.ts`: deferred.
- `src/workflows/reviewer-workflow.ts`: deferred.
- The Pawl library: this milestone adds no Pawl constructs. The existing `CodeCommitReviewEvents`, `DynamoDbTable`, and `LambdaFunction` are used unmodified.

## 6. CDK context surface

Computed defaults (following Pawl `BasicConstruct` naming `${prefix}${id}-...`, `prefix = ${team}-${stage}-`):

- `stateTableName` = `${team}-${stage}-ReviewerState-table` (derived from `id: "ReviewerState"`; not configurable this milestone).
- `routerFunctionName` = `${team}-${stage}-router-lambda` (derived from `id: "router"`).
- `reviewerFunctionName` = `${team}-${stage}-Reviewer-lambda` (derived from the future reviewer construct's `id: "Reviewer"`; sets the physical name the next milestone's `DurableLambdaFunction` must use).
- `reviewerAlias` = `"live"` (default if not provided).
- `reviewerFunctionArn` = `arn:aws:lambda:<region>:<account>:function:${team}-${stage}-Reviewer-lambda:<alias>` (derived from the convention).
- `reviewerArn` (for bot filtering) defaults to the derived alias ARN for synth safety. **Important uncertainty:** `CodeCommitEventFilterOptions.reviewerArn` uses `===` equality against each event's author ARN (`src/router/codecommit-event-normalizer.ts:47`). The author ARN CodeCommit actually records for inline comments posted by the future reviewer Lambda is empirically unknown — it depends on how CodeCommit attributes authors of SDK-initiated `PostCommentForPullRequest` calls (typically the role session ARN, not the alias ARN). Live-AWS validation is deferred to the next milestone (Task 8 fixture capture); until then, the stack sets `reviewerArn` from context if provided, else falls back to the derived alias ARN purely so synth is deterministic. Self-event filtering may be incomplete until the real actor ARN is captured and supplied via context.
- `botArnPatterns` = `[]` (default if not provided).

Required from context:

- `repositoryName` (string, non-empty)

Optional:

- `reviewerAlias` (string, default `"live"`)
- `reviewerArn` (string; defaults to the derived convention alias ARN when absent — used for both IAM bot filtering)
- `botArnPatterns` (string, comma-separated; default `""`)

`reviewerFunctionName` is NOT required from context — it is always derived from the `team`/`stage` + `id: "Reviewer"` convention so the router's invoke target, IAM scope, and bot-filter ARN stay aligned with whatever the next milestone's reviewer `DurableLambdaFunction` actually produces. The §2 wording “derives `reviewerArn` from the project name convention” is a leftover; this section is authoritative.

`team` and `stage` come from existing CDK context (see `cdk.json` `team`/`stage`). `projectName` is not used for naming; it remains only as a human-readable context value.

Validation: a Zod schema parses the context map and produces a typed `StackConfig` used through the stack. Invalid context fails synthesis with a clear Zod error.

## 7. IAM

### 7.1 Router role

- DynamoDB: `dynamodb-table.grantReadWrite(router)` (CRUD on the state table only).
- CodeCommit: `codecommit-review-events.grantRead(router)` (GetPullRequest, GetDifferences, GetCommentsForPullRequest, GetCommit, BatchGetCommits) and `grantConfigRead(router)` (GetFile). No `grantComment` this milestone.
- Lambda durable execution (inline policy against the future reviewer function):
  - `lambda:InvokeFunction` on the alias ARN `arn:aws:lambda:<region>:<account>:function:${team}-${stage}-Reviewer-lambda:${reviewerAlias}`
  - `lambda:ListDurableExecutionsByFunction` on the same alias ARN (matches Pawl's `grantReadDurableExecutions` helper, which uses `this.alias.functionArn`)
  - `lambda:GetDurableExecution` on `${reviewerFunctionArn}/durable-execution/*/*` (function-alias-ARN suffixed with `durable-execution/*/*`, matching Pawl's `grantReadDurableExecutions` helper at `packages/cdk/src/durable-lambda-function.ts`)
  - `lambda:SendDurableExecutionCallbackSuccess` on `"*"` (Lambda callback APIs accept only an opaque `CallbackId` and do not support resource-level IAM; this mirrors Pawl's existing `grantSendDurableExecutionCallbacks` helper at `packages/cdk/src/durable-lambda-function.ts`)

The exact IAM action names and ARN patterns are confirmed against the AWS SDK v3 `@aws-sdk/client-lambda` commands the existing `AwsLambdaTransport` invokes (`InvokeCommand`, `ListDurableExecutionsByFunctionCommand`, `GetDurableExecutionCommand`, `SendDurableExecutionCallbackSuccessCommand`). If the pinned SDK uses non-standard action names, the stack test must surface it and the spec updates to match.

When the next milestone instantiates the reviewer `DurableLambdaFunction`, the hand-written inline policy is replaced by Pawl's `grantInvokeDurable`/`grantReadDurableExecutions`/`grantSendDurableExecutionCallbacks` helpers to keep one IAM source of truth and avoid drift. This milestone's inline policy is intentional because the reviewer construct does not yet exist.

The exact durable-execution resource ARN follows Pawl's helper convention at `packages/cdk/src/durable-lambda-function.ts`: `${reviewerFunctionArn}/durable-execution/*/*` (a function-alias-ARN suffixed with `durable-execution/*/*`), not a service-relative `durable-execution:` ARN.

### 7.2 EventBridge

`CodeCommitReviewEvents` already creates the EventBridge rules, Lambda permissions, and DLQ. The construct grants invocation permission from EventBridge to the router Lambda. No additional EventBridge IAM is added.

### 7.3 cdk-nag

The construct test applies `AwsSolutionsChecks` and uses targeted `NagSuppressions` only where Pawl construct defaults already document suppressions. New suppressions introduced by this milestone's router inline policy are pre-listed here and must each cite a concrete reason:

- `AwsSolutions-IAM5` on the inline Lambda policy, for the `"*"` resource on `lambda:SendDurableExecutionCallbackSuccess` (Lambda callback APIs do not support resource-level IAM; Pawl's own `grantSendDurableExecutionCallbacks` helper uses the same `*` with the same reason).

`InvokeFunction`, `ListDurableExecutionsByFunction`, and `GetDurableExecution` use exact alias/version-derived ARNs (no wildcards), so they do not require `AwsSolutions-IAM5` suppressions.

The test asserts zero unsuppressed findings outside this explicit list.

## 8. Testing strategy

### 8.1 Handler unit test

`tests/unit/handlers/event-router-handler.test.ts`:

- Injects an in-memory state store, a fake `LambdaTransport`, and a fake `SourceControlProvider` into `buildEventRouter({ ... })`.
- Calls the handler with a synthetic native CodeCommit pull-request EventBridge event and asserts the router appended the event, called `lambda.send` with a `kind: "invoke"` command, and the handler returned successfully.
- Calls the handler with a reviewer-self comment event and asserts `routeCodeCommit` returns `undefined` and no `lambda.send` was invoked.
- Does not exercise real AWS clients.

### 8.2 CDK construct test

`tests/constructs/reviewer-stack.test.ts`:

- Uses `cdk.json` test context (`repositoryName = "test-repo"`; no `reviewerFunctionName` is supplied — it must be derived from the `team`/`stage` + `id: "Reviewer"` convention) supplied via `app.node.setContext` or a test `App` with context.
- Asserts the stack synthesizes exactly one DynamoDB table, one Lambda function (router), and one `CodeCommitReviewEvents` rule group (two native rules + DLQ).
- Asserts the router role's policies include the exact CodeCommit read actions + GetFile, scoped to the repository ARN.
- Asserts the router role's inline Lambda durable-execution policy has the invoke/list/status/callback actions against the derived reviewer function ARN pattern and the `"*"` callback resource.
- Asserts the router Lambda has the documented environment variables with the expected values.
- Asserts `AwsSolutionsChecks` passes with only the explicit suppressions pre-listed in §7.3.

### 8.3 Verification commands

- `rtk test bun test tests/unit/handlers tests/unit/event-router.test.ts tests/constructs/reviewer-stack.test.ts`
- `rtk tsc --noEmit`
- `rtk run 'PATH="$PWD/node_modules/.bin:$PATH" cdk synth'` (invokes the locally-pinned `aws-cdk` CLI rather than `bunx cdk synth`, so the resolver does not touch the workspace lockfile; uses the application's `cdk.json` context defaults for `reviewerAlias`, derived `reviewerArn`, empty `botArnPatterns`, plus required `repositoryName` from context)
- `rtk bun run lint`
- `rtk bun run fmt:check`
- `rtk bun install --frozen-lockfile`
- `rtk git diff --check`

`cdk synth` relies on local `esbuild` on `PATH` to bundle the router `NodejsFunction`. The verification command sets `PATH="$PWD/node_modules/.bin:$PATH"` before `cdk synth`. Docker is not required.

## 9. Acceptance criteria

1. `stacks/reviewer-stack.ts` instantiates `DynamoDbTable`, `LambdaFunction` (router), and `CodeCommitReviewEvents` from `@pawl/cdk`.
2. The router role has DynamoDB CRUD, CodeCommit read + config-read, and Lambda durable-execution invoke/list/status/callback IAM scoped to the future reviewer function ARN pattern.
3. The router role does not have CodeCommit comment permissions this milestone.
4. The stack reads `repositoryName` from CDK context and validates it with Zod; `reviewerFunctionName` is derived from `team`+`stage` + `id: "Reviewer"`; missing required `repositoryName` context fails synthesis.
5. `reviewerAlias` defaults to `"live"`, `reviewerArn` is derived from convention when absent, `botArnPatterns` defaults to empty.
6. `CodeCommitReviewEvents` targets the router Lambda and receives the existing DLQ/monitoring defaults.
7. `src/handlers/event-router-handler.ts` exports `buildEventRouter` (injectable) and `handler` (env-only composition root) and routes a native CodeCommit event through `EventRouter.routeCodeCommit`.
8. The handler unit test routes a synthetic event with injected fakes and rejects reviewer-self events without invoking Lambda.
9. `cdk synth` produces a CloudFormation template with exactly one state table, one router function, and the expected `CodeCommitReviewEvents` resources; synth uses local esbuild, not Docker.
10. `cdk-nag AwsSolutionsChecks` passes with documented suppressions only.
11. Existing unit tests (`event-router.test.ts`, `dynamodb-state-store.test.ts`, etc.) remain green; no regression in the 174-test baseline.
12. No Pawl library changes and no live AWS calls.
