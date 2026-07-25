# AWS Integration Tests & Operations Milestone Implementation Plan

> **For agentic workers:** Use superpowers:test-driven-development.

**Goal:** Opt-in AWS integration tests (skip-able), a synth-based security test in the default suite, operational docs, and README. Tests-and-docs only — no runtime code, no IAM, no Pawl changes.

**Tech Stack:** Bun 1.3.x, TypeScript 6, Zod 4, Oxlint/Oxfmt, Bun test, `rtk`.

## Working directory

```text
APP=/Users/jolo/Development/worktrees/durable-lambda-reviewer-integration-milestone
PAWL=/Users/jolo/Development/worktrees/pawl
```

- Branch: `feat/integration-ops-milestone` (from `main` at `2232c7d`)
- App baseline: 239 tests passing; tsc clean; cdk synth clean
- Pawl baseline: `794e286` (read-only)

## File map

| Path                                                 | Responsibility                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `tests/aws/codecommit-reviewer.integration.test.ts`  | Opt-in full-pipeline scenarios; skip without env var; cleanup in afterAll   |
| `tests/aws/durable-replay.integration.test.ts`       | Opt-in replay/callback scenarios; skip; cleanup                             |
| `tests/aws/repository-isolation.integration.test.ts` | Opt-in two-repo isolation; skip; cleanup                                    |
| `tests/security/synth-security.test.ts`              | Synth-based security assertions (default suite)                             |
| `docs/operations/deploy.md`                          | Deploy/remove/rollback, context vars, multi-repo, prod constraints          |
| `docs/operations/alerts.md`                          | Pawl alarms, DLQ replay, execution stop, replay/callback runbook            |
| `docs/operations/repository-config.md`               | `.pawl/reviewer.json` schema, safe-defaults, destination-commit, onboarding |
| `README.md`                                          | Architecture, quick start, testing, ops link                                |

---

### Task 1: Synth-based security test (runs in default suite)

- [ ] **Step 1: Write** `tests/security/synth-security.test.ts` synthesizing multi-repo stack; assert §5 properties (no unapproved wildcards, no CodeBuild secrets, DLQ present, alarms present, public-test fails in prod, approved-registry only, PITR).
- [ ] **Step 2: GREEN + commit**

### Task 2: Opt-in AWS integration test scaffolding

- [ ] **Step 1: Write** three `tests/aws/*.integration.test.ts` files with the shared skip guard, scenario `describe` blocks, and `afterAll` cleanup. All skip without `RUN_AWS_INTEGRATION=1`.
- [ ] **Step 2: Verify default suite still green (all skip) + commit**

### Task 3: Operational docs + README

- [ ] **Step 1: Write** `docs/operations/deploy.md`, `alerts.md`, `repository-config.md`.
- [ ] **Step 2: Update** `README.md`.
- [ ] **Step 3: Commit**

### Task 4: Verify the milestone

- [ ] **Step 1: Final gate** (lint, fmt, test, tsc, synth, frozen install, diff-check).
- [ ] **Step 2: Acceptance criteria** (spec §7, 1–5).
- [ ] **Step 3: Pawl boundary** (`794e286`).
- [ ] **Step 4: Self-review**.
