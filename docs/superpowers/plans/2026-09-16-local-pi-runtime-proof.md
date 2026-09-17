# Local Pi Runtime Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove embedded Pi's critical contracts without replacing production Eve or performing a live deployment.

**Architecture:** Pi `Agent` runs the loop; new `src/pi-runtime/` modules own policy, explicit AWS execution identity, conversation events, local records and specialist orchestration. Deterministic provider streams and controlled executors exercise these modules through the real OpenTUI renderer. Authentication and schema feasibility are early stop/go gates, not assumptions buried beneath a full migration.

**Tech Stack:** Bun tests, strict TypeScript, Zod, Pi core/AI 0.85.1, existing AWS clients and credential providers, Node filesystem/child-process APIs, existing OpenTUI.

**Approved spec:** `docs/superpowers/specs/2026-09-16-local-pi-runtime-design.md`

---

## Scope, dependencies and evidence

- Retain production `packages/cli/index.ts`, Eve transport/launcher, authored Eve tools, scripts, Node engine requirement and dependencies. No permanent dual-runtime switch.
- No sandbox, generic shell tool, global Pi settings/auth/extensions, automatic compaction, detached agent jobs or automatic tool/approval replay.
- The two proposed direct additions are **exactly** `@earendil-works/pi-agent-core@0.85.1` and `@earendil-works/pi-ai@0.85.1`. Obtain explicit package-install approval before changing manifests. No TypeBox or other new direct dependency. Stop if public interfaces cannot support the bridge/auth requirements.
- Stage 1 implements representative tool adapters and proves policy; it does **not** port every Eve tool/instruction or change startup menus. Those and complete production asset support belong to the separately approved Stage 2 plan.
- Private-files support has one explicitly bounded shared-code change: extract settings' ignore-rule management so session/artifact writes cannot cause alternating ignore-block churn. Existing settings behavior and tests must remain compatible.
- Native renderer tests are offline. Live STS/model discovery/inference and an actual terminal exercise require separate owner authorization. No live deploy, asset upload or CloudFormation change-set creation is a proof step.
- Follow @test-driven-development and @verification-before-completion. Read @opentui and its testing/lifecycle docs before Task 13. Read installed Pi Markdown fully and relevant public declarations before implementing adapters.

### Starting state and commands

Planning checkout: `/Users/jolo/Development/pawl`, local `main`, `1fba562802c7bb338ed3f9799dc8360c881fe38d`. Recheck at execution start. Existing dirty UI/model/pulse changes, package/lockfile `microsandbox` change and untracked local configuration are not part of this stage. Do not reset, stage, copy or commit them.

All command blocks below run from the **feature worktree root**, unless explicitly marked otherwise. Prefix shell commands with `rtk`; use `rtk proxy` when raw output/exit semantics matter. Typecheck the CLI with `rtk proxy bun --cwd packages/cli run typecheck`, not a nonexistent root TypeScript project. Record stdout **and stderr**, plus exit codes; never interpret `|| true` as a passing check.

### File map and execution order

Tasks execute serially, one writer per worktree. Paths in this table are relative to `packages/cli/`.

| Task | Files created/modified | Responsibility |
|---|---|---|
| 1 | `package.json`, root `bun.lock`; approved spec/plan copied into worktree | Isolation, baseline, approved dependency pins |
| 2 | `src/pi-runtime/tool-schema.ts`; `tests/pi-runtime-tool-schema.test.ts` | Public Pi/Zod compatibility gate |
| 3 | `src/pi-runtime/execution-context.ts`; `tests/pi-runtime-execution-context.test.ts` | Checked credential snapshots and account binding |
| 4 | `src/pi-runtime/bedrock.ts`; `tests/pi-runtime-bedrock.test.ts`; `tests/fixtures/pi-bedrock-sdk.ts` | Actual Pi provider authentication/stream gate |
| 5 | `src/pi-runtime/{conversation,reducer,session-driver}.ts`; corresponding `tests/pi-runtime-*.test.ts` | Owned UI contract and input routing |
| 6 | `src/pi-runtime/{policy,approval,mutation}.ts`; corresponding tests | Finite budgets, human decisions, shared mutation permit |
| 7 | `src/pi-runtime/host-exec.ts`; `tests/pi-runtime-host-exec.test.ts` | Controlled subprocesses |
| 8 | `src/pawl-local-files.ts`, `src/settings.ts`, `src/pi-runtime/{session-record,session-store}.ts`; corresponding tests and existing settings tests | Private paths/ignores, durable records and conservative recovery |
| 9 | `src/pi-runtime/deploy-artifact.ts`; `tests/pi-runtime-deploy-artifact.test.ts` | Immutable, supported deployment material |
| 10 | `src/pi-runtime/agent.ts`; `tests/pi-runtime-agent.test.ts`; `tests/fixtures/pi-runtime-stream.ts` | Pi Agent integration and restored-context boundary |
| 11 | `src/pi-runtime/tools.ts`; `tests/pi-runtime-tools.test.ts` | Representative operations behind policy |
| 12 | `src/pi-runtime/specialists.ts`; `tests/pi-runtime-specialists.test.ts` | Bounded root-to-specialist orchestration |
| 13 | `src/pi-runtime/tui-view.ts`; `tests/pi-runtime-tui.test.ts` | New runtime through native OpenTUI |
| 14 | `scripts/verify-pi-runtime-proof.ts`; `tests/pi-runtime-proof-script.test.ts`; repo `docs/superpowers/proofs/2026-09-16-local-pi-runtime-proof.md` | Explicitly authorized provider/terminal proof and evidence |
| 15 | Only files above | Integrated review and stage gate |

## Task 1: Isolate, baseline, approve and pin dependencies

- [ ] **1. Capture source state without modifying it.** From `/Users/jolo/Development/pawl`, record branch/HEAD/worktrees, porcelain status, binary diff and copies of the two untracked design/plan documents in a newly created scratch directory. Record the scratch path. Do not copy unrelated files into the feature worktree.
- [ ] **2. Create the feature worktree after reading @using-git-worktrees.** Confirm the target path/branch are unused:

```bash
rtk git worktree add /Users/jolo/Development/pawl-pi-runtime-proof -b feat/local-pi-runtime-proof main
```

From then on, set tool `cwd` to `/Users/jolo/Development/pawl-pi-runtime-proof`. Copy **only** the approved spec and this plan from the source checkout into their matching worktree paths. Review/commit those documents explicitly; never use `git add .`.

- [ ] **3. Install the existing graph with the frozen lockfile and establish the clean-worktree baseline before adding Pi.** Source dirty-checkout test counts are historical context, not the comparator for this worktree.

```bash
rtk proxy bun install --frozen-lockfile
rtk proxy bun test packages/cli/tests > /tmp/pawl-pi-proof-clean-cli.log 2>&1
rtk proxy bun test > /tmp/pawl-pi-proof-clean-root.log 2>&1
rtk proxy bun lint > /tmp/pawl-pi-proof-clean-lint.log 2>&1
rtk proxy bun --cwd packages/cli run typecheck > /tmp/pawl-pi-proof-clean-tsc.log 2>&1
rtk git status --short
```

Execute checks individually and retain exit codes even when a preceding check fails. Expect known root LocalStack/typecheck failures; investigate new setup failures rather than hiding them. A frozen install must not alter the lockfile.

- [ ] **4. Ask for approval to install exactly the two Pi packages above.** If already explicitly approved in the execution conversation, record that authorization instead of asking again. No paid inference is authorized by package approval.
- [ ] **5. Add exact pins, then inspect the root manifest/lockfile delta.** This command does not change the shell's working directory:

```bash
rtk proxy bun add --cwd packages/cli --exact @earendil-works/pi-agent-core@0.85.1 @earendil-works/pi-ai@0.85.1
rtk git diff -- packages/cli/package.json bun.lock
```

Stop if pins are not exact, unexpected direct packages appear, or the installed public APIs differ from those reviewed. Do not import globally installed packages at runtime.

- [ ] **6. Commit only approved dependency files.**

```bash
rtk git add packages/cli/package.json bun.lock
rtk git commit -m "chore(cli): add pi runtime proof dependencies"
```

## Task 2: Prove the Zod/Pi schema bridge first

**Files:** `src/pi-runtime/tool-schema.ts`, `tests/pi-runtime-tool-schema.test.ts` (CLI-relative).

- [ ] **1. Write failing tests using a real Pi Agent/tool validation path, not just JSON-schema snapshots.** Cover current Pawl shapes: optional strings/booleans/string arrays, bounded integer, enums, defaults, string records and required object fields. Include `"2"` for a number, `"false"` for a boolean, optional `null`, unexpected keys and invalid enums. Assert both parsed values and that invalid raw inputs never enter the executor.
- [ ] **2. Run:** `rtk proxy bun test packages/cli/tests/pi-runtime-tool-schema.test.ts`. Expected: missing module/bridge failure.
- [ ] **3. Implement one adapter with this public shape:**

```ts
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Tool } from "@earendil-works/pi-ai";
import { z } from "zod";

export function toolParameters(schema: z.ZodObject): Tool["parameters"] {
	return z.toJSONSchema(schema, { io: "input" });
}
```

Prove this assignment and the actual validator on the pinned packages. Do not fix incompatibility with an unchecked cast. A bounded keyword/schema check must reject unsupported refinements/transforms/unrepresentable shapes rather than silently advertising weaker input constraints. Use the actual supported Zod type parameters required by 4.4.3.

`definePawlTool` must install `AgentTool.prepareArguments` to run authoritative `schema.parse(raw)` **before** Pi's normalizer/coercion. Pi's later `beforeToolCall` sees normalized values and is too late to enforce strict raw Zod semantics. Parse at the executor boundary too; use the canonical parsed input for approval hashing. Zod's own default/extra-key semantics must stay consistent with the advertised schema and Pi's second validation pass.

- [ ] **4. Rerun the focused suite and CLI typecheck; compare new diagnostics to baseline.** No undeclared `typebox` import, no `any`, no duplicate hand-maintained schemas.
- [ ] **5. Gate:** stop if plain public `Tool["parameters"]` plus Zod cannot preserve semantics. Request approval for a different bridge/dependency rather than importing a transitive package or weakening validation.
- [ ] **6. Commit only the two task files:** `feat(cli): bridge zod tool schemas to pi`.

## Task 3: Checked AWS credential snapshots

**Files:** `src/pi-runtime/execution-context.ts`, `tests/pi-runtime-execution-context.test.ts`.

- [ ] **1. Write failing tests** for explicit project/profile/region, account identity, refresh, expiry and conflicting ambient settings. Use injected credential/STS factories, never real AWS. Record the exact credential object passed to the identity check and SDK operation and assert they match. Include missing `Account`/`Arn`, changed account, changed role and harmless assumed-role session-name rotation.
- [ ] **2. Run:** `rtk proxy bun test packages/cli/tests/pi-runtime-execution-context.test.ts`. Expected: FAIL.
- [ ] **3. Implement `createExecutionContext` and `checkedCredentials(signal)` with immutable per-operation credential snapshots.** Resolve the selected profile explicitly with existing `fromIni({profile})`; verify the resolved **snapshot**, not an independently resolving profile, with STS. Cache successful identity validation only for that credential fingerprint until its expiration. On a changed fingerprint revalidate; reject expired credentials or incompatible account/partition/principal before starting work. Normalize the transient assumed-role session component, not the account/role identity. Fail closed if that normalization cannot be established.

The context exposes canonical project, selected profile/region, account/principal identity, an abort-aware checked credential provider and helpers for SDK configuration and child environments. Mutation/policy services are injected later; this task must not import not-yet-created modules.

SDK operations get the checked credential provider and region explicitly. A proof scan adapter must pass these into `runProjectScan`, not its `fromNodeProviderChain()` fallback. Startup production wiring is deferred, but the shared scan adapter is tested now.

For subprocesses, **do not just export a profile and hope CDK resolves the same identity**. Build each environment from the checked snapshot's access key, secret and optional session token plus selected region. Remove inherited `AWS_*` and conflicting `CDK_DEFAULT_ACCOUNT`/`CDK_DEFAULT_REGION` entries before assigning controlled values; preserve ordinary PATH/HOME/etc. Provide controlled AWS shared-config/credential files in a private temporary directory so an ambient default profile/credential process cannot replace the snapshot. Never log/persist those secrets as session metadata; remove temporary credential files on settlement. Their location is outside committed project content, mode `0600`, with bounded lifetime. Stage 1 rejects extra explicit profile flags and unapproved cross-account assume-role targets.

- [ ] **4. Test refresh against the same account/role succeeds; changed identity aborts the context and invalidates future work.** Child-process credentials cannot refresh independently: require remaining credential lifetime to cover the operation's bounded timeout plus 60 seconds; otherwise refresh before spawn or refuse. The proof does not promise automatic recovery from expiry during a deploy.
- [ ] **5. Rerun focused tests and commit:** `feat(cli): bind proof operations to checked aws credentials`.

## Task 4: Early Bedrock authentication and stream feasibility gate

**Files:** `src/pi-runtime/bedrock.ts`, `tests/pi-runtime-bedrock.test.ts`, `tests/fixtures/pi-bedrock-sdk.ts`.

**Verified 0.85.1 hazards:** scoped env lookup uses `env[name] || process.env[name]`; empty strings do not clear ambient values. A scoped/explicit profile makes the adapter ignore supplied static credentials. Bearer auth is independent of profile. `BedrockOptions` has no injected credential-provider field. The simple-stream wrapper does not promise forwarding of provider-specific profile/region options. Do not build against the old plan's empty-env assumptions.

- [ ] **1. Write failing tests that execute the real public `bedrockProviderModule.stream`, intercepting its SDK boundary in an isolated test subprocess.** Use Bun `mock.module` in the fixture before loading the provider to capture the constructed `BedrockRuntimeClient` config and command. Mock only the SDK transport exports required by that module, not Pawl's provider factory; never install/import an undeclared SDK package into production code. Isolate mocks so the rest of `bun test` is not contaminated. No network is permitted in this test process.
- [ ] **2. Include the negative cases:** empty env falls through, ambient bearer token, skip-auth, different profile/static credentials, absent selected session token with an ambient token, credential expiry/refresh/account change, mismatched model region, and cancellation before credential resolution. Assert actual client credentials/auth scheme/region and actual command model ID, not just wrapper arguments.
- [ ] **3. Run:** `rtk proxy bun test packages/cli/tests/pi-runtime-bedrock.test.ts`. Expected: FAIL.
- [ ] **4. Implement the supported mechanism:**

  1. Receive explicit profile/region via Task 3 context, obtain the freshly checked snapshot for each model request.
  2. Use the explicit `amazonBedrockProvider()` catalog (optionally registered in a fresh `createModels()` **for lookup only**). Do not call registry auth/login/default stores or let `Models.streamSimple` resolve ambient credentials.
  3. Call public `bedrockProviderModule.stream` directly. Supply non-empty scoped `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, selected token when present, `AWS_REGION`/`AWS_DEFAULT_REGION`, and `AWS_BEDROCK_SKIP_AUTH: "0"`. Omit both `options.profile` and scoped `AWS_PROFILE`: the selected profile has already been resolved and checked; supplying it again would re-enable independent SDK resolution. The SDK's explicit credential object must win over any ambient profile; prove this at the captured client boundary.
  4. Fail closed before calling the provider if a non-empty ambient `AWS_BEARER_TOKEN_BEDROCK` exists, or if selected credentials have no session token but an ambient `AWS_SESSION_TOKEN` exists. An empty override is **not** a solution. Reject caller-supplied `apiKey`, `bearerToken` or uncontrolled env overrides; construct a trusted allowlist of stream options instead of spreading unknown options. Check on every request, not only startup. No `process.env` mutation or subprocess model server workaround.
  5. Resolve the exact selected ID from live-approved Pawl scope membership and static metadata. Catalog base metadata may be cloned with the exact selected inference-profile ID, but invocation must never substitute the base ID. Require complete context/output metadata; absent metadata is an actionable unsupported-model result. Reject custom endpoints/ARN-region conflicts in this proof.
  6. Preserve medium reasoning for Nova 2 Lite via a narrow, schema-checked `onPayload` mapping to `reasoningConfig: {type: "enabled", maxReasoningEffort: "medium"}`; do not send Anthropic fields to Nova or this Nova mapping to other families. For the chosen Claude model use Pi's family-aware `reasoning: "medium"`. Test actual command bodies. Unknown reasoning behavior fails closed or is explicitly off, never guessed from catalog `reasoning: true` alone.
  7. Return an `AssistantMessageEventStream` even for preparation failures. Encode error/abort with a final assistant message; do not reject Pi's `StreamFn` promise. Forward abort and combine it with the per-request deadline once Task 6 is available. No automatic Pawl retry of a failed model request.

The payload hook verifies request shape/model **only**; it cannot prove signing identity. The checked snapshot plus observed SDK credential configuration is the offline identity evidence. Live STS/inference remains separate.

- [ ] **5. Rerun tests and CLI typecheck; record gate evidence.** If actual public provider behavior differs or cannot use checked credentials safely, **stop here** and report it before building the rest. Do not patch Pi internals, add an unapproved SDK, change execution modes, or claim equivalent identity from profile labels.
- [ ] **6. Commit:** `feat(cli): prove explicit pi bedrock authentication`.

## Task 5: Pawl conversation, reducer and input driver

**Files:** `src/pi-runtime/{conversation,reducer,session-driver}.ts`; `tests/pi-runtime-{conversation,reducer,session-driver}.test.ts`.

- [ ] **1. Write failing interface/reducer tests** for assistant/reasoning deltas, message boundaries, tool progress/results, explicit request IDs, partial batch resolution, deduplicated errors and application run boundaries. Unknown vendor events must not become approval requests. Reference current reducer tests without importing Eve types.
- [ ] **2. Run:** `rtk proxy bun test packages/cli/tests/pi-runtime-conversation.test.ts packages/cli/tests/pi-runtime-reducer.test.ts`. Expected: FAIL.
- [ ] **3. Implement this small owned boundary** (define each discriminated event/answer with Zod-derived types; never leak Eve/Pi unions):

```ts
export interface PawlConversation {
	readonly id: string;
	send(text: string): Promise<{ runId: string }>;
	answer(answer: PawlAnswer): Promise<void>;
	cancel(runId?: string): Promise<void>;
	events(): AsyncIterable<PawlConversationEvent>;
	dispose(): Promise<void>;
}
```

`send` accepts/persists input but does not await model completion. A single event consumer subscribes before send. Pi's inner `turn_end` is not an application terminal event. Exactly one terminal event per run is produced after cleanup/checkpoint settlement. Busy input is queued in memory only; queued prompts are discarded on cancel/dispose/restart. Enforce queue bound from Task 6.

- [ ] **4. Write failing driver tests** for numbered/ID choice resolution, freeform questions, invalid/stale/duplicate answers, cancellation while waiting, queue handling, echo once, disposal and late events. Bare unmatched text must not silently become approval or a new prompt while a request is pending.
- [ ] **5. Implement routing and driver.** The subscription consumes events and user input concurrently: it must not wait for `agent_end` before answering an approval that blocks the agent. Input-request state is not the end of a run. Test this deadlock explicitly with a promise barrier, not a sleep.
- [ ] **6. Run:** `rtk proxy bun test packages/cli/tests/pi-runtime-conversation.test.ts packages/cli/tests/pi-runtime-reducer.test.ts packages/cli/tests/pi-runtime-session-driver.test.ts`. Expected: PASS. Commit task files as `feat(cli): define local conversation lifecycle`.

## Task 6: Finite policy, approval gate and shared mutation coordinator

**Files:** `src/pi-runtime/{policy,approval,mutation}.ts`; matching `tests/pi-runtime-*.test.ts`.

### Fixed proof defaults

| Limit | Default and lifetime |
|---|---|
| Model calls | 32 total across root and specialists per accepted user prompt; includes failed/dispatched requests, not only successful responses |
| Tool executions | 64 total across root and specialists per prompt; counted immediately before execution |
| Run wall clock | 15 minutes from accepted prompt, including approval waits and all children |
| Model request | 120 seconds including credential preparation/streaming; combined abort signal |
| Host command | 120 seconds and no longer than remaining run budget; 2-second graceful cleanup then force termination and up to 3 more seconds to reap |
| Approval | 5 minutes, also expires with parent run/context; one-use, never persisted as a reusable grant |
| Concurrency | At most 2 specialists; one mutation across the entire root/child tree; children cannot delegate |
| Queued prompts | 8; excess is a visible rejection, never a silently lost submission |
| Tool text | 16 KiB UTF-8 per result with explicit truncation marker; preview truncation disables deploy approval until a complete view is available |
| Model output | `min(model.maxTokens, 4096)` tokens per call |
| Context admission | `estimate + outputReserve + safetyReserve <= model.contextWindow`; safety reserve `max(2048, ceil(contextWindow * 0.1))` |

Estimate text conservatively as UTF-8 bytes of system prompt + full model messages + tool schemas, plus 1024 overhead units. This is an admission heuristic, **not** an exact provider token count. The proof accepts text/tool conversations; image inputs or unknown opaque payload forms without a safe accounting rule are unsupported. Recognized reasoning/signature strings are preserved and counted. A provider context rejection is also an actionable context-limit outcome. Do not trim persisted or model history to pass the check.

- [ ] **1. Write failing policy tests** with injected clocks/counters: first prompt over limit; restored history over limit; tool result pushes next request over limit; 33rd root/child model call; 65th execution; expired approval/run; deadline during stream/approval/subprocess/child; exhausted queued prompt admission. Assert no additional model/tool starts after exhaustion.
- [ ] **2. Run:** `rtk proxy bun test packages/cli/tests/pi-runtime-policy.test.ts`. Expected: FAIL.
- [ ] **3. Implement atomic budget reservations and `checkBeforeModel`/`checkBeforeTool`.** Calls, tool allowance and deadlines belong to the root prompt's shared policy object, not independent child counters. Check before the **first** request as well as every subsequent request/tool; `shouldStopAfterTurn` is only an extra early-exit optimization. Do not throw from Pi hooks whose contract forbids rejection; return a normal terminal/error stream or blocked tool outcome and trigger shared cancellation. A fresh explicit prompt creates a new budget; an input answer or automatic follow-up iteration does not.
- [ ] **4. Write failing approval and mutation tests.** Bind approval to run/request/tool-call IDs, canonical arguments, plan/artifact digest, project and checked identity. Cover denied/stale/duplicate/expired responses, restart, generation writes bypassing the root tool, altered preview and account refresh. Assert root/child mutations serialize and no permit is held while a parent awaits a mutating child.
- [ ] **5. Run:** `rtk proxy bun test packages/cli/tests/pi-runtime-approval.test.ts packages/cli/tests/pi-runtime-mutation.test.ts`. Expected: FAIL.
- [ ] **6. Implement an abortable question/approval broker and `withMutation`.** Questions do not imply authorization. Consume grants at the actual executor/write boundary after validation; a UI answer or pre-tool hook alone is insufficient. Request decisions before acquiring the mutation permit. Release on every exit; cancelled waiters never enter. On denial stop the affected operation; do not depend on Pi's batch `terminate` hint to prevent sibling calls from executing after a run-wide cancel.
- [ ] **7. Rerun all three suites and commit:** `feat(cli): enforce bounded local runtime policy`.

## Task 7: Controlled subprocesses

**Files:** `src/pi-runtime/host-exec.ts`, `tests/pi-runtime-host-exec.test.ts`.

- [ ] **1. Write failing tests with controlled local Node fixtures only.** Cover stdout/stderr, nonzero exit, 64 KiB capture cap per stream with truncation markers, aborted-before-spawn, SIGTERM-resistant child and grandchild, inherited AWS conflicts, checked-snapshot environment, lifetime refusal and cleanup after errors. Avoid arbitrary process kills; retain only fixture-owned PIDs/groups.
- [ ] **2. Run:** `rtk proxy bun test packages/cli/tests/pi-runtime-host-exec.test.ts`. Expected: FAIL.
- [ ] **3. Implement `createControlledExec(context, policy)` as an internal executor, not a model-invoked shell.** Bind cwd/environment to Task 3. Every call accepts the shared signal and deadline. On macOS/Linux use owned process groups, graceful/forced deadlines from Task 6 and bounded reaping of pipes/descendants. Fail closed for mutating subprocess execution on unsupported platforms until equivalent cleanup is proven; do not quietly use a weaker path.
- [ ] **4. Propagate cleanup failures and uncertain remote outcomes.** Credential temporary files are removed after process settlement; leftover paths are reported without secret contents. Local cancellation cannot undo submitted AWS operations. Never retry a side effect because the child exited or its output was lost.
- [ ] **5. Rerun suite and commit:** `feat(cli): control local proof subprocesses`.

## Task 8: Shared private files and session persistence

**Files:** `src/pawl-local-files.ts`, `src/settings.ts`, `src/pi-runtime/{session-record,session-store}.ts`; `tests/pawl-local-files.test.ts`, `tests/pi-runtime-session-store.test.ts`; existing `tests/settings.test.ts` and `tests/tui-startup.test.ts`.

- [ ] **1. Write failing private-files tests before extracting the settings helper.** Alternate settings/session/artifact writes repeatedly; assert unchanged unrelated ignore content, final effective exclusions, no repeated append churn, no credential content, and `.pawl/plan.md` stays trackable. Test symlinked `.pawl`, ignore file, sessions/artifacts directories and target/temp files. Use `git check-ignore` in fixture repos; do not manipulate the user's index.
- [ ] **2. Run:** `rtk proxy bun test packages/cli/tests/pawl-local-files.test.ts`. Expected: FAIL.
- [ ] **3. Extract a shared `protectPawlLocalFiles` helper.** Keep one deterministic final managed block covering `/settings.json`, `/.settings-*.tmp`, `/sessions/`, `/.sessions-*.tmp`, `/artifacts/`, `/.artifacts-*.tmp`; preserve all other user content and effective precedence over prior negations. Settings delegates to it while retaining its version-1 fields, error behavior and atomic save contract. No production entrypoint changes. Refuse symlinks; document that these checks are not a sandbox against malicious same-user filesystem races.
- [ ] **4. Write failing codec/store tests:** version/sequence/header validation; private `0700` subdirectories and `0600` records/locks; immutable project/account/region metadata; unknown format rejected; complete and interrupted messages; opaque reasoning signatures/IDs; record ordering; middle corruption versus an incomplete trailing record; write failure before intent versus after execution; concurrent writers and conservative stale-lock behavior.
- [ ] **5. Run:** `rtk proxy bun test packages/cli/tests/pi-runtime-session-store.test.ts`. Expected: FAIL.
- [ ] **6. Implement version-1 JSONL records with a pinned Pi message codec.** Header stores session/project/identity/model/codec version; later records carry monotonic sequence and timestamps. Runtime metadata is strict and cannot contain SDK credentials/env dumps. Validate message roles and known content shapes while preserving supported opaque provider fields byte-for-byte. Do not reject a legitimate conversation merely because the human typed a string resembling a secret; instead document transcript sensitivity. No raw provider config is recorded.

A single writer holds an exclusive `wx` lock with owner PID/nonce. No automatic stale-lock deletion in this proof: report the lock path/owner and require operator-confirmed cleanup after all owners stop. Test refusal while locked and successful recovery after fixture-simulated operator cleanup. This limitation must appear in the proof report, not be hidden as seamless crash recovery.

Append complete records through one queue; finish the write and sync before acknowledging a checkpoint. An unfinished final line may be discarded only as an uncommitted tail; invalid terminated/middle records or sequence gaps fail closed. Complete tool intent must be synced before allowing a side effect. Failed result persistence aborts the run and marks the operation uncertain; no automatic retry. Preserve the original log when producing recovered model context.

- [ ] **7. Add multi-tool recovery fixtures.** For a **completed** assistant tool-call message, preserve completed results and fill only missing results with explicit `isError: true` interrupted/unknown-outcome notices. For partial/error/aborted assistant messages that Pi removes during transformation, do not attach orphan synthetic results; retain them as interrupted display history and exclude the incomplete group from model context as a unit. Use the actual provider's payload conversion in offline tests to verify valid grouping/signature continuity. Loading calls neither provider nor executor and never revives an approval.
- [ ] **8. Rerun private-files, session and existing settings/startup suites; commit:** `feat(cli): persist private resumable conversation records`.

## Task 9: Immutable deployment artifact proof

**Files:** `src/pi-runtime/deploy-artifact.ts`, `tests/pi-runtime-deploy-artifact.test.ts`.

**Supported proof subset:** top-level stack templates and asset manifests referencing **already materialized regular files** (`source.path`, packaging `file` or its file default) located within the owned assembly. Reject executable-produced assets, all Docker sources, `packaging: zip` directories, nested assemblies/unsupported manifests, symlinks and absolute/escaping references. Do not claim full Pawl deployment coverage; Stage 2 must audit real generated assets and materialize other required forms or get an explicit scope decision before cutover.

- [ ] **1. Write failing tests** for changed source after preview, nondeterministic re-synthesis, file tampering/deletion/addition, external `../` paths, absolute paths, symlinks, executable asset sources, Docker `directory`/`executable`, deferred ZIP packaging and cross-account destinations. Include a fixture whose manifest is unchanged but deferred command would produce different bytes; it must be rejected before approval.
- [ ] **2. Run:** `rtk proxy bun test packages/cli/tests/pi-runtime-deploy-artifact.test.ts`. Expected: FAIL.
- [ ] **3. Implement `prepareArtifact` / `verifyArtifact` / `deployApprovedArtifact` using the Task 7 executor seam.** Synthesis targets an exclusively created private assembly under `.pawl/artifacts/`, never edits existing `cdk.out/`, and runs only in explicit trusted-code workflows. Validate all transitive references and supported asset forms before publishing the artifact. Digest sorted relative file names and bytes, stack selection, target identity and deployment-affecting options; reject unknown/account-agnostic target environments and unapproved destination/assume-role targets.

Preview **and** deployment use the same frozen assembly with explicit `--app <assembly-dir>` and stack selection, not project-based diff followed by fresh synth. Use a read-only template diff mode (`--change-set false`, confirm exact installed CLI syntax before implementation); never let the proof create a CloudFormation change set. Include the artifact ID/digest/target beside the displayed diff. If no differences or output is truncated, do not authorize deployment.

Immediately before execution, under the mutation permit, revalidate identity, integrity, approval and expiry. The executor consumes only that verified reference and never re-synthesizes or invokes a deferred asset builder. Private ownership and integrity checks are a trusted-process contract, not protection against malicious same-user tampering between a check and CDK opening files.

- [ ] **4. Test the complete preview → human answer → executor chain with fake synthesis/CDK executors.** A fake mutator receives the exact frozen assembly bytes. Changed source either leaves the snapshot unchanged or requires a new preview; changed frozen material is always refused. No actual deploy/asset publishing is available to the proof runner. Separately inspect installed CDK CLI/schema docs or offline help to confirm argument semantics; fake argv assertions alone are not proof of CLI behavior.
- [ ] **5. Rerun tests and commit:** `feat(cli): bind proof approval to frozen deployment material`.

## Task 10: Embed the Pi Agent and integrate persistence/policy

**Files:** `src/pi-runtime/agent.ts`, `tests/pi-runtime-agent.test.ts`, `tests/fixtures/pi-runtime-stream.ts`.

- [ ] **1. Build deterministic public `AssistantMessageEventStream` fixtures** for text/reasoning, tool batch, follow-up reply, malformed input, provider error, abort and deferred completion barriers. No real network, no personal Pi state, no timing sleeps.
- [ ] **2. Write failing integration tests.** Subscribe before send; persist completed assistant messages before preflight; enforce a synced intent before side effect; map text/reasoning/tool events; keep busy across Pi inner turns; emit one terminal outcome after awaited cleanup; recover partial/multi-tool messages; restore history without running anything; ignore late cancelled-run events. A failed awaited subscriber must abort further work even if Pi's event listener handling itself does not propagate that error as expected.
- [ ] **3. Run:** `rtk proxy bun test packages/cli/tests/pi-runtime-agent.test.ts`. Expected: FAIL.
- [ ] **4. Construct `new Agent` with explicit initial model/messages/tools/system prompt and Task 4 stream function.** Use sequential Pi tools plus the session-wide mutation coordinator. `prepareArguments` validates raw input; preflight calls authorization policy, while executor wrappers recheck/consume grants and persist intent. Awaited subscribers checkpoint/project events; capture checkpoint failures in shared fatal state and abort, with a separate fail-closed executor guard.

Perform context admission and shared budget checks in the `StreamFn` wrapper **before** provider dispatch, including first/restored requests. Perform execution checks again before each executor. `shouldStopAfterTurn` may return true to prevent a follow-up but is not the primary guard. Hook errors with no-throw contracts become appropriate error/blocked results and shared cancellation. Root run settlement waits for child cleanup and durable terminal status; unexpected promise rejection must still generate one owned terminal event.

`send` while idle starts a fresh root-prompt budget; queued user prompts are processed serially after settlement and get their own budgets. Do not map automatic inner calls or approval answers to new budgets. Keep stored history complete; a context admission failure explains how to start a new conversation.

- [ ] **5. Explicitly test all boundary limits from Task 6 with tiny injected limits**, persistence failures before/after mutation, late provider events and disposed conversations. Test the real Pi Agent, not a fake Agent class.
- [ ] **6. Rerun suite and commit:** `feat(cli): integrate pi loop with pawl lifecycle policy`.

## Task 11: Representative Pawl tools, not a wholesale port

**Files:** `src/pi-runtime/tools.ts`, `tests/pi-runtime-tools.test.ts`.

- [ ] **1. Write failing tests for** `ask_question`, `scan_resources`, approval-gated `generate` (fake writer), `deploy_preview` and `deploy_infra` (fake deploy executor). Inject domain/executor dependencies. Validate current scan shape through Task 2. The provider-driven request must reach the actual policy wrapper; don't test an unrelated approval mock.
- [ ] **2. Run:** `rtk proxy bun test packages/cli/tests/pi-runtime-tools.test.ts`. Expected: FAIL.
- [ ] **3. Implement adapters using runtime-independent modules.** Import no Eve wrappers. Pass explicit context into the scan operation; fake service clients/executor make default tests offline. Scanning with synthesis is trusted local code, not a sandbox; default live proof does not synthesize the user's project. Preserve coverage/drift limitations in results.

Generation binds the approved plan digest/project to an explicit proposed write set. The proof writer can modify only controlled fixture paths through the same policy boundary a future real writer will use; a direct specialist write cannot bypass it. Deployment consumes Task 9's verified reference. All model-facing outputs are bounded. The live proof factory contains **no production deployment capability**, even if a model invents its tool name.

- [ ] **4. Test unknown names, invalid raw args, denial/expiry/abort, identity change, direct write bypass, incomplete preview and restart.** Assert fixture filesystem/executor evidence, not only approval prompt counts.
- [ ] **5. Rerun suite and commit:** `feat(cli): exercise pawl tool policy through pi`.

## Task 12: Bounded specialist orchestration

**Files:** `src/pi-runtime/specialists.ts`, `tests/pi-runtime-specialists.test.ts`.

- [ ] **1. Write failing tests** for the four roles, explicit prompt/data inputs, root cancellation, shared account/model/budgets, two-child limit, no nested delegation and child policy restrictions. Generator returns a proposed file set; root writes remain approval-gated. Children share the mutation coordinator without the parent holding it across delegation.
- [ ] **2. Run:** `rtk proxy bun test packages/cli/tests/pi-runtime-specialists.test.ts`. Expected: FAIL.
- [ ] **3. Implement root-to-child dispatch with explicit role configurations.** Use a real Pi Agent with deterministic stream fixtures, not only mocked child methods. Read role instruction Markdown as data; do not import Eve `defineAgent` modules or discover personal/project extensions. Preserve existing planner/WAF/auditor Zod result shapes in owned definitions; generator gets an explicit proposed-file-set schema and no arbitrary writer/shell.

For structured returns, provide a child-only `finish_result` tool generated from the Zod schema; capture the validated result and stop the child. Text that merely resembles JSON is not success. Missing/invalid results are visible failures bounded by the shared policy, never an unbounded repair loop. Children cannot call `finish_result` to bypass pending mutations; completion must contain no unexecuted side-effect work.

- [ ] **4. Prove shared limits/cancellation with real parent and child Agent fixtures.** Limit exhaustion must prevent a new model request/tool execution in every agent. Disposing the parent settles all children and inputs. No background receipt/poller/server design.
- [ ] **5. Rerun tests and commit:** `feat(cli): prove scoped local specialist orchestration`.

## Task 13: Native OpenTUI integration proof

**Files:** `src/pi-runtime/tui-view.ts`, `tests/pi-runtime-tui.test.ts`.

- [ ] **1. Read OpenTUI's skill and native testing/lifecycle references.** Follow the existing `tests/tui-app.test.ts` `createTestRenderer` setup/cleanup and public exports. Keep production app/presenter/reducer unchanged.
- [ ] **2. Write a failing end-to-end fixture:** real Pi Agent with fake streams → new conversation driver/reducer → new narrow `tui-view` sink adapter → existing `createPawlApp` inside the **native** test renderer. Inject keyboard/paste input via the test renderer. Do not cast owned state to Eve's `TuiState` or pass fabricated state directly to the renderer as the sole test.
- [ ] **3. Run:** `rtk proxy bun test packages/cli/tests/pi-runtime-tui.test.ts`. Expected: FAIL.
- [ ] **4. Implement only the proof sink adapter and fixture wiring.** Use stable app append/update/status/input APIs from clean `main`. Assert visible working/waiting status and owned busy state. Wire a busy callback when supplied by the app, but do not copy the source checkout's uncommitted pulse/UI changes into this worktree. Full dirty-UI visual/pulse parity is explicitly a later integration check, not evidence from the clean baseline.
- [ ] **5. Add native assertions for:**
  - two consecutive user prompts and a multi-iteration tool turn;
  - text/reasoning rendering and no premature idle between inner turns;
  - a freeform question answered while the agent is waiting;
  - approval offered before any fake mutation, numbered/ID answer and exactly one execution;
  - denial, unresolved text, cancellation and late stream events;
  - restored scrollback with interrupted markers, no replay, new input required;
  - fixed editor remaining usable while chat scrolls, user echo once;
  - teardown destroys renderer and settles all queues/subscriptions/timers/child agents.
- [ ] **6. Rerun this suite with the existing `tui-app`, presenter and theme tests; commit:** `test(cli): drive pi conversation through native opentui`.

## Task 14: Explicit proof runner, live checks and report

**Files:** `scripts/verify-pi-runtime-proof.ts`, `tests/pi-runtime-proof-script.test.ts`, repo `docs/superpowers/proofs/2026-09-16-local-pi-runtime-proof.md`.

- [ ] **1. Write failing runner tests** for argument validation, import without side effects, offline default, refusal of live mode without both `PAWL_PI_PROOF_LIVE=1` and `--confirm-live-bedrock`, and unsupported/conflicting auth errors. CLI contract: `--project-dir` is always required; `--offline` is default and mutually exclusive with `--live`; `--tui` enables the terminal view; `--resume-session <id>` loads without an automatic opening prompt. Live mode additionally requires `--profile`, `--region`, `--model-id` and `--second-model-id`; offline mode must not resolve AWS credentials. Each live model uses its own session so reasoning/signatures are not replayed into a different model. Separate CLI parsing from execution so tests never log in or call AWS.
- [ ] **2. Run:** `rtk proxy bun test packages/cli/tests/pi-runtime-proof-script.test.ts`. Expected: FAIL.
- [ ] **3. Implement offline and live modes.** Offline `--tui` uses Task 13's stream/tool fixtures in a real terminal. Live mode uses Task 3/4 identity/provider and only a harmless read/fake-approval tool; no deploy or artifact upload command is registered. Both use an explicitly selected **temporary project**, not the user's working project. Reuse Clack credential/model validation before creating the renderer. Do not change production `runStartup` menus; simulate resume/new via runner arguments for this proof.

Report only redacted identity metadata/model IDs/request-shape assertions and pass/fail counts. Keep credential values, raw signing headers and full potentially sensitive transcripts out of the public report. Preserve private session files for an explicit second invocation and document cleanup.

- [ ] **4. Rerun runner tests.** Then request separate authorization for real-terminal and live actions. Owner must choose the actual available second model with different reasoning behavior (prefer an available Claude scope); do not leave a placeholder as an executable command. Record exact arguments and consent in the report. Default requested target remains profile `jolo`, region `eu-central-1`, Nova `eu.amazon.nova-2-lite-v1:0`; verify availability before paid calls. Missing second-model access means the corresponding proof is blocked, not silently skipped or substituted.
- [ ] **5. Authorized real-terminal check:** run the offline `--tui` mode in the owner's terminal; exercise keyboard/paste, question, approve/deny/cancel, close, then restart/resume. Confirm the editor remains responsive, transcript/states are visible and shutdown leaves no fixture processes. Automated native frames are not a substitute for this check.
- [ ] **6. Authorized live check:** STS identity + model discovery, streamed reply/tool round-trip/second prompt for **each** selected model, actual Nova/Claude reasoning payload assertions, cancellation, close and explicit resume. A separate invocation must load history without invoking the provider/tool until a new prompt. Exercise fake approval under the live loop without any real mutation. No broad account scan or deployment is part of this authorization.
- [ ] **7. Write the report even if live checks are deferred.** Table columns: requirement, fixture/native/live evidence, exact command/runtime/package versions, result, limitation. Include auth conflict refusals, conservative lock cleanup, context heuristic, unsupported asset forms/platforms and pending dirty-UI integration. Classify unrun live/terminal checks as **pending/blocked**, not passed. Live model success does not prove every AWS operation or all models.
- [ ] **8. Commit runner/tests/report:** `test(cli): record embedded pi proof evidence`.

## Task 15: Integrated review and Stage 1 gate

- [ ] **1. Run checks individually from the feature root; retain logs and exit statuses:**

```bash
rtk proxy bun test packages/cli/tests > /tmp/pawl-pi-proof-final-cli.log 2>&1
rtk proxy bun test > /tmp/pawl-pi-proof-final-root.log 2>&1
rtk proxy bun lint > /tmp/pawl-pi-proof-final-lint.log 2>&1
rtk proxy bun --cwd packages/cli run typecheck > /tmp/pawl-pi-proof-final-tsc.log 2>&1
rtk git diff --check main...HEAD
rtk git diff --check
```

Compare against **Task 1's clean worktree** baseline, including normalized TypeScript diagnostics. Report known LocalStack/type errors separately; no new failures are acceptable. Do not claim all root tests pass if baseline failures remain.

- [ ] **2. Inspect isolation and the shared helper exception:**

```bash
rtk git diff --name-only main...HEAD
rtk git diff main...HEAD -- packages/cli/index.ts packages/cli/src/tui/client.ts packages/cli/src/tui/startup.ts packages/cli/src/launch.ts packages/cli/agent
rtk git diff main...HEAD -- packages/cli/src/settings.ts packages/cli/src/pawl-local-files.ts packages/cli/package.json bun.lock
```

First production-path diff must be empty. The second must contain only reviewed ignore-helper extraction and approved exact Pi dependencies. Check source checkout status against its captured baseline; do not absorb its unrelated edits.

- [ ] **3. Dispatch fresh read-only spec and quality reviewers through one governed subagent workflow.** Give spec/plan paths, worktree/ref, baseline evidence and proof report. No shell/foreground fallback after agent infrastructure errors; preserve state and retry only through the approved protocol.
- [ ] **4. Resolve blocking findings and re-review.** Review approval does not turn mock tests into provider/terminal evidence. Do not patch baseline problems outside the task to get a green summary.
- [ ] **5. Present the evidence gate and request owner approval before merge or Stage 2 planning.** Eve is still production. Schema/auth feasibility must be established; native tests and required authorized live/terminal checks must be complete for an unrestricted Stage 1 pass. If permission/availability prevents them, report a conditional offline result and retain the cutover block. The artifact proof covers only the explicitly supported subset; Stage 2 must resolve real generated-asset coverage and preserve the outstanding source UI changes before production switch.
