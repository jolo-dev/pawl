# Project-local Startup Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save validated AWS startup choices per project and replace repeated Clack questions with a Continue/Change settings overview.

**Architecture:** A settings store owns validation and filesystem safety. A startup coordinator composes that store with the existing injectable preflight; shared AWS validation serves saved and interactive selections. Clack remains before the renderer and receives optional initial selections.

**Tech Stack:** TypeScript, existing Zod, Node filesystem APIs, Bun tests, existing Clack and AWS adapters. No new dependencies.

**Approved spec:** `docs/superpowers/specs/2026-09-14-project-startup-settings-design.md` (commit `b32d55f`, subsequently approved by the owner).

---

## Execution safety and baseline

Paths below are repository-relative. Run CLI commands from `packages/cli`; run repository lint/tests from the repository root. Prefix shell commands with `rtk`.

The checkout already contains uncommitted model, TUI, pulse, presenter, and `index.ts` changes, plus unrelated skill files. Record `rtk git status --short` and capture the current diff before implementation. Never reset/stash those edits or use broad staging. Prefer inline sequential execution here; managed writer worktrees require a clean source checkout and explicit coordination of the existing changes first. Do not launch a writer against the dirty checkout through a worktree protocol that requires cleanliness.

At each task checkpoint, inspect the feature delta. Do not make mixed commits of previously modified files. Use hunk-level staging only after reviewing it against the captured baseline, or defer feature commits until the owner has chosen how to preserve the existing work. Newly created feature-only files may be staged individually. Nothing in this plan authorizes committing unrelated UI/model changes.

Baseline: 439 CLI tests pass; root lint passes; root suite has 1390 pass, 8 skip, and 4 failures associated with missing `LOCALSTACK_AUTH_TOKEN`. CLI `tsc --noEmit` reports 50 existing errors. Root and CLI have different working directories; do not confuse suite totals.

## File map

Create:
- `packages/cli/src/settings.ts`: strict settings schema and project-local load/save store.
- `packages/cli/tests/settings.test.ts`: real temporary-directory persistence and safety tests.
- `packages/cli/src/tui/preflight-validation.ts`: shared AWS/profile/model validation, with no persistence.
- `packages/cli/tests/tui-preflight-validation.test.ts`: exact-scope and authentication checks.
- `packages/cli/src/tui/startup.ts`: saved-settings overview, recovery, wizard composition and save handling.
- `packages/cli/tests/tui-startup.test.ts`: startup state transitions with injected adapters.
- `packages/cli/tests/tui-clack-prompter.test.ts`: production adapter initial-selection forwarding.

Modify:
- `packages/cli/src/tui/preflight.ts`: optional defaults and shared validation, preserving Back/cancel behavior.
- `packages/cli/tests/tui-preflight.test.ts`: defaults, changed selections and existing regressions.
- `packages/cli/src/tui/clack-prompter.ts`: optional initial select value and a narrow injectable select function for adapter tests.
- `packages/cli/index.ts`: replace the direct wizard call with the startup coordinator; preserve current renderer/session/pulse wiring and subcommand early exits.
- `packages/cli/README.md`: document project-local settings and recovery.

Do not change `src/aws-credentials.ts`, Bedrock catalog policy, the TUI layout/pulse, or generic scaffolding for this feature. The existing `checkBedrockAccess()` only proves its current ListFoundationModels check; do not claim model invocation is guaranteed.

## Task 1: Strict schema and project-local loading

**Files:** create `src/settings.ts`, `tests/settings.test.ts`.

- [ ] Write failing temporary-directory tests: missing file; valid v1 file; independent projects; invalid JSON/version/unknown fields; empty, excessive-length, and control-character strings; unreadable/non-file paths; symlinked `.pawl` and settings files. Assert that load never writes or follows a symlink target.
- [ ] Run `rtk test bun test tests/settings.test.ts`; confirm failures are at the new settings boundary.
- [ ] Implement this schema and public contract (names may be kept exactly):

```ts
import { z } from "zod";

const plainString = (max: number) => z.string()
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/.test(value),
    "Terminal control characters are not allowed")
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(max));

export const projectSettingsSchema = z.object({
  version: z.literal(1),
  profile: plainString(256),
  region: plainString(64),
  modelId: plainString(256),
  modelName: plainString(256),
}).strict();
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type SettingsLoad =
  | { readonly kind: "missing" }
  | { readonly kind: "saved"; readonly settings: ProjectSettings }
  | { readonly kind: "unusable"; readonly reason: string };
export interface ProjectSettingsStore {
  load(): Promise<SettingsLoad>;
  save(selection: Omit<ProjectSettings, "version">): Promise<void>;
}
export class SettingsError extends Error {}
```

Validate control characters on the original string, before trimming, so trailing newlines/escape bytes cannot be normalized into acceptance.

- [ ] Add `createProjectSettingsStore(projectDir)` using absolute paths rooted at that directory. Use `lstat` to reject symlinked directories/files before reading. Missing `.pawl` or missing settings is `missing`; every other IO/parse/schema failure is `unusable` with an actionable message. Do not include raw malformed file contents in diagnostics.
- [ ] Re-run the tests and root lint. Inspect the task-only diff; checkpoint without staging unrelated changes.

## Task 2: Atomic saving and settings-specific Git protection

**Files:** extend `src/settings.ts`, `tests/settings.test.ts`.

- [ ] Add failing tests for exact saved keys; file mode `0600` on POSIX; existing `.pawl/plan.md` preservation; existing `.pawl/.gitignore` preservation; idempotent saves; symlinked `.gitignore`; ignore/write failures; temp-file cleanup; failed rename preserving the previous settings. Use real filesystem operations except a narrow injected rename failure when necessary—never a process-global fs mock.
- [ ] Run the focused suite and confirm the save behavior fails before implementation.
- [ ] Build the serialized object by explicitly selecting `profile`, `region`, `modelId`, and `modelName`, and adding `version: 1`. Parse it with the schema before performing any writes. Do not spread arbitrary caller objects into the persisted file.
- [ ] Create `.pawl` if absent, checking that an existing path is a real directory. Before changing `.pawl/.gitignore`, reject symlinks and non-files. Preserve its content and append this block if it is not already the final block:

```gitignore
# pawl local startup settings
/settings.json
/.settings-*.tmp
```

Keeping the block last makes earlier negation rules ineffective for these two paths. Preserve newline boundaries. Do not change the project root ignore file, Git index, or any other `.pawl` files. If Git-ignore protection fails, do not write settings.

- [ ] Write JSON plus a final newline to a sibling `.settings-<randomUUID>.tmp` using exclusive creation (`wx`) and mode `0600`; rename over `settings.json` only after the complete write. Recheck the destination is not a symlink before replacement. Clean up the owned temp file on any failure, reporting cleanup failures rather than silently swallowing them. Do not remove a temp file that this call did not create.
- [ ] Wrap filesystem failures in `SettingsError` with a useful path/operation message. Never delete or truncate existing settings before the rename. A symlinked `.pawl/.gitignore` must not cause a write to its target.
- [ ] Where available, create a temporary Git repository and verify `git check-ignore` matches settings/temp files but not `plan.md`. Check directories are independent and no home-directory state is read.
- [ ] Re-run the settings suite and lint; inspect/checkpoint feature-only changes.

## Task 3: Share AWS validation between saved and interactive startup

**Files:** create `src/tui/preflight-validation.ts`, `tests/tui-preflight-validation.test.ts`; update `src/tui/preflight.ts`, `tests/tui-preflight.test.ts`.

- [ ] Write failing tests for a saved exact scope accepted; a removed scope rejected despite an available matching base model; removed profile rejected before auth; empty catalog; thrown profile/config/catalog/access errors; access denied; expired SSO login followed by credential validation; valid SSO token still followed by credential validation; SSO URL reported through the prompter.
- [ ] Run the two preflight suites and confirm the new cases fail.
- [ ] Extract the profile-list, authenticated-catalog, and selected-model/access stages. Keep all AWS dependencies injected through existing `PreflightDeps`. Return typed failure outcomes, including profile-region lookup errors, rather than leaking exceptions. Suggested contract:

```ts
type Failure = Extract<PreflightOutcome, { ok: false }>;
type Checked<T> = { readonly ok: true; readonly value: T } | Failure;

// Each helper accepts deps/prompter explicitly.
// loadProfiles -> Checked<readonly string[]>
// loadAuthenticatedModels(profile, region) -> Checked<readonly BedrockModelGroup[]>
// validateModelSelection(profile, region, modelId, groups) -> PreflightOutcome
// validateSavedSelection(selection) -> PreflightOutcome
```

`loadAuthenticatedModels` reads SSO configuration, logs in only if required, always runs `checkCredentials(profile, region)`, and then lists model groups. `validateModelSelection` finds `group.scopes.includes(modelId)` exactly, checks existing Bedrock access, and returns the authoritative group name. `validateSavedSelection` composes all stages after checking the profile is still listed. No paid inference probe.

- [ ] Adapt the interactive wizard to the same helpers. Collect profile and region before the shared auth/catalog stage so STS validates the selected region. Update existing rejected-credentials test answers to include region; retain its failure assertion. Preserve the provider/model/scope Back behavior and one-scope shortcut.
- [ ] Ensure an arbitrary/non-listed profile or scope returned by an injected prompter cannot bypass validation. Keep `PreflightSuccess` and `PreflightOutcome` caller contracts intact; type-only imports may connect validation and preflight without a runtime import cycle.
- [ ] Re-run existing/new preflight tests, typecheck and lint; inspect/checkpoint the extraction independently of settings UI.

## Task 4: Saved defaults and real Clack initial-selection wiring

**Files:** update `src/tui/preflight.ts`, `src/tui/clack-prompter.ts`, `tests/tui-preflight.test.ts`; create `tests/tui-clack-prompter.test.ts`.

- [ ] Add failing tests that record actual prompt requests: saved profile/region/provider/base-model/scope appear as initial values; missing defaults are omitted; changed profile uses its configured region; changed provider/model does not inherit an incompatible scope; Back still works; cancellation returns without success.
- [ ] Add an optional `initialValue?: string | undefined` to `PreflightPrompter.select` and an optional third argument `{ defaults?: PreflightSuccess }` to `runPreflight`. Existing callers with two arguments remain valid.
- [ ] For every select, set an initial value only if it appears in the current options. Derive a saved group by exact `scopes.includes(defaults.modelId)` in the live catalog. When the user changes provider/model, only apply that default if the current candidate set still includes it. When the profile differs from saved defaults, suggest its own configured region or the existing `us-east-1` fallback.
- [ ] Forward `request.initialValue` to Clack's `select<string>`. The installed public declarations are at `node_modules/@clack/prompts/dist/index.d.mts` under the repository root and support `initialValue`.
- [ ] Add a narrow optional injected Clack select function to the adapter factory, defaulting to the real `select<string>`. Test the adapter's constructed Clack options, initial value, Back mapping and symbol cancellation without starting a real interactive prompt or using a global module mock. Preserve status/text/notice behavior; do not broaden this into an unrelated Clack rewrite.
- [ ] Run `rtk test bun test tests/tui-preflight.test.ts tests/tui-clack-prompter.test.ts tests/tui-prompter.test.ts`; retain compatibility with the old numbered transcript prompter, which does not need new visual-default behavior because production startup uses Clack.
- [ ] Inspect/checkpoint feature-only changes.

## Task 5: Saved startup overview, explicit recovery and safe persistence

**Files:** create `src/tui/startup.ts`, `tests/tui-startup.test.ts`.

- [ ] Write failing tests using an injected `ProjectSettingsStore`, existing fake AWS dependencies, and a scripted prompter. Cover every branch below, including no save on cancelled/failed edits and no AWS calls before the saved-overview choice.
- [ ] Implement:

```ts
export interface StartupOptions {
  readonly store: ProjectSettingsStore;
  readonly deps: PreflightDeps;
  readonly prompter: PreflightPrompter;
}
export function runStartup(options: StartupOptions): Promise<PreflightOutcome>;
```

Use stable prompt IDs: `saved-settings` (Continue/Change settings), `settings-recovery` (Change settings/Cancel). Values are `continue`, `change`, and `cancel`; Continue has `initialValue: "continue"`. Standard null/BACK cancellation returns `{ok:false, cancelled:true, reason:"Cancelled."}`.

- [ ] On `saved`, show `profile`, `region`, `modelName`, and exact `modelId` through `notice` and ask `saved-settings`. Continue runs `validateSavedSelection`; Change runs `runPreflight` with defaults. Preserve the old result as edit defaults until a replacement succeeds.
- [ ] On `missing`, enter the wizard directly. On `unusable`, show the loader's reason and offer `settings-recovery` before opening a wizard without trusted defaults. Do not silently start a first-run wizard after corruption.
- [ ] Any non-cancelled AWS/wizard validation failure displays its reason and offers `settings-recovery`. Change reruns the wizard using any previously valid saved defaults; Cancel/null ends. Use an explicit loop, not recursion. Never auto-select another account/model or implicitly retry failed AWS operations forever.
- [ ] A successful validated selection is the only route to `store.save`. Saving on every success, including Continue, is allowed and repairs missing ignore protection; no need to implement a cache-diff optimization. If save throws, issue a notice such as `Could not save .pawl/settings.json: <reason>. Continuing with these settings for this session.` Return the validated success anyway. Do not repeat the wizard for a disk failure.
- [ ] Tests must show that failed/cancelled validation never calls save; save failure still returns success; stale exact scope offers recovery; edited defaults survive failed attempts; refreshed live model name is saved; nothing starts a runtime inside this coordinator.
- [ ] Run settings and all preflight/startup tests together, lint and typecheck; inspect/checkpoint feature-only changes.

## Task 6: Production wiring, documentation and complete verification

**Files:** update `packages/cli/index.ts`, `packages/cli/README.md`; extend startup integration tests as needed.

- [ ] Add a regression for loading a real temporary settings file through the coordinator, Continue with injected AWS checks, and verified persistence. Add a failed/cancelled path and assert it never returns a successful launch result.
- [ ] Replace only the direct `runPreflight` import/call in `index.ts` with:

```ts
const outcome = await runStartup({
  store: createProjectSettingsStore(projectDir),
  deps: defaultPreflightDeps(),
  prompter: createClackPrompter(),
});
```

Retain existing outcome handling and `result` usage. Do not move the renderer before Clack or change any `init` subcommand dispatch, presenter `setBusy` wiring, launch configuration, profile propagation, or account scanner behavior.

- [ ] Document `.pawl/settings.json`, its non-secret fields, Continue/Change settings, runtime credential checks, deleting the file to reset, write-failure warnings and `.pawl/.gitignore`. Note Git ignores do not untrack a file that the user already committed; do not run `git rm` automatically.
- [ ] From `packages/cli`, run `rtk test bun test tests` and `rtk proxy bunx tsc --noEmit`. CLI tests must pass; report typecheck errors against the baseline rather than claiming a clean project typecheck.
- [ ] From the repository root, run `rtk bun lint`, `rtk test bun test`, and `rtk git diff --check`. Expect no lint/whitespace errors; identify whether only the four known LocalStack-related failures remain.
- [ ] Manually exercise a real terminal (or an explicitly consented foreground run): first launch, saved overview with Enter for Continue, Change settings with a visible preselection, and cancellation. Use the production Clack adapter before OpenTUI; do not claim a mocked choice proves real terminal behavior. AWS access/SSO may require user interaction; report that limitation if a real run is unavailable rather than making an unauthorized model/deployment probe.
- [ ] Request a read-only feature-delta review against the captured starting state and this spec, checking persistence safety, auth parity, exact model identity, cancellation, and preservation of current UI changes. Fix introduced findings and rerun affected tests before completion.
- [ ] Summarize implemented behavior, checks actually run, unchanged baseline failures, and any unverified real-terminal/AWS behavior. Commit only feature-owned changes if staging can exclude all prior edits; otherwise leave the reviewed work unstaged for the owner.
