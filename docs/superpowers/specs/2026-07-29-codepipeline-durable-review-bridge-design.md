# CodePipeline Durable Review Bridge Design

## Goal

Replace the invalid direct CodePipeline-to-durable-Lambda action with a non-durable bridge and an idempotent callback lifecycle. For PR-gated CodeCommit pipelines, CodePipeline must show a real `AIReview` action that remains pending until the matching durable review cycle completes.

The action succeeds when review processing completes, regardless of findings. It fails for operational errors, blocked limits, timeouts, or superseded revisions. A pull request merged or closed while review is still pending succeeds because review is no longer required.

## Scope

This design applies only when all of the following are true:

- the pipeline source is CodeCommit;
- `onPullRequest` is `true`;
- `autoReview` is configured; and
- a non-Source pipeline stage exists in which Pawl can inject `AIReview`.

Push-triggered auto-review remains independent of CodePipeline and does not receive an `AIReview` gate. S3 and GitHub pipeline sources remain out of scope.

## Root cause

The existing construct injects the durable reviewer directly through CDK's `LambdaInvokeAction`. That cannot work:

1. CodePipeline's Lambda action configuration rejects a function ARN and requires a function name.
2. AWS durable Lambda invocation requires a qualified version or alias ARN; `$LATEST` is not a supported durable target.
3. CodePipeline sends a `CodePipeline.job` envelope, while the reviewer expects a Pawl `ReviewerEvent`.
4. The reviewer does not currently call `PutJobSuccessResult` or `PutJobFailureResult`.

There is no target string or proxy override that satisfies these incompatible contracts. The bridge separates the CodePipeline action contract from durable invocation.

## High-level architecture

```text
CodeCommit PR event
        |
        v
EventBridge -> Router Lambda
                 |-- refetch authoritative PR
                 |-- append/start/wake durable reviewer
                 |-- start pipeline for exact commit with Pawl variables
                 `-- store execution -> PR/revision mapping

CodePipeline: Source -> Build + AIReview -> Approve/Deploy
                              |
                              v
                    Bridge Lambda (ordinary)
                              |
                              `-- register CodePipeline job immediately

Durable reviewer completes exact revision cycle
        |
        `-- persist outcome and kick reconciler

Static one-minute EventBridge rule -----------|
                                              v
                                    Reconciler Lambda
                                              |
                              PutJobSuccessResult / PutJobFailureResult
```

The router starts the pipeline and reviewer from the same authoritative PR revision. The bridge does not start a second reviewer execution. CodePipeline variables carry the immutable PR identity into sanitized Lambda action user parameters, so the bridge never depends on a racy execution-mapping lookup to identify the review. A centralized reconciler is the only actor allowed to call CodePipeline job-result APIs.

## Components

### 1. Typed CodePipeline handler wrapper

Add a named `useCodePipelineHandler` export to `@pawl/lambda`, following the existing handler-factory pattern. It must:

- accept the CodePipeline Lambda action job envelope;
- provide Powertools Logger through the callback and configure Tracer internally through the existing factory;
- use metadata-only logging so artifact credentials and raw user parameters are never logged;
- expose before, after, and error hooks consistently with other handlers; and
- return `void`; CodePipeline completion is reported through the CodePipeline API, not the Lambda return value.

The wrapper does not change the existing handler-factory callback signature. Runtime parsing remains in the bridge through Zod; TypeScript declarations alone are not a trust boundary.

### 2. Pipeline variables and sanitized action parameters

The CodePipeline construct remains `PipelineType.V2` and declares these pipeline-level variables with inert defaults:

```text
PAWL_PROVIDER
PAWL_REPOSITORY
PAWL_REQUEST_ID
PAWL_GENERATION
PAWL_SOURCE_REVISION
PAWL_DESTINATION_REVISION
```

The router supplies all six values through `StartPipelineExecution.variables`. Values are validated before the call and must be non-empty.

The injected `AIReview` action receives a CDK-owned `userParameters` object containing only:

```text
pipelineExecutionId: #{codepipeline.PipelineExecutionId}
pipelineName: <static pipeline name>
stageName: <static injected stage name>
actionName: AIReview
provider: #{variables.PAWL_PROVIDER}
repository: #{variables.PAWL_REPOSITORY}
requestId: #{variables.PAWL_REQUEST_ID}
generation: #{variables.PAWL_GENERATION}
sourceRevision: #{variables.PAWL_SOURCE_REVISION}
destinationRevision: #{variables.PAWL_DESTINATION_REVISION}
```

CodePipeline serializes this object into `CodePipeline.job.data.actionConfiguration.configuration.UserParameters`. The bridge Zod-parses the JSON string and allowlists exactly these fields. The raw user-parameter string is never logged or stored.

This makes the job self-identifying even if the separate pipeline-execution mapping write is delayed. The execution mapping remains useful for execution-state events and PR result comments, but it is not a bridge prerequisite.

### 3. Pipeline bridge Lambda

Create an ordinary Pawl `LambdaFunction` bundled from a dedicated bridge handler. The bridge must:

1. Extract and Zod-validate the job ID first.
2. Zod-parse the minimum outer `CodePipeline.job` envelope.
3. Parse and validate the sanitized user parameters defined above.
4. Persist an idempotent `PENDING` job record immediately with exact request/generation/revision identity, deadline, and retry metadata.
5. Invoke the centralized reconciler asynchronously.
6. Return without calling `PutJob*` directly.

If full parsing fails but a valid job ID is available, the bridge persists a `PENDING` job containing an immutable `ConfigurationError` callback candidate and invokes the reconciler. That failure record does not need PR identity. If no valid job ID can be extracted, the bridge throws and lets the Lambda action surface an invocation failure.

The bridge must never persist temporary artifact credentials, artifact URLs, prompt content, diffs, comments, raw user parameters, or raw event bodies.

### 4. Pipeline start and execution mapping

Replace the deployed router placeholders with production adapters:

- a CodePipeline transport backed by `@aws-sdk/client-codepipeline`;
- a DynamoDB execution mapping/job/outcome store backed by the existing state table; and
- the existing CodeCommit provider for result comments where required.

For request-opened, request-reopened, and revision-updated events in PR-gated mode, the router must refetch the authoritative CodeCommit PR before starting anything. It rejects stale or out-of-order events when:

- the PR is already merged or closed;
- the event revision is older than the provider's current source revision; or
- persisted generation/revision state has already advanced.

The router starts CodePipeline for the exact source commit and persists the execution mapping as soon as `StartPipelineExecution` returns. Human-comment events wake the reviewer but do not start a new pipeline execution.

`StartPipelineExecution` must use:

```text
clientRequestToken: deterministic SHA-256-derived token for request + generation + source revision
variables: the six PAWL_* values declared by the pipeline
sourceRevisions:
  - actionName: Source
    revisionType: COMMIT_ID
    revisionValue: <authoritative source commit>
```

The token must satisfy CodePipeline length and character limits. The current source action is statically named `Source`; if Pawl later permits configurable source action names, this value must come from the synthesized action definition rather than remain hard-coded.

A conditional request/revision idempotency item ensures duplicate EventBridge delivery returns the same semantic execution instead of starting another pipeline.

### 5. Review cycle observer

Add an optional, port-based cycle observer to the core reviewer workflow. The workflow reports a sanitized cycle outcome after feedback and reconciliation, before `waitForCallback`:

- request key;
- generation;
- source revision;
- cycle number;
- review status (`reviewed` or `blocked`);
- check-runner status; and
- timestamp.

The workflow must not import CodePipeline SDK types. Event-only reviewers use a no-op observer.

Outcome policy:

- `reviewed` with completed checks: success, regardless of findings;
- blocked limit: failure;
- terminal CodeBuild/check infrastructure failure: failure for the pipeline gate, even if PR feedback can still be posted;
- reviewer, Bedrock, or state-store exception: failure;
- merged or closed request while no callback intent has been claimed: success;
- empty wake: no outcome and no unrelated job completion.

The first gating outcome for a request generation and source revision is immutable. Later human-comment cycles on the same revision do not change an already completed pipeline action. Reopening the same commit creates a new generation and cannot consume an old outcome.

The deployed reviewer handler catches terminal workflow errors, records a sanitized failure outcome for the matching request/generation/revision when known, invokes the reconciler, and rethrows so the durable execution still reflects failure.

### 6. DynamoDB coordination model

Use dedicated items in the existing state table instead of overloading request lifecycle metadata. Extend `DynamoDbTable` with Zod-validated global secondary-index definitions so the reviewer state table can add the two indexes below.

#### Pipeline execution mapping

```text
PK: PIPELINE_EXECUTION#<pipelineExecutionId>
SK: META
```

Fields include pipeline name, repository, PR ID, request generation, source commit, destination commit, creation time, and TTL.

A request/revision idempotency item maps request + generation + source revision to the pipeline execution ID and prevents duplicate starts.

#### Pipeline job

```text
PK: PIPELINE_JOB#<jobId>
SK: META
```

Fields include pipeline/action/execution identifiers, request identity when valid, generation, source revision, deadline, callback candidate, immutable terminal intent, completion lease, attempt count, next-action time, timestamps, and TTL.

State transitions:

```text
PENDING -> COMPLETING -> SUCCEEDED
                      -> FAILED
```

Both normal outcomes and preselected callback candidates such as `ConfigurationError`, `Superseded`, `TimedOut`, or terminal-request success may conditionally claim `PENDING -> COMPLETING`. PR mapping is not required once a job ID and callback candidate are known.

`COMPLETING` has a bounded lease. An expired lease may be reclaimed only with the same immutable terminal intent.

#### Review outcome

```text
PK: REVIEW_OUTCOME#<provider>#<repository>#<requestId>#GEN#<generation>
SK: REVISION#<sourceRevision>
```

Fields include cycle, status, check status, sanitized summary, creation time, and TTL. The first outcome write for a generation/revision uses `attribute_not_exists` and is immutable.

#### Actionable-state index

```text
GSI1PK: PIPELINE_JOB_STATE#<PENDING|COMPLETING>
GSI1SK: <nextActionAt>#<jobId>
```

The reconciler queries each actionable state up to the current time. Terminal jobs remove the actionable-state index attributes.

#### Request-scoped index

```text
GSI2PK: REQUEST#<provider>#<repository>#<requestId>#GEN#<generation>
GSI2SK: REVISION#<sourceRevision>#JOB#<jobId>
```

This supports paginated supersession, merged/closed completion, and request-wide failure without table scans. Valid bridge jobs receive these index attributes in their initial write. Configuration-error jobs without valid PR identity remain discoverable through the actionable-state index.

### 7. Intent selection and precedence

The reconciler is the only component that promotes a callback candidate to immutable `terminalIntent`. It chooses in this order:

1. **Existing terminal intent:** always wins and is never overwritten.
2. **Superseded revision:** failure, honoring the policy that older executions fail when a newer authoritative revision exists.
3. **Recorded review outcome:** reviewed/completed checks succeeds; blocked or operational outcome fails.
4. **Merged/closed request:** success only while the job is still `PENDING` and no earlier candidate has been claimed.
5. **Expired deadline:** failure with `TimedOut`.
6. **No candidate yet:** remain `PENDING` and set the next reconciliation time.

A merge or close never rewrites `COMPLETING`, never replaces an existing intent, and never sends the opposite callback after a failure attempt has begun. “Merged/closed succeeds” therefore applies only to a genuinely pending review whose outcome or supersession has not already been selected.

Malformed-payload `ConfigurationError` is a preselected callback candidate and may move directly from `PENDING` to `COMPLETING` without PR identity.

### 8. Central reconciler and completion protocol

Create an ordinary reconciler Lambda. It is invoked by:

- the bridge after registration;
- the router after mapping, supersession, merge, or close;
- the reviewer after recording an outcome; and
- a static EventBridge rule every minute.

The reconciler is the only actor with `PutJobSuccessResult` and `PutJobFailureResult` permissions.

For each due job:

1. Evaluate candidate precedence while state is `PENDING`.
2. Conditionally claim `PENDING -> COMPLETING`, storing immutable terminal intent, lease expiry, and next retry time.
3. If no candidate exists, advance `nextActionAt` without changing state.
4. For expired `COMPLETING`, reclaim the lease with the existing intent only.
5. Call `PutJobSuccessResult` or `PutJobFailureResult`.
6. Persist `COMPLETING -> SUCCEEDED|FAILED` and remove actionable-index attributes.

AWS API calls and DynamoDB updates cannot share a transaction. If a Lambda crashes:

- before callback: the completion lease expires and the scheduled reconciler retries;
- after a successful callback but before terminal persistence: retry receives an already-completed or invalid-job response, treated as terminal confirmation of the stored intent;
- after an ambiguous callback response: retry always reuses the stored intent.

A success and failure callback can never race to opposite outcomes. Retry uses bounded exponential backoff by updating `nextActionAt`; the one-minute rule provides durable redrive until terminal state or the native CodePipeline job becomes unavailable.

Failure details sent to CodePipeline are bounded and sanitized. Allowed categories include `ConfigurationError`, `ReviewBlocked`, `ReviewFailed`, `Superseded`, and `TimedOut`. They must not include prompts, source code, comments, artifact credentials, raw user parameters, or raw model output.

### 9. Supersession and terminal PR behavior

When an authoritative new source revision starts:

- the router queries the request-scoped index with pagination;
- `PENDING` jobs for older revisions receive a `Superseded` callback candidate;
- `COMPLETING` jobs retain their existing immutable intent; and
- the reconciler is invoked.

A delayed old revision event cannot supersede a newer execution because the router refetches the provider and conditionally advances persisted request/revision state.

When a PR is merged or closed:

- no new pipeline execution starts;
- `PENDING` jobs for that request generation receive a terminal-request success candidate only if no higher-precedence candidate exists;
- `COMPLETING` jobs are not modified;
- the reconciler is invoked; and
- the existing durable callback lifecycle remains responsible for ending the reviewer execution.

Registration racing with merge or close is safe because the bridge carries request identity directly. The first reconciliation checks authoritative request lifecycle state and applies the precedence rules.

### 10. Configurable timeout and durable redrive

CodePipeline Lambda actions have a fixed 24-hour timeout and do not support `TimeoutInMinutes`. Pawl implements an earlier configurable deadline in job state.

Add `reviewActionTimeoutMinutes` to `CodePipelineProps`:

- default: `60`;
- integer minimum: `5`;
- integer maximum: `1380` (23 hours, leaving service-side margin before CodePipeline's fixed 24-hour timeout);
- valid only for PR-gated auto-review.

The CDK construct creates one EventBridge rule with a one-minute rate targeting the reconciler Lambda. No dynamic schedules are created. This avoids orphan schedules, scheduler client-token races, and `iam:PassRole`.

The reconciler queries due `PENDING` and `COMPLETING` jobs. A due deadline becomes `TimedOut` only if no higher-precedence candidate exists; an expired completion lease retries its existing intent. Job TTL is longer than the deadline and exists only for eventual cleanup, never as a timing mechanism.

### 11. CDK action wiring

Remove the proxy and every attempt to place a durable ARN or `$LATEST` in CodePipeline's `FunctionName` configuration.

For PR-gated auto-review, inject an `AIReview` `LambdaInvokeAction` targeting the ordinary bridge Lambda by function name. Add the sanitized `userParameters` object with pipeline and Pawl variable references. The bridge action receives the source artifact for CodePipeline context only; temporary artifact credentials are neither stored nor passed to durable execution.

The bridge, reconciler, router, reviewer, state table, and scheduled rule use Pawl constructs where public abstractions exist. Public consumer stack code continues importing from `@pawl/cdk` only.

Push-triggered auto-review creates no bridge action.

### 12. IAM matrix

| Actor | Required permissions | Scope |
|---|---|---|
| Pipeline action role | Invoke bridge Lambda | Bridge function ARN through CDK grant |
| Bridge Lambda | Write job records; invoke reconciler | State table ARN/indexes; reconciler ARN |
| Router Lambda | Start/read this pipeline; read/write execution mappings and request candidates; invoke reconciler | Pipeline ARN; state table ARN/indexes; reconciler ARN |
| Reviewer Lambda | Read/write outcomes/request state; invoke reconciler | State table ARN/indexes; reconciler ARN |
| Reconciler Lambda | Read/write jobs/mappings/outcomes; `PutJobSuccessResult`; `PutJobFailureResult` | State table ARN/indexes; CodePipeline callback APIs require `*` because job IDs are opaque |
| EventBridge rule | Invoke reconciler | Reconciler function ARN |

The callback wildcard receives a documented `AwsSolutions-IAM5` suppression explaining that CodePipeline job-result APIs accept an opaque job ID and do not support resource-level IAM permissions. No actor needs `iam:PassRole` or EventBridge Scheduler data-plane permissions.

### 13. Dependencies

With explicit user approval, move `@aws-sdk/client-codepipeline` from `packages/cdk` dev dependencies to runtime dependencies.

The revised static-rule design does not require the separately approved `@aws-sdk/client-scheduler`; do not add it. No other dependency additions are permitted by this design.

## Error handling

- Invalid bridge payload with valid job ID: persist a `ConfigurationError` candidate, invoke reconciler, and return.
- Invalid payload without job ID: throw so Lambda invocation failure is visible to CodePipeline.
- DynamoDB conditional conflict: reload state and reconcile idempotently.
- CodePipeline callback throttling or transient failure: preserve intent, allow the completion lease to expire, and retry with bounded exponential backoff.
- Expired or already-completed CodePipeline job: mark local state terminal with the stored intent and stop retrying.
- Reviewer exception: record failure outcome, invoke reconciler, then preserve the original reviewer failure.
- Reconciler batch failure: process jobs independently; one bad job must not prevent later jobs in the query page from being attempted.

## Public API changes

```ts
export interface CodePipelineProps {
  // existing properties...
  readonly reviewActionTimeoutMinutes?: number;
}
```

`@pawl/lambda` adds the named `useCodePipelineHandler` export and its public event/result types as needed.

`DynamoDbTableProps` gains optional Zod-validated global secondary-index definitions required by the coordination indexes.

All new runtime payloads and configuration values use Zod schemas. No `any` is introduced.

## Testing

### Unit tests

- `useCodePipelineHandler` metadata projection excludes credentials and raw user parameters.
- Bridge schema accepts documented CodePipeline envelopes and the CDK-owned sanitized user parameters.
- Pipeline execution ID and PR identity are resolved from user parameters, not assumed outer-envelope fields.
- Bridge persists only approved metadata.
- Invalid payload with a job ID reaches `PutJobFailureResult`; missing job ID throws.
- Execution mapping and pipeline start are idempotent by request, generation, and source revision.
- Start request contains exact source override, deterministic token, and all six pipeline variables.
- Authoritative provider state rejects stale revision events and starts after merge/close.
- Outcome-before-job and job-before-outcome both complete exactly once.
- Duplicate bridge invocation and duplicate outcome writes are idempotent.
- Findings do not fail a reviewed outcome.
- Blocked limits and operational/check failures fail.
- Merged/closed PRs succeed genuinely pending jobs but never overwrite an existing or completing intent.
- New revisions fail older pending jobs as superseded; delayed old events cannot supersede newer jobs.
- Reopen with the same commit uses a new generation and cannot consume a stale outcome.
- Request-wide reconciliation paginates.
- Timeout claims only pending jobs without a higher-precedence candidate.
- Empty reviewer wakes do not complete jobs.
- Crash after `COMPLETING` claim is recovered after lease expiry.
- Crash after successful callback but before terminal persistence treats repeated invalid/already-completed response as confirmation.
- Ambiguous callback retries reuse the immutable intent.
- Reconciler continues after one job fails.

### CDK tests

- Pipeline declares the six Pawl variables.
- `AIReview` targets the ordinary bridge Lambda by function name.
- `AIReview` user parameters contain the execution ID and Pawl variable references only.
- No durable ARN or `$LATEST` appears in pipeline action configuration.
- Push-triggered mode does not inject the gate.
- Bridge/reconciler Lambdas, one-minute EventBridge rule, environment, state-table GSIs, and least-privilege policies synthesize.
- Timeout validation accepts 5–1380, rejects invalid modes and ranges, and defaults to 60.
- `PutJob*` wildcard suppression is present and specifically documented.
- Router, reviewer, bridge, and reconciler grants match the IAM matrix.
- Existing cdk-nag checks pass with documented suppressions only where AWS APIs cannot be resource-scoped.

### Integration tests

Using the existing LocalStack setup where supported:

- deploy the pipeline and verify bridge action and user-parameter configuration;
- invoke the bridge with a realistic CodePipeline job envelope and expanded Pawl parameters;
- verify job/outcome persistence and idempotent reconciliation;
- exercise supersession, merge/close precedence, timeout, and completion-lease recovery;
- verify callback commands through a fake or supported CodePipeline endpoint;
- isolate LocalStack limitations instead of weakening assertions.

A real-AWS end-to-end verification remains required for the complete lifecycle: PR revision event, exact-revision pipeline start with variables, bridge registration, durable cycle outcome, CodePipeline callback, supersession, timeout, and merged/closed behavior.

## Non-goals

- Gating push-triggered pipelines that cannot be reliably mapped to a PR.
- Failing a pipeline because the reviewer posted findings.
- Passing CodePipeline artifact credentials to durable execution.
- Replacing the existing durable PR event loop.
- Implementing S3/GitHub source mapping.
- General-purpose CodePipeline orchestration outside the auto-review use case.
