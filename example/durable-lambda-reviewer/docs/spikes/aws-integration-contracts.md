# Live AWS integration contracts

## Capture status

**DONE_WITH_CONCERNS — captured 2026-07-17 and completed 2026-07-18.** CodeCommit, CodeBuild, Bedrock Converse, and the core durable Lambda start/callback/status contract were exercised against live AWS services. The exact Bedrock least-privilege resource set was successfully retested under constrained assumed-role credentials. Durable duplicate and stale-callback behavior was observed, with invocation-mode and short-timeout limitations recorded below.

This spike records observed behavior only. The JSON files under `tests/aws/fixtures` are sanitized evidence, not invented mocks.

## Disposable environment

- AWS CLI profile used for commands: `jolo`
- Development-account alias returned by IAM: `jolo-dev`
- Region: `eu-central-1`
- Repository: `durable-reviewer-contract-20260717`
- Base branch: `main`
- Data: synthetic and non-personal
- Event capture: a temporary EventBridge rule targeting a bounded SQS queue
- Completion resources: `durable-reviewer-contract-completion-20260718` prefix

The repository and all completion-prefixed resources were dedicated disposable spike resources in the `jolo-dev` development account. This does not establish that the CLI profile itself is exclusive to testing. No credential, account number, real AWS resource identifier, source body, or comment body is committed. Identifiers use explicit angle-bracket placeholders.

## CodeCommit

### Native events

The run created a pull request, posted a top-level pull-request comment, replied to that comment, pushed a new source commit, closed that request, then created and fast-forward merged a second request. Twenty-seven native CodeCommit EventBridge envelopes were drained from the bounded queue before cleanup. Selected complete envelope shapes are retained in:

- `tests/aws/fixtures/codecommit/native-comment-events.json`
- `tests/aws/fixtures/codecommit/native-pull-request-events.json`

Observed native event details:

| Action               | EventBridge detail type                | `detail.event`                   | Result                    |
| -------------------- | -------------------------------------- | -------------------------------- | ------------------------- |
| Create pull request  | `CodeCommit Pull Request State Change` | `pullRequestCreated`             | observed twice            |
| Top-level PR comment | `CodeCommit Comment on Pull Request`   | `commentOnPullRequestCreated`    | observed                  |
| Reply to PR comment  | `CodeCommit Comment on Pull Request`   | `commentOnPullRequestCreated`    | observed with `inReplyTo` |
| Push source commit   | `CodeCommit Pull Request State Change` | `pullRequestSourceBranchUpdated` | observed                  |
| Close request        | `CodeCommit Pull Request State Change` | `pullRequestStatusChanged`       | observed                  |
| Merge request        | `CodeCommit Pull Request State Change` | `pullRequestMergeStatusUpdated`  | observed                  |
| Update comment       | `CodeCommit Comment on Pull Request`   | `commentOnPullRequestUpdated`    | observed twice            |

**Conclusion:** native `onCommentOnPullRequest`-equivalent EventBridge coverage includes both top-level comments and replies. A reply is distinguished by `detail.inReplyTo`. CloudTrail fallback is not recommended for this contract; native coverage was complete for both cases.

### Inline locations

`filePosition` was one-based. A zero value produced `InvalidFilePositionException`. The complete accepted/rejected matrix and service error text are in `tests/aws/fixtures/codecommit/inline-location-contract.json`.

Observed path and side rules:

- Added file: new path with `AFTER` was accepted.
- Modified file: the same path was accepted with both `BEFORE` and `AFTER`.
- Deleted file: old path with `BEFORE` was accepted; `AFTER` produced `InvalidRelativeFileVersionEnumException` because the file does not exist on that side.
- Renamed file: old path with `BEFORE` and new path with `AFTER` were accepted. The inverse path/side combinations produced `InvalidRelativeFileVersionEnumException`.
- Empty result: position 1 with `AFTER` was accepted even though the resulting file was empty.
- Binary result: position 1 with `AFTER` was accepted by the API. This proves API acceptance only, not meaningful text rendering.
- EOF change: position 2 was accepted on the no-final-newline `BEFORE` side; position 3 was accepted for the appended line on `AFTER`; position 4 was also accepted where the resulting file ended with a newline. The run did not establish a general upper-bound rule beyond this trailing-newline case.

Adapters should retain both path and `BEFORE`/`AFTER`; a path alone is insufficient for deleted and renamed files.

### Idempotency and concurrent updates

`tests/aws/fixtures/codecommit/comment-mutation-contract.json` records:

- Repeating the identical `PostCommentForPullRequest` request with the same client token returned the same comment identifier.
- Reusing that token with changed content failed with `IdempotencyParameterMismatchException`.
- Two concurrent `UpdateComment` requests both succeeded.
- The final read contained the second-launched request's value.
- `UpdateComment` exposed no revision or precondition input, so the observed behavior was last-successful-write-wins rather than optimistic concurrency.

The fixture redacts all comment values.

## CodeBuild exact-commit build

The disposable project was started with `sourceVersion` set to the full source commit identifier. After `StartBuild` returned, the source branch was advanced to a different commit while the build was still nonterminal (`PROVISIONING`). The build completed `SUCCEEDED`, and final `resolvedSourceVersion` exactly equaled the originally requested full commit, not the moved branch head.

`tests/aws/fixtures/codebuild/exact-source-version-contract.json` retains the sanitized start, in-progress, final, and comparison evidence.

The successful CodeBuild service role granted exactly:

- `codecommit:GitPull` on the disposable repository resource;
- `logs:CreateLogStream` and `logs:PutLogEvents` on the disposable project's log streams.

The log group was pre-created by the capture principal, so the service role did not need `logs:CreateLogGroup`. The build had no artifact store. This is the actual policy under which the successful build ran; it is not a claim about permissions required to provision or delete the temporary infrastructure.

## Bedrock Converse

Live discovery returned the active system-defined inference profile `eu.anthropic.claude-sonnet-4-6` in `eu-central-1`. `GetInferenceProfile` returned six destination foundation-model resources, in:

- `eu-central-1`
- `eu-north-1`
- `eu-south-1`
- `eu-south-2`
- `eu-west-1`
- `eu-west-3`

A no-tools Converse request with an innocuous prompt succeeded through that exact profile. The response was `CONTRACT_OK` with `stopReason: end_turn`; see:

- `tests/aws/fixtures/bedrock/sonnet-inference-profile.json`
- `tests/aws/fixtures/bedrock/converse-response.json`

### Least-privilege result

The constrained verification role was granted only `bedrock:InvokeModel` on the inference-profile resource. Converse failed with `AccessDeniedException` for an underlying foundation-model resource, proving that the profile resource alone is insufficient.

The completion run rediscovered the active profile and all six underlying model resources. A fresh disposable role was then granted exactly `bedrock:InvokeModel` on the profile resource plus those six returned resources. After bounded IAM propagation, assumed-role Converse succeeded on attempt 2 and returned `CONTRACT_OK` with `stopReason: end_turn`. No tools were supplied. The sanitized constrained-role success is retained in `tests/aws/fixtures/bedrock/least-privilege-validation.json`.

Therefore the verified resource contract is the inference-profile resource **and** every foundation-model resource freshly returned by `GetInferenceProfile`. Do not replace the explicit discovered profile with a remembered or symbolic model identifier.

## Durable Lambda

A minimal Node.js 22 function using `@aws/durable-execution-sdk-js` `2.1.0` was deployed with durable configuration, published as a numbered version, and invoked through alias `live`. The function created a callback and returned the callback result. Callback identifiers were transferred through a bounded disposable SQS helper because CloudWatch delivery was not prompt enough for callback submission.

Sanitized structured response shapes and outcomes are retained in `tests/aws/fixtures/durable/durable-execution-contract.json`. That fixture is the reviewable evidence artifact; the bullets below are interpretation and operational notes rather than a substitute for structured evidence.

Observed live contract:

- An asynchronous Invoke (`InvocationType: Event`) with `DurableExecutionName` returned HTTP status 202 and a durable execution resource identifier.
- `GetDurableExecution` reported `RUNNING` before callback completion.
- `SendDurableExecutionCallbackSuccess` accepted UTF-8 bytes containing JSON.
- The execution reached terminal `SUCCEEDED`.
- The terminal `Result` was a JSON string. Decoding it produced an object with a string tag and a `callbackResult` string; that nested string contained JSON followed by a newline. The durable fixture substitutes safe values while preserving that exact string nesting and encoding.
- The retained `GetDurableExecution` responses establish status querying. A `ListDurableExecutionsByFunction` response was not retained, so the fixture marks that operation unverified rather than inventing a response shape.
- Reinvoking the same durable name with the same payload returned the same execution identifier.
- A changed-payload RequestResponse invocation for an existing name returned `DurableExecutionAlreadyStartedException`.
- An asynchronous changed-payload invoke returned HTTP 202 before name/payload validation was observable, so callers that require synchronous conflict detection must not infer acceptance from that transport response alone.
- Sending callback success after callback closure returned `CallbackTimeoutException` with the message that the callback was timed out or already completed.

The execution role initially failed with `CheckpointUnrecoverableExecutionError` because `lambda:CheckpointDurableExecution` was absent. The corrected, successful role granted both `lambda:CheckpointDurableExecution` and `lambda:GetDurableExecutionState` on the disposable function/version execution resource pattern. It also held exact log-stream and helper-queue permissions needed by the capture implementation.

Limitation: callback timeout/closure was live-verified, but the dedicated five-second timeout branch was not completed after the orchestrator stopped further experimentation. The observed stale-callback error came from callbacks that had already closed during delayed RequestResponse attempts. Duplicate behavior was verified across the retained live attempts, while the fully successful callback path used asynchronous start.

## IAM boundaries observed

### Production runtime caller/application actions

These are separated from service-role and spike-provisioning permissions. The configured `jolo` profile was not constrained to a candidate production runtime policy, so a successful caller request proves the API action and request resource selection, but not IAM resource-policy enforcement unless noted.

| Integration                 | Caller/application actions and evidence                                                                                                                                                                                                                                                                                                                    | Resource-scoping observation                                                                                                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CodeCommit reads/comments   | `codecommit:PostCommentForPullRequest`, `codecommit:PostCommentReply`, `codecommit:UpdateComment`, `codecommit:GetComment`, and `codecommit:GetBranch` were exercised. Production adapter reads such as `GetPullRequest`, `GetDifferences`, `GetCommit`, and `GetCommentsForPullRequest` were not validated by a constrained runtime policy in this spike. | Repository-addressed calls used only the disposable repository. Comment-ID-only calls do not carry a repository identifier in their API input; this run did not prove whether their IAM policy must use a wildcard resource.                                            |
| CodeBuild start/status/logs | `codebuild:StartBuild` and `codebuild:BatchGetBuilds` were exercised by the caller. No production caller log-read action was established; build log writes belonged to the CodeBuild service role.                                                                                                                                                         | Requests selected the exact disposable project, but caller-side resource enforcement was not tested with a constrained policy.                                                                                                                                          |
| Durable Lambda control      | `lambda:InvokeFunction`, `lambda:GetDurableExecution`, and `lambda:SendDurableExecutionCallbackSuccess` were exercised. A `ListDurableExecutionsByFunction` response was not retained, and `lambda:StopDurableExecution` was cleanup-only rather than part of the successful workflow path.                                                                | Invoke selected the versioned alias and Get selected an execution resource. Callback submission accepts only an opaque callback ID. Because no constrained caller-policy matrix was run, this spike does **not** claim that callback submission requires `Resource: *`. |
| Bedrock                     | `bedrock:InvokeModel` through Converse was exercised under constrained assumed-role credentials.                                                                                                                                                                                                                                                           | Live enforcement proved that the exact inference-profile resource alone was insufficient and that the profile plus all six discovered foundation-model resources succeeded.                                                                                             |

### AWS service-role actions

- The successful CodeBuild service role used `codecommit:GitPull` on the exact disposable repository plus `logs:CreateLogStream` and `logs:PutLogEvents` on the exact project log streams. The log group was pre-created.
- The successful durable Lambda execution role used `lambda:CheckpointDurableExecution` and `lambda:GetDurableExecutionState` on the disposable function/version execution pattern, log-stream writes on the exact function log group, and `sqs:SendMessage` on the exact callback-capture queue.

These service-role actions are not caller/application permissions.

### Temporary capture, provisioning, and cleanup actions

The disposable spike additionally exercised temporary infrastructure actions, including:

- IAM role/trust/inline-policy create, update, inspect, and delete operations, `iam:PassRole`, and `sts:AssumeRole`;
- CodeCommit repository and pull-request lifecycle creation/deletion plus disposable Git push;
- EventBridge rule/target and SQS queue/policy/message lifecycle operations;
- CodeBuild project create/update/delete and CloudWatch log-group create/delete operations;
- Lambda function/configuration/code/version/alias create/update/delete operations and log filtering used only to capture evidence; and
- Bedrock model/profile discovery APIs.

Those actions were necessary to provision and remove the live spike. They are not evidence that a production reviewer runtime needs them. Resource-level enforcement was directly demonstrated only for the constrained Bedrock role and the two service roles described above.

## Cleanup

Sanitized structured absence responses from both cleanup passes are retained in `tests/aws/fixtures/cleanup/cleanup-validation.json`; the prose below summarizes that evidence.

A cleanup manifest was maintained from resource creation. Recovery cleanup used only exact prefixed names and performed these operations through RTK-wrapped AWS CLI commands:

1. Listed builds for `durable-reviewer-contract-20260717-build`, checked each exact build, and stopped any nonterminal build (both retained builds were already terminal when checked).
2. Removed target `capture`, deleted EventBridge rule `durable-reviewer-contract-20260717-events`, then deleted its exact SQS queue.
3. Deleted CodeBuild project `durable-reviewer-contract-20260717-build` and log group `/aws/codebuild/durable-reviewer-contract-20260717-build`.
4. Deleted inline policies and then roles `durable-reviewer-contract-20260717-codebuild` and `durable-reviewer-contract-20260717-bedrock`.
5. Looked up the exact Lambda function, role, and log group names; they were absent because that phase never started.
6. Deleted CodeCommit repository `durable-reviewer-contract-20260717` last.

Fresh exact-name verification then established:

- CodeBuild returned the project in `projectsNotFound`.
- Exact EventBridge rule and SQS queue lookups returned not found.
- Exact CodeBuild, Bedrock, and Lambda role lookups returned not found.
- Exact Lambda function lookup returned not found.
- Exact CodeBuild and Lambda log-group filters returned zero exact matches.
- Exact CodeCommit repository lookup returned not found.

No residual disposable AWS resource was found.

The 2026-07-18 completion run maintained a second cleanup manifest before creating resources. Cleanup checked every retained execution identifier for the exact completion function and stopped any nonterminal execution before deleting alias/function (thereby deleting published versions), deleted its exact log group and callback-capture queue, removed inline policies from the exact Lambda and Bedrock roles, and deleted both roles. Fresh exact/prefix checks then confirmed the completion function, both roles, log group, and queue were absent.

## Reproduction and sanitization notes

Representative command families used during capture were:

```text
rtk proxy aws codecommit create-pull-request ...
rtk proxy aws codecommit post-comment-for-pull-request ...
rtk proxy aws codecommit post-comment-reply ...
rtk proxy aws codecommit update-comment ...
rtk proxy aws sqs receive-message ...
rtk proxy aws codebuild start-build --source-version <full-commit-id> ...
rtk proxy aws codebuild batch-get-builds ...
rtk proxy aws bedrock get-inference-profile ...
rtk proxy aws bedrock-runtime converse ...
rtk proxy aws lambda invoke --invocation-type Event --durable-execution-name <name> ...
rtk proxy aws lambda get-durable-execution ...
rtk proxy aws lambda send-durable-execution-callback-success ...
```

Raw captures lived only under `/tmp/durable-reviewer-contract-20260717-raw` and `/tmp/durable-reviewer-contract-completion-20260718-raw`. Sanitization replaced account, resource, repository, pull-request, commit, comment, callback, execution, build, caller, and timestamp values; removed notification/comment bodies; and retained contract-relevant field names, enums, statuses, booleans, positions, regions, model identifier, and error classes. Temporary credentials used to assume the constrained Bedrock role existed only in process memory and were never written to a file. The raw temporary directories are not tracked.
