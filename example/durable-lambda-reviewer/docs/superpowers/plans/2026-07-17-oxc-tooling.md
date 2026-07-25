# Oxc Tooling Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Oxlint and Oxfmt as the app's checked-in lint and formatting toolchain, apply their safe findings, and remove reliance on ad hoc ESLint or Prettier execution.

**Architecture:** Keep the migration app-local and zero-configuration. Pin both Oxc CLIs in the root package, expose the official scripts, use only Oxlint's safe fixes plus Oxfmt's normal writer, and manually review any remaining source changes before verification.

**Tech Stack:** Bun 1.3.x, TypeScript 6, Oxlint 1.74.0, Oxfmt 0.59.0, Git via `rtk`

---

## File Map

- Modify: `package.json` — pinned Oxc development dependencies and lint/format scripts.
- Modify: `bun.lock` — reproducible Oxc dependency resolution.
- Potentially modify: `index.ts`, `stacks/**/*.ts`, `src/**/*.ts`, `tests/**/*.ts`, and supported root JSON/Markdown files — Oxfmt output and intentional safe lint corrections only.
- Do not modify: `../pawl/**` — Pawl retains Biome and its current HEAD/tracked status.
- Do not create `.oxlintrc.json` or `.oxfmtrc.json` unless tool execution proves an app-local ignore is required; if so, add only `ignorePatterns` for the demonstrated path.

### Task 1: Install and expose the Oxc tools

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Capture the preservation baseline**

Run:

```bash
rtk git -C /Users/jolo/Development/worktrees/durable-lambda-reviewer status --short --branch
rtk git -C /Users/jolo/Development/worktrees/durable-lambda-reviewer rev-parse HEAD
rtk git -C /Users/jolo/Development/worktrees/pawl status --short --branch
rtk git -C /Users/jolo/Development/worktrees/pawl rev-parse HEAD
```

Expected: this reviewed implementation plan is already committed and the app worktree is clean; Pawl is at `919b7e2` with only its pre-existing ignored/untracked `.pi-subagents/` state and no tracked changes.

- [ ] **Step 2: Verify the scripts are initially absent**

Run:

```bash
rtk run 'cd /Users/jolo/Development/worktrees/durable-lambda-reviewer && rtk bun run lint'
rtk run 'cd /Users/jolo/Development/worktrees/durable-lambda-reviewer && rtk bun run fmt:check'
```

Expected: both commands fail because the scripts do not yet exist. This is the tooling migration's RED check; no application behavior test is appropriate for package-script configuration.

- [ ] **Step 3: Install exact Oxc versions**

Run:

```bash
rtk run 'cd /Users/jolo/Development/worktrees/durable-lambda-reviewer && rtk bun add --dev --exact oxlint@1.74.0 oxfmt@0.59.0'
```

Expected: `package.json` and `bun.lock` add only the two app-local development tools and their required platform packages.

- [ ] **Step 4: Add the official package scripts**

Modify `package.json` scripts to include exactly:

```json
{
  "lint": "oxlint",
  "lint:fix": "oxlint --fix",
  "fmt": "oxfmt",
  "fmt:check": "oxfmt --check"
}
```

Keep the existing deploy, remove, dev, and test scripts unchanged.

- [ ] **Step 5: Validate script wiring and inventory findings**

Run:

```bash
rtk run 'cd /Users/jolo/Development/worktrees/durable-lambda-reviewer && rtk bun run lint'
rtk run 'cd /Users/jolo/Development/worktrees/durable-lambda-reviewer && rtk bun run fmt:check'
```

Expected: both CLIs execute from pinned local dependencies. Either command may exit nonzero only because it reports repository findings to fix in Task 2; command-not-found or configuration errors are failures to resolve now.

- [ ] **Step 6: Commit the toolchain**

Run:

```bash
rtk git -C /Users/jolo/Development/worktrees/durable-lambda-reviewer add package.json bun.lock
rtk git -C /Users/jolo/Development/worktrees/durable-lambda-reviewer commit -m 'build: adopt oxlint and oxfmt'
```

Expected: one commit containing only the package manifest and lockfile changes.

### Task 2: Apply findings and verify the migration

**Files:**

- Potentially modify: `index.ts`
- Potentially modify: `stacks/**/*.ts`
- Potentially modify: `src/**/*.ts`
- Potentially modify: `tests/**/*.ts`
- Potentially modify: supported root JSON/Markdown files
- Do not modify: `../pawl/**`

- [ ] **Step 1: Apply only safe automated changes**

Run:

```bash
rtk run 'cd /Users/jolo/Development/worktrees/durable-lambda-reviewer && rtk bun run lint:fix'
rtk run 'cd /Users/jolo/Development/worktrees/durable-lambda-reviewer && rtk bun run fmt'
```

Expected: Oxlint applies safe fixes only; Oxfmt writes its supported files. Do not run `--fix-suggestions` or `--fix-dangerously`.

- [ ] **Step 2: Review and correct remaining lint findings**

Run:

```bash
rtk run 'cd /Users/jolo/Development/worktrees/durable-lambda-reviewer && rtk bun run lint'
```

Expected: zero findings. For any remaining diagnostic, make the smallest behavior-preserving source correction, rerun the specific affected tests, and rerun `bun run lint`. Do not disable rules globally merely to obtain a clean run.

- [ ] **Step 3: Review the complete app diff for behavioral safety**

Run:

```bash
rtk git -C /Users/jolo/Development/worktrees/durable-lambda-reviewer diff --stat HEAD
rtk git -C /Users/jolo/Development/worktrees/durable-lambda-reviewer diff HEAD
```

Expected: every source-file change is explainable as Oxfmt output or a specific safe Oxlint correction. Revert or rewrite any semantic change not required by a diagnostic. No Pawl path appears.

- [ ] **Step 4: Run all quality gates**

Run:

```bash
rtk run 'cd /Users/jolo/Development/worktrees/durable-lambda-reviewer && rtk bun run lint'
rtk run 'cd /Users/jolo/Development/worktrees/durable-lambda-reviewer && rtk bun run fmt:check'
rtk run 'cd /Users/jolo/Development/worktrees/durable-lambda-reviewer && rtk test bun test'
rtk run 'cd /Users/jolo/Development/worktrees/durable-lambda-reviewer && rtk tsc --noEmit'
rtk run 'cd /Users/jolo/Development/worktrees/durable-lambda-reviewer && rtk bun install --frozen-lockfile'
rtk git -C /Users/jolo/Development/worktrees/durable-lambda-reviewer diff --check
```

Expected: lint and format checks exit zero; all tests pass; TypeScript reports no errors; the frozen install makes no changes; diff check is clean.

- [ ] **Step 5: Verify migration boundaries**

Run:

```bash
rtk rg -n -i 'eslint|prettier' /Users/jolo/Development/worktrees/durable-lambda-reviewer/package.json
rtk find /Users/jolo/Development/worktrees/durable-lambda-reviewer -type d \( -name .git -o -name node_modules -o -name cdk.out -o -name .pi-subagents \) -prune -o -type f \( -name '*eslint*' -o -name '*prettier*' \) -print
rtk git -C /Users/jolo/Development/worktrees/pawl rev-parse HEAD
rtk git -C /Users/jolo/Development/worktrees/pawl status --short --branch
```

Expected: no ESLint/Prettier package or script reference and no legacy config/ignore files in the app; Pawl remains at `919b7e2` with unchanged tracked-file status.

- [ ] **Step 6: Commit the applied findings**

Run:

```bash
rtk git -C /Users/jolo/Development/worktrees/durable-lambda-reviewer add --all
rtk git -C /Users/jolo/Development/worktrees/durable-lambda-reviewer commit -m 'style: apply Oxc checks'
rtk git -C /Users/jolo/Development/worktrees/durable-lambda-reviewer status --short --branch
```

Expected: the app worktree is clean and the commit contains only app-local Oxc formatting/lint corrections.
