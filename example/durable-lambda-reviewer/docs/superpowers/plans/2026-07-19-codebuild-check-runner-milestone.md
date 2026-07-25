# CodeBuild Check Runner Milestone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Replace `NoopCheckRunner` with a real `CodeBuildCheckRunner` that runs repository-configured checks at the exact immutable source commit via CodeBuild, polls, and returns bounded/scrubbed logs. Instantiate a Pawl `CodeBuildProject` and grant the reviewer `grantRunAndRead`.

**Architecture:** `CodeBuildCheckRunner` implements the existing `CheckRunner.run` synchronously (internal poll loop). It generates a buildspec from `checks` + `installCommand`, calls `StartBuild` with `sourceVersion = snapshot.sourceRevision`, polls `BatchGetBuilds` until terminal, reads CloudWatch logs (bounded + scrubbed), and maps status. Runs inside the workflow's durable `run-review` step.

**Tech Stack:** Bun 1.3.x, TypeScript 6, `@aws-sdk/client-codebuild` (`StartBuildCommand`, `BatchGetBuildsCommand`), `@aws-sdk/client-cloudwatch-logs` (`GetLogEventsCommand`), Zod 4, Oxlint/Oxfmt, Bun test, AWS CDK 2.261, cdk-nag, `rtk`.

---

## Working directory and conventions

```text
APP=/Users/jolo/Development/worktrees/durable-lambda-reviewer-codebuild-milestone
PAWL=/Users/jolo/Development/worktrees/pawl
```

- Branch: `feat/codebuild-check-runner-milestone` (from `main` at `4830248`)
- App baseline: 220 tests passing on 23 files; tsc clean; cdk synth clean
- Pawl baseline HEAD: `794e286990533ef965f0961f0c3b27e47e09d783` (read-only)
- All shell commands use the `rtk` extension; follow `@superpowers:test-driven-development`
- `cdk synth`/construct tests prepend `PATH="$PWD/node_modules/.bin:$PATH"`

## File map

### New application files

| Path                                     | Responsibility                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `src/adapters/codebuild-check-runner.ts` | `CodeBuildCheckRunner`, `CodeBuildTransport`, buildspec generator, log scrubber |

### Modified application files

| Path                                       | Responsibility                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `src/handlers/durable-reviewer-handler.ts` | Env path constructs `CodeBuildCheckRunner` from `CODEBUILD_PROJECT_NAME`                           |
| `src/workflows/reviewer-workflow.ts`       | Pass `repositoryConfig.checks` + `install.command` to `checkRunner.run`                            |
| `stacks/reviewer-stack.ts`                 | Instantiate `CodeBuildProject`; `grantRunAndRead(reviewer)`; reviewer env `CODEBUILD_PROJECT_NAME` |
| `tests/constructs/reviewer-stack.test.ts`  | Assert CodeBuild project + reviewer IAM (StartBuild/BatchGetBuilds/logs); cdk-nag clean            |
| `cdk.json`                                 | Add `reviewerCodeBuildComputeSize` + `reviewerCodeBuildImage` context                              |

### New test files

| Path                                        | Responsibility                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `tests/unit/codebuild-check-runner.test.ts` | Source version, buildspec, status mapping, log bounding, scrubbing, timeout, no secrets |

### Out of scope

- `.pawl/reviewer.json` runtime loading, multi-repo stack (Task 16), AWS integration tests (Task 17), start/poll/resume durable split.

---

### Task 1: Implement the `CodeBuildCheckRunner` adapter (TDD)

**Files:**

- Create: `src/adapters/codebuild-check-runner.ts`
- Create: `tests/unit/codebuild-check-runner.test.ts`

- [ ] **Step 1: Write the failing adapter tests (RED)**

Create `tests/unit/codebuild-check-runner.test.ts` with a fake `CodeBuildTransport`. Cases:

1. StartBuild source version + buildspec contains each check command.
2. SUCCEEDED → all `passed`.
3. FAILED → per-check failed/passed from exit markers.
4. FAULT → `infrastructure-failure` retryable.
5. STOPPED → `infrastructure-failure` not retryable.
6. Poll timeout → `timed-out`.
7. Log bounding (exceeds 4096 → truncated + flag).
8. Log scrubbing (`AKIA...` redacted).
9. No secrets in `environmentVariablesOverride` (only `PAWL_CHECK_RUN_ID`).

- [ ] **Step 2: Implement the adapter**

`src/adapters/codebuild-check-runner.ts`:

- `CodeBuildTransport` interface (startBuild/batchGetBuilds/getLogEvents).
- `CodeBuildRuntimeTransport` wrapping `CodeBuildClient` + `CloudWatchLogsClient`.
- `generateBuildspec(checks, installCommand)` → YAML string with `<<<CHECK:name:START>>>` / `<<<CHECK:name:EXIT:N>>>` markers.
- `scrubLog(text)` regex redaction.
- `CodeBuildCheckRunner.run`: start → poll (5s/15min) → read logs → parse markers → map status.

- [ ] **Step 3: Run GREEN + regression**

```bash
cd "$APP"
rtk test bun test tests/unit/codebuild-check-runner.test.ts
rtk tsc --noEmit
rtk test bun test
rtk bun run lint
rtk bun run fmt
```

- [ ] **Step 4: Review and commit**

```bash
rtk git -C "$APP" add src/adapters/codebuild-check-runner.ts tests/unit/codebuild-check-runner.test.ts
rtk git -C "$APP" commit -m 'feat: add CodeBuild check runner adapter'
```

---

### Task 2: Wire the check runner into the workflow and handler

**Files:**

- Modify: `src/workflows/reviewer-workflow.ts`
- Modify: `src/handlers/durable-reviewer-handler.ts`

- [ ] **Step 1: Workflow** — pass `checks: repositoryConfig.checks` + `installCommand: repositoryConfig.install?.command` to `checkRunner.run`.
- [ ] **Step 2: Handler** — env path constructs `CodeBuildCheckRunner({ transport: new CodeBuildRuntimeTransport(), projectName: process.env.CODEBUILD_PROJECT_NAME, clock, pollIntervalMs, maxPollMs, maxLogBytes })` (throw if `CODEBUILD_PROJECT_NAME` missing).
- [ ] **Step 3: Verify + commit**

```bash
rtk tsc --noEmit && rtk test bun test && rtk bun run lint && rtk bun run fmt
rtk git -C "$APP" commit -m 'feat: wire CodeBuild check runner into reviewer workflow'
```

---

### Task 3: Wire the CodeBuild project into the CDK stack

**Files:**

- Modify: `stacks/reviewer-stack.ts`
- Modify: `tests/constructs/reviewer-stack.test.ts`
- Modify: `cdk.json`

- [ ] **Step 1: cdk.json + construct test (RED)** — add context; assert `AWS::CodeBuild::Project` exists + reviewer role has StartBuild/BatchGetBuilds/logs.
- [ ] **Step 2: Stack** — instantiate `CodeBuildProject`; `grantRunAndRead(reviewer)`; reviewer env `CODEBUILD_PROJECT_NAME`.
- [ ] **Step 3: GREEN + gates**

```bash
PATH="$PWD/node_modules/.bin:$PATH" rtk test bun test tests/constructs/reviewer-stack.test.ts
PATH="$PWD/node_modules/.bin:$PATH" rtk run 'cdk synth --quiet'
rtk bun run lint && rtk bun run fmt:check && rtk test bun test && rtk tsc --noEmit && rtk bun install --frozen-lockfile
```

- [ ] **Step 4: Commit**

```bash
rtk git -C "$APP" commit -m 'feat: wire CodeBuild project and grant reviewer run/read IAM'
```

---

### Task 4: Verify the milestone against the accepted spec

- [ ] **Step 1: Final gate** (lint, fmt, test, tsc, synth, frozen install, diff-check).
- [ ] **Step 2: Acceptance criteria** (spec §9, 1–8).
- [ ] **Step 3: Pawl boundary** (`794e286`, only `.pi-subagents/` untracked).
- [ ] **Step 4: Commit scope** (`git diff 4830248..HEAD --stat`).
- [ ] **Step 5: Self-review** against spec §4–§8.
