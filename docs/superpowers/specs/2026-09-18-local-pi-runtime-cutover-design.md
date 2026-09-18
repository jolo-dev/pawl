# Local Pi runtime — safety-first production cutover design

## Status and authority

The owner approved the **Stage 2 design direction**: safety-first vertical parity, explicit per-session consent for selected-project `AGENTS.md`, and separate dependency-install approval disclosing the exact command and lifecycle-script policy. This document records that direction for written review. **Implementation planning, implementation, live checks, actual-terminal control, production cutover, commits and push are not authorized by this document.**

The governing architecture is [Pawl-owned harness with a local Pi runtime](2026-09-16-local-pi-runtime-design.md). The [Stage 1 plan](../plans/2026-09-16-local-pi-runtime-proof.md) and [proof report](../proofs/2026-09-16-local-pi-runtime-proof.md) supply historical contracts and evidence, not an unconditional production pass. This specification resolves the Stage 2 policies without prescribing a file-by-file implementation plan.

Planning baseline: local `main` at `fccf0a3d908235f07e4d959b34f554842b9ff45e`, after the authorized local fast-forward merge, with owner work still uncommitted. Eve remains production. No push occurred. Existing UI/model/dependency work, the narrow Pi TUI test-helper correction, local configuration and the newly observed dirty `.serena/project.yml` must be preserved. The proof worktree, merge recovery backup and retained dependency stash remain untouched. Local evidence locations are deliberately omitted here because they may contain sensitive data.

### Evidence correction

The discovery packet's eight Pi TUI failures are stale. Verified post-helper evidence is:

| Check | Latest recorded result | Meaning |
| --- | --- | --- |
| Focused Pi TUI suite | 10 pass, 0 fail; also rerun by parent | Typed descendant traversal fixes the helper's direct-child assumption; original nine test bodies/assertions preserved |
| CLI tests | 1162 pass, 0 fail | Combined dirty-checkout offline baseline |
| Root lint | 439 files checked, clean | No fixes applied |
| Root tests | 2109 pass, 8 fail, 8 skip | **Failed**; failure multiset matches premerge dirty baseline |
| CLI typecheck | 50 diagnostics, byte-identical to premerge | **Failed**, not green |
| Stage 1 reviews | Integrated Task 15 approved conditional offline scope | Standalone Task 14 spec/quality reviews were skipped; not all tasks were individually reviewed |
| Live Bedrock / actual terminal | Unperformed | Both remain cutover blockers |

Fresh spec and quality reviews approved the narrow helper correction, not production readiness. The historical proof report's retained findings and redaction claim require the closures below. These checks were not rerun merely to author this documentation.

## Goals, non-goals and alternatives

Deliver one coherent local, resumable AWS infrastructure assistant: Clack startup, the existing OpenTUI experience, all authored Pawl tools/resources and four specialists, explicit account-bound execution, and separate generation/install/deploy decisions. Pi owns model/tool iteration; Pawl owns permissions, persistence, lifecycle and product semantics. Closing Pawl stops local work; it does not undo an operation AWS already accepted.

Selected: embedded `@earendil-works/pi-agent-core` plus `@earendil-works/pi-ai`, using the Pi `Agent` rather than maintaining a second loop. The earlier alternatives remain rejected for this cutover: the full coding-agent SDK would bring higher-level policies Pawl does not want implicitly; pi-ai alone would make Pawl own iteration. Neither a Pi CLI/RPC child nor an Eve-like replacement server is needed.

The selected delivery order is **safety first → full domain/resource parity → startup/resume/UI integration → evidence gates → separately authorized switch and removal**. Composition-first with mutations disabled was considered, but an attractive shell must not precede confidence in its execution boundaries. Separate read-only and write milestones may organize verification, but do not authorize a partial-feature production switch. Nonproduction verification composition is temporary; there is no permanent runtime selector.

Non-goals: durable background jobs, automatic restart/retry of operations, lossy compaction, new scanner services or billing APIs, new dependencies, sandbox expansion, general shell/file tools, personal Pi configuration, executable project extensions, global settings, imported Eve history, deletion of historical data, or a new trust/settings/budget UI. Existing init commands are not being redesigned.

## Ownership and deep interfaces

Existing source anchors in this section are relative to `packages/cli/`. They identify seams to adapt, not a claim that proof modules can ship unchanged.

| Owner / source seam | Public responsibility | Hidden implementation and invariants |
| --- | --- | --- |
| Composition: `index.ts`, `src/tui/startup.ts`, preflight modules | Select project/settings, authenticate, choose compatible history, construct and dispose one session | Clack finishes before renderer creation; no Eve server, health polling or transport in final composition; failures during partial initialization release prior owners |
| Conversation: `src/pi-runtime/conversation.ts`, `agent.ts` | Accept send, answer a live request, cancel, subscribe, dispose; emit owned run/message/tool/input outcomes | Pi unions never reach UI; send acceptance differs from completion; subscriptions precede first send; one terminal outcome after cleanup, even on failure |
| UI: `src/tui/app.ts`, presenter/reducer and `src/pi-runtime/{session-driver,tui-view}.ts` | Project the owned conversation into transcript, pending inputs, resource pane and busy state | Preserve composer, scroll, pulse, transparency, appearance and owner changes; no model/tool/persistence authority in UI |
| Session records: `src/pi-runtime/{session-record,session-store}.ts`, `src/pawl-local-files.ts` | Create/open/list compatible records, checkpoint intent/results, recover display and model context | One writer, validated versioned codec, private paths, ordered synced writes, poison-on-failure, no replay; no credential persistence |
| Execution context: `execution-context.ts`, `checked-sdk.ts`, `checked-scanners.ts`, `host-exec.ts` under `src/pi-runtime/` | Supply checked credentials/region, cancellation and bounded SDK/host execution | Exact credential-generation and identity checks at dispatch; no ambient fallback; command-local environment and bounded cleanup; not an OS sandbox |
| Policy: `policy.ts`, `approval.ts`, `mutation.ts`, `tool-schema.ts` under `src/pi-runtime/` | Admit tools/model calls, request/consume exact one-use grants, serialize mutations | Authoritative raw Zod validation, shared finite budgets, fatal latch, freshness checks after waits; raw Pi tool objects are not a registration bypass |
| Resources and specialists: explicit Pawl loader, `src/pi-runtime/specialists.ts` | Load approved text and scoped capabilities; return validated role results | No filesystem-discovered extensions, ambient Pi auth/config or recursive delegation; resource consent is not operation authority |
| Domain operations: `src/harness.ts`, `src/infra/`, `src/diagram.ts`, `src/scaffold/`, `src/deploy/` | Codebase scan, resource scan, synthesis interpretation, provenance/drift/suggestions, diagrams, scaffolding, reviews | Reuse domain logic with injected context/read/exec ports; do not import Eve wrappers or inherit ambient defaults |
| Deployment material: `src/pi-runtime/deploy-artifact.ts` | Prepare, preview, verify and execute an integrity-bound artifact | Own all transitive packaged material, target and execution options; never re-synthesize/rebuild/package mutable inputs after approval |

These are cohesive boundaries, not one wrapper per vendor method. The session composition supplies policy and context once; domain adapters cannot discover another cwd/profile/region. Artifact consumers receive a verified reference, not a mutable project path masquerading as approved work. File mutation consumers receive the exact approved write set, not a general writer.

### Event and data flow

User input enters the driver and is either a new prompt, a bounded in-memory queued prompt, or an answer to an explicit pending request. Unmatched text while a request is pending is visibly rejected, never guessed into approval. Stale IDs and concurrent/duplicate answers cannot consume a grant twice. Project guidance, questions, plan acceptance and action approvals have distinct semantics even when rendered through the same input surface.

An accepted run checkpoints input, admits context/budget, and invokes the Pi Agent with explicit model, text resources and registered tools. Provider text/reasoning and tool progress become Pawl events. Completed messages/checkpoints are persisted in order; a side effect cannot precede a synced intent. Pi's inner `turn_end` is not application idle. Waiting for a human remains an active run, and event consumption continues while answers are routed.

Before a side effect, the operation prepares exact material and asks for the corresponding approval. After the human wait it acquires the shared mutation permit, rechecks store/policy/cancellation, freshly validates identity and material, and consumes the grant at the actual executor/write boundary. Additional asynchronous waits cannot turn an earlier check into lasting permission. Outcome persistence and bounded child cleanup precede the terminal event. Late events cannot change settled state or start work in a later run.

Full history stays on disk. Tool outputs are bounded with visible truncation and coverage preserved. Context admission includes instructions, tools, history, output reserve and reasoning requirements; over-limit context stops with New conversation guidance. No silent trimming, automatic compaction or splitting of tool-call/result groups.

### Credential and model flow

Reuse `src/aws-credentials.ts`, `src/bedrock-models.ts` and preflight SSO/model validation. Build one canonical-project execution context bound to selected profile, workload region and checked account/partition/principal. A profile label alone is not identity. Inject it into every root/child model request, all SDK operations, **the independent startup resource-pane scan**, and host synthesis/build/install/deploy adapters as applicable.

Preserve the exact selected inference-profile/model ID and default `eu.amazon.nova-2-lite-v1:0`; no base-ID, region/scope or availability fallback. Root and all children share the same supported reasoning policy, including medium reasoning for the selected supported families. Prove options at the actual Agent-to-provider request boundary: the current root/child `thinkingLevel: "off"` versus adapter medium split is not accepted parity. Unknown metadata/reasoning behavior is explicit unsupported/off behavior, never a guess or silent downgrade of an approved selection.

The checked SDK boundary must remain per-command/per-attempt, not just a credential-provider option that a client can memoize. Preserve credential-generation retirement, expiry, demand-driven revalidation, cancellation and endpoint isolation established in Stage 1. Compatible refresh may proceed; incompatible identity invalidates context and pending grants before new work. Ordinary profile authentication/SSO-home semantics and the approved web-identity selected-workload-region exception remain intact. This does not promise instantaneous detection of every external IAM revocation.

The Bedrock adapter uses explicit registered metadata and the proven checked-snapshot path, not Pi's ambient auth store. Conflicting keys, session tokens, bearer auth, profiles, regions or endpoints must either be neutralized by the supported boundary or cause a visible refusal. Never mutate process-global AWS environment between agents. Host invocations get command-local checked environment/private credential material, sufficient credential lifetime, bounded deadlines and cleanup. Generated `cdk.json` profile settings must not override the session. Required CDK deployment/bootstrap role assumptions must be enumerated, target-bound and verified; no ambient or undisclosed role switch, new IAM provisioning, or cross-account expansion is implied. A required role unsupported by the boundary blocks parity rather than being quietly bypassed.

## Startup, local history and recovery

Preserve early dispatch of `init codecommit`, `init codepipeline`, and generic `init`, including CLI arguments, interactive/noninteractive behavior, install choice and exit semantics. They continue before chat startup and do not acquire a model runtime. Model-invoked initialization follows the stricter action policy below.

Keep `.pawl/settings.json` version 1: `version`, `profile`, `region`, `modelId`, `modelName`, and no durable trust flag. Settings-save failure retains the existing visible nonfatal notice; **session-checkpoint failure is different and fatal to execution**.

The saved-settings overview identifies the most recent candidate conversation and offers **Continue / New conversation / Change settings**. Continue validates identity and resumes compatible context or starts fresh when none exists. New conversation retains selected settings; Change settings retains preflight's current role. Canonical project and authenticated account/region must match before old history enters a model. Also validate identity/codec/model compatibility; do not silently reinterpret opaque reasoning across models. Incompatibility, corruption or a busy record is explained with fresh-conversation/cancel or actionable recovery guidance, not automatic reassignment to another account or a second mandatory wizard.

Project guidance consent is checked before any new model request or restoration into model context. Resume may display validated history locally while remaining execution-idle. It never sends the opening greeting, calls `Agent.continue()`, restores queued prompts, invokes a provider/tool, revives approval, or resumes a child. A fresh conversation may retain the existing tool-free greeting only after startup and consent checks. The independent resource scan is startup behavior, not tool replay, and shares session cancellation/identity.

Records live privately under `.pawl/sessions/`, with `0600` records/locks and private owned directories, idempotent Git exclusion, preserved unrelated ignore rules and trackable `.pawl/plan.md`. Safe session IDs are validated before any filename/path construction, including candidate listing and resume entrypoints. Refuse traversal, separators, unsafe symlinks and aliases rather than redirect IO. The codec validates versions/sequences/project/identity and preserves supported opaque signatures and tool IDs. Incomplete final uncommitted tails are recoverable; middle corruption and unknown versions fail closed. Locks reject concurrent writers; stale-lock cleanup remains explicit/operator-confirmed, not guessed from PID reuse.

Recover unfinished operations as interrupted/unknown, never successful. Complete assistant tool batches retain completed results and explicitly mark missing results interrupted; incomplete assistant groups remain interrupted display history without orphan results in model context. Preserve the original records. Session data can contain project secrets or human-entered secrets; permissions and ignore rules do not make it shareable. Never persist SDK credentials, tokens, raw environment or signing headers as runtime metadata.

## Resource trust and operation approval

### Explicit resource inventory

Port the root `agent/instructions.md`, four specialist instruction files, `agent/skills/{pawl-codegen,pawl-constructs,pawl-plan}/SKILL.md`, and `prompts/{infra,cost,well-architected}.md` into an explicit Pawl-owned loader. Preserve workflow and construct/handler conventions, but translate obsolete Eve/generic `write`/shell/environment instructions into the actual scoped capabilities. Bundled text that mentions a shell command does not register or authorize one. Resolve bundled references from known package resources rather than model-controlled traversal such as the legacy prompt's relative library paths. Authored `agent.ts`, `agent/lib/bedrock.ts` and HTTP channel are runtime wiring to replace, not executable resources to load into Pi.

### Selected-project guidance consent

Only the selected canonical project's root `AGENTS.md` is eligible as additional text guidance in this slice. There is no ancestor/nested discovery or automatic loading of `.pi`, `.kiro`, personal Pi settings, model registries, auth stores, packages, hooks or executable extensions. Refuse an unsafe/symlinked guidance path. Bundled Pawl policy outranks project text; neither text nor specialist output can grant permissions.

Before those bytes enter root **or child** model context, ask explicitly for this session, identifying the project/file, the specific content being accepted and that it will be sent as model guidance. Inspecting bytes locally to present that decision is not permission to transmit them. Decline means proceed without that guidance (or cancel), not an implicit yes. Generic codebase reads, tool results and delegation must not sneak the declined file back into context.

Consent is in-memory and tied to a content snapshot/digest for this local session. Restart, including Continue, requires fresh consent; persisted provenance is not a reusable grant. The loader detects changed/replaced/removed guidance before further model dispatch and does not silently hot-reload it. Stop the affected work, invalidate pending/unconsumed grants, and use the existing consent/new-conversation/cancel surfaces to make a fresh decision. Do not pretend that removing a system message removes guidance already reflected in conversation history: if guidance is declined on resume, revoked, or changed after use, preserve that history locally but require a fresh conversation before proceeding without it or with different guidance. Ending the current session and starting/declining a new one is sufficient revocation; no new settings page, slash command or trust manager is required.

Already consumed actions are not undone. Previously granted but unconsumed approvals are never expanded, transferred to a new conversation or retargeted by new guidance. Even where consent remains valid, every tool grant remains bound only to the exact approved operation/material.

### Separate action decisions

| Decision | Bound permission | Never implies |
| --- | --- | --- |
| Project-text consent | Include the identified guidance snapshot in this session's allowed context | File writes, shell execution, installation, deployment or extension loading |
| Plan review | Accept the presented plan content for generation preparation | Writing generated files or deploying |
| Generation/scaffold approval | Exact project/destination, plan or scaffold configuration, create/overwrite operations, file paths and contents, relevant existing-file preconditions, session/run/call and identity | Other files, changed content, install, bootstrap or deploy |
| Dependency-install approval | Exact executable/arguments, working directory, package-manager choice, input manifest/lock material and lifecycle-script policy, bounded execution and current identity | A different command, changed inputs, enabling scripts later, reattempt after uncertainty, or deployment |
| Deployment approval | Complete successful preview and integrity-bound deployment material, target, stacks, permitted roles and execution-affecting options, current run/call | Fresh synth/build/packaging, a mutable project deployment, changed target/material, future deploys or rollback |

Plan persistence is a narrow Pawl-owned operation for `.pawl/plan.md` in the requested planning workflow, not a general file writer or acceptance of the plan. Generation prepares the proposed files first and shows enough material to approve exact writes. The generator returns proposals; only the approved executor writes. Canonical, filesystem-aware and case-aware checks protect all Pawl-owned state, including settings, ignore management, sessions, artifacts, locks and temporary paths, through aliases as well as literal names. Revalidate path/parent identity and overwrite preconditions at write time. `.pawl/plan.md` has only its dedicated plan capability, not a general exemption for generator writes. No edits to existing `cdk.out/` are authorized by these file tools.

Model-invoked `init_project` gathers all required inputs without nested stdin prompts, prepares the scaffold for generation-style approval, and writes only that approved destination/set. `install: true` expresses a request, not consent. Show the exact installation command and whether lifecycle scripts are enabled or disabled, including that enabled scripts execute dependency/project code and installation can use the network and modify dependency/lock material. Bind the selected policy to execution; never silently retry with scripts enabled. Missing tools/dependencies produce instructions or a separate approval, not automatic installation through `npx` or a fallback executor. Installation denial leaves the already approved scaffold intact and clearly reports that dependencies were not installed.

Approvals are fresh, one-use, finite-lived, abortable and nonreplayable. Denial, expiry, changed arguments/identity/content, stale IDs, cancellation, disposal and restart refuse execution. Ask before acquiring the mutation permit; consume under it after all boundary checks. Root and children share one coordinator, with no permit held across delegation that needs it. Permission is executable policy, not an instruction or UI-only check.

### Trust limitation

Read-only **AWS analysis** does not mean side-effect-free local execution: CDK synth, bundlers, package lifecycle scripts and configured credential programs can execute local code. Trusted project synth/build can access host resources and credentials available to that process. Path checks, allowlists and a controlled environment are not an OS sandbox and do not defend against every malicious same-user filesystem race. Explain this before trusted-code workflows; do not relabel AGENTS consent as approval to execute code. The migration adds neither a sandbox nor a credential-isolation architecture. Preview must not create change sets, publish assets, bootstrap or deploy under an analysis label.

## Authored tool and specialist parity

All paths below are CLI-relative. Preserve domain semantics and coverage, not Eve's incidental prompts/default authority.

| Capability / current authored source | Stage 2 contract and reusable seam |
| --- | --- |
| `plan` — `agent/tools/plan.ts` | Reuse codebase scan/prompt content from `src/harness.ts`; explicitly invoke bounded planner, validate structured result, persist `.pawl/plan.md` through its narrow path, present for review. Current harness only returns a prompt, not a completed planning workflow |
| `generate` — `agent/tools/generate.ts` | Approved plan → generator proposal → exact-file approval → protected writer; `src/pi-runtime/tools.ts` is representative policy, not complete production writing |
| `architecture` — `agent/tools/architecture.ts` | Reuse `renderPlanDiagram` in `src/diagram.ts`, scoped plan read and controlled execution; no shell authority for the model |
| `cost` — `agent/tools/cost.ts` | Reuse prompt and `src/infra/review-context.ts`; retain optional account read and explicit estimates-only/no billing-data limitation |
| `well_architected` — `agent/tools/well_architected.ts` | Same checked review context plus six-pillar specialist result; missing coverage remains visible |
| `scan_resources` — `agent/tools/scan_resources.ts` | Reuse `runProjectScan`, scanners, synthesized-resource loader, provenance, drift and suggestions; preserve service selection, synthesis/`skipSynth` behavior and entry caps. Broken synthesis/identity is not an empty successful comparison |
| `deploy_preview` — `agent/tools/deploy_preview.ts` | Reuse relevant decision/presentation logic from `src/deploy/diff.ts`, but preview the frozen material, not a mutable project. Nonzero/failed/incomplete/truncated/no-change preview cannot authorize deploy |
| `deploy_infra` — `agent/tools/deploy_infra.ts` | Consume exact approved artifact through checked executor; do not reuse the independent project-based `runCdkDeploy` authority path |
| `init_project` — `agent/tools/init_project.ts` | Reuse `src/scaffold/` configuration/templates; explicit scaffold-write decision, optional **separate** installation decision and captured noninteractive subprocess output |
| Questions / scoped supporting operations | Own `ask_question`, bounded project/library reads, plan persistence and root-to-specialist dispatch; no inherited Eve/Pi generic `bash`, `write`, root-copy agent or package-loading tools |

A resource scan is point-in-time deployed state plus achieved coverage, not history. Preserve `driftUnavailable`, denied/not-scanned services, provenance ambiguity and truncation. Suggestions are advisory and never applied merely because a scan ranked them. The startup pane and review tools must use the same checked domain path. Preserve [ADR 0002](../../adr/0002-per-service-resource-scanners.md) and the terminology in repository `CONTEXT.md`; do not promise new service coverage.

Four explicit specialists share selected model/reasoning/account/region and finite root budgets:

- **planner:** codebase scan and notes → typed summary, services, network, security, observability, Mermaid diagram, deployment and file plan; no arbitrary writes.
- **generator:** approved plan and scoped references → validated proposed file set; no direct file/install/deploy authority.
- **well-architected:** bounded project/resource context → typed six-pillar risks/priorities with evidence and gaps.
- **infra-auditor:** scan and deterministic suggestions → ranked construct findings, coverage warning and drift caveats; no invented resources, spend, compliance or deletion decisions.

Only root-to-specialist delegation is supported. Children receive explicit necessary context and narrower capabilities, not ambient root powers or full history by default. No specialist can approve its own work, bypass project consent, start nested children or outlive parent settlement. Structured completion is validated, not inferred from JSON-looking prose. Bound child concurrency, combined calls, tool executions, deadlines, outputs, context and queued prompts. Exact conservative limits belong in the later plan; no budget UI or unbounded repair loop.

## Immutable generated-asset lifecycle

The production contract is **prepare → materialize → freeze → preview → approve → verify → execute → record outcome**. Stage 1's regular-file-only artifact fixtures prove a subset, not generated-project deployment parity.

Preparation runs trusted synthesis/build only before deployment approval, targeting Pawl-owned private artifact storage rather than editing existing `cdk.out/`. Complete all local compilation, bundling, directory archiving and other required packaging before freezing. The artifact binds assembly/templates/manifests, every transitive asset's actual deployable bytes or equivalent immutable content identity, stack selection, target and execution-affecting options. A manifest hash or source-directory digest alone is insufficient if CDK will later produce different bytes.

Preview and deployment consume the same frozen material. Preview is non-mutating with respect to AWS, includes artifact identity/digest and target, and exposes the complete decision material to the human. A failed/nonzero command is a failed preview even if stdout resembles a diff. Truncation cannot become implicit permission. No differences means stop. Template diff is not a guarantee that remote state cannot change before submission.

After approval, deployment may submit/publish **only already bound material**; it must not synthesize mutable project code, resolve mutable asset inputs, run a deferred builder, archive a directory afresh, or rebuild a container. Workspace changes can leave execution constrained to the unchanged snapshot or force refusal/new preview; changes to frozen material always refuse. Identity/cancellation/integrity/approval are rechecked after human/coordinator waits at dispatch. Tampering, added/deleted files, aliases and unsupported references fail closed.

Required capability evidence before cutover:

| Material / capability | Required production evidence |
| --- | --- |
| Template-only and multi-stack apps | Installed CDK assembly/selection semantics, target-bound options and same frozen material at preview/execute |
| Bundled Lambda and other file assets | Real Pawl-generated `LambdaFunction`/handler path (which uses `NodejsFunction` bundling), regular files and directory-to-ZIP packaging materialized and integrity-bound before approval |
| Other forms produced by supported generation/scaffolding | Audit actual generated assemblies and their transitive references, including nested assemblies, executable-produced assets and Docker/image assets where encountered; materialize required forms before approval or block parity |
| Immutable image/package transport, when required | Demonstrate publishing/submission cannot rebuild or substitute content after approval; mutable tags, deferred commands and post-approval local packaging are insufficient |
| Destinations and CDK roles | Required account/region destinations and permitted role behavior verified against the selected context; unknown/escaping targets refused |
| Negative and nondeterministic cases | Changed workspace, nondeterministic synth/build, same manifest with different asset bytes, symlink/case aliases and integrity tampering never change approved execution |

Maintain an explicit supported/unsupported capability table grounded in real generated outputs and installed CDK contracts. Unsupported forms fail before approval with actionable explanation. A form needed for existing authored production capability is a **cutover blocker**, not a fixture-based parity claim or silent feature reduction; any unavoidable scope/runtime/dependency change requires a separate owner decision. Concrete packaging mechanisms belong in the implementation plan, but none may defer mutable materialization until after approval. No live asset publication or deployment is required or authorized as proof.

## Failure, cancellation and uncertainty

Fatal policy, identity, persistence, integrity and executor refusals latch the shared run closed, abort children and pending requests, discard queues, and forbid further model/tool/effect admission. A thrown tool error becoming an ordinary Pi tool result is not sufficient: mixed batches and automatic follow-ups must also be stopped. Raw/unregistered tools cannot bypass authoritative Zod preparation; validate raw input before Pi normalization and canonical input again at execution. Unsupported schema shapes fail registration rather than weakening validation or adding a dependency.

Genuinely recoverable domain results may continue within budget: for example a supported scan reports denied-service coverage, or a missing project file is explicitly reported as unavailable. They cannot disguise failed identity, rejected executor policy, broken synthesis, corrupt state or uncertain mutation as a successful empty result. Provider failures are visible; no automatic Pawl retry of model requests or uncertain remote effects.

The store becomes poisoned on append/sync failure. Every queued write rechecks poison at execution time; no queued checkpoint, new model request or new side effect proceeds after failure. Surface typed store errors consistently. Before-intent failure means no effect was permitted. Failure after effect/submission means unknown/interrupted outcome, even when recording that outcome also fails; show the failure directly and let recovery infer uncertainty from durable intent. Never claim that an unsuccessful save proves an operation did not occur.

Cancel while idle is a harmless settled operation, and rejected cancellation must not leave an input latch waiting forever for an event that will never arrive. Cancellation propagates through root, children, approvals, coordinator waiters, SDK transports and host executors. It prevents new work immediately and waits for bounded owned cleanup. Force/reap/pipe deadlines apply even when the original process group returns ESRCH or an escaped descendant holds pipes. Report incomplete termination honestly rather than hanging or claiming all processes are gone. Per-invocation errors carry per-invocation outcomes; never mutate a shared abort reason with another command's result.

Shutdown is idempotent and handles partial initialization. Stop admission, cancel/settle work and inputs, release store locks and private credential resources, detach subscriptions/timers/pulse work, and restore/destroy the renderer even if other cleanup fails. Renderer destruction alone does not await Pawl's async services. Uncatchable process death cannot promise cleanup; conservative recovery handles it. Remote submission may continue despite local cancellation. After an uncertain deployment, inspection and a fresh preview/approval are required for a new attempt; no automatic retry or asserted rollback.

### Retained findings: required closure evidence

Historical priority labels are not waivers. Each row requires a source fix, regression evidence through the relevant boundary and independent review before cutover.

| Finding / current source seam (CLI-relative) | Observable closure |
| --- | --- |
| Idle/rejected cancel latch — `src/pi-runtime/session-driver.ts` | Idle cancel and rejected cancel both settle visibly; subsequent prompt/answer works without a fabricated event |
| ESRCH escaped-descendant hang — `src/pi-runtime/host-exec.ts` | Controlled owned fixtures prove bounded pipe/reap settlement even without a surviving original group; incomplete cleanup is explicit |
| Shared abort error mutation — same executor | Concurrent invocations sharing a reason retain independent result/error evidence and leave the shared reason unchanged |
| Store poison, queued writes, raw IO errors and unsafe session IDs — `session-store.ts`, `session-record.ts` | Injected append/sync failures stop queued persistence and all effects; typed fatal errors; traversal/separator/alias IDs rejected before IO |
| Preview exit status — `deploy-artifact.ts` | Nonzero/failed diff with plausible output produces no usable deploy grant or executor call |
| Pre-wait identity snapshot and discarded deploy signal — `tools.ts`, `deploy-artifact.ts` | Change identity or cancel during approval/coordinator/integrity waits; fresh boundary validation refuses actual spawn/submission |
| Lexical generation path protection — `tools.ts` | Case-insensitive filesystems, symlink parents/targets and aliases cannot reach any owned `.pawl` state; exact approved-file changes only |
| Raw AgentTool / `prepareArguments` bypass — `agent.ts`, `tool-schema.ts` | Registry rejects raw/untrusted definitions; actual Agent path cannot coerce invalid raw args into authorized execution |
| Executor/persistence refusal treated as recoverable — `agent.ts` | Mixed tool batches, children and follow-up loops start no further effects after fatal refusal; genuine domain coverage errors remain distinguishable |
| Root/child reasoning off versus adapter medium — `agent.ts`, `specialists.ts`, `bedrock.ts` | Actual root and specialist Agent requests match selected model/reasoning policy and retain signatures over two turns/resume |
| Child cancellation, paste, late events, pulse — specialist/driver/native UI suites | Full child settlement, no late writes/events, multiline paste, busy/waiting/idle pulse transitions and timer cleanup through current integrated renderer |
| Principal/account ARN report leakage — `scripts/verify-pi-runtime-proof.ts` | Synthetic account/principal markers absent from all shareable report output, including embedded ARN accounts and error paths, **before any live run** |

## Acceptance and bounded delivery gates

Stage 2 remains nonproduction until all applicable gates pass. Re-establish the dirty-checkout baseline at implementation start and retain exact command, exit, runtime/package versions, fixtures versus real boundaries, limitations and redacted evidence. Do not repair unrelated baseline problems merely to claim green.

| Gate | Required evidence / acceptance boundary |
| --- | --- |
| Preservation and design | Owner review of this written design before implementation planning; snapshot/index comparison preserves unrelated work. A later doc-only commit needs separate authorization |
| Safety contracts | Close every retained finding above; adversarial interface tests for validation, intent-before-effect, fatal poisoning, exact one-use grants, mutation serialization, budgets and bounded cancellation. Use actual Pi Agent plus deterministic streams and controlled executors, not only method-call counts |
| Full parity | Every inventory row and resource mapped to owned capability; real domain entrypoints with checked identity; generator/scaffold exact writes; separate install disclosure/denial/scripts-policy tests; successful and unsupported real generated-asset coverage plus immutable negative cases |
| Startup/recovery | Continue/New/Change settings, v1 settings preservation, consent decline/restart/change/revocation, account/region/model mismatch, locks/corruption, partial multi-tool history and zero model/tool/queue/approval replay. Preserve init command behavior |
| Native renderer | Actual Pi → owned driver/reducer → current OpenTUI app under native test renderer; keyboard/multiline paste, approval/deny/question/cancel, idle/rejected cancel, late events, fixed composer/scroll, transparency/pulse, resize and full cleanup. Native in-memory frames are not an actual-terminal check |
| Offline integration and independent review | CLI tests, root lint/tests, CLI typecheck and whitespace checks with exact baseline comparison; no new failures or weakened assertions. Independent read-only spec and quality review covering complete composition and closure evidence. Root's 8 failures and 50 TS diagnostics remain reported failures until genuinely resolved |
| Runtime/distribution compatibility | Verify pinned Pi/OpenTUI public APIs, native package loading and final launch/build path on intended supported runtime/platforms; do not infer compatibility from an engine field or import-only test |
| Authorized two-model live | Separate owner approval for exact profile/region/actions and exact second supported model with different reasoning behavior, alongside Nova 2 Lite. Verify identity, selected scope, streaming, tool round-trip, second prompt, reasoning, cancellation and explicit zero-replay resume for each model. No broad scan, deploy, asset publishing or change-set creation; inaccessible second model blocks this gate rather than being substituted |
| Authorized actual terminal | Separate owner-approved terminal scope: keyboard/paste, question, approve/deny/cancel, responsiveness, scroll/composer/pulse, close, restart/resume and shutdown without leftover fixture processes. Not inferred from native test frames |
| Production switch/removal | All preceding safety/parity/offline/native/review/runtime/live/terminal gates satisfied, owner authorizes switch, then one coherent replacement with historical data retained. No permanent selector or premature removal |

Live model choice and exact authorization remain **pending gates**, not unfinished architecture decisions or permission inferred from planning. Before collecting any live evidence, redact principal/account identifiers including account digits inside ARNs. Share request-shape/model/pass-fail metadata only, not credentials, raw headers, environment dumps or full transcripts. Private logs/session records still need careful handling; the Stage 1 report's redaction assertion does not prove the runner currently satisfies it.

## Runtime requirements, removal and documentation boundary

Verified installed references: Pi core/AI pins `0.85.1`; OpenTUI catalog and installed manifest `0.5.11`; Eve catalog `0.54.3`. `packages/cli/package.json` currently declares Node `24.x`. The **installed** `node_modules/@opentui/core/package.json` and README instead specify Bun `>=1.3.0` or Node `>=26.4.0`; the README requires ESM and `--experimental-ffi` for Node. This mismatch is a compatibility gate, not evidence that Node 24 supports the renderer or permission to change runtimes. Preserve the existing declared requirement until compatibility evidence supports an explicit owner-approved change. No package/runtime upgrade, lowering to Node 22, or new dependency is authorized here. Keep the current Eve launch constraint until Eve is actually removed.

After parity and final gates, audit imports, type uses, scripts, build/distribution paths, tests, catalog/lockfile consumers and documentation before removing `eve`, `ai` or `@ai-sdk/amazon-bedrock`. Remove only proven obsolete uses: Eve launch/server health polling, HTTP transport, authored bundling, runtime configuration/channels and Eve-specific dev/build/start/eval wiring. Retain AWS discovery/auth/scanner packages, Clack, OpenTUI, Pi pins and unrelated owner dependency work. Reusing a package elsewhere prevents wholesale removal based merely on this CLI cutover.

Future implementation must replace the obsolete architectural guidance via a superseding ADR, preserving [ADR 0001](../../adr/0001-custom-opentui-client.md) as history. Update README/AGENTS and authored guidance to describe local resumability, explicit text consent and separate actions, controlled trusted-code execution, runtime requirements supported by evidence, and reset of chat history at cutover. Do not import `.eve` sessions or delete old data during cleanup. Retain old private records and explain that they are not resumed by Pi.

This delivery is one design document only. Next is user review, then a separately approved bounded implementation plan; no production file, dependency, runtime, live operation or terminal state changes as a consequence of writing it.
