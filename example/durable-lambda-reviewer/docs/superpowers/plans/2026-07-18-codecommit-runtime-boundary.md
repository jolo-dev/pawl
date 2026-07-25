# CodeCommit Runtime Boundary Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `@pawl/codecommit`, preserve its runtime behavior in focused app-local modules, and retain Pawl's existing `@pawl/cdk` `CodeCommitReviewEvents` construct as the only reusable CodeCommit abstraction.

**Architecture:** The durable reviewer owns CodeCommit SDK commands, external-data validation, pagination, and DTOs behind its provider-neutral adapter. Pawl remains deployment-only for this concern: `CodeCommitReviewEvents` owns EventBridge routing, DLQ/monitoring, and repository-scoped IAM, while no runtime client is exported through `@pawl/cdk`.

**Tech Stack:** Bun 1.3.x, TypeScript 6, AWS SDK v3 `@aws-sdk/client-codecommit` 3.1089.0, Zod 4, `@pawl/cdk`, Bun test, Oxlint/Oxfmt in the app, Biome/cdk-nag in Pawl, Git via `rtk`

---

## Working directories and constraints

Use these paired worktrees throughout:

```text
APP=/Users/jolo/Development/worktrees/durable-lambda-reviewer-codecommit-boundary
PAWL=/Users/jolo/Development/worktrees/pawl
```

The app worktree must remain on `fix/local-codecommit-client`. The Pawl worktree must remain on `feat/durable-code-reviewer`; its expected starting HEAD is `919b7e22e7f751b594d1c432ffed828eed14ec83`, with only the pre-existing untracked `.pi-subagents/` directory.

Follow `@superpowers:test-driven-development` for runtime changes. Use one writer at a time because the app's Bun workspace reads packages from the paired Pawl worktree. Never modify `/Users/jolo/Development/pawl`, which is an unrelated dirty Pawl worktree.

The Pawl starting branch has documented unrelated baseline failures: standard CDK/root builds lack Node/DOM ambient types, broad tests require unavailable Docker services, and repository-wide Biome includes untracked `.pi-subagents/` artifacts plus intentionally unrendered JSON templates. Do not repair those failures in this migration. Hard gates use focused construct tests with Pawl's local `esbuild`, supplemental TypeScript with Bun ambient types, focused Biome over migration paths, frozen install, and diff/boundary checks. Broad commands are rerun only to prove no new migration-related failure.

## File map

### Durable reviewer

| Path                                                                | Responsibility                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/adapters/codecommit-review-types.ts`                           | App-owned transport interface and CodeCommit runtime DTOs; exports no AWS SDK types |
| `src/adapters/codecommit-review-client.ts`                          | AWS SDK commands, Zod validation, pagination bounds, and file decoding              |
| `src/adapters/codecommit-provider.ts`                               | Provider-neutral mapping; constructs the local runtime client by default            |
| `tests/unit/codecommit-review-client.test.ts`                       | Deterministic AWS command/response contract coverage                                |
| `tests/fixtures/codecommit/*.json`                                  | Existing deterministic CodeCommit response fixtures migrated from Pawl              |
| `tests/unit/codecommit-provider.test.ts`                            | Existing application-adapter regression coverage; should not need semantic changes  |
| `package.json`                                                      | Direct CodeCommit SDK dependency; no `@pawl/codecommit` workspace or dependency     |
| `bun.lock`                                                          | Reproducible app dependency graph without the deleted Pawl package                  |
| `docs/superpowers/specs/2026-07-17-durable-code-reviewer-design.md` | Corrected runtime ownership and acceptance boundary                                 |
| `docs/superpowers/plans/2026-07-17-durable-code-reviewer.md`        | Corrected historical tasks and verification commands                                |

### Pawl

| Path                                                  | Responsibility                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/codecommit/**`                              | Delete the obsolete runtime package, tests, fixtures, and build configuration        |
| `package.json`                                        | Remove the now-unused `@aws-sdk/client-codecommit` catalog entry                     |
| `tsconfig.json`                                       | Remove the `@pawl/codecommit` path alias                                             |
| `bun.lock`                                            | Remove the deleted workspace and now-unused CodeCommit SDK resolution                |
| `packages/cdk/src/codecommit-review-events.ts`        | Preserve unchanged: infrastructure-only construct                                    |
| `packages/cdk/tests/codecommit-review-events.test.ts` | Preserve unchanged: EventBridge, IAM, DLQ, monitoring, validation, and cdk-nag tests |
| `packages/cdk/index.ts`                               | Preserve unchanged: public construct export                                          |

---

### Task 1: Migrate the CodeCommit client contract into the app

**Files:**

- Create: `tests/unit/codecommit-review-client.test.ts`
- Create: `tests/fixtures/codecommit/binary-file.json`
- Create: `tests/fixtures/codecommit/comments-page-1.json`
- Create: `tests/fixtures/codecommit/comments-page-2.json`
- Create: `tests/fixtures/codecommit/differences-page-1.json`
- Create: `tests/fixtures/codecommit/differences-page-2.json`
- Create: `tests/fixtures/codecommit/file.json`
- Create: `tests/fixtures/codecommit/merged-pull-request.json`
- Create: `tests/fixtures/codecommit/pull-request.json`
- Create: `src/adapters/codecommit-review-types.ts`
- Create: `src/adapters/codecommit-review-client.ts`
- Modify: `package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Capture both repository baselines**

Run:

```bash
APP=/Users/jolo/Development/worktrees/durable-lambda-reviewer-codecommit-boundary
PAWL=/Users/jolo/Development/worktrees/pawl
rtk git -C "$APP" status --short --branch
rtk git -C "$APP" rev-parse HEAD
rtk git -C "$PAWL" status --short --branch
rtk git -C "$PAWL" rev-parse HEAD
```

Expected: the app is clean on `fix/local-codecommit-client` with this reviewed plan committed. Pawl is at `919b7e22e7f751b594d1c432ffed828eed14ec83`; `.pi-subagents/` is its only untracked path and no Pawl tracked file is modified.

- [ ] **Step 2: Copy the existing contract tests and fixtures to their desired app-owned paths**

Run:

```bash
cd "$APP"
mkdir -p tests/fixtures/codecommit
cp "$PAWL"/packages/codecommit/tests/fixtures/*.json tests/fixtures/codecommit/
cp "$PAWL"/packages/codecommit/tests/codecommit-review-client.test.ts tests/unit/codecommit-review-client.test.ts
```

In `tests/unit/codecommit-review-client.test.ts`, replace the package-barrel imports:

```ts
import type { PullRequestSnapshot } from "../index";
import { CodeCommitReviewClient } from "../index";
```

with direct app-local imports:

```ts
import { CodeCommitReviewClient } from "../../src/adapters/codecommit-review-client";
import type { PullRequestSnapshot } from "../../src/adapters/codecommit-review-types";
```

Replace each `./fixtures/<name>.json` import with `../fixtures/codecommit/<name>.json`. Keep all 19 test bodies and all eight fixture payloads unchanged.

- [ ] **Step 3: Run RED and inspect the failure**

Run:

```bash
cd "$APP"
rtk test bun test tests/unit/codecommit-review-client.test.ts
```

Expected: FAIL because `src/adapters/codecommit-review-client.ts` and `src/adapters/codecommit-review-types.ts` do not exist. A fixture/import typo is not the expected failure; correct any such typo and rerun until the missing local module is the reason.

- [ ] **Step 4: Copy the runtime units into focused app-local modules**

Run:

```bash
cd "$APP"
cp "$PAWL"/packages/codecommit/src/types.ts src/adapters/codecommit-review-types.ts
cp "$PAWL"/packages/codecommit/src/codecommit-review-client.ts src/adapters/codecommit-review-client.ts
```

In `src/adapters/codecommit-review-client.ts`, replace:

```ts
} from "./types";
```

with:

```ts
} from "./codecommit-review-types";
```

Do not alter schemas, pagination constants, command inputs, mapping logic, or binary decoding during the move.

- [ ] **Step 5: Declare the app's direct runtime dependency**

In `package.json`, add this entry to `dependencies` beside the other AWS SDK clients:

```json
"@aws-sdk/client-codecommit": "catalog:"
```

Do not remove `@pawl/codecommit` yet; Task 2 switches the production adapter before removing the old workspace edge.

Regenerate the lockfile:

```bash
cd "$APP"
rtk bun install
```

Expected: install succeeds, and the app now declares the SDK imported by its local client.

- [ ] **Step 6: Run GREEN for the migrated contract**

Run:

```bash
cd "$APP"
rtk bun run fmt
rtk test bun test tests/unit/codecommit-review-client.test.ts
rtk tsc --noEmit
```

Expected: 19 client tests pass and TypeScript reports no errors. Oxfmt may change indentation/import layout but must not change test payloads or runtime behavior.

- [ ] **Step 7: Review the migration diff**

Run:

```bash
rtk git -C "$APP" diff --stat
rtk git -C "$APP" diff -- src/adapters/codecommit-review-client.ts src/adapters/codecommit-review-types.ts tests/unit/codecommit-review-client.test.ts tests/fixtures/codecommit package.json bun.lock
rtk git -C "$PAWL" diff -- packages/codecommit
```

Expected: app runtime/test content matches Pawl behavior apart from local import paths and app formatting. Pawl has no tracked diff.

- [ ] **Step 8: Commit the app-local client**

Run:

```bash
rtk git -C "$APP" add package.json bun.lock src/adapters/codecommit-review-client.ts src/adapters/codecommit-review-types.ts tests/unit/codecommit-review-client.test.ts tests/fixtures/codecommit
rtk git -C "$APP" commit -m 'refactor: add local CodeCommit review client'
```

Expected: one app commit containing the independently tested local runtime client, fixtures, and direct SDK dependency.

---

### Task 2: Switch the application adapter and remove its Pawl runtime dependency

**Files:**

- Modify: `src/adapters/codecommit-provider.ts`
- Verify: `tests/unit/codecommit-provider.test.ts`
- Modify: `package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Capture the dependency-boundary RED state**

Run:

```bash
cd "$APP"
rtk rg -n '@pawl/codecommit|\.\./pawl/packages/codecommit' package.json bun.lock src tests
```

Expected: matches in `package.json`, `bun.lock`, and `src/adapters/codecommit-provider.ts`. This is the RED check for the dependency-boundary refactor; application behavior already has provider regression tests.

- [ ] **Step 2: Switch `CodeCommitProvider` to the local runtime units**

Replace the `@pawl/codecommit` imports at the top of `src/adapters/codecommit-provider.ts` with:

```ts
import { CodeCommitReviewClient } from "./codecommit-review-client";
import type {
  ChangedFile as CodeCommitChangedFile,
  CodeCommitReviewTransport,
  PullRequestSnapshot,
  ReviewComment as CodeCommitReviewComment,
} from "./codecommit-review-types";
```

Within the file, rename only the two package-origin aliases:

```text
PawlChangedFile     -> CodeCommitChangedFile
PawlReviewComment   -> CodeCommitReviewComment
```

Keep `CodeCommitClientPort`, dependency injection, provider-neutral mapping, hunks, fingerprints, locations, and comment resolution unchanged.

- [ ] **Step 3: Remove the obsolete app workspace and dependency**

In `package.json`:

- remove `../pawl/packages/codecommit` from `workspaces.packages`;
- remove `"@pawl/codecommit": "workspace:*"` from `dependencies`;
- retain `"@aws-sdk/client-codecommit": "catalog:"` from Task 1.

Run:

```bash
cd "$APP"
rtk bun install
```

Expected: `bun.lock` no longer contains the `@pawl/codecommit` workspace resolution, while CodeCommit SDK resolution remains through the app's direct dependency.

- [ ] **Step 4: Verify focused behavior and the GREEN boundary**

Run:

```bash
cd "$APP"
rtk bun run fmt
rtk test bun test tests/unit/codecommit-review-client.test.ts tests/unit/codecommit-provider.test.ts
rtk tsc --noEmit
if rtk rg -n '@pawl/codecommit|\.\./pawl/packages/codecommit' package.json bun.lock src tests; then
  echo 'obsolete app dependency remains' >&2
  exit 1
fi
```

Expected: 27 focused tests pass, TypeScript reports no errors, and the boundary search prints no matches.

- [ ] **Step 5: Verify the app no longer needs the Pawl package directory**

Temporarily prove resolution does not traverse the old workspace by asking Bun for a frozen install after the workspace edge is gone:

```bash
cd "$APP"
rtk bun install --frozen-lockfile
rtk bun run lint
rtk bun run fmt:check
```

Expected: frozen install makes no changes; lint and formatting pass without resolving `../pawl/packages/codecommit`.

- [ ] **Step 6: Review and commit the adapter switch**

Run:

```bash
rtk git -C "$APP" diff --check
rtk git -C "$APP" diff --stat
rtk git -C "$APP" diff -- src/adapters/codecommit-provider.ts package.json bun.lock
rtk git -C "$APP" add src/adapters/codecommit-provider.ts package.json bun.lock
rtk git -C "$APP" commit -m 'refactor: remove Pawl CodeCommit runtime dependency'
```

Expected: one app commit that switches the production adapter and removes only the obsolete workspace/dependency edge.

---

### Task 3: Delete the obsolete Pawl runtime package

**Files:**

- Delete: `../pawl/packages/codecommit/index.ts`
- Delete: `../pawl/packages/codecommit/package.json`
- Delete: `../pawl/packages/codecommit/tsconfig.json`
- Delete: `../pawl/packages/codecommit/tsconfig.build.json`
- Delete: `../pawl/packages/codecommit/src/codecommit-review-client.ts`
- Delete: `../pawl/packages/codecommit/src/types.ts`
- Delete: `../pawl/packages/codecommit/tests/codecommit-review-client.test.ts`
- Delete: `../pawl/packages/codecommit/tests/fixtures/*.json`
- Modify: `../pawl/package.json`
- Modify: `../pawl/tsconfig.json`
- Modify: `../pawl/bun.lock`
- Verify unchanged: `../pawl/packages/cdk/src/codecommit-review-events.ts`
- Verify unchanged: `../pawl/packages/cdk/tests/codecommit-review-events.test.ts`
- Verify unchanged: `../pawl/packages/cdk/index.ts`

- [ ] **Step 1: Reconfirm Pawl preservation state and current package behavior**

Run:

```bash
rtk git -C "$PAWL" status --short --branch
rtk git -C "$PAWL" rev-parse HEAD
cd "$PAWL"
rtk test bun test packages/codecommit/tests/codecommit-review-client.test.ts
PATH="$PWD/node_modules/.bin:$PATH" rtk test bun test packages/cdk/tests/codecommit-review-events.test.ts
rtk tsc -p packages/cdk/tsconfig.build.json --noEmit --types bun
rtk run 'bunx biome check package.json tsconfig.json packages/cdk/src/codecommit-review-events.ts packages/cdk/tests/codecommit-review-events.test.ts packages/cdk/index.ts'
```

Expected before deletion: Pawl tracked state is clean at `919b7e22e7f751b594d1c432ffed828eed14ec83`; 19 runtime client tests and 17 focused construct tests pass; supplemental CDK TypeScript and focused Biome pass. `.pi-subagents/` remains the only untracked path.

- [ ] **Step 2: Capture the Pawl cleanup RED state**

Run:

```bash
cd "$PAWL"
rtk rg -n '@pawl/codecommit|@aws-sdk/client-codecommit' package.json tsconfig.json bun.lock packages/codecommit
```

Expected: matches prove the package, path alias, SDK catalog entry, and lockfile resolution still exist.

- [ ] **Step 3: Delete the package and remove root references**

Run:

```bash
cd "$PAWL"
rm -rf packages/codecommit
```

In root `tsconfig.json`, delete exactly:

```json
"@pawl/codecommit": ["./packages/codecommit/index.ts"],
```

In root `package.json`, delete exactly:

```json
"@aws-sdk/client-codecommit": "3.1089.0",
```

Do not remove Zod or any other shared catalog entry; other Pawl packages still use them.

- [ ] **Step 4: Regenerate Pawl's lockfile**

Run:

```bash
cd "$PAWL"
rtk bun install
```

Expected: `bun.lock` drops the `@pawl/codecommit` workspace and the package-specific `@aws-sdk/client-codecommit` resolution. No other workspace package disappears.

- [ ] **Step 5: Verify the infrastructure construct remains healthy**

Run:

```bash
cd "$PAWL"
PATH="$PWD/node_modules/.bin:$PATH" rtk test bun test packages/cdk/tests/codecommit-review-events.test.ts
rtk tsc -p packages/cdk/tsconfig.build.json --noEmit --types bun
rtk run 'bunx biome check package.json tsconfig.json packages/cdk/src/codecommit-review-events.ts packages/cdk/tests/codecommit-review-events.test.ts packages/cdk/index.ts'
```

Expected: 17 focused construct tests, supplemental CDK TypeScript, and focused Biome pass. Do not edit the construct merely because the runtime package was removed. The standard CDK build is not a hard gate because its preserved baseline already fails on unrelated missing Node/DOM ambient types.

- [ ] **Step 6: Verify the GREEN Pawl boundary and unchanged construct**

Run:

```bash
cd "$PAWL"
test ! -e packages/codecommit
if rtk rg -n '@pawl/codecommit|@aws-sdk/client-codecommit' package.json tsconfig.json bun.lock packages; then
  echo 'obsolete Pawl runtime boundary remains' >&2
  exit 1
fi
rtk git diff --check
rtk git diff 919b7e22e7f751b594d1c432ffed828eed14ec83 -- packages/cdk/src/codecommit-review-events.ts packages/cdk/tests/codecommit-review-events.test.ts packages/cdk/index.ts
```

Expected: no obsolete references, no whitespace errors, and no diff at all for the three preserved CDK files.

- [ ] **Step 7: Review and commit the Pawl deletion**

Run:

```bash
rtk git -C "$PAWL" diff --stat
rtk git -C "$PAWL" diff -- package.json tsconfig.json bun.lock packages/codecommit
rtk git -C "$PAWL" add --all package.json tsconfig.json bun.lock packages/codecommit
rtk git -C "$PAWL" commit -m 'refactor: remove CodeCommit runtime package'
rtk git -C "$PAWL" status --short --branch
```

Expected: one Pawl commit containing only the package deletion and root manifest/config/lock cleanup. `.pi-subagents/` remains untracked.

---

### Task 4: Correct durable reviewer architecture documentation

**Files:**

- Modify: `docs/superpowers/specs/2026-07-17-durable-code-reviewer-design.md`
- Modify: `docs/superpowers/plans/2026-07-17-durable-code-reviewer.md`

- [ ] **Step 1: Capture stale documentation references**

Run:

```bash
cd "$APP"
rtk rg -n '@pawl/codecommit|packages/codecommit|Pawl CodeCommit runtime' docs/superpowers/specs/2026-07-17-durable-code-reviewer-design.md docs/superpowers/plans/2026-07-17-durable-code-reviewer.md
```

Expected: matches in the architecture, file map, historical Task 7, dependency instructions, provider instructions, Pawl verification commands, acceptance criterion 17, and delivery sequence.

- [ ] **Step 2: Update the durable reviewer design**

Make these exact semantic replacements in `docs/superpowers/specs/2026-07-17-durable-code-reviewer-design.md`:

- Scope: Pawl supplies CDK and Lambda abstractions; the application owns the CodeCommit runtime adapter.
- Source-control provider: the CodeCommit adapter delegates raw SDK operations to the app-local `CodeCommitReviewClient`.
- Section 5.3: rename it from `@pawl/codecommit` to `App-local CodeCommit runtime` and state that runtime commands, validation, pagination, DTOs, and injected transport live under `src/adapters/`.
- Testing: move client contract tests from “Pawl package tests” to app unit/adapter tests.
- Acceptance criterion 17: CodeCommit runtime SDK usage is confined to the app-local client, while reusable infrastructure remains in `@pawl/cdk`.
- Delivery sequence item 5: add the app-local CodeCommit runtime client; do not create a Pawl package.

Do not change product behavior, provider-neutral interfaces, or the approved Pawl-first infrastructure boundary.

- [ ] **Step 3: Correct the historical implementation plan**

In `docs/superpowers/plans/2026-07-17-durable-code-reviewer.md`:

1. Update the header architecture and tech stack to name the app-local client and direct SDK dependency.
2. Replace the two Pawl package file-map entries with:

```markdown
| `src/adapters/codecommit-review-types.ts` | App-owned CodeCommit DTOs and injectable transport contract |
| `src/adapters/codecommit-review-client.ts` | Paginated PR/diff/file/comment operations and idempotent comment writes |
```

3. Change the `codecommit-provider.ts` file-map description to “backed by the app-local CodeCommit review client.”
4. Replace Task 7 with an app-local client task using the files and RED/GREEN contract from Tasks 1–2 of this migration plan. Include an explicit note that `@pawl/codecommit` must not be recreated.
5. In Task 9, replace `@pawl/codecommit` and its workspace path with direct `@aws-sdk/client-codecommit` usage.
6. In Task 11, state that the provider delegates raw calls to the app-local client.
7. In Tasks 17–18, remove `packages/codecommit/tests` and `packages/codecommit` from Pawl commands; add the app-local client test to the app verification commands.

Keep unrelated task numbering, acceptance behavior, and future work intact.

- [ ] **Step 4: Verify documentation consistency**

Run:

```bash
cd "$APP"
rtk bun run fmt
rtk bun run fmt:check
rtk rg -n 'app-local CodeCommit|CodeCommitReviewClient|@pawl/cdk' docs/superpowers/specs/2026-07-17-durable-code-reviewer-design.md docs/superpowers/plans/2026-07-17-durable-code-reviewer.md
if rtk rg -n 'new local `@pawl/codecommit`|Add the `@pawl/codecommit`|backed by `@pawl/codecommit`|packages/codecommit/tests|\.\./pawl/packages/codecommit' docs/superpowers/specs/2026-07-17-durable-code-reviewer-design.md docs/superpowers/plans/2026-07-17-durable-code-reviewer.md; then
  echo 'stale executable documentation remains' >&2
  exit 1
fi
rtk git diff --check
```

Expected: corrected local-client references are present; no instruction remains that would recreate or consume the deleted package.

- [ ] **Step 5: Review and commit documentation**

Run:

```bash
rtk git -C "$APP" diff -- docs/superpowers/specs/2026-07-17-durable-code-reviewer-design.md docs/superpowers/plans/2026-07-17-durable-code-reviewer.md
rtk git -C "$APP" add docs/superpowers/specs/2026-07-17-durable-code-reviewer-design.md docs/superpowers/plans/2026-07-17-durable-code-reviewer.md
rtk git -C "$APP" commit -m 'docs: correct CodeCommit runtime ownership'
```

Expected: one app documentation commit with no production or dependency changes.

---

### Task 5: Run cross-repository acceptance and boundary checks

**Files:**

- Verify: all changed files in the durable reviewer worktree
- Verify: all changed files in the paired Pawl worktree
- Do not create additional files or commits unless a failing check exposes a real migration defect

- [ ] **Step 1: Run all durable reviewer quality gates**

Run:

```bash
cd "$APP"
rtk bun run lint
rtk bun run fmt:check
rtk test bun test tests/unit/codecommit-review-client.test.ts tests/unit/codecommit-provider.test.ts
rtk test bun test
rtk tsc --noEmit
rtk bun install --frozen-lockfile
rtk git diff --check
```

Expected: Oxlint has zero findings; Oxfmt reports all files matched; 27 focused tests and the expanded full suite pass; TypeScript has no errors; frozen install makes no changes; diff check is clean.

- [ ] **Step 2: Run the hard Pawl migration gates**

Run:

```bash
cd "$PAWL"
PATH="$PWD/node_modules/.bin:$PATH" rtk test bun test packages/cdk/tests/codecommit-review-events.test.ts
rtk tsc -p packages/cdk/tsconfig.build.json --noEmit --types bun
rtk run 'bunx biome check package.json tsconfig.json packages/cdk/src/codecommit-review-events.ts packages/cdk/tests/codecommit-review-events.test.ts packages/cdk/index.ts'
rtk bun install --frozen-lockfile
rtk git diff --check
```

Expected: 17 focused construct tests, supplemental CDK TypeScript, focused Biome, frozen install, and diff check pass.

- [ ] **Step 3: Re-run broad Pawl commands as non-regression evidence**

Run without changing tracked files:

```bash
cd "$PAWL"
set +e
PATH="$PWD/node_modules/.bin:$PATH" bun test > /tmp/pawl-boundary-full-test.log 2>&1
test_status=$?
bun run build > /tmp/pawl-boundary-build.log 2>&1
build_status=$?
bunx biome check . > /tmp/pawl-boundary-biome.log 2>&1
biome_status=$?
set -e
printf 'full tests=%s build=%s biome=%s\n' "$test_status" "$build_status" "$biome_status"

if [ "$test_status" -ne 0 ]; then
  rtk rg -n 'docker API|LocalStack|connect' /tmp/pawl-boundary-full-test.log
fi
if [ "$build_status" -ne 0 ]; then
  rtk rg -n 'TS2304|TS2584|TS2591' /tmp/pawl-boundary-build.log
fi
if [ "$biome_status" -ne 0 ]; then
  rtk rg -n '\.pi-subagents|templates/pawl-init/package.json' /tmp/pawl-boundary-biome.log
fi
if rtk rg -n '@pawl/codecommit|packages/codecommit' /tmp/pawl-boundary-full-test.log /tmp/pawl-boundary-build.log /tmp/pawl-boundary-biome.log; then
  echo 'broad command exposed a deleted-package regression' >&2
  exit 1
fi
```

Expected: any nonzero status is explained only by the captured pre-change categories: unavailable Docker/LocalStack services, pre-existing Node/DOM ambient-type build errors, or broad Biome scanning of untracked artifacts/unrendered templates. No output references the deleted package. If a new failure category appears, stop and investigate it rather than declaring a baseline exception.

- [ ] **Step 4: Prove the final dependency boundaries**

Run:

```bash
cd "$APP"
if rtk rg -n '@pawl/codecommit|\.\./pawl/packages/codecommit' package.json bun.lock src tests; then exit 1; fi
rtk rg -n '@aws-sdk/client-codecommit' package.json bun.lock src/adapters/codecommit-review-client.ts tests/unit/codecommit-review-client.test.ts

cd "$PAWL"
test ! -e packages/codecommit
if rtk rg -n '@pawl/codecommit|@aws-sdk/client-codecommit' package.json tsconfig.json bun.lock packages; then exit 1; fi
rtk rg -n 'CodeCommitReviewEvents' packages/cdk/index.ts packages/cdk/src/codecommit-review-events.ts packages/cdk/tests/codecommit-review-events.test.ts
```

Expected: only the app owns the runtime SDK/client; Pawl contains no runtime package residue; the infrastructure construct remains implemented, exported, and tested.

- [ ] **Step 5: Review commit scope and repository cleanliness**

Run:

```bash
rtk git -C "$APP" status --short --branch
rtk git -C "$APP" log --oneline --decorate -5
rtk git -C "$APP" diff HEAD~3..HEAD --stat
rtk git -C "$PAWL" status --short --branch
rtk git -C "$PAWL" log --oneline --decorate -3
rtk git -C "$PAWL" diff 919b7e22e7f751b594d1c432ffed828eed14ec83..HEAD --stat
rtk git -C "$PAWL" diff 919b7e22e7f751b594d1c432ffed828eed14ec83..HEAD -- packages/cdk/src/codecommit-review-events.ts packages/cdk/tests/codecommit-review-events.test.ts packages/cdk/index.ts
```

Expected: the app has the planned runtime, adapter/dependency, and documentation commits; Pawl has one deletion/cleanup commit; both tracked worktrees are clean; Pawl still shows only `.pi-subagents/` untracked; the preserved CDK files have no diff.

- [ ] **Step 6: Request final independent review**

Use `@superpowers:requesting-code-review` with both repository ranges. The reviewer must compare implementation against `docs/superpowers/specs/2026-07-18-codecommit-runtime-boundary-design.md`, inspect all non-copy edits, confirm runtime behavior parity, and verify no runtime code moved into `@pawl/cdk`.

Apply any valid Critical or Important findings through the original task implementer, rerun the affected focused checks, rerun Steps 1–5, and request re-review. Before reporting completion, use `@superpowers:verification-before-completion` and cite fresh command evidence.
