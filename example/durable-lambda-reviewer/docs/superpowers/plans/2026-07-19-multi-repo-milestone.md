# Multi-Repository Stack Assembly Milestone Implementation Plan

> **For agentic workers:** Use superpowers:test-driven-development.

**Goal:** Generalize the single-repo stack to N repositories: one shared reviewer/router/table, one CodeBuild project + one CodeCommit event construct per repo. Reviewer resolves the per-repo CodeBuild project at runtime.

**Tech Stack:** Bun 1.3.x, TypeScript 6, Zod 4, Oxlint/Oxfmt, Bun test, `rtk`.

## Working directory

```text
APP=/Users/jolo/Development/worktrees/durable-lambda-reviewer-multirepo-milestone
PAWL=/Users/jolo/Development/worktrees/pawl
```

- Branch: `feat/multi-repo-milestone` (from `main` at `3f3e4c8`)
- App baseline: 237 tests passing; tsc clean; cdk synth clean
- Pawl baseline: `794e286` (read-only)

## File map

| Path                                                   | Responsibility                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `src/adapters/codebuild-check-runner.ts`               | `projectNames: Record<string,string>`; resolve by request.repository; UNKNOWN_REPOSITORY failure                          |
| `src/handlers/durable-reviewer-handler.ts`             | Build projectNames from `CODEBUILD_REPOSITORIES` + `CODEBUILD_PROJECT_*`; drop `CODEBUILD_PROJECT_NAME`/`REPOSITORY_NAME` |
| `src/handlers/event-router-handler.ts`                 | Drop `REPOSITORY_NAME` validation                                                                                         |
| `stacks/reviewer-stack.ts`                             | `repositories` array; per-repo CodeBuild+Events loop; per-repo env vars; `CODEBUILD_REPOSITORIES`                         |
| `cdk.json`                                             | `repositories` array replaces `repositoryName`                                                                            |
| `tests/constructs/reviewer-stack.test.ts`              | Assert N projects, N event rules, 1 reviewer/router/table, per-repo env + IAM                                             |
| `tests/unit/codebuild-check-runner.test.ts`            | Update constructor; add unknown-repository case                                                                           |
| `tests/unit/handlers/durable-reviewer-handler.test.ts` | Assert projectNames built from env (if exists)                                                                            |

---

### Task 1: Update `CodeBuildCheckRunner` for multi-repo (TDD)

- [ ] **Step 1: Update adapter tests (RED)** — change constructor to `projectNames: { repo: "test-project" }`; add unknown-repository → infrastructure-failure case.
- [ ] **Step 2: Implement** — constructor `projectNames: Readonly<Record<string,string>>`; `run()` resolves by `input.request.repository`, returns `infrastructure-failure`/`UNKNOWN_REPOSITORY` on miss.
- [ ] **Step 3: GREEN + commit**

### Task 2: Update handlers

- [ ] **Step 1: Reviewer handler** — `codeBuildProjectsFromEnv()` reads `CODEBUILD_REPOSITORIES` + `CODEBUILD_PROJECT_*`; drop `CODEBUILD_PROJECT_NAME`/`REPOSITORY_NAME`.
- [ ] **Step 2: Router handler** — drop `REPOSITORY_NAME` validation.
- [ ] **Step 3: tsc + tests + commit**

### Task 3: Update stack + cdk.json (TDD)

- [ ] **Step 1: Update construct test (RED)** — `repositories: ["repo-a","repo-b"]`; assert 2 projects, 2 event rules, 1 reviewer/router/table, per-repo env vars, per-repo IAM.
- [ ] **Step 2: Implement** — `repositories` schema; per-repo loop; `projectEnvVar()` helper; `CODEBUILD_REPOSITORIES`; drop single `REPOSITORY_NAME`.
- [ ] **Step 3: cdk.json** — `repositories` array.
- [ ] **Step 4: synth + tests + commit**

### Task 4: Verify the milestone

- [ ] **Step 1: Final gate** (lint, fmt, test, tsc, synth, frozen install, diff-check).
- [ ] **Step 2: Acceptance criteria** (spec §7, 1–6).
- [ ] **Step 3: Pawl boundary** (`794e286`).
- [ ] **Step 4: Self-review**.
