# Durable Code Reviewer Design

**Date:** 2026-07-17  
**Status:** User-approved design; pending written-spec review  
**Initial provider:** AWS CodeCommit  
**Future provider:** GitHub

## 1. Purpose

Build an AWS Lambda Durable Function that reviews pull or merge requests, posts comments only when high-confidence improvements are needed, and then waits for either a human comment or a new commit. A human comment becomes review context. A new commit causes the latest revision to be reviewed. When all reported findings have been addressed or dismissed through accepted review context, the reviewer updates its existing comments as resolved and completes without adding a success comment.

The first release supports multiple CodeCommit repositories in one AWS account and region. The review core remains provider-neutral so a GitHub adapter can be added later.

## 2. Confirmed product decisions

- Use a native AWS Lambda Durable Function rather than Step Functions or stateless invocations.
- Support AWS CodeCommit first; preserve a provider-neutral core.
- Combine deterministic JavaScript/TypeScript checks with semantic review through Amazon Bedrock.
- Use a configurable Bedrock model ID, defaulting to Claude Sonnet.
- Resume on any new human comment or new commit.
- Treat human comments as untrusted review context and instructions for the next review cycle.
- Post inline comments on changed lines; use a summary only for cross-cutting issues that cannot be attached to one line.
- Report only high-confidence correctness, security, reliability, and meaningful maintainability issues. Do not report cosmetic style issues.
- Read deterministic-check commands from `.pawl/reviewer.json` on the base branch, never from the proposed revision.
- Support JavaScript and TypeScript repositories with repository-defined commands.
- End when clean, merged, closed, or timed out. The timeout is configurable and defaults to 30 days.
- When findings are fixed, update the original comments as resolved instead of adding a success comment.
- Support multiple configured repositories in one AWS account and region.
- Use the local `../pawl` libraries. Missing reusable AWS abstractions must be implemented in Pawl first; application infrastructure must not bypass Pawl with raw CDK constructs.

## 3. Scope

### 3.1 In scope

- CodeCommit pull-request, source-revision, status, and comment event ingestion.
- One logical durable execution per open pull request.
- Deterministic checks in an isolated CodeBuild project.
- Bedrock semantic review of changed code.
- Inline actionable findings, deduplication, and resolved-comment updates.
- Wait and resume on human comments or new commits.
- Multiple repository registrations in one account and region.
- Provider-neutral review orchestration and domain models.
- Pawl CDK and Lambda abstractions required by the application; the application owns its CodeCommit runtime adapter.
- Unit, construct, workflow, and AWS integration tests.

### 3.2 Out of scope for the first release

- GitHub implementation; only its adapter boundary is designed.
- GitLab or other source-control providers.
- Multi-account or multi-region operation.
- Languages other than JavaScript and TypeScript.
- Automatic code changes, commits, or merges.
- Pull-request approval or rejection votes.
- A standalone web interface.
- Conversational replies that are unrelated to actionable review findings.
- Cosmetic formatting, naming, or preference comments.

## 4. Architecture

### 4.1 High-level flow

1. CodeCommit or CloudTrail emits a request, source revision, status, or comment event through EventBridge.
2. A conventional router Lambda normalizes and persists the event.
3. The router conditionally starts one durable execution for the request or signals its current callback.
4. The durable reviewer consumes persisted events, reviews the latest head revision, reconciles findings, and either completes or waits.
5. DynamoDB is the source of truth for events, execution state, callbacks, findings, and provider comment IDs.
6. CodeBuild runs deterministic checks. Bedrock returns schema-constrained semantic findings.

### 4.2 Components

#### Event router

A normal EventBridge handler that:

- Converts provider events to a common event model.
- Rejects reviewer-generated comments and configured bot identities.
- Deduplicates provider events.
- Stores events before attempting to wake an execution.
- Starts a durable execution through a conditional ownership operation when no active execution exists.
- Best-effort signals the active callback when the execution is waiting.

#### Durable review orchestrator

A thin orchestration loop that:

- Claims unconsumed events.
- Coalesces multiple commit events to the latest head revision.
- Loads unconsumed human comments as context.
- Checks request status.
- Invokes replay-safe steps for configuration, deterministic checks, diff retrieval, Bedrock review, and finding reconciliation.
- Registers a callback and waits while actionable findings remain.
- Completes when clean, merged, closed, or timed out.

Business logic is delegated to independently testable services; the durable handler does not contain provider-specific API logic.

#### Source-control provider

A provider-neutral interface with operations equivalent to:

```ts
interface SourceControlProvider {
  getRequest(ref: RequestRef): Promise<ReviewRequest>;
  getDiff(ref: RequestRef, revisions: RevisionRange): Promise<ChangedFile[]>;
  getFile(ref: RequestRef, revision: string, path: string): Promise<string | undefined>;
  listComments(ref: RequestRef, after?: EventWatermark): Promise<ReviewComment[]>;
  postInlineFinding(ref: RequestRef, finding: Finding): Promise<PostedComment>;
  postSummaryFinding(ref: RequestRef, finding: Finding): Promise<PostedComment>;
  markCommentResolved(
    ref: RequestRef,
    comment: PostedComment,
    resolution: Resolution,
  ): Promise<void>;
}
```

The first adapter delegates CodeCommit API operations to the app-local `CodeCommitReviewClient`. Future GitHub support implements the same application interface.

#### Check runner

- Resolves immutable source and destination commit IDs at the start of each review cycle.
- Reads `.pawl/reviewer.json` from that exact destination commit, not from the live target-branch reference.
- Validates the file with Zod and a versioned schema.
- Starts a restricted CodeBuild job against the exact source commit.
- Uses only commands obtained from the pinned destination commit.
- Returns normalized check results and bounded logs to the review engine.
- Distinguishes a check failure from a runner or AWS infrastructure failure.

#### Review engine

- Combines the changed-code diff, normalized deterministic results, repository guidance, and new human comments.
- Invokes the configured Bedrock model without agent tools.
- Requires structured JSON output.
- Applies category, confidence, scope, and evidence policy after model output validation.
- Returns findings; it does not post provider comments itself.

#### Finding reconciler

- Computes stable finding fingerprints from provider, repository, request, category, path, nearby code context, and normalized issue identity.
- Posts only findings not already represented by an open comment.
- Preserves existing open findings without duplicating comments.
- Updates prior comments when findings disappear after a commit or when a policy-validated, finding-linked human comment causes the model to withdraw the finding.
- Persists progress after each provider mutation so replay and partial failure are safe.

#### State store

A DynamoDB-backed transactional store for:

- Request lifecycle and active execution identity.
- Callback registration and generation.
- Deduplicated event inbox and consumption watermark.
- Review cycle, immutable source commit, and immutable destination commit.
- Finding status, linked human context, and provider comment IDs.
- Repository configuration version.
- Expiration and retention.

## 5. Pawl-first implementation boundaries

### 5.1 `@pawl/cdk`

Add reusable constructs when no equivalent currently exists:

- `DurableLambdaFunction`: durable execution configuration, execution timeout, retention, bundling, IAM, monitoring, and validation.
- `DynamoDbTable`: general state table, TTL, encryption, point-in-time recovery, alarms, and permission helpers.
- `CodeBuildProject`: bounded build environment, logs, timeout, encryption, networking options, and least-privilege IAM.
- `CodeCommitReviewEvents`: EventBridge rules for pull-request state, source updates, and human comment activity, including a CloudTrail-backed comment-event fallback.

Application stack code imports these constructs from `@pawl/cdk`; it does not instantiate raw `aws-cdk-lib` constructs.

### 5.2 `@pawl/lambda`

- Use the existing EventBridge handler wrapper for the router.
- Add `useDurableHandler` around the AWS Durable Execution SDK.
- The wrapper supplies typed input, replay-safe hooks, Powertools Logger/Tracer/Metrics, correlation fields, and explicit handling for replay behavior.

### 5.3 App-local CodeCommit runtime

The application owns a small runtime unit, `src/adapters/codecommit-review-client.ts`, that makes raw CodeCommit SDK calls through a `@aws-sdk/client-codecommit` dependency and exposes only app-owned types from `src/adapters/codecommit-review-types.ts`. It provides domain-oriented operations for:

- Pull-request metadata and revisions.
- Paginated differences and line locations.
- Comment retrieval and author identity.
- Inline and summary comment creation.
- Existing comment updates.

The client accepts an injected transport for contract tests and exposes app-owned DTOs to the provider. No runtime CodeCommit client is exported through `@pawl/cdk`.

## 6. Event and execution model

### 6.1 Normalized events

```ts
type ReviewEvent =
  | { type: "request-opened"; id: string; occurredAt: string }
  | { type: "revision-updated"; id: string; revision: string; occurredAt: string }
  | { type: "human-comment"; id: string; commentId: string; occurredAt: string }
  | { type: "request-merged"; id: string; occurredAt: string }
  | { type: "request-closed"; id: string; occurredAt: string };
```

Provider payloads are not stored as the application contract. The router preserves only bounded metadata needed for audit and re-fetches authoritative provider state during review.

### 6.2 Lifecycle states

- `STARTING`: ownership acquired; durable invocation is being created.
- `RUNNING`: an execution is consuming events or reviewing.
- `WAITING`: a callback is registered and actionable findings remain.
- `BLOCKED_LIMIT`: a hard review-size limit prevents a trustworthy result; existing findings remain unchanged while the execution waits for a new event or timeout.
- `COMPLETED`: no findings remain or the request ended.
- `TIMED_OUT`: repository timeout elapsed.
- `FAILED`: a permanent operational failure exhausted its retry policy.

A conditional write permits only one active execution for a provider/repository/request key. A stale `STARTING`, `RUNNING`, or `WAITING` lease can be recovered only after checking the durable execution status.

### 6.3 Race-free waiting

1. Every incoming event is persisted before a callback signal is attempted.
2. The durable execution consumes through an event watermark.
3. When it needs to wait, it registers the callback token and generation in state.
4. It checks the inbox once more after registration.
5. If an event is already pending, it avoids blocking or immediately self-signals.
6. If an event arrives afterward, the router sees the registered callback and signals it.
7. On wake, the execution reads the inbox; callback payloads are hints, not authoritative event data.

This protocol tolerates duplicate callback delivery, a stale token, router retry, and an event arriving during callback registration.

### 6.4 Coalescing

- Multiple source updates are reduced to the current provider head revision.
- All unconsumed human comments are preserved in chronological order as context.
- A short configurable debounce window coalesces bursts of human comments or pushes.
- Review identity includes the head revision and consumed-comment watermark.

## 7. Repository configuration

At the start of each review cycle, the service resolves the pull request's destination branch to an immutable destination commit and reads `.pawl/reviewer.json` from that exact commit. The cycle persists both destination and source commit IDs, so durable replay always uses the same configuration and code snapshot. If the destination branch later advances, a subsequent event starts a new cycle that resolves and persists the new destination commit. A proposed change cannot alter the commands used to review itself.

Example:

```json
{
  "version": 1,
  "checks": [
    { "name": "types", "command": "bunx tsc --noEmit", "timeoutSeconds": 300 },
    { "name": "tests", "command": "bun test", "timeoutSeconds": 600 }
  ],
  "install": {
    "command": "bun install --frozen-lockfile --ignore-scripts"
  },
  "review": {
    "timeoutDays": 30,
    "modelId": "configured-default",
    "maxChangedFiles": 100,
    "maxDiffBytes": 1000000
  }
}
```

The exact schema is versioned. Deployment configuration supplies defaults and an allowlist of permitted Bedrock model IDs. Every deployment resolves `configured-default` to one explicit model ID or inference-profile ARN; no symbolic model version is selected at runtime. The initial validation spike selects a currently supported Claude Sonnet model or inference profile. Repository configuration may narrow limits but cannot grant additional IAM or exceed service-wide limits.

## 8. Review policy

### 8.1 Allowed findings

A finding must be high confidence, supported by concrete changed-code evidence, and belong to one of:

- Correctness.
- Security.
- Reliability.
- Meaningful maintainability with a concrete future failure or material cost.

Performance may be reported only when it creates a correctness, reliability, or clearly material resource problem. Cosmetic style, naming preference, formatting, and speculative redesign are excluded.

### 8.2 Scope

Findings normally attach to an added or modified line. A cross-cutting summary finding is allowed only when the proposed change directly introduces the issue and no single changed line is an honest location.

### 8.3 Structured model output

Each candidate finding includes:

- Category and severity.
- Confidence.
- Path, side, and line or hunk identity.
- Concise problem statement.
- Concrete evidence and impact.
- Actionable recommendation.
- Optional minimal suggested replacement.

The application validates and filters model output. The model cannot directly call provider APIs or post comments.

### 8.4 Untrusted input

Diffs, source files, configuration prose, and comments are data, not system instructions. An eligible human author is an authenticated CodeCommit principal that is neither the configured reviewer identity nor a configured bot identity. Every eligible human comment resumes review and is available as general context.

A comment may participate in dismissing an existing finding only when it is linked to that finding by replying to the reviewer's provider comment or by referencing its stable finding marker. The model may recommend withdrawal only with the linked comment ID and a concrete rationale showing why the original evidence no longer establishes an issue. A deterministic policy validator verifies author eligibility, linkage, and output schema before the reconciler changes state. An unrelated comment can trigger review but cannot resolve a finding.

Human comments cannot:

- Change global review policy.
- Request credentials or hidden prompts.
- Enable tools.
- Expand IAM permissions.
- Select a non-allowlisted model.
- Disable service-wide safety or cost limits.

## 9. Comment behavior

### 9.1 New findings

- Post inline on the changed line when possible.
- Post one bounded summary comment only for cross-cutting findings.
- Include a stable reviewer marker in comment metadata/body for identity filtering and reconciliation.
- Do not post an approval or clean-result comment.

### 9.2 Existing findings

- Never repost an open finding with the same fingerprint.
- Refresh location metadata internally when surrounding lines move.
- If a materially different issue appears at the same location, use a new fingerprint.

### 9.3 Resolved findings

For CodeCommit, update the original comment while preserving its original content and prepend a concise status such as:

```text
✅ Resolved in abc1234
```

If a linked comment from an eligible human causes the model to withdraw the finding and the deterministic dismissal policy accepts that decision, use a distinct status such as `Resolved after reviewer context` and record the triggering comment ID and rationale. Do not add a separate resolution comment.

Merging or closing with unresolved findings ends execution but does not falsely mark those findings fixed.

## 10. Deterministic check isolation

- CodeBuild checks out the immutable source commit recorded for the review cycle.
- Commands and review policy come from the immutable destination commit recorded for that cycle.
- Builds run with no application secrets and a minimal role limited to source retrieval, logs, and required artifact storage.
- Dependency lifecycle scripts are disabled by default.
- Network access, package registries, compute size, disk, duration, and output size are constrained by deployment policy.
- Logs returned to the model are truncated and scrubbed.
- A non-zero configured check is review evidence.
- A CodeBuild service failure, timeout outside the configured command, or unavailable dependency service is an operational failure and must not become a code-review comment.

## 11. Error handling and idempotency

### 11.1 Retryable failures

AWS API throttling, transient provider errors, Bedrock throttling, and callback delivery failures use bounded exponential backoff with jitter. Durable steps use stable operation IDs so replay returns recorded results rather than repeating side effects.

### 11.2 Model failures

Malformed Bedrock output receives one constrained schema-repair attempt. Continued invalid output is an operational failure. It emits metrics and follows retry policy without posting a review comment.

### 11.3 Provider writes

Finding state transitions reserve a write before provider mutation and confirm it afterward. Recovery checks provider state using the reviewer marker before retrying an uncertain write. Progress is persisted after every successful comment mutation.

### 11.4 Configuration failures

Missing or invalid `.pawl/reviewer.json` follows deployment policy: either use safe service defaults or fail the review operationally. It never executes commands from the head revision as fallback and does not post a code-quality comment about service configuration.

### 11.5 Timeout

The default request lifecycle timeout is 30 days and may be reduced or increased within a service-wide maximum. Timeout closes active callback state, records `TIMED_OUT`, expires inbox data according to retention policy, and posts no comment.

### 11.6 Limit handling

Limits must never turn a partial review into a clean result:

- Diff and file limits are evaluated before reconciliation. The engine may chunk work within the configured total token budget. If changed-file count, diff bytes, or total model budget exceeds a hard repository or service limit, record `BLOCKED_LIMIT`, emit an operational metric/alert, preserve all existing finding states, post no new or resolved comments, and wait for a new commit/comment or lifecycle timeout.
- Per-model-call token limits are handled by deterministic diff chunking. Exceeding the total per-cycle token budget follows the same `BLOCKED_LIMIT` behavior.
- Build-duration limits are operational timeouts, not check findings.
- Cycle-per-hour limits pause through a durable timer until the rate window resets, then resume the same pending cycle.
- Comment-per-cycle limits persist approved-but-unposted findings and resume through a durable timer when the comment budget resets. The execution cannot declare the request clean while pending findings remain.

## 12. Security

- Scope IAM to configured repository ARNs, one state table, specific CodeBuild projects, log groups, and allowlisted Bedrock model resources.
- Encrypt DynamoDB, logs, and artifacts at rest with managed or configured KMS keys.
- Keep source contents and human comment bodies out of normal logs.
- Filter reviewer identity and configured bot identities to prevent loops.
- Validate all external identifiers and bound pagination.
- Do not pass AWS credentials or secrets into reviewed builds.
- Apply hard limits for changed files, diff bytes, build duration, model tokens, cycles per hour, and comments per cycle, with the non-clean limit behavior defined in Section 11.6.
- Use a non-agentic Bedrock invocation with no tools.
- Preserve an audit trail of event IDs, revisions, model ID, policy version, finding fingerprints, and provider write IDs without storing unrestricted prompt content.

## 13. Observability

Pawl monitoring produces a dashboard and alarms for:

- Router successes, failures, deduplications, and DLQ depth.
- Active, running, and waiting durable executions.
- Event-to-resume latency.
- Review cycle duration and outcome.
- CodeBuild check, infrastructure, and timeout outcomes.
- Bedrock latency, throttling, schema failures, token usage, and estimated cost.
- Findings posted, suppressed, deduplicated, and resolved.
- Callback failures and stale callback attempts.
- Executions approaching timeout.

Structured correlation fields include provider, account, region, repository, request ID, head revision, execution ID, cycle ID, and event watermark.

## 14. Testing strategy

### 14.1 Unit tests

- Event normalization, bot filtering, and deduplication.
- Configuration schema and limit enforcement.
- Finding schema, category/confidence policy, fingerprinting, and reconciliation.
- Comment resolution transitions.
- Prompt-injection boundaries and output rejection.
- Retry, timeout, and event-coalescing policies.

### 14.2 Pawl package tests

- CDK assertions for durable configuration, IAM, alarms, EventBridge rules, DynamoDB TTL/encryption, and CodeBuild isolation.
- `useDurableHandler` replay and Powertools behavior.
- App-local `CodeCommitReviewClient` contract tests with injected transport, pagination, line locations, author identity, and uncertain-write recovery.

### 14.3 Workflow tests

Use a deterministic fake provider, fake check runner, fake model, fake callback signaler, and in-memory state adapter to exercise the complete durable lifecycle. Include event/callback interleavings, replay, duplicate provider writes, partial comment batches, and timeout.

### 14.4 AWS integration tests

Deploy to a dedicated account and CodeCommit repository. Test native CodeCommit events and the CloudTrail comment-event fallback against real AWS behavior. Use deterministic model responses for routine integration tests where possible and run live Bedrock smoke tests separately to control cost. Do not rely on LocalStack for CodeCommit semantics it does not accurately implement.

## 15. Acceptance criteria

1. A clean request receives no comment and completes.
2. A request with one high-confidence issue receives one inline comment and waits.
3. Duplicate events and durable replay do not duplicate comments.
4. Any human comment resumes review and becomes untrusted model context.
5. A fixing commit updates the original comment as resolved and completes.
6. Only a policy-validated comment from an eligible human that links to the finding can cause model-recommended dismissal; the original comment is then updated with a distinct resolution status.
7. An unresolved issue remains deduplicated across commits.
8. Merge or closure ends execution without falsely resolving open findings.
9. Infrastructure failures emit alerts but no review comments.
10. An event racing callback registration is processed exactly once.
11. Malicious code or comments cannot override policy or obtain credentials.
12. Multiple configured repositories remain isolated.
13. The configured timeout closes state without posting a comment.
14. Exceeding a hard review limit never produces a clean result or resolves existing findings; rate limits resume automatically after their window resets.
15. Every review cycle pins source code and base configuration to immutable commit IDs and reuses them during replay.
16. Application infrastructure uses local Pawl constructs; raw CDK is confined to reusable Pawl packages.
17. CodeCommit runtime SDK usage is confined to the app-local `CodeCommitReviewClient`, while reusable infrastructure remains in `@pawl/cdk`.

## 16. Delivery sequence

The implementation plan should divide work into reviewable milestones:

1. Repair and validate the current scaffold baseline.
2. Add Pawl durable Lambda and state-table constructs.
3. Add Pawl CodeBuild and CodeCommit event constructs.
4. Add `@pawl/lambda` durable handler support.
5. Add the app-local CodeCommit runtime client under `src/adapters/`; do not create a Pawl runtime package.
6. Implement provider-neutral domain models and state store.
7. Implement event router and race-free wake protocol.
8. Implement check runner and configuration loading.
9. Implement Bedrock review engine and policy filtering.
10. Implement finding reconciliation and CodeCommit comments.
11. Assemble the durable lifecycle.
12. Add integration, security, observability, and deployment validation.

Implementation must follow test-driven development and use one writer per active worktree.

## 17. Known risks and validation spikes

Before committing to detailed implementation APIs, the plan must include small validation spikes for:

- Exact AWS Durable Execution SDK callback registration, external signaling, replay, and execution-status APIs in the selected SDK version.
- CodeCommit event coverage for pull-request comments and the required CloudTrail fallback event shape.
- CodeCommit diff line-position mapping and `UpdateComment` behavior.
- CodeBuild source checkout at a CodeCommit pull-request head revision.
- Bedrock model resource IAM format and one explicit, currently supported Claude Sonnet model ID or inference-profile ARN to use as the deployment default.

A failed spike may change an internal adapter but must not change the approved product behavior without user approval.
