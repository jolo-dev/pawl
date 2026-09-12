# ApiGateway Supported-Target Links Implementation Plan

> **For agentic workers:** Use test-driven implementation and independent review. Do not commit, stage, install dependencies or modify infrastructure code/diagram sources.

**Goal:** Make ApiGateway's existing Routes and integrations node offer links to its supported LambdaFunction and EventBridge target documentation.

**Architecture:** Attach explicit, stable diagram/node metadata during documentation generation; enhance only the approved node with an accessible link chooser after SVG rendering. Preserve the ownership-only drawing and existing camera, compact hover toolbar, strict renderer and fallback behavior. Use normal anchors for navigation.

**Tech Stack:** Existing TypeDoc/Starlight, Mermaid 11.17.2, DOM/SVG, Bun and Chromium/CDP; no new dependencies.

## Confirmed design

Following grilling/domain-modeling, the user confirmed all of these decisions with “yes to all”:

1. Targets mean supported construct types, such as ApiGateway's LambdaFunction/EventBridge route targets—not application instances or deployed resources.
2. Open documentation links; do not reveal other constructs' internal diagrams or add target nodes/edges to the ownership diagram.
3. Clicking **Routes and integrations** opens a small chooser containing **LambdaFunction** and **EventBridge**. The chooser identifies them as **Supported targets**, not configured resources.
4. If metadata contains one target, the interaction is a direct link rather than a chooser. Keep this cardinality behavior testable, but do not enable any other real construct in this pilot.
5. Pilot **ApiGateway only**. No links on its authorizer/logs/API nodes, no automatic broader rollout and no external documentation/console destinations.
6. Navigation is **same tab by default**; genuine anchors preserve Ctrl/Cmd-click, middle-click and browser link actions.

`CONTEXT.md` records the settled distinction between supported target types and configured targets. UI/implementation decisions belong here, not in that glossary. No ADR is warranted for this reversible pilot.

## Source facts

- `packages/cdk/src/apigateway.ts`: `ApiProps.routes` uses `LambdaFunction | EventBridge`, as does `addRoute`; actual integration dispatch handles those two classes. Trust those types rather than the broader stale route-prose examples.
- Its existing authored service ID is `routes`, captioned Routes and integrations. The supplied target instances are intentionally omitted from the ownership diagram.
- Generated ApiGateway documentation already links to `/pawl/cdk/classes/lambdafunction/` and `/pawl/cdk/classes/eventbridge/`.
- The current fork discards reflection identity while converting diagram fences, and the viewer's SVG render IDs contain random UUIDs. Explicit class/node identity is needed; do not infer relationships from icons, display labels or hard-coded runtime render IDs.
- The viewer currently captures ordinary mouse-down for pan. Links/buttons are exempt, and pointer capture can retarget subsequent clicks. Real click-versus-drag behavior must be verified; adding an onclick alone is insufficient.

## Interaction and accessibility contract

- The existing routes node has a subtle, discoverable link/chooser affordance without changing diagram geometry or adding resource content. Mouse click/tap and keyboard Enter/Space can open the chooser; both icons and relevant caption should have a coherent hit area where practical.
- Pan still works when dragging the diagram, including a drag beginning on the linked node. A small movement threshold distinguishes activation from dragging. Drag release/cancel/lost capture must never open the chooser or navigate accidentally. Pointer capture must not swallow a real click.
- The chooser contains two normal documentation anchors. Preserve modified/middle click; do not replace anchor navigation with window.open or blanket preventDefault.
- Keyboard users can discover and activate the node, reach the links, dismiss with Escape and recover focus. An outside click dismisses it. In expanded mode, Escape closes the chooser before closing the viewer dialog; closing/restoring the viewer leaves no stranded overlay/focus state.
- Position the chooser within the visible viewer/viewport, not clipped by the transformed stage. It works at zoom/pan offsets, narrow screens and inside the native dialog. Keep one logical chooser across light/dark variants; hidden variants remain inert.
- Close or safely reposition the chooser on camera movement, resize, theme change and expand/restore. Keep wheel/pan and toolbar behavior intact. No new global page shortcut/scroll interception.
- Preserve styles from `docs/DESIGN.md` and the compact hover toolbar. No visual-world redesign. This is a small documentation link chooser, not another modal workflow or an expanded resource graph.

## Metadata and safety contract

- Add only narrowly scoped ApiGateway/routes metadata, using TypeDoc reflection identity or another explicit generator-owned identity. Do not enable the feature by matching route names, icons or arbitrary page text globally.
- Resolve real documentation destinations correctly with production `/pawl/` and development/no-base routes. Prefer generator-resolved URLs; a narrowly explicit relative mapping is acceptable if validated against actual generated routes. Never guess an ARN, console URL or endpoint.
- Validate/escape any serialized metadata and inserted text. Reject malformed/unsafe URLs; fail closed to the existing non-interactive diagram if metadata or the expected node is unavailable. Keep Mermaid strict security and sanitized SVG insertion.
- Isolate renderer-specific node lookup and test it against pinned 11.17.2 output. Persistent identity is class + authored node ID; runtime prefixes are scoped lookups only.
- If wrapper attributes change, update the fork's exact wrapper-detection logic: its current `insertMermaidScript()` checks the literal `<div class="mermaid-block">`. A metadata wrapper must not accidentally lose the bootstrap.
- Guard the target mapping against drift from the real ApiProps route union. Do not expand or repair EventBridge's unrelated target/destination behavior.

## File scope

- `docs/typedoc-plugin-mermaid.mjs`: explicit pilot identity/metadata and safe emitted delivery wiring.
- `docs/mermaid-viewer.mjs`: narrow activation/pan integration and enhancement lifecycle.
- Optional focused adjacent module, e.g. `docs/mermaid-target-links.mjs`, if it keeps link metadata/chooser behavior cohesive rather than inflating the camera controller. Any module split must work in both emitted pages and existing direct-import tests; no unresolved browser imports or source-rewrite tricks.
- `docs/src/styles/custom.css`: scoped node affordance and chooser styles only.
- `docs/tests/mermaid-viewer.test.ts` and `docs/tests/mermaid-viewer.browser.mjs`: metadata/cardinality/security/source-drift and genuine browser interaction coverage. A separate focused target-links test file is acceptable if clearer.
- This plan for evidence. Generated references change only through the docs build.
- Preserve `CONTEXT.md`, source diagrams, public APIs, dependencies/lockfiles, global config and unrelated dirty work.

## Task 1 — Snapshot and red

- [x] Snapshot current Git-visible state to `/tmp/pawl-target-links-before.json`. Continue in the existing intentionally dirty workspace with one writer; no resets, worktree recreation or staging.
- [x] Inspect the source union, fork conversion lifecycle, generated routes, actual SVG node structure and current gesture tests.
- [x] Add failing tests for explicit ApiGateway-only metadata, zero/one/multiple target behavior, URL safety/base handling and target-union drift.
- [x] Add a real browser failing assertion for clicking the delivered routes node and reaching the chooser. Record an expected assertion failure, not a missing-import/environment error.

## Task 2 — Pilot implementation

- [x] Implement minimal explicit metadata and actual emitted wiring, with a source-of-truth test for the two supported types.
- [x] Implement accessible node activation and chooser/direct-anchor behavior. Keep normal anchor semantics and robust drag suppression/recovery.
- [x] Implement theme/dialog/camera lifecycle and small scoped styles, preserving geometry and fallback.
- [x] Run focused tests and lint; fix only task-owned issues.

## Task 3 — Delivered verification

- [x] Build docs serially; never hand-edit generated pages.
- [x] Exercise actual ApiGateway node click/tap, keyboard opening/dismissal, both link destinations, native same-tab and modified/middle-click behavior. Verify correct URLs on `/pawl/` and no-base delivery.
- [x] Exercise drag from the linked node and blank space, pointer capture/release/cancellation, wheel zoom and reset while chooser is open, theme/resize transitions, expanded-mode chooser and ordered Escape/focus behavior.
- [x] Check zero/one/multiple metadata cardinality using clearly synthetic browser fixtures; only ApiGateway has real production mapping. Confirm other diagrams and ApiGateway's other nodes remain non-interactive.
- [x] Retain existing 287 browser assertions or explicitly document any assertions legitimately adapted for the new link affordance; do not weaken unrelated camera/security/fallback tests.
- [x] Verify all 22 diagrams/88 views retain geometry/connectors and no page overflow. Accessible attributes may change; geometry and Mermaid source must not.
- [x] One batched desktop/mobile, light/dark inspection and at most one correction/confirmation. Save evidence under `/tmp/pawl-target-links-browser/`; include inline and expanded chooser, keyboard focus and a non-pilot page. Run the mechanical detector once, no unrelated cleanup.

## Task 4 — Review and final gates

- [x] Independent review of reconstructed task diff, source-backed semantics, actual link/click/drag evidence, keyboard/dialog lifecycle, safety and final screenshots: **OK with notes**, no findings; original baseline limitations remain below.
- [x] No material findings or implementation corrections required by independent review.
- [ ] Final gates: lint/focused tests pass again; recovery explicit browser suite passes. Full serial LocalStack-enabled suite is **blocked before launch by unavailable Docker**, as recorded below. No real AWS deployments or token disclosure.
- [x] Recompute snapshot preservation and document exact generated changes. No staged files, package/source/diagram changes or unexpected edits.

## Evidence and outcome

Implemented and independently approved **OK with notes**. Fresh final lint/focused checks pass; full serial LocalStack gate remains blocked by unavailable Docker. See **Final verification attempt** below.

**Recovery provenance notice:** The original worker timed out and its `/tmp` evidence is now absent. The original-run account below is retained as historical transcript-backed reporting, not currently available artifact evidence. Fresh verification and its durable paths are recorded in **Same-protocol recovery verification** at the end of this plan. The original complete pre-pilot snapshot and 88-view before/after SVG comparison cannot currently be re-attested.

### Implementation decisions and findings

- The approved preflight had no findings. No new product or architecture decision was needed.
- The TypeDoc resolve hook retains **class kind + ApiGateway name + packages/cdk/src/apigateway.ts source identity** and serializes only `owner: ApiGateway`, `node: routes`, and the two approved relative target links. The parser accepts only the exact approved name/destination pairs, rejects duplicates and malformed/unsafe values, and resolves against the actual page URL, not an HTML base element. Both generated URL bases were exercised.
- Kept delivery self-contained in the existing viewer module. TypeDoc imports the mapping at generation time and emits the complete, unchanged module source inline; there are no runtime local module imports or source-string rewrites. Attributed wrappers now retain the bootstrap. Rendering remains pinned to 11.17.2 and strict.
- Mermaid-specific lookup is isolated in `findTargetNode`: SVG-local render prefix + authored service ID. No random SVG ID is persisted as metadata. Missing nodes in either theme fail closed, rather than producing partially enhanced variants.
- Existing service groups are wrapped without changing their drawing. Multiple targets use a keyboard-operable disclosure and one nonmodal, top-layer popover containing native anchors; a single target uses a genuine SVG anchor. The popup does not add graph nodes, edges, or deployed-instance claims.
- Capture is delayed until a 5px node drag threshold. Click/auxclick suppression is scoped to completed/cancelled viewer gestures, not normal anchors or keyboard activation. A further real-CDP red test exposed a first movement jumping outside the viewport; observing pending mouse movement on window fixes that while preserving native clicks. Mouse capture/release, cancellation, recovery, and native touch remain tested.
- One visual batch found the fixed popup could become detached from its node on page scroll. A red assertion preceded the bounded fix: document scroll dismisses the popup with focus recovery. Screenshot capture no longer scrolls an already-open popup, and waits for the native touch highlight to finish. The one confirmation batch showed the corrected mobile placement. No layout/visual-world redesign was made.
- The no-base build also regenerates Markdown links without `/pawl/`; a final **production build** restored those incidental generation changes. Final generated-file diffs are only viewer delivery on the 22 diagram pages plus the ApiGateway metadata attribute. No generated files were hand-edited.

### Exact changed files

Authored files (six):

- `docs/mermaid-viewer.mjs`
- `docs/typedoc-plugin-mermaid.mjs`
- `docs/src/styles/custom.css`
- `docs/tests/mermaid-viewer.test.ts`
- `docs/tests/mermaid-viewer.browser.mjs`
- `docs/superpowers/plans/2026-09-10-apigateway-target-links.md`

Build-generated files, all under `docs/src/content/docs/cdk/classes/`:

`AgentCore.md`, `ApiDestination.md`, `ApiGateway.md`, `ApiGatewayV1.md`, `AuthoritativeRevisionArbitrationExhaustedError.md`, `CodeBuildProject.md`, `CodeCommit.md`, `CodeCommitAutoReviewer.md`, `CodeCommitReviewEvents.md`, `CodeCommitSourceLimitError.md`, `CodePipeline.md`, `DurableLambdaFunction.md`, `DynamoDbTable.md`, `DynamoDbTableWithStreams.md`, `EventBridge.md`, `LambdaFunction.md`, `LocalStack.md`, `PipelineDefinitionError.md`, `PipelineReviewDispatcher.md`, `Sqs.md`, `Stack.md`, `StaticSite.md`.

### Commands and red/green evidence

All shell invocations used `rtk`; builds, test suites, and geometry runs were serial. Logs and artifacts are under `/tmp/pawl-target-links-browser/`.

| Command | Result / evidence |
| --- | --- |
| `rtk python3` snapshot script before edits | 661 Git-visible files captured with SHA-256, content, status, and staged state in `/tmp/pawl-target-links-before.json`. |
| `rtk bun test docs/tests/mermaid-viewer.test.ts` before implementation | Expected **3 assertion failures**, 6 existing tests pass: missing explicit metadata, parser contract, and source-union mapping. `unit-red.log`. |
| `PAWL_BROWSER_DIR=/tmp/pawl-target-links-browser/red rtk bun docs/tests/mermaid-viewer.browser.mjs` before implementation | Expected **real routes-click assertion failure**, delivered viewer initialized, no browser errors. `browser-red.log`. |
| Browser suite with new outside-first-move assertion before fix | Expected failure proving mouse movement outside the viewport was missed. `browser-outside-drag-red.log`. |
| Browser suite with new page-scroll assertion before fix | Expected failure proving a fixed chooser remained open after page scroll. `browser-scroll-red.log`. |
| `rtk bun test docs/tests/mermaid-viewer.test.ts packages/cdk/tests/documentation-diagrams.test.ts` | **71 pass, 0 fail, 932 expectations**. `focused-tests.log`. |
| `rtk bunx biome check --write docs/mermaid-viewer.mjs docs/typedoc-plugin-mermaid.mjs docs/src/styles/custom.css docs/tests/mermaid-viewer.test.ts docs/tests/mermaid-viewer.browser.mjs` | Focused formatting/check passes; existing Biome configuration excludes the TypeDoc fork. |
| `rtk bun lint` | **300 files checked, zero errors**. `lint.log`. |
| From docs: `rtk bun run build` | **183 production pages built**. `build.log`, final restoration `build-final-production.log`. |
| From docs: `rtk bun run build --base / --outDir /tmp/pawl-target-links-browser/no-base-site` | **183 actual no-base pages built**. `build-no-base.log`. Build this before the final production build when reproducing, to retain production Markdown URLs. |
| `PAWL_BROWSER_DIR=/tmp/pawl-target-links-browser rtk bun docs/tests/mermaid-viewer.browser.mjs` | **360 recorded checks pass**, plus six real new-tab destination assertions. All original **287** check labels/counts retained (verified mechanically, none weakened). `results.json`, `browser.log`, `console-errors.json` (empty). |
| `PAWL_BROWSER_DIR=/tmp/pawl-target-links-browser/geometry rtk bun /tmp/pawl-mermaid-viewer-geometry.mjs` | **22 pages / 88 views, zero connector/overlap failures, zero page overflow**. Harness unchanged; no selector adaptation or weakened connector checks. `geometry.log`, `geometry/results.json`, `geometry/failures.json`. |
| From docs: `rtk /Users/jolo/.pi/agent/skills/impeccable/scripts/impeccable detect src/styles/custom.css mermaid-viewer.mjs --json` | **One detector run**, no primary findings. Two advisories: pre-existing toolbar 1rem type size, and the new neutral 15% black soft shadow. Retained intentionally as a small offset paper shadow consistent with DESIGN.md; no design metadata changed. `detector.json`. |
| `rtk python3 /tmp/pawl-target-links-browser/verify-preservation.py` | Verifies only six authored and 22 generated-delivery changes, no additions/removals, preserved original checks, 88 identical geometry views, no staged files. `preservation.json`, `changed-files.json`, `geometry-comparison.json`, `task-only.diff`, `authored.diff`. |
| `rtk git diff --check`; `rtk node --check docs/typedoc-plugin-mermaid.mjs`; `rtk node --check docs/mermaid-viewer.mjs` | All pass. |
| `rtk chromium --version` | Helium 0.16.5.1 / Chromium 152.0.7977.82 on macOS. Genuine new-tab modifier tested is **Cmd/Meta**; middle-click and ordinary same-tab navigation tested for chooser and direct anchors. |

Delivered browser coverage includes both real target destination pages on production and no-base URLs; icon/caption hit area, click vs small movement vs pan, first-move outside viewport, pointer cancellation/lost capture/recovery; Enter/Space/Tab/Escape and focus recovery; native modified/middle-click tabs and native direct-anchor Enter; touch tap/swipe; zero/single/invalid/missing-node direct-import fixtures; non-pilot pages; wheel/reset/resize/theme/page-scroll/expanded lifecycle; strict renderer errors, blocked CDN, and no-JS source fallback.

### Visual evidence

One batch inspected desktop/mobile, dark/light, inline/expanded chooser, keyboard focus, and a non-pilot page. One bounded correction/confirmation followed; no further visual rounds or detector passes.

- `target-desktop-dark-inline-keyboard.png`
- `target-desktop-light-inline-keyboard.png`
- `target-desktop-dark-expanded.png`
- `target-desktop-light-expanded.png`
- `target-mobile-dark-inline-keyboard.png` (real touch tap)
- `target-mobile-light-inline-keyboard.png` (real touch tap)
- `target-mobile-dark-expanded.png`
- `target-mobile-light-expanded.png`
- `CodePipeline-desktop-dark-inline.png`

All are in `/tmp/pawl-target-links-browser/`; existing viewer screenshots and all 88 geometry SVG/screenshots remain there too. The 88-view comparison against `/tmp/pawl-mermaid-mouse-browser/geometry/` proves identical viewBoxes, service transforms, connector paths and text attributes/content. Source diagrams are also byte-identical to the task snapshot.

### Preservation, limitations, and remaining gates

- `CONTEXT.md`, `docs/DESIGN.md`, all source/package files, configs, dependency manifests/lockfiles and all unrelated prior dirty work are byte-preserved. No installs, staging, commits, worktree resets or deployments were performed.
- Browser evidence is Chromium/CDP, including touch emulation, not physical-device or assistive-technology testing. Safari/Firefox and platform-native Ctrl-click on Windows/Linux were not run; native anchors preserve those browsers' default behavior. The chooser uses the modern native Popover API, alongside the existing native dialog.
- Docs builds retain existing TypeDoc cross-reference/schema warnings and the missing `site` sitemap warning; builds complete. No unrelated fixes were attempted.
- **Parent remaining:** independent implementation/visual acceptance review and any bounded material corrections; final lint, focused tests, explicit two-build browser suite and full serial LocalStack-enabled integration suite via `/tmp/pawl-run-tests-with-localstack.ts`. Full expensive tests were deliberately not run by the worker.


## Same-protocol recovery verification

User-authorized continuation of workflow `b8036577-b784-45fa-8079-20b43a68f4ba` after worker `751e8f84-ba16-45ce-aac2-bb5b0a88f5b3` timed out. HEAD remains `f40688429e7e2c3160e40f482375bd699be30970`. No feature reimplementation, cosmetic changes, dependency operations, staging, commits, source-diagram changes, production API changes or CONTEXT changes were made in recovery. Only this plan was edited; both builds reproduced all previously present generated Markdown bytes exactly.

### Durable evidence and baseline limits

All fresh evidence is under `/Users/jolo/.pi/agent/subagent-evidence/pawl-target-links-recovery-b8036577/` (abbreviated **E** below), not solely `/tmp`.

- `E/fresh-before.json`: fresh pre-recovery-edit Git-visible snapshot, 664 paths including 661 files with SHA-256 and base64 content. This is **not** the missing original 661-file pre-pilot snapshot. `E/fresh-before-tracked.diff` records the complete dirty tracked state, not a task-only diff. The three non-file entries (existing gitlink directory, directory symlink and pre-existing deleted Construct.md) are described in `E/fresh-nonfile-supplement.json`; directory contents behind gitlinks/symlinks are not recursively snapshotted. The snapshot's `missing` flag means non-file for these entries.
- `E/reconstructed/`: durable copy of the parent's recovered four complete pre-pilot authored files, CSS excerpt, artifact index, and reconstructed authored diff. Those baselines came from first full reads in the original worker transcript. CSS before line 621, the pre-pilot plan, and the full pre-pilot generated/source-file snapshot were not recovered. Do not conflate this partial reconstruction with the fresh snapshot.
- `E/reconstructed-authored-current.diff` compares the four recovered full authored baselines to current source; `E/reconstructed-css-excerpt.diff` separately compares only the recovered CSS tail. Neither is a complete original task-only diff.
- The recovered old `verify-preservation.py` was inspected but **not run**: it requires absent original snapshots/results/SVGs and would falsely imply complete pre-pilot attestation if pointed at fresh substitutes. Recovery uses `E/verify-recovery-preservation.py`, with explicitly fresh-snapshot scope, instead.
- Geometry helper fully recovered from `29c75419-9614-45d2-b339-6a8c60a404de_worker_0_transcript.jsonl`, line 44 full read; replayed only its already-recorded line 118 `.mermaid-viewport > .mermaid` → `.mermaid-stage > .mermaid` edit. `E/geometry-original-read.mjs`, `E/pawl-mermaid-viewer-geometry.mjs`, and `E/geometry-recovery-provenance.json` retain the source and provenance. Existing `PAWL_BROWSER_NAMES` supplies the 22 generated diagram page names (`E/geometry-pages.json`), avoiding the helper's missing `/tmp` inventory. No source-preview or SVG-baseline injection was enabled, and no connector checks were changed.

### Fresh serial gates

Commands below were executed serially with `rtk`; no full expensive suite was run.

| Command | Fresh result / durable evidence |
| --- | --- |
| `rtk bun test docs/tests/mermaid-viewer.test.ts packages/cdk/tests/documentation-diagrams.test.ts` | **71 pass, 0 fail, 932 expectations**; `E/focused-tests.log`. |
| `rtk bun lint` | **300 files checked, zero errors, no fixes**; `E/lint.log`. |
| From docs: `rtk bun run build --base / --outDir /Users/jolo/.pi/agent/subagent-evidence/pawl-target-links-recovery-b8036577/no-base-site` | **183 actual no-base pages**; `E/build-no-base.log`, `E/no-base-site/`. |
| From docs: `rtk bun run build` | **183 production pages**, restoring `/pawl/` generated links; `E/build-production.log`. Existing TypeDoc cross-reference/schema and missing sitemap `site` warnings remain. |
| `PAWL_BROWSER_DIR=/Users/jolo/.pi/agent/subagent-evidence/pawl-target-links-recovery-b8036577 rtk bun docs/tests/mermaid-viewer.browser.mjs` | **360 recorded checks pass**, plus six native new-tab destination assertions; `E/browser.log`, `E/results.json`, empty `E/console-errors.json`. Both URL bases, real native anchors, click/touch/keyboard/drag and lifecycle/fallback cases pass. |
| `PAWL_BROWSER_DIR=E/geometry PAWL_BROWSER_NAMES=<22 names from E/geometry-pages.json> rtk bun E/pawl-mermaid-viewer-geometry.mjs` | **22 pages / 88 current views, zero connector/overlap failures, zero page overflow**; `E/geometry.log`, `E/geometry/results.json`, empty `E/geometry/failures.json` and `E/geometry/console-errors.json`, 88 SVGs and screenshots. This is current-output verification, **not** comparison against the absent original SVG baseline. |
| `rtk bun E/check-preserved-assertions.mjs` | All **48 original browser check call sites** preserved byte-for-byte within the current 86 call sites; `E/preserved-assertions.json`. Original 287 runtime-check count is historical; no original results file was substituted. |
| `rtk git diff --check`; `rtk node --check docs/typedoc-plugin-mermaid.mjs`; `rtk node --check docs/mermaid-viewer.mjs`; `rtk chromium --version` | Pass; `E/static-checks.log`. Recovery browser: **Helium 0.16.6.1 / Chromium 152.0.7977.82** (Helium patch newer than original run). Cmd/Meta and middle-click were actually exercised; platform-native Ctrl-click was not. |
| `rtk python3 E/verify-recovery-preservation.py` | Fresh snapshot comparison: **only this plan changed**, zero additions/removals, unchanged HEAD/index, all implementation/CSS/tests/generated/source/package/CONTEXT bytes preserved; `E/preservation.json`, `E/recovery-only.diff`. |

The raw shell wrappers redirect complete command stdout/stderr into these durable logs and preserve each exit status. No missing-log or infrastructure workaround was needed. No new failure required a code fix, so no new red/green implementation cycle was introduced.

### One final visual inspection

Inspected the following nine fresh screenshots once; chooser text, keyboard focus, placement and compact toolbar remain coherent, without clipping. No cosmetic edits, new visual framework, detector rerun or screenshot correction round:

- `E/target-desktop-dark-inline-keyboard.png`
- `E/target-desktop-light-inline-keyboard.png`
- `E/target-desktop-dark-expanded.png`
- `E/target-desktop-light-expanded.png`
- `E/target-mobile-dark-inline-keyboard.png`
- `E/target-mobile-light-inline-keyboard.png`
- `E/target-mobile-dark-expanded.png`
- `E/target-mobile-light-expanded.png`
- `E/CodePipeline-desktop-dark-inline.png`

### Acceptance and remaining gates

The delivered ApiGateway/routes pilot passes fresh focused, lint, two-build, browser and current geometry acceptance. There were **no feature-file changes during recovery** and **no staged files**. The implementation's historical six authored / 22 generated-file scope is retained above; recovery does not claim that scope is independently proven against the missing complete pre-pilot snapshot. Fresh preservation is independently verified against the recovery snapshot instead.

Independent implementation/visual review subsequently completed **OK with notes**; final verification is recorded below. Browser evidence remains Chromium/CDP with touch emulation, not physical-device, Safari/Firefox, or assistive-technology testing. Old exact before/after geometry equivalence and complete pre-pilot dirty-work preservation remain explicit evidence gaps; current 88-view geometry, source-backed tests and recovery-byte preservation are available, not fabricated replacements.

## Final verification attempt

Independent reviewer `31cb2eb3-b99f-465f-bab5-18d2d7bc20d8` approved **OK with notes**, no findings and no corrections requested. The declared `target-links-recovery/review.md` artifact was empty; the supervisor recovered the reviewer's successful structured-output submission verbatim into `E/review-recovered.md` and `E/review-recovered.json`. Those recovered artifacts, not the empty file, supply the actual verdict. The reviewer inspected code and fresh screenshots/logs but did not independently rerun tests. In addition to baseline/platform limits above, separate caption-hit activation was not independently demonstrated: browser activation targets the wrapper center, although source wraps the complete service and caption.

The final verification worker changed **only this plan**, not implementation, generated files, source diagrams, APIs, dependencies or unrelated dirty work. No installs, staging, commits, AWS deployments or credential login were performed.

| Final command | Actual result / durable evidence |
| --- | --- |
| `rtk bun lint` (captured via `rtk proxy bash`) | **300 files checked, zero errors, no fixes**; `E/final-lint.log`. |
| `rtk bun test docs/tests/mermaid-viewer.test.ts packages/cdk/tests/documentation-diagrams.test.ts` (captured via `rtk proxy bash`) | **71 pass, 0 fail, 932 expectations**, 2 files; `E/final-focused-tests.log`. |
| `rtk open -a Docker` | Returned without error, but Docker daemon remained unavailable. |
| `rtk docker desktop start` | **Timed out after 120 seconds**. This startup attempt was not successful and was not a test-suite run; `E/final-docker-start-attempt.json`. |
| `rtk docker desktop status`; `rtk docker info --format '{{.ServerVersion}}'`; `rtk docker ps -a --format '{{.ID}} {{.Image}} {{.Status}} {{.Names}}'` | Failed: Desktop status unavailable; daemon socket `/Users/jolo/.docker/run/docker.sock` missing. `E/final-docker-preflight.log`. |
| `rtk bun E/pawl-run-tests-with-localstack.ts` | **NOT RUN**: full serial suite blocked before launch by Docker. No full-suite pass/fail count exists for this attempt. |
| `rtk python3 E/verify-recovery-preservation.py` | Fresh recovery snapshot preservation recomputed after plan update; `E/preservation.json`, `E/recovery-only.diff`, `E/final-preservation.log`. Only plan changed; no added/removed Git-visible paths; unchanged HEAD/status; empty index. |
| `rtk git diff --check` | Pass; `E/final-diff-check.log`. |

The missing runner was recovered exactly, without edits, from the parent session transcript `2026-09-07T13-41-55-660Z_01a07c1a-a34c-7427-9212-fcc79d97e279.jsonl`, line 420 original write-tool arguments; `E/runner-recovery-provenance.json` records this source. Its durable path is `E/pawl-run-tests-with-localstack.ts`. It retrieves `/pawl/localstack/token` using `aws --profile jolo ssm get-parameter --with-decryption`, keeps the value in memory, injects it only through `LOCALSTACK_AUTH_TOKEN`, prepends root `node_modules/.bin` to PATH, buffers test output and redacts the token before forwarding output. Existing `localstack.setup.ts` passes the token to the container environment and explicitly removes it from CDK child environments, whose endpoints and test credentials point to LocalStack. **No SSM retrieval was attempted in this final gate because Docker failed first**; credential availability is therefore not attested.

Docker's failed `ps -a` means absence of lingering test containers **cannot be verified**. This final attempt launched no tests/containers and did not remove or alter unrelated containers. The prior worker timeout and missing original `/tmp` evidence remain historical failures/limitations, not relabeled successes. The fresh recovery browser result (360 checks plus six native-tab assertions) and 22-page/88-view geometry result remain available and reviewed; neither was rerun in this final gate, and implementation/generated bytes remain identical to that tested state.

**Remaining action:** restore Docker Desktop availability, then run the recovered runner serially from repository root with redacted output captured to durable evidence; verify its actual exit/counts and no lingering test containers, and recompute preservation. Do not claim overall final-gate completion until that run succeeds. Complete original pre-pilot snapshot and before/after SVG equivalence remain unavailable even after runtime recovery.

## Final gate completion

Docker Desktop became reachable after user confirmation ("docker is running now"). The parent ran the recovered runner directly:

- `rtk docker info` / `rtk docker ps -a` before the run: daemon reachable; the only localstack container was the pre-existing **six-week-old exited** `localstack-main` (Exit 137), unrelated to this task.
- `rtk bun /Users/jolo/.pi/agent/subagent-evidence/pawl-target-links-recovery-b8036577/pawl-run-tests-with-localstack.ts`: **exit 0; 1,101 pass, 8 existing skips, 0 fail**, 1,109 tests across 107 files in 151.01 seconds. Redacted durable log: `/tmp/pawl-target-links-full-tests.log`.
- After the run: `docker ps -a` again lists only that pre-existing exited container — the suite left **no lingering test containers**. `git diff --cached --name-only` empty; no staged files.
- Preservation was not recomputed after this run because nothing in the repository was modified by it (test execution only); the previous fresh preservation check remains valid.

With this run, all parent-owned gates from the plan are complete: independent review (OK with notes, no findings), lint, focused tests, both builds, delivered browser suite, current geometry, full serial LocalStack suite and container cleanup. The historical evidence gaps recorded above (missing complete original pre-pilot snapshot and historical before/after SVG equivalence; Chromium-only browser coverage) remain honestly unrecoverable/unperformed and are not closed by this run.
