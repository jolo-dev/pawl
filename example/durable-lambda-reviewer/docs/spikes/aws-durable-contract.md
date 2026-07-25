# AWS Lambda durable execution contract

## Pinned baseline

These packages require and target Node.js 22 or newer:

- `@aws/durable-execution-sdk-js` `2.1.0`
- `@aws/durable-execution-sdk-js-testing` `1.1.3`
- `@aws-sdk/client-lambda` `3.1089.0`

The local contract test was run with Bun 1.3.14; Task 2 did not verify execution under Node.js.

Runtime `2.1.0` is intentional: testing SDK `1.1.3` declares runtime peer support as `>=1.0.1 <=2.1.0`. Runtime `2.2.0` must wait for a compatible testing release rather than bypassing that peer contract.

## Locally package-verified contracts

The pinned runtime exports `withDurableExecution` and the `DurableContext` type. A wrapped typed handler can use:

- `context.step("load", operation)` for a durable step;
- `context.wait("debounce", { seconds: 1 })` for a named timer;
- `context.createCallback(...)` when callback creation and submission need to be separated;
- `context.waitForCallback<T>(name, submitter, { timeout })` to create, submit, and await a typed callback; and
- `context.executionContext.durableExecutionArn` to identify the active durable execution.

The Pawl contract test proves `step`, named `wait`, and `waitForCallback<string>` together. `LocalDurableTestRunner.setupTestEnvironment({ skipTime: true })` skips durable time locally; an operation can be awaited at `WaitingOperationStatus.SUBMITTED` and completed through `sendCallbackSuccess`. Environment setup is paired with teardown in `finally`, and the workflow returns `review:commit`.

The pinned Lambda client exposes these control-plane contracts:

- `InvokeCommand` accepts `DurableExecutionName` and returns `DurableExecutionArn` when a durable execution is started.
- `ListDurableExecutionsByFunctionCommand` accepts function, qualifier, durable name, and status filters. The router can use this lookup after an uncertain start response to recover the already-started execution instead of blindly creating another.
- `GetDurableExecutionCommand` accepts the durable execution ARN and returns execution status. The application can use that status when deciding whether a stale local lease is recoverable.
- `SendDurableExecutionCallbackSuccessCommand` accepts the callback ID and result bytes. JSON callback values must be serialized and UTF-8 encoded, for example with `new TextEncoder().encode(JSON.stringify(value))`.
- `StopDurableExecutionCommand` accepts the durable execution ARN for an explicit stop request.

The package declarations and documentation also establish these design constraints:

- A durable execution name is unique within a function. Reusing a name with the same payload recovers the existing execution; a different payload is rejected as already started.
- Callback IDs are capabilities with a bounded lifetime. They can expire or close, so callback delivery must treat those outcomes as terminal/recoverable state rather than retry forever.
- A successful callback result is bounded to 256 KB.
- Step semantics apply per retry attempt, not as global exactly-once delivery. Provider writes, including CodeCommit comments and state transitions, still require application-level idempotency keys and conditional writes.

## Not yet live-verified

Task 2 verifies installed public exports, TypeScript declarations, the local runner, callback completion, and local time skipping. It does **not** prove deployed AWS behavior, IAM permissions, service-side name collision behavior, uncertain network responses, callback expiry/closure responses, payload enforcement, status propagation, stop behavior, or replay timing. Task 8's opt-in AWS spike must exercise those live service behaviors before production rollout.
