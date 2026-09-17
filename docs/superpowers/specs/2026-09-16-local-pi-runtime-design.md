# Pawl-owned harness with a local Pi runtime

## Approved direction

Replace Eve with an embedded runtime built on `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai`. Pi runs the model/tool-call loop; Pawl owns product behavior, permissions, resource loading, session persistence and orchestration. Keep OpenTUI, Clack, project-local startup settings and existing AWS operations.

The owner selected **local resumable chat**, not durable background execution. Closing Pawl stops its local execution. Restart restores conversation context but never automatically resumes an unfinished operation. AWS operations already accepted by the service may continue independently; closing a terminal cannot undo them.

Implement in two gated stages: first prove the critical runtime contracts without removing Eve; then cut over production and remove Eve-specific code. These should have separate bounded implementation plans, not one unverified wholesale rewrite.

## Alternatives considered

- **Embed the complete `pi-coding-agent` SDK:** supports explicit tools and a custom resource loader, and includes session/compaction behavior. Viable, but adds higher-level coding-agent policies Pawl does not currently want to adopt implicitly.
- **Use `pi-agent-core` plus `pi-ai` — selected:** Pi owns iteration and provider streaming; Pawl controls the surrounding harness without forking Pi internals.
- **Use only `pi-ai`:** gives Pawl the entire loop, but the owner explicitly chose not to maintain it.

## Ownership and module interfaces

```text
Clack startup + OpenTUI
          |
Pawl conversation interface
          |
Pawl session lifecycle, policy, persistence and orchestration
          |
Pi Agent loop -> explicit pi-ai Bedrock adapter -> AWS Bedrock
          |
Pawl tool adapters -> existing AWS/scaffold/deploy operations
```

- **Pi:** model/tool iteration, streaming messages, tool lifecycle events, abort propagation, steering and follow-up queue mechanics.
- **Pawl:** application-level run state; queue policy exposed by the UI; session records; trusted instructions/skills; tool authorization; questions and approvals; account binding; context policy; finite execution limits; specialist-agent orchestration.
- **Existing AWS modules:** remain the implementation of resource scanning, synthesis, provenance, suggestions, cost/WAF review, code generation and deployment where they are already runtime-independent.

Define a small Pawl-owned conversation interface around send, answer, cancel, subscription and disposal. Define its ordering/error semantics alongside the types: send acceptance is distinct from run completion; subscriptions must exist before the first run; abort and shutdown settle pending input requests; exactly one terminal application-level outcome is emitted per run.

Do not expose Eve or Pi event/input unions to the UI. Map Pi events into Pawl-owned text/reasoning/tool/input/run events. Existing reducer, presenter, scrollback, busy pulse and fixed composer are retained but consume the new event contract. Pi's `turn_end` is one model iteration, not necessarily the end of a user's request. Pawl must not announce idle merely because a model response or tool batch ended.

Use the Pi `Agent` class, not a second hand-written loop and not a CLI/RPC child process. Its awaited subscription and pre-tool hooks provide the control points needed for persistence and policy. Provider adapters must respect Pi's streaming-error contract rather than unexpectedly rejecting outside the event stream.

## Explicit model, credentials and resources

Keep `.pawl/settings.json` version 1 and its current allowed fields/Continue/Change settings behavior. Do not migrate user settings into `.pi` or write global Pi configuration.

Resolve the exact selected Bedrock model/inference-profile ID. Keep region, model metadata, reasoning options and credentials consistent for every request, including specialist requests. Preserve the default `eu.amazon.nova-2-lite-v1:0`. Do not silently substitute a base model, another scope, or an available fallback.

Create one session-scoped execution context carrying the canonical project directory, selected profile/region, authenticated account identity, identity-checked credential provider, cancellation signal and shared mutation coordinator. Inject it into the Bedrock adapter, every AWS SDK operation (including the startup resource scan), specialist tools and controlled host executors. No tool may fall back to `fromNodeProviderChain()`, ambient region or ambient project discovery when this context is available. Remove environment-only wiring from the authored tools during migration; reusing a domain operation does not mean reusing its ambient credential defaults.

For SDK calls, inject the context's credential provider and region explicitly. For host subprocesses, construct a per-invocation environment from the selected context, neutralizing conflicting inherited AWS credential/profile/region/token settings; preserve unrelated environment needed to run the executable. Prove that the chosen mechanism supplies the same identity to CDK as the session, including refresh, expiry and permitted assume-role behavior. If credentials refresh into an incompatible identity, fail closed before new work and invalidate pending approvals. Do not mutate process-global AWS environment variables between agents or persist credentials in session records.

Continue existing SSO refresh and resolved-credential checks. Ambient API keys, bearer tokens or another profile must not silently override the selected account. The proof stage must verify the actual installed Pi provider and SDK/subprocess credential behavior before committing to their integration shapes. This is explicit credential plumbing, not an OS sandbox or a new IAM provisioning feature.

Use explicit provider registration and model metadata; do not inherit a user's Pi model registry, authentication store, settings, personal extensions or package discovery. No automatic network model-catalog refresh beyond Pawl's existing chosen-region discovery policy.

Load only Pawl's approved instructions, tools and skills. Preserve project instruction support through an explicitly defined, documented trust policy, not implicit execution of project extensions. Do not enable generic Pi `bash`, `write` or package-loading tools by default. Reuse named Pawl tools and narrowly scoped file operations needed by the generator.

## Tool schemas and execution policy

Keep Zod as the authoritative runtime schema definition for Pawl tools. The installed Pi tool types use TypeBox `TSchema`; prove a bounded schema adapter for the actual input shapes before converting every tool. Test optional/default/enum/array/object arguments and validation errors. Avoid duplicate independently maintained schemas or a cast that merely hides incompatible validation behavior.

Treat the two selected Pi packages as the intended dependency additions for the migration, with versions pinned after the proof. Any additional direct dependency (including TypeBox if required by the bridge) needs explicit approval; do not silently add it or rely on an undeclared transitive import.

Authorization is executable policy, not a system-prompt instruction:

- Only registered, allowed tools can execute; unknown tools fail closed.
- Validate arguments before authorization and execution.
- A deployment requires a fresh, explicit approval tied to the exact tool arguments, project, authenticated account/region and preview artifact. If these inputs change, require a new preview/approval. The artifact must bind the material actually deployed: an immutable, integrity-checked synthesized assembly and its materialized assets, a fixed change set, or an equivalent mechanism that prevents re-synthesis/rebuilding from replacing the approved work. Deployment must consume that approved artifact, not run a fresh synthesis from mutable project sources. Assign the concrete mechanism to the proof plan and verify it before cutover. Workspace changes after preview must either cause refusal and a new preview or leave execution constrained to the unchanged approved snapshot; they must never silently change what is deployed.
- Preserve the existing `generate` approval gate as well as deployment approval. Generation permission is scoped to the approved plan/project and intended write operation; do not permit equivalent direct generator/specialist file writes to bypass it.
- Rejected, cancelled, expired, mismatched or restart-recovered approval requests cannot execute a deployment.
- Check authorization at the tool/executor path, not solely in a UI handler. Do not grant a specialist broader authority than its parent.
- Pending questions/approvals are abortable. Denial/cancellation must settle the wait and must not leave the UI busy forever.
- Cancellation and shutdown propagate through host executors as well as Pi agents. Stop starting new subprocess work, terminate owned local subprocesses/descendants using a bounded cleanup strategy, and settle their stream/error handling. A process already submitting an AWS operation can leave its remote outcome uncertain; record that uncertainty rather than claiming rollback.

Preview and deployment stay separate. No generic shell shortcut may bypass the deployment policy. This is not an OS sandbox: CDK synthesis and other project build code can execute arbitrary local code. Document that trust/credential limitation honestly, and do not call prompt restrictions or tool allowlists a sandbox. Adding a sandbox or a new credential-isolation architecture is outside this migration unless separately approved.

## Local session records and resumption

Store private, versioned records under `.pawl/sessions/`, with files created as `0600`. Extend existing `.pawl/.gitignore` protection idempotently to ignore sessions and owned temporary files without churn between settings/session ignore blocks. Preserve plans and existing ignore rules. Refuse unsafe symlink paths rather than redirecting session IO outside the selected project.

Each session records its identity, format/codec version, project, authenticated AWS account and region, model selection, conversation history and operation outcomes. A profile name alone is not an account identity. Preserve provider-required opaque reasoning/signature content and tool-call/result IDs through a validated internal codec; the public UI interface still remains Pawl-owned.

Session content can contain sensitive project/AWS information or user-supplied secrets. Private permissions and Git exclusion do not make it suitable for sharing; do not claim all transcripts are secret-free. Do not persist SDK credential objects, environment dumps or authentication tokens as runtime metadata.

Persistence rules:

1. Keep one writer per session. A second process must not concurrently append to the same session; give an actionable busy/new-session outcome.
2. Persist completed messages and tool lifecycle checkpoints in order. Persist intent before permitting side-effecting execution; if that checkpoint cannot be saved, fail closed before execution.
3. A save failure after execution is an unknown/interrupted outcome, not evidence that the action did not happen. Never automatically retry it.
4. Partial streaming text can be shown as interrupted history but must not become a fabricated complete model message.
5. Recover an incomplete trailing record conservatively; do not silently discard corruption in the middle of the log or accept an unsupported schema version.
6. On restart, restore only validated context. Mark unfinished runs, requests and operations as interrupted. Ensure model context has a valid tool-call/result structure without inventing successful results.
7. Resume does not call `Agent.continue()` automatically, replay tools, replay queued input, or revive approvals. Wait for a new user instruction. Uncertain deployment outcomes require inspection and a new preview/approval before any new deployment attempt.
8. Revalidate AWS identity before sending restored context to a model or running a tool. An account/region mismatch must be explained; do not silently attach the old conversation to the new target.

Proposed startup integration: the saved-settings overview also identifies the most recent candidate conversation. **Continue** validates the selected account and resumes a compatible conversation, or starts a new conversation if none exists. **New conversation** keeps the chosen AWS settings but starts fresh; **Change settings** retains its current role. If identity validation makes the candidate incompatible, explicitly explain it and offer a fresh conversation or cancellation. Do not add another mandatory multi-step wizard merely to resume. These menu details are part of this written design's review/approval, not an already implemented behavior.

Existing Eve conversations are not automatically imported. Leave old runtime data untouched and document the reset in history at cutover; never delete existing session data as part of dependency cleanup.

## Context and specialist-agent policy

Retain the four specialist roles: planner, generator, well-architected and infra-auditor. Pawl creates their Pi agents explicitly with scoped tools/resources and the same authenticated account/region. Keep orchestration local and bounded; root cancellation propagates to children, and child work cannot outlive the parent process as a durable job.

Serialize mutating operations through one session-wide coordinator shared by the root and all specialists, not merely Pi's per-agent sequential tool setting. Never hold the mutation permit across a parent delegation wait when the delegated child must acquire it; acquire around actual mutation execution after approval and release on success, failure or cancellation. Read-only service scans may keep their existing bounded concurrency. No unbounded recursive delegation; the first migration supports root-to-specialist calls only, with no nested specialist delegation. Do not install or inherit the developer's `pi-subagents` extension into Pawl.

The runtime factory must supply finite model-call/deadline limits shared across root and specialist work. Exhaustion produces a visible stopped/error outcome without beginning another tool/model call. Exact conservative defaults belong in the implementation plan; this slice adds no budget-settings UI.

Initial context policy is conservative: retain the complete on-disk history, bound tool output, and stop with an actionable context-limit message rather than silently dropping history or splitting tool-call/result groups. Automatic lossy compaction is disabled for the initial migration. A future compaction implementation remains Pawl policy, not an implicitly inherited coding-agent behavior.

## Stage 1: proof without production cutover

Build a narrow embedded adapter and tests while Eve remains the production runtime. Avoid adding a permanent user-facing dual-runtime selector. An explicitly invoked verification script may exercise Pi independently.

Required proof:

- Real selected-profile/region Bedrock streaming on Nova 2 Lite and a second supported model with different reasoning behavior. Verify request identity/options, a tool call and a second conversational turn. Live probes must be explicitly authorized and scoped; no deployment is required or allowed as a proof step.
- Zod-to-Pi schema compatibility without weakening validation.
- A fake side-effecting executor that demonstrably does not run before approval, after denial/abort, or on restart; changed preview/arguments invalidate approval. Test altered project content and nondeterministic synthesis after preview with unchanged tool arguments: the executor must consume the approved immutable artifact or refuse, never deploy newly synthesized content. Test altered assembly/assets failing integrity checks before execution. No live deployment is needed.
- Conflicting ambient profile, access keys/session token, bearer token and region cannot redirect Bedrock, a resource scan or a CDK executor away from the session context. Verify SDK injection and controlled subprocess environments/identity handling, including credential refresh and incompatible identity rejection.
- Generation approval parity and session-wide mutation serialization across root/specialists, including cancellation and a parent delegating to a mutating child without deadlock.
- Streaming/UI ordering, cancellation and question/approval waits with native OpenTUI tests and deterministic fake provider streams. Use controlled local child-process fixtures to prove abort/shutdown stops owned subprocesses and prevents new work, without real AWS mutations.
- Session write/reload, interrupted tool recovery, private permissions/Git exclusion, mismatched account handling and concurrent-writer rejection.
- Specialist tool scoping and parent-to-child cancellation.

If provider authentication, schema compatibility or policy enforcement cannot be established with public supported interfaces, stop and report the gap before removing Eve or adding more dependencies. Preserve the current production path until this gate passes. State precisely which proof checks were mocked and which used a real terminal/provider.

## Stage 2: cutover after the proof gate

Adapt the current client/reducer/session driver to Pawl-owned events and input requests, wire the embedded runtime into startup, and port authored Eve tools/specialist definitions into explicit Pawl runtime modules. Reuse existing domain modules instead of rewriting infrastructure operations, but explicitly replace ambient SDK/host-exec credential wiring with the session execution context. Adapt the preview/deploy seam so execution consumes the approved integrity-checked artifact; retaining the current separate project-based `cdk diff`/`cdk deploy` calls does not satisfy approval parity.

Remove production Eve server launch, health polling, HTTP transport, authored-runtime bundling and obsolete Eve scripts/dependencies only after parity tests pass. Update the CLI Node requirement based on the selected Pi versions and OpenTUI compatibility, not simply because Eve is gone. Remove Vercel AI SDK packages only if a dependency/use audit proves they are no longer required.

Document the new architecture in a superseding ADR; preserve ADR 0001 as historical context. Update AGENTS/README/instructions that currently mandate Eve-specific runtime behavior. Keep existing init subcommands, startup settings and UI appearance unchanged except the approved session-choice additions.

## Test and delivery requirements

Use interface-level tests for send/answer/cancel/resume and deterministic provider/tool fixtures; do not rely on mock method-call counts alone. Cover complete and interrupted multi-tool batches, late events after cancellation, invalid/stale approval IDs, concurrent answers, failed session writes, session corruption, exact model scopes, SSO expiry, and UI busy/idle transitions.

Before each stage is accepted, run CLI tests, root lint/tests, typecheck and whitespace checks, with read-only code/spec review and explicit baseline comparison. Before production removal of Eve, complete the authorized live-provider and real-terminal checks from Stage 1. Never describe a fake approval test as a live deployment verification.

Last verified working-checkout baseline was 640 CLI tests passing, clean lint, root 1591 pass/8 skip/4 known LocalStack-related failures, and 50 TypeScript diagnostics identical to the earlier baseline. Re-establish this at implementation start; the checkout has since changed.

## Current checkout and source evidence

Planning is against local `main` at `1fba562802c7bb338ed3f9799dc8360c881fe38d`. Prior approved UI/model/pulse changes remain uncommitted. `packages/cli/package.json` and `bun.lock` now also have a pre-existing `microsandbox` development-dependency change; this design neither introduces nor removes it and does not authorize a sandbox integration. Preserve unrelated `.pi`, `.kiro`, skills-lock and `.pawl` files.

Installed reference packages inspected: Pi coding-agent, agent-core and pi-ai **0.85.1**. Relevant sources:

- `@earendil-works/pi-coding-agent/docs/sdk.md` and `examples/sdk/12-full-control.ts`: explicit embedding/resource-loader alternative.
- `@earendil-works/pi-agent-core/README.md` and `dist/types.d.ts`: Agent events, awaited subscribers, tool policy hooks, cancellation and TypeBox tool-schema requirement.
- `@earendil-works/pi-ai/dist/api/bedrock-converse-stream.d.ts`: Bedrock profile/region options; actual simple-stream forwarding/auth behavior still requires the proof gate.
- Pawl `src/tui/client.ts`, `src/tui/session.ts`, `src/tui/reducer.ts`, `src/tui/preflight-validation.ts`, `agent/tools/*` and `agent/subagents/*`: current runtime coupling and reusable operations.

No Pi dependencies or runtime code are changed by this design document.
