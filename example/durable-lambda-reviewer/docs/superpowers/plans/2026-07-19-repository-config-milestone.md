# Repository Config Loading Milestone Implementation Plan

> **For agentic workers:** Use superpowers:test-driven-development.

**Goal:** Load `.pawl/reviewer.json` from the reviewed repository at the immutable destination commit and thread it through the check runner + review engine, replacing the hardcoded `DEFAULT_REPOSITORY_CONFIG`. Safe-defaults on absent/malformed.

**Tech Stack:** Bun 1.3.x, TypeScript 6, Zod 4, Oxlint/Oxfmt, Bun test, `rtk`.

## Working directory

```text
APP=/Users/jolo/Development/worktrees/durable-lambda-reviewer-config-milestone
PAWL=/Users/jolo/Development/worktrees/pawl
```

- Branch: `feat/repository-config-milestone` (from `main` at `80efb3d`)
- App baseline: 232 tests passing; tsc clean; cdk synth clean
- Pawl baseline: `794e286` (read-only)

## File map

| Path                                             | Responsibility                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `src/services/repository-config-loader.ts`       | NEW: `RepositoryConfigLoader` port + `ProviderRepositoryConfigLoader` + `DEFAULT_REPOSITORY_CONFIG` (moved from workflow) |
| `src/workflows/reviewer-workflow.ts`             | Load config in `load-snapshot`; thread into check runner + engine                                                         |
| `src/handlers/durable-reviewer-handler.ts`       | Construct + inject `ProviderRepositoryConfigLoader`                                                                       |
| `tests/unit/repository-config-loader.test.ts`    | NEW: present+valid, absent, malformed, schema-invalid, destination commit                                                 |
| `tests/unit/workflows/reviewer-workflow.test.ts` | Fake provider `getFile → undefined`                                                                                       |

---

### Task 1: Implement the `RepositoryConfigLoader` (TDD)

- [ ] **Step 1: Write failing loader tests (RED)** — `tests/unit/repository-config-loader.test.ts` with a fake `SourceControlProvider`. Cases: present+valid, absent, malformed JSON, schema-invalid, read at destination commit.
- [ ] **Step 2: Implement** `src/services/repository-config-loader.ts`: port + `ProviderRepositoryConfigLoader({ provider, logger })` reading `.pawl/reviewer.json` at the destination commit, parsing with `repositoryConfigSchema`, falling back to `DEFAULT_REPOSITORY_CONFIG` + warn on error.
- [ ] **Step 3: GREEN + regression + commit**

```bash
cd "$APP"
rtk test bun test tests/unit/repository-config-loader.test.ts
rtk tsc --noEmit && rtk test bun test && rtk bun run lint && rtk bun run fmt
rtk git -C "$APP" commit -m 'feat: add repository config loader'
```

### Task 2: Wire the loader into the workflow and handler

- [ ] **Step 1: Workflow** — add `configLoader` to `ReviewerWorkflowDeps`; load config in `load-snapshot` step; pass `repositoryConfig.checks`/`install.command` to `checkRunner.run` and `repositoryConfig` to `reviewEngine.review`. Move `DEFAULT_REPOSITORY_CONFIG` to the loader module and re-import.
- [ ] **Step 2: Handler** — env path constructs `new ProviderRepositoryConfigLoader({ provider, logger })`; inject into workflow. Injected/test path defaults to a loader returning defaults.
- [ ] **Step 3: Workflow test** — fake provider's `getFile` returns `undefined` (defaults).
- [ ] **Step 4: Verify + commit**

```bash
rtk tsc --noEmit && rtk test bun test && rtk bun run lint && rtk bun run fmt
rtk git -C "$APP" commit -m 'feat: load repository config in reviewer workflow'
```

### Task 3: Verify the milestone

- [ ] **Step 1: Final gate** (lint, fmt, test, tsc, synth, frozen install, diff-check).
- [ ] **Step 2: Acceptance criteria** (spec §7, 1–7).
- [ ] **Step 3: Pawl boundary** (`794e286`).
- [ ] **Step 4: Commit scope**.
- [ ] **Step 5: Self-review**.
