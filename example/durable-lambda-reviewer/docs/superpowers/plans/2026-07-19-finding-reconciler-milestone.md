# Finding Reconciler Milestone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the `NoopFindingReconciler` stub with a real `IdempotentFindingReconciler` that posts/resolves provider comments via the existing `ReviewStateStore` + `SourceControlProvider` ports, using stable fingerprints and reserve → write → confirm idempotency. Grant the reviewer `codecommit:PostCommentForPullRequest`/`UpdateComment` IAM.

**Architecture:** The reconciler runs inside the workflow's `context.step("run-review")`. For each accepted finding it computes a `FindingFingerprint` (with ±3-line `nearbyCode`), reserves a write, calls `provider.postInlineFinding`, and confirms. For each dismissal it reserves a resolve, calls `provider.markCommentResolved`, and confirms. Duplicate/stale reservations are skipped. Uncertain provider-write errors recover by reading existing provider comments for the finding's issue-identity watermark before re-throwing.

**Tech Stack:** Bun 1.3.x, TypeScript 6, Zod 4, Oxlint/Oxfmt, Bun test, AWS CDK 2.261, cdk-nag, `rtk`.

---

## Working directory and conventions

```text
APP=/Users/jolo/Development/worktrees/durable-lambda-reviewer-reconciler-milestone
PAWL=/Users/jolo/Development/worktrees/pawl
```

- Branch: `feat/finding-reconciler-milestone` (from `main` at `b5fad93`)
- App baseline: 212 tests passing on 22 files; tsc clean; cdk synth clean
- Pawl baseline HEAD: `794e286990533ef965f0961f0c3b27e47e09d783` (read-only)
- All shell commands use the `rtk` extension; follow `@superpowers:test-driven-development`
- `cdk synth`/construct tests prepend `PATH="$PWD/node_modules/.bin:$PATH"`

## File map

### Modified application files

| Path                                       | Responsibility                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `src/services/finding-reconciler.ts`       | Add `IdempotentFindingReconciler`; extend `ReconcilerInput` with `existingFindings` + `changedFiles` |
| `src/workflows/reviewer-workflow.ts`       | Pass `existingFindings` + `changedFiles` into `reconciler.apply(...)`                                |
| `src/handlers/durable-reviewer-handler.ts` | Env path constructs `IdempotentFindingReconciler({ store, provider, clock })`                        |
| `stacks/reviewer-stack.ts`                 | Add `events.grantComment(reviewer)`                                                                  |
| `tests/constructs/reviewer-stack.test.ts`  | Assert reviewer role `codecommit:PostCommentForPullRequest`+`UpdateComment` scoped to repo ARN       |

### New test files

| Path                                    | Responsibility                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `tests/unit/finding-reconciler.test.ts` | Post, duplicate suppression, dismissal, carry-forward, stale-gen, uncertain-retry |

### Out of scope

- CodeBuild check runner (Task 12), summary findings, full RetryPolicy integration, rate-window pending comments, `.pawl/reviewer.json` loading.

---

### Task 1: Implement the `IdempotentFindingReconciler` (TDD)

**Files:**

- Modify: `src/services/finding-reconciler.ts`
- Create: `tests/unit/finding-reconciler.test.ts`

- [ ] **Step 1: Write the failing reconciler tests (RED)**

Create `tests/unit/finding-reconciler.test.ts` with `InMemoryStateStore` + a fake `SourceControlProvider`. Cases:

1. **New finding post**: one accepted finding → `postInlineFinding` called once → `listFindings` shows it `open` with the provider comment id.
2. **Duplicate suppression**: same finding fingerprint presented again → `reserveFindingWrite` returns `already-confirmed` → `postInlineFinding` NOT called.
3. **Dismissal resolution**: a dismissal candidate linked to an existing open finding → `markCommentResolved` called once → finding status becomes `dismissed`.
4. **Carry-forward no-op**: an existing open finding whose fingerprint is NOT in the new candidates → no resolve, no post.
5. **Stale-generation skip**: `reserveFindingWrite` returns `stale-generation` → skip, no provider call.
6. **Uncertain-retry recovery**: `postInlineFinding` throws on the first call; `listComments` returns a comment containing the finding's `issueIdentity` watermark → confirm with that comment's id; only one `postInlineFinding` attempt.
7. **Uncertain-retry re-throw**: `postInlineFinding` throws and no existing comment matches → error propagates.

The fake provider records calls and is configurable to throw. `PostedComment` returns `{ id: "provider-comment-N", findingFingerprint, contentHash }`.

- [ ] **Step 2: Implement the reconciler**

In `src/services/finding-reconciler.ts`:

- Extend `ReconcilerInput` with `existingFindings: readonly PersistedFinding[]` and `changedFiles: readonly ChangedFile[]`.
- Add `IdempotentFindingReconciler` constructor `{ store, provider, clock }`.
- `apply(input)`: for each candidate, compute fingerprint (findings) or use `candidate.findingFingerprint` (dismissals), `reserveFindingWrite`, then provider write, then `confirmFindingWrite`. Implement uncertain-retry recovery via `provider.listComments` filtered by the `<!-- pawl:<issueIdentity> -->` watermark.

- [ ] **Step 3: Run GREEN**

```bash
cd "$APP"
rtk test bun test tests/unit/finding-reconciler.test.ts
```

Expected: all cases pass.

- [ ] **Step 4: Verify typecheck and app regression**

```bash
cd "$APP"
rtk tsc --noEmit
rtk test bun test
rtk bun run lint
rtk bun run fmt
```

Expected: all green; 212 baseline + new reconciler tests pass.

- [ ] **Step 5: Review and commit**

```bash
rtk git -C "$APP" add src/services/finding-reconciler.ts tests/unit/finding-reconciler.test.ts
rtk git -C "$APP" commit -m 'feat: add idempotent finding reconciler'
```

---

### Task 2: Wire the reconciler into the workflow and handler

**Files:**

- Modify: `src/workflows/reviewer-workflow.ts`
- Modify: `src/handlers/durable-reviewer-handler.ts`
- Modify: `tests/unit/workflows/reviewer-workflow.test.ts`

- [ ] **Step 1: Update the workflow**

Pass `existingFindings: ctx.existingFindings` and `changedFiles: ctx.changedFiles` into `reconciler.apply(...)`.

- [ ] **Step 2: Update the handler**

Env path: construct `new IdempotentFindingReconciler({ store: stateStore, provider, clock: () => new Date() })` instead of `new NoopFindingReconciler()`. The test/injected path keeps using whatever the caller passes (default `NoopFindingReconciler` for tests that don't override).

- [ ] **Step 3: Update the workflow test**

The existing workflow test uses `NoopFindingReconciler` — keep it (the test exercises the workflow, not the reconciler). No change needed unless the `ReconcilerInput` shape change breaks compilation; fix any type errors.

- [ ] **Step 4: Verify**

```bash
cd "$APP"
rtk tsc --noEmit
rtk test bun test
rtk bun run lint
rtk bun run fmt
```

Expected: all green.

- [ ] **Step 5: Review and commit**

```bash
rtk git -C "$APP" add src/workflows/reviewer-workflow.ts src/handlers/durable-reviewer-handler.ts tests/unit/workflows/reviewer-workflow.test.ts
rtk git -C "$APP" commit -m 'feat: wire idempotent reconciler into reviewer workflow'
```

---

### Task 3: Grant reviewer CodeCommit comment IAM

**Files:**

- Modify: `stacks/reviewer-stack.ts`
- Modify: `tests/constructs/reviewer-stack.test.ts`

- [ ] **Step 1: Update the construct test (RED)**

Add a test: the reviewer role has `codecommit:PostCommentForPullRequest` + `codecommit:UpdateComment` scoped to `arn:aws:codecommit:${Region}:${Account}:test-repo`. Reuse the reviewer-role statement extraction helper.

Run:

```bash
cd "$APP"
PATH="$PWD/node_modules/.bin:$PATH" rtk test bun test tests/constructs/reviewer-stack.test.ts
```

Expected: FAIL because `grantComment` is not yet called.

- [ ] **Step 2: Implement the stack change**

In `stacks/reviewer-stack.ts`, after `events.grantConfigRead(reviewer)`, add:

```ts
events.grantComment(reviewer);
```

- [ ] **Step 3: Run GREEN + full gates**

```bash
cd "$APP"
PATH="$PWD/node_modules/.bin:$PATH" rtk test bun test tests/constructs/reviewer-stack.test.ts
PATH="$PWD/node_modules/.bin:$PATH" rtk run 'cdk synth --quiet'
rtk bun run lint
rtk bun run fmt:check
rtk test bun test
rtk tsc --noEmit
rtk bun install --frozen-lockfile
```

Expected: all green; synth clean; cdk-nag clean (no new suppression).

- [ ] **Step 4: Review and commit**

```bash
rtk git -C "$APP" add stacks/reviewer-stack.ts tests/constructs/reviewer-stack.test.ts
rtk git -C "$APP" commit -m 'feat: grant reviewer codecommit comment permissions'
```

---

### Task 4: Verify the milestone against the accepted spec

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

Confirm each criterion in `docs/superpowers/specs/2026-07-19-finding-reconciler-milestone-design.md` §8 (1–9).

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
rtk git -C "$APP" diff b5fad93..HEAD --stat
```

Expected: app clean with milestone commits; Pawl unchanged.

- [ ] **Step 5: Self-review** against spec §4–§8; cite fresh evidence.
