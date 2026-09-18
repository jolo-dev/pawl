# Local Pi runtime proof — Stage 1 evidence report

> Generated 2026-09-16 by Task 14 (`scripts/verify-pi-runtime-proof.ts`) on the
> feature worktree `feat/local-pi-runtime-proof`. **Status: OFFLINE proof
> complete; live Bedrock and real-terminal checks are PENDING separate owner
> authorization and are classified as pending/blocked, not passed.** A live
> model success would not prove every AWS operation or all models, so no live
> claim is made here.

## Scope and honest boundaries

- Production Eve remains the shipped runtime; nothing in this stage replaces
  `packages/cli/index.ts`, the Eve transport/launcher, authored Eve tools or
  startup menus. This report covers the embedded-Pi proof runtime under
  `packages/cli/src/pi-runtime/` only.
- The two added dependencies are exactly `@earendil-works/pi-agent-core@0.85.1`
  and `@earendil-works/pi-ai@0.85.1` (owner-approved pins). No TypeBox or other
  new direct dependency was added.
- Fixture/native evidence comes from offline Bun tests (deterministic fake
  provider streams, fake executors, controlled scan handlers). Fixture success
  proves the module contracts, not live AWS behavior.
- Live STS/Bedrock calls, real-terminal exercise, deployment and merge/push were
  NOT authorized for this run and were not performed. No credential was
  requested or resolved.

## Runtime and command identity

| Item | Value |
| --- | --- |
| Worktree / branch | `/Users/jolo/Development/pawl-pi-runtime-proof` on `feat/local-pi-runtime-proof` |
| Bun | 1.4.2 |
| Node (host) | v26.5.0; `packages/cli` `engines.node` = 24.x; monorepo >= 22 |
| Pi packages (pinned) | `@earendil-works/pi-agent-core` 0.85.1, `@earendil-works/pi-ai` 0.85.1 |
| Renderer | `@opentui/core` 0.5.11 (catalog pin) |
| Validation / test | zod 4.4.3 (catalog), Bun test |
| Proof runner | `rtk proxy bun packages/cli/scripts/verify-pi-runtime-proof.ts --project-dir <empty temp dir> [--tui] [--resume-session <id>]` |
| Test gate | `rtk proxy bun test packages/cli/tests/pi-runtime-proof-script.test.ts` — 22 pass, 0 fail |

## Requirement evidence matrix

| # | Requirement | Fixture / native / live evidence | Exact command | Result | Limitation |
| --- | --- | --- | --- | --- | --- |
| 1 | Isolation, frozen deps, clean baseline | Task 1 commit `5d7f6c9e`; `bun.lock` records only the two approved Pi pins; frozen install verified | `rtk proxy bun install --frozen-lockfile` (Task 1) | pass | Baseline limitations retained: missing docs typedoc env, Docker/LocalStack unavailable in broad runs |
| 2 | Zod↔Pi tool-schema bridge | `tests/pi-runtime-tool-schema.test.ts` (13.4K): plain strings, native min(0)/min(1) only; unsupported checks fail closed | `rtk proxy bun test packages/cli/tests/pi-runtime-tool-schema.test.ts` | pass (offline) | Bounded Stage 1 bridge; custom refinements/coercion unsupported by design |
| 3 | Checked AWS credential snapshots | `tests/pi-runtime-execution-context.test.ts`, `tests/pi-runtime-credential-lease.test.ts`, `tests/pi-runtime-checked-sdk.test.ts`: fresh command-local clients, exact frozen snapshots, per-attempt public middleware, combined cancellation, endpoint isolation, 5-min demand-driven leases, no failed-refresh fallback | `rtk proxy bun test packages/cli/tests/pi-runtime-{execution-context,credential-lease,checked-sdk}.test.ts` | pass | Proof boundary covers SDK operations wired through the checked executor only |
| 3b | Web identity region binding | `tests/pi-runtime-web-identity.test.ts`: acquisition region-bound to the selected context region, `authSchemePreference ["noAuth"]`, no environment/profile/IMDS region fallback | `rtk proxy bun test packages/cli/tests/pi-runtime-web-identity.test.ts` | pass | SSO retains its profile home region (intentional asymmetry) |
| 4 | Bedrock auth/stream gate | `tests/pi-runtime-bedrock.test.ts` + `tests/fixtures/pi-bedrock-sdk.ts`: ambient credential conflicts (bearer token, mixed session token, endpoint URLs) refuse; Nova/Claude payload assertions via schema-checked `onPayload` guard | `rtk proxy bun test packages/cli/tests/pi-runtime-bedrock.test.ts` | pass (fixture) | No live request made; live payload check is pending (row 21) |
| 5 | Owned conversation contract | `tests/pi-runtime-conversation.test.ts`, `tests/pi-runtime-reducer.test.ts`, `tests/pi-runtime-session-driver.test.ts`: event union, input routing, cancel/queued semantics, pending-input trap | focused bun test per file | pass | Session-driver cancel latch can wedge when cancel is called while idle (accepted report-only P2); Task 10 real conversation avoids inheriting it |
| 6 | Finite budgets, approvals, mutation permit | `tests/pi-runtime-policy.test.ts`, `tests/pi-runtime-approval.test.ts`, `tests/pi-runtime-mutation.test.ts`: 32 model calls/64 tool executions/15-min deadline/120-s request timeout/5-min approval timeout, 16 KiB result truncation, conservative UTF-8 context estimate, atomic reservations, coded exhaustion, digest-bound one-use grants consumed at the write boundary, questions never grant, no persistence, session-wide FIFO permit | focused bun test per file | pass | Partial asset/platform support is an intentional approved proof limit; exhaustion classification is conservative |
| 7 | Controlled subprocesses | `tests/pi-runtime-host-exec.test.ts`: every run bound through `context.withChildEnvironment` (realpath cwd, scrubbed/reseeded env, 0600 credential files, flag rejection, lifetime refusal), owned process groups, bounded SIGTERM→SIGKILL, fail-closed kill settlement, 64 KiB/stream capture | `rtk proxy bun test packages/cli/tests/pi-runtime-host-exec.test.ts` | pass | Known retained gap: ESRCH escaped-descendant reap (pre-Task-11 recommendation, deliberately unfixed in Stage 1) |
| 8 | Private files and durable sessions | `tests/pawl-local-files.test.ts`, `tests/pi-runtime-session-store.test.ts`: `.pawl/` private paths, alternating ignore-block churn prevented via the extracted settings helper (Task 8, sole planned shared-code change), `wx` lock 0600, fsynced FIFO appends, immutable project/account/region metadata, conservative reopen | focused bun test per file | pass | NO automatic stale-lock deletion: recovery is operator-confirmed cleanup; conservative lock cleanup is documented, not hidden |
| 9 | Immutable deployment artifact | `tests/pi-runtime-deploy-artifact.test.ts`: frozen assembly under `.pawl/artifacts`, `--app` + `--change-set false` template diff, no change sets, approval bound to digest/project/identity, mutation permit + integrity reverify + one-use grant at the deploy boundary | `rtk proxy bun test packages/cli/tests/pi-runtime-deploy-artifact.test.ts` | pass (fixture) | Covers only the explicitly supported artifact subset; no real deploy executed (pending) |
| 10 | Real Pi Agent integration | `tests/pi-runtime-agent.test.ts`: persistence-before-preflight, guarded `streamFn` with policy admission, one-use grants at executor boundary, `recordToolIntent` before side effects, `replay:"never"` permit holding, queue limit, exactly one terminal event, fatal classification, dispose semantics, restored-context boundary (history loads, nothing runs until a new prompt) | `rtk proxy bun test packages/cli/tests/pi-runtime-agent.test.ts` | pass | `thinkingLevel` hardcoded off in the agent (provider-level reasoning plan supplies medium reasoning); reviewer-noted executor-level non-policy refusal tightening left open |
| 11 | Representative tools behind policy | `tests/pi-runtime-tools.test.ts`: `ask_question` (additive broker.ask seam), `scan_resources` (injected seam; existing `cdk.out` read, never synthesizes the user's project), `generate` approval-gated with validated write set, `.pawl/sessions`+`.pawl/artifacts` never model-writable, deploy tools exist only with an injected deployment dependency, unknown tools fail closed | `rtk proxy bun test packages/cli/tests/pi-runtime-tools.test.ts` | pass | Non-synthesis scan limit: coverage/drift gaps preserved in results; not every Eve tool ported (Stage 2) |
| 12 | Bounded specialist orchestration | `tests/pi-runtime-specialists.test.ts`: four roles with authored-output schemas, parallel execution mode, replay-safe, shared ONE budgets + shared mutation coordinator, MAX_CONCURRENT_SPECIALISTS=2, pending-mutation refusal before settle, cancellation/dispose abort children, nested delegation/questions fail closed | `rtk proxy bun test packages/cli/tests/pi-runtime-specialists.test.ts` | pass | Parallel-mode comment vs sequential root toolExecution noted (defense-in-depth limit still correct); cancellation tests use barrier streams and assert child signal aborts (reviewer-recommended tightening applied in Task 12) |
| 13 | Native OpenTUI integration | `tests/pi-runtime-tui.test.ts`: real installed Pi Agent → deterministic fixture streams → Task 10 conversation → Task 5 driver/reducer → `createTuiView` → clean-baseline `createPawlApp` under the native `@opentui/core` test renderer; keyboard input injected via mock input; reasoning/tool/approval/question/cancel/resume frames asserted | `rtk proxy bun test packages/cli/tests/pi-runtime-tui.test.ts` | pass (native frames) | Automated native frames are NOT a substitute for the real-terminal check (pending, row 20) |
| 14 | Proof runner CLI contract | `tests/pi-runtime-proof-script.test.ts`: `--project-dir` required; offline default; `--offline`/`--live` mutually exclusive; live requires env `PAWL_PI_PROOF_LIVE=1` AND `--confirm-live-bedrock` AND `--profile/--region/--model-id/--second-model-id` (distinct models); invalid region refused; AWS flags refused offline; unknown args refused; parsing separated from execution (tests never log in or call AWS) | `rtk proxy bun test packages/cli/tests/pi-runtime-proof-script.test.ts` | pass | Live argument validation only; live execution unverified (pending) |
| 15 | Offline proof execution (runner) | `runProof` offline headless: explicit empty temporary project enforced (non-empty refused), session store created under `.pawl/sessions`, opening prompt → echo tool round trip → completed run, resume invocation loads history with 0 model requests/0 tool executions/0 user messages; run succeeds with garbage ambient `AWS_PROFILE`/`AWS_DEFAULT_REGION` (offline never resolves credentials); resume of unknown session refused | same test file; live runner invocation recorded: `mktemp -d` + `rtk proxy bun packages/cli/scripts/verify-pi-runtime-proof.ts --project-dir <dir>` (exit 0; completed, 2 model requests, 1 tool execution) then `--resume-session proof_offline_<ts>` (exit 0; 4 recovered entries, 0 requests) | pass | Offline fixtures only; no live provider request |
| 16 | Auth conflict refusals (runner + gate) | `--live` without env gate refused; env gate without `--confirm-live-bedrock` refused; `--confirm-live-bedrock` without `--live` refused; direct live `runProof` without env refused before any filesystem/AWS action; offline with `--profile`/`--model-id` refused; identical `--model-id`/`--second-model-id` refused | proof-script test suite | pass | Nothing beyond parse/gate refusals exercised live |
| 17 | Resume without automatic opening prompt | Runner resume test: `openSessionStore` reopens the prior session (identity/project/model metadata validated), `recoverSessionContext` feeds restored model context, zero provider requests until a new prompt; uncommitted tail discarded conservatively | proof-script test suite | pass | Resume replay of tools never happens automatically (Task 8/10 design) |
| 18 | Conservative context heuristic | Task 6 policy: conservative UTF-8 context estimate (`CONTEXT_ESTIMATE_OVERHEAD_UNITS`, safety reserve), coded `context_limit` with new-conversation guidance, history never trimmed | `tests/pi-runtime-policy.test.ts`, `tests/pi-runtime-agent.test.ts` | pass | Estimate is conservative, not exact tokenization; no automatic compaction (approved scope) |
| 19 | Unsupported asset forms/platforms | Deploy artifact tests pin unsupported generated-asset forms to explicit refusals; report-only scope note | `tests/pi-runtime-deploy-artifact.test.ts` | pass (fixture) | Stage 1 artifact subset only; Stage 2 must resolve real generated-asset coverage |
| 20 | Real-terminal check (offline `--tui`) | Runner implements it: `createCliRenderer` + `createPawlApp` + `createTuiView` + driver; Ctrl+C cancels an active run or closes when idle; best-effort exit lock cleanup; scripted offline sequence exercises question → approve/deny → done on the next typed prompt | manual, in owner terminal | **PENDING** — not authorized in this stage | Keyboard/paste, approve/deny/cancel, close, restart/resume responsiveness unverified; fixture processes at shutdown unverified |
| 21 | Live checks: STS identity, model discovery, streamed reply, tool round trip, second prompt, reasoning payload, cancellation, resume per model | Runner implements the flow: Clack credential/model validation (production `loadAuthenticatedModels`/`validateModelSelection`) before any renderer, Task 3 `createExecutionContext` (STS identity), Task 4 `createBedrockModelStream` (reasoning medium; Nova reasoningConfig vs Claude budget/adaptive payload guard), two distinct-model sessions, live resume single-session mode | `rtk proxy bun packages/cli/scripts/verify-pi-runtime-proof.ts --project-dir $(mktemp -d) --live --confirm-live-bedrock --profile <p> --region <r> --model-id <m1> --second-model-id <m2>` (env `PAWL_PI_PROOF_LIVE=1`) | **PENDING / BLOCKED** — owner authorization not granted; no AWS call, credential request or model selection was made | Each live model needs its own session (enforced); missing second-model access would block the second-model proof rather than silently substituting it. Default requested target: profile `jolo`, region `eu-central-1`, Nova `eu.amazon.nova-2-lite-v1:0`; second model to be chosen by owner (prefer an available Claude scope) |
| 22 | Pending dirty-UI integration | Uncommitted UI/model/pulse edits in the source checkout (`/Users/jolo/Development/pawl`) were explicitly excluded; worktree created clean from `1fba562` | parent snapshot `/tmp/pawl-pi-proof-start-svmAQ1/source-file-hashes.json` | recorded | Stage 2 must preserve/absorb those source changes before any production switch |

## Verification battery (Task 14, recorded with exit codes)

| Command | Exit | Outcome |
| --- | --- | --- |
| `rtk proxy bun test packages/cli/tests/pi-runtime-proof-script.test.ts` (RED first) | 1 | FAIL as expected (missing module) |
| `rtk proxy bun test packages/cli/tests/pi-runtime-proof-script.test.ts` (GREEN) | 0 | 22 pass, 0 fail, 86 expect() calls |
| `rtk proxy bun test packages/cli/tests` | 0 | 1143 pass, 0 fail across 79 files |
| `bunx biome check` (runner + test) | 0 | clean |
| `rtk proxy bun lint` | 0 | clean (435 files) |
| `rtk proxy bun run --cwd packages/cli typecheck` | 2 | exactly the retained 50 baseline diagnostics; zero in `scripts/verify-pi-runtime-proof.ts` or the new test |
| `rtk git diff --check` | 0 | clean |

Logs: `/tmp/pawl-pi-proof-start-svmAQ1/task-14/` (red-run, green-run-1..7, biome-1..5, tsc-after-2, full-cli-tests, root-lint, runner-e2e, runner-e2e-resume).

## Report hygiene

- Redacted by construction: the runner's evidence carries identity metadata
  (account id masked `1234…6789` style), model ids, request-shape counts and
  pass/fail checks only. Credential values, raw signing headers and full
  transcripts are never printed or persisted in reports.
- Private session files are kept after a run for an explicit second invocation
  (`--resume-session`); cleanup is manual: delete the temporary project
  directory. No credential material is ever written into the session store.
- Live/terminal rows are intentionally classified pending/blocked, not passed.
