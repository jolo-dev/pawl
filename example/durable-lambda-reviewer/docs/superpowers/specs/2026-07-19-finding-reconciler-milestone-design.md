# Finding Reconciler Milestone Design

**Date:** 2026-07-19
**Status:** Draft — pending user approval
**Milestone:** Fourth of the durable reviewer feature implementation (master plan Task 14)

## 1. Purpose

Replace the `NoopFindingReconciler` stub with a real `FindingReconciler` that turns the review engine's accepted findings + dismissal candidates into provider comment posts/resolves and state-store finding writes, idempotently and race-free. This is the last stub — completing it means the reviewer actually posts actionable comments on pull requests and resolves them when fixed or dismissed.

The reconciler implements the reserve → provider-write → confirm sequence against the existing `ReviewStateStore.reserveFindingWrite`/`confirmFindingWrite` and `SourceControlProvider.postInlineFinding`/`markCommentResolved`, with stable fingerprints (`createFindingFingerprint`), deterministic idempotency tokens, and uncertain-retry recovery via provider comment reads.

## 2. Confirmed decisions

- **Fingerprint computation:** the reconciler computes a stable `FindingFingerprint` for each accepted finding via `createFindingFingerprint({ provider, repository, requestId, category, path, nearbyCode, issueIdentity, line })`. `nearbyCode` is derived from the finding's hunk context (a bounded slice of the changed lines around the finding location). The fingerprint is the idempotency key across cycles.
- **Reserve → write → confirm sequence:** for each accepted finding:
  1. `store.reserveFindingWrite({ operation: "post", request, generation, finding, fingerprint, idempotencyToken })`. If `reserved: false` with `reason: "already-confirmed"` and an `existingProviderCommentId`, skip (already posted). If `"already-reserved"`, another in-flight write owns it — skip. If `"stale-generation"`, skip (the generation moved on).
  2. `provider.postInlineFinding(request, finding, revisions)`. The provider computes its own `clientRequestToken` from the finding (existing `tokenFor`), so a retried post is idempotent at the provider too.
  3. `store.confirmFindingWrite({ request, generation, reservationId, fingerprint, providerCommentId: posted.id, providerContentHash: posted.contentHash, completedAt })`.
- **Dismissal resolution:** for each accepted dismissal candidate, `store.reserveFindingWrite({ operation: "resolve", ..., resolution: "dismissed", triggeringHumanCommentId })` → `provider.markCommentResolved(request, { id: linkedProviderCommentId, findingFingerprint, contentHash }, { type: "dismissed", eligibleHumanCommentId, rationale })` → confirm. The provider's `markCommentResolved` appends `✅ Resolved after reviewer context (<commentId>)` to the existing comment (existing behavior); the reconciler never posts a separate resolution comment.
- **Fixed resolution (carry-forward):** an existing open finding whose fingerprint does **not** appear in the new accepted set is _not_ auto-resolved — the reconciler only resolves findings explicitly dismissed by a linked human comment or when the provider reports the PR merged/closed. Carry-forward of unresolved findings is implicit (they remain `open` in state; the next cycle's `existingFindings` includes them).
- **Uncertain provider-write recovery:** if `postInlineFinding` throws an ambiguous error (network timeout, 5xx), the reconciler does **not** blindly retry — it reads the provider's existing comments by the finding's idempotency marker (`provider.listComments` filtered by the `clientRequestToken` watermark) before deciding whether to re-post. If a posted comment already exists, confirm with its id; otherwise re-post once. This is bounded by the existing `RetryPolicy` (not yet wired — this milestone uses a single retry attempt; full retry-policy integration is deferred).
- **No new ports.** The reconciler consumes the existing `ReviewStateStore` and `SourceControlProvider` ports. The `ReconcilerInput` gains `existingFindings` (already on `ReviewEngineInput`) and `changedFiles` (for `nearbyCode` context) so the reconciler can compute fingerprints. The `FindingReconciler` interface signature stays `apply(input): Promise<void>`.
- **Reconciler is not durable-aware.** The reconciler runs inside the workflow's `context.step("run-review", ...)`, so the durable SDK handles replay/retry of the _step_. The reconciler itself is a plain async function — if the step replays, the reserve/confirm idempotency makes it safe. No `context.step` calls inside the reconciler.
- **IAM:** no new IAM. The reviewer role already has `codecommit:PostCommentForPullRequest`? **No** — the router milestone explicitly granted only read + config-read, no comment permissions (spec §7.1: "No `grantComment` this milestone"). This milestone **adds** `events.grantComment(reviewer)` to the stack, granting `codecommit:PostCommentForPullRequest` + `codecommit:UpdateComment` scoped to the repository ARN. The construct test asserts these actions are present.
- **No live-AWS tests.** Fakes for `SourceControlProvider` and `InMemoryStateStore`; the provider fake records `postInlineFinding`/`markCommentResolved` calls and returns canned `PostedComment` objects.

## 3. Scope

### 3.1 In scope

- `src/services/finding-reconciler.ts`: real `FindingReconciler` implementation (`IdempotentFindingReconciler`) replacing `NoopFindingReconciler`. The `NoopFindingReconciler` stays (for tests) but the prod path uses the real one.
- `tests/unit/finding-reconciler.test.ts`: new finding post, duplicate suppression, dismissal resolution, carry-forward no-op, uncertain-retry recovery, stale-generation skip.
- `src/workflows/reviewer-workflow.ts`: pass `existingFindings` + `changedFiles` into `ReconcilerInput` (the engine already receives them; the reconciler needs them too). Construct the real reconciler in the handler's env path.
- `src/handlers/durable-reviewer-handler.ts`: env path constructs `IdempotentFindingReconciler({ store, provider, clock })` instead of `NoopFindingReconciler`.
- `stacks/reviewer-stack.ts`: add `events.grantComment(reviewer)` so the reviewer can post/update comments.
- `tests/constructs/reviewer-stack.test.ts`: assert the reviewer role has `codecommit:PostCommentForPullRequest` + `codecommit:UpdateComment` scoped to the repo ARN; cdk-nag clean.

### 3.2 Out of scope

- CodeBuild check runner (Task 12) — `NoopCheckRunner` remains.
- Full `RetryPolicy` integration for provider writes (single retry this milestone; the durable SDK's step retry + the reserve/confirm idempotency cover correctness).
- Summary/cross-cutting findings (`postSummaryFinding`) — this milestone posts only inline findings via `postInlineFinding`. Summary findings deferred (the engine produces only inline findings today).
- Pending-comments-across-rate-windows (the master plan's rate-limit case) — deferred; the reserve/confirm sequence handles a single cycle's batch.
- `.pawl/reviewer.json` runtime loading.

## 4. Architecture

### 4.1 Reconciler flow

`IdempotentFindingReconciler.apply(input)`:

```
for each candidate in input.candidates:
  if candidate.kind === "finding":
    fingerprint = createFindingFingerprint({ ...from candidate + nearbyCode from input.changedFiles })
    reservation = store.reserveFindingWrite({ operation: "post", request, generation, finding, fingerprint, idempotencyToken: tokenFor(request, fingerprint) })
    match reservation:
      { reserved: true, reservationId }:
        try:
          posted = provider.postInlineFinding(request, finding, revisions)
          store.confirmFindingWrite({ request, generation, reservationId, fingerprint, providerCommentId: posted.id, providerContentHash: posted.contentHash, completedAt: now() })
        catch ambiguous error:
          # uncertain-retry recovery: read existing comments by marker
          existing = findExistingPostedComment(provider, request, fingerprint)
          if existing: store.confirmFindingWrite({ ..., providerCommentId: existing.id, ... })
          else: re-throw (the durable step will retry the whole reserve→write→confirm)
      { reserved: false, reason: "already-confirmed", existingProviderCommentId }:
        skip (already posted in a prior cycle)
      { reserved: false, reason: "already-reserved" }:
        skip (in-flight; another write owns it)
      { reserved: false, reason: "stale-generation" }:
        skip (generation moved on)
  else:  # dismissal
    reservation = store.reserveFindingWrite({ operation: "resolve", request, generation, fingerprint: candidate.findingFingerprint, providerCommentId: candidate.linkedProviderCommentId, idempotencyToken, resolution: "dismissed", triggeringHumanCommentId: candidate.eligibleHumanCommentId })
    match reservation:
      { reserved: true, reservationId }:
        provider.markCommentResolved(request, { id: candidate.linkedProviderCommentId, findingFingerprint, contentHash }, { type: "dismissed", eligibleHumanCommentId, rationale })
        store.confirmFindingWrite({ ..., providerCommentId: candidate.linkedProviderCommentId, providerContentHash: <unchanged>, completedAt: now() })
      else: skip
```

### 4.2 Fingerprint + nearbyCode

`createFindingFingerprint` needs `nearbyCode: readonly string[]`. The reconciler derives this from `input.changedFiles`: find the file matching the finding's `path`, find the hunk matching `location.hunkIdentity`, take a bounded slice (±3 lines) of the hunk's lines around the finding's `location.line`. This makes the fingerprint stable under line movement (the master plan's "moved-line stable fingerprint" requirement) — `issueIdentity` + `nearbyCode` anchor identity to code content, not line numbers.

### 4.3 Idempotency token

`idempotencyToken` for the state-store reservation is `tokenFor(request, fingerprint)` = a SHA-256 of `{ request, fingerprint }`. This is deterministic across replays, so a retried `reserveFindingWrite` for the same finding+request returns `already-reserved` or `already-confirmed` rather than creating a duplicate reservation. (The provider's own `clientRequestToken` is separate — `tokenFor(ref, finding)` in `CodeCommitProvider` — and already idempotent.)

### 4.4 Uncertain-retry recovery

When `postInlineFinding` throws, the reconciler catches and checks: is there already a posted comment for this finding? It calls `provider.listComments(request)` and looks for a comment whose body contains the finding's `issueIdentity` watermark (the `<!-- pawl:<issueIdentity> -->` marker that `CodeCommitProvider.contentForFinding` emits). If found, confirm with that comment's id; otherwise re-throw so the durable step retries. This prevents duplicate posts after a timeout where the provider actually succeeded.

## 5. File responsibilities

### 5.1 Modified application files

- `src/services/finding-reconciler.ts`: add `IdempotentFindingReconciler` (keeps `NoopFindingReconciler` + the `FindingReconciler` interface). The `ReconcilerInput` interface gains `existingFindings: readonly PersistedFinding[]` and `changedFiles: readonly ChangedFile[]` (already available from the workflow's loaded context).
- `src/workflows/reviewer-workflow.ts`: pass `existingFindings` + `changedFiles` into `reconciler.apply(...)`.
- `src/handlers/durable-reviewer-handler.ts`: env path constructs `IdempotentFindingReconciler({ store, provider, clock })`.
- `stacks/reviewer-stack.ts`: add `events.grantComment(reviewer)`.
- `tests/constructs/reviewer-stack.test.ts`: assert reviewer role comment actions.

### 5.2 New test files

- `tests/unit/finding-reconciler.test.ts`

### 5.3 Out of scope

- `src/adapters/codebuild-check-runner.ts` (Task 12), summary findings, full retry-policy integration, rate-window pending comments, `.pawl/reviewer.json` loading.

## 6. IAM (delta)

The reviewer role gains CodeCommit comment permissions via `events.grantComment(reviewer)`:

- `codecommit:PostCommentForPullRequest`
- `codecommit:UpdateComment`

Both scoped to `arn:aws:codecommit:${region}:${account}:${repositoryName}` (the `CodeCommitReviewEvents.repository.repositoryArn`). No wildcard; no new `AwsSolutions-IAM5` suppression. The construct test asserts both actions are present on the reviewer role and scoped to the repo ARN.

## 7. Testing strategy

### 7.1 Reconciler unit test

Fakes:

- `InMemoryStateStore` (existing) — `reserveFindingWrite`/`confirmFindingWrite`/`listFindings` work against the in-memory finding map.
- Fake `SourceControlProvider` — records `postInlineFinding`/`markCommentResolved`/`listComments` calls; `postInlineFinding` returns a `PostedComment` with a synthetic id + contentHash; configurable to throw on the first call (for uncertain-retry).

Cases:

1. **New finding post**: one accepted finding → `reserveFindingWrite` reserved → `postInlineFinding` called once → `confirmFindingWrite` called with the posted id; `store.listFindings` shows the finding as `open` with the provider comment id.
2. **Duplicate suppression**: the same finding fingerprint is presented again (second cycle) → `reserveFindingWrite` returns `already-confirmed` → `postInlineFinding` **not** called → no duplicate.
3. **Dismissal resolution**: a dismissal candidate linked to an existing open finding → `reserveFindingWrite({ operation: "resolve" })` reserved → `markCommentResolved` called once → `confirmFindingWrite` called; the finding's status becomes `resolved`/`dismissed`.
4. **Carry-forward no-op**: an existing open finding whose fingerprint is NOT in the new candidates → no resolve, no post (it stays open; the reconciler does not auto-resolve).
5. **Stale-generation skip**: `reserveFindingWrite` returns `stale-generation` → skip, no provider call.
6. **Uncertain-retry recovery**: `postInlineFinding` throws on the first call; `listComments` returns a comment with the finding's issue-identity watermark → confirm with that comment's id (no re-post); assert only one `postInlineFinding` attempt.
7. **Uncertain-retry re-throw**: `postInlineFinding` throws and no existing comment matches → the error propagates (the durable step retries).

### 7.2 Construct test (extended)

- Reviewer role has `codecommit:PostCommentForPullRequest` + `codecommit:UpdateComment` scoped to the repo ARN.
- cdk-nag still clean (no new suppression).

## 8. Acceptance criteria

1. `src/services/finding-reconciler.ts` implements `FindingReconciler` with the reserve → provider-write → confirm sequence.
2. New accepted findings are posted via `postInlineFinding` and confirmed in state; duplicate fingerprints are suppressed.
3. Accepted dismissal candidates resolve the linked provider comment via `markCommentResolved` and confirm in state.
4. Carry-forward open findings (not in the new set) are left untouched — no auto-resolve.
5. Uncertain provider-write errors recover by reading existing provider comments; if a posted comment exists, confirm with it (no duplicate); otherwise re-throw.
6. The reviewer role has `codecommit:PostCommentForPullRequest` + `codecommit:UpdateComment` scoped to the repo ARN; cdk-nag clean.
7. The workflow passes `existingFindings` + `changedFiles` into the reconciler; the handler's env path constructs the real reconciler.
8. `cdk synth` clean; existing 212 tests remain green; new reconciler + construct tests added on top.
9. No Pawl library changes and no live AWS calls.

## 9. Decisions (approved by user — use judgment on all 3)

1. **`nearbyCode` slice size.** ±3 lines around the finding location. A bounded window anchors identity to local code content without making the fingerprint brittle to unrelated edits elsewhere in the hunk.
2. **Summary findings.** Deferred. The engine produces only inline findings (line/hunk locations) today; `postSummaryFinding` wiring rides with a future milestone that adds summary-finding output to the engine.
3. **Retry count for uncertain provider writes.** Single retry (read-then-repost) this milestone, with full `RetryPolicy` integration deferred. The durable SDK's step retry + the reserve/confirm idempotency cover correctness; a bounded retry prevents duplicate posts.

---

**Once approved, I'll write the implementation plan** task-by-task, then implement it in the worktree `feat/finding-reconciler-milestone`, mirroring the established flow.
