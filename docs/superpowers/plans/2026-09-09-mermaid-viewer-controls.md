# Mermaid Viewer Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Track evidence below. Do not commit or stage files.

**Goal:** Add accessible zoom out/in, reset-to-fit and expand/restore controls around Pawl's Mermaid diagrams without changing diagram content or dependencies.

**Architecture:** Enhance the existing shared TypeDoc Mermaid wrapper rather than individual generated pages. Use a small browser controller, controlled asynchronous Mermaid rendering and scoped presentation. Preserve the two theme variants with one logical viewer state and toolbar, and pin the current browser CDN renderer to Mermaid 11.17.2.

**Tech Stack:** Existing TypeDoc/Starlight, Mermaid 11.17.2, browser DOM/SVG and native dialog, Bun tests, existing Chromium/CDP tools. No new dependencies.

## Approved basis and scope

The user approved the viewport-control increment proposed in `docs/analysis/mermaid-interactions.md`: “okay start with zoom/reset/expand”. The research is the design basis. Apply the shared enhancement consistently to rendered diagram blocks; use ApiGateway as the first behavioral fixture, then verify dense and single-node diagrams too. No node links, tooltips, selection, drag/pinch gestures, browser-fullscreen API or diagram-source changes.

Continue in the existing intentionally dirty workspace with a single writer: a clean worktree would omit the previously approved docs/design and diagram work. Snapshot before editing; preserve all unrelated work. No deployments, installs, dependency/lockfile changes, commits or staging. Source comments remain authoritative; generated references change only through the build.

## Interaction design

- One quiet toolbar per logical diagram: zoom out, readable zoom percentage, zoom in, Reset, Expand/Restore. Following the user's refinement, it floats at the top-right on hover-capable fine pointers, hidden until viewer hover or keyboard focus. Touch devices retain visible controls with reserved clearance so the toolbar cannot mask the diagram. Match `docs/DESIGN.md` rather than introducing a new visual identity. Use authored small SVG icons where icons help, visible text for Reset/Expand, and accessible names for every button.
- Fit-to-viewport is 100%. Provide bounded zoom (50–300%, 25 percentage-point steps); disable buttons at their limits. Reset fits the full diagram and returns its scroll position to the fitted origin. Do not change SVG geometry, node coordinates or connectors.
- The viewport owns any horizontal/vertical scrolling. Every edge remains reachable after zooming. Never intercept ordinary wheel, pinch, or page keyboard shortcuts. A keyboard-focusable named viewport permits native scrolling.
- Expand uses an in-page enlarged native dialog, not browser fullscreen. Move the existing viewer rather than cloning IDs. Keep its toolbar available; native modal focus containment, Escape, explicit Restore and return focus to the triggering control. Restore returns it to the original DOM position without losing the diagram. Fit remains meaningful in both sizes; keep logical zoom consistent across resizing/theme changes.
- One viewer state controls both dark/light SVG variants. Only the visible variant participates in focus/accessibility and measurement; no duplicate toolbar when themes change or initialization repeats.
- No-JS, CDN failure, renderer failure and malformed diagrams must leave readable source fallback. Do not hide fallback before confirmed render success, expose error SVGs as successful content, or leave an unbounded animation-frame polling loop. A failed block must not prevent successful neighboring blocks from rendering.
- Preserve strict Mermaid security. Render labels as text, avoid unsanitized HTML insertion beyond Mermaid's sanitized SVG, and keep any application markup static/trusted. Pin browser Mermaid to 11.17.2; no package installation is needed.

## File responsibilities

- Modify `docs/typedoc-plugin-mermaid.mjs`: wrapper markup/style/bootstrap wiring, pinned import, reliable initialization. Keep unrelated TypeDoc conversion behavior intact.
- Create `docs/mermaid-viewer.mjs` (or a small clearly named adjacent module): actual browser lifecycle and viewer behavior, safely included in emitted pages by the fork. It must execute in delivered generated Markdown, not merely work when imported by a test. Avoid unrelated refactoring of the existing fork.
- Modify `docs/src/styles/custom.css` only if needed for scoped theme-consistent viewer styling; alternatively keep viewer-specific CSS next to the existing fork's emitted CSS. Do not change global layout/type/theme behavior.
- Create `docs/tests/mermaid-viewer.test.ts`: deterministic Bun coverage of exported state/fit helpers, generated wrapper/bootstrap contract, pin and security defaults. Prefer behavior tests over source-text assertions.
- Create `docs/tests/mermaid-viewer.browser.mjs` if a durable browser harness can be kept focused and dependency-free; otherwise save the browser harness and evidence in `/tmp/pawl-mermaid-viewer-*` and document its exact command here. Browser-only tests must not make default Bun tests require Chrome or remote network access.
- Update this plan with changed files, red/green evidence and final validation. Generated CDK/Lambda pages are build output only.

## Task 1 — Preservation and failing tests

- [x] Snapshot existing tracked/untracked project text relevant to the task (including generated pages and protected manifests/config/source) to `/tmp/pawl-mermaid-viewer-before.json`. Record the actual file list and expected mutation boundary.
- [x] Read the research, current fork, actual generated ApiGateway page, existing design/CSS and diagram tests. Inspect `/tmp/pawl-check-connector-fix.mjs` for the working dependency-free Chromium/CDP approach.
- [x] Write tests before implementation for clamp/zoom/reset/fit behavior and emitted viewer/bootstrap contract. For DOM-only behavior, prepare browser assertions against the delivered page before implementing those controls.
- [x] Run `rtk bun test docs/tests/mermaid-viewer.test.ts` and the relevant browser red check. Save expected assertion failures, not unrelated import/environment failures, as TDD evidence.

## Task 2 — Viewer and lifecycle

- [x] Implement the minimal controller and wire its real code into the emitted module script. Treat the external renderer as one narrow integration dependency; keep view-state arithmetic independently testable.
- [x] Replace polling with awaited rendering that isolates failure per block and preserves original source. Make initial and repeated initialization safe; handle existing rendered blocks without duplicate controls/listeners.
- [x] Add the scoped toolbar and viewport styles. Implement bounds, scroll reachability, reset, expansion/restoration and theme/resize handling without diagram mutation or global event hijacking.
- [x] Verify keyboard activation, disabled limits, Escape and restored focus; retain useful fallback and current SVG accessibility information.
- [x] Run focused tests and `rtk bun lint`; fix only task-owned issues.

## Task 3 — Delivered-page verification

- [x] Run `rtk bun run --cwd docs build` (serially; preserve build logs). Never hand-edit generated references.
- [x] Check real generated ApiGateway, CodePipeline/CodeBuildProject and a single-node helper page at desktop and mobile sizes in both themes. Include inline, zoomed, reset and expanded states; check screenshot validity, toolbar readability and touch targets, keyboard/focus, full diagram reachability, resize/theme transitions, multiple blocks, repeated setup and error/source fallback.
- [x] Use a bounded visual pass: one batched inspection, one batch of corrections, one confirmation. Save artifacts in `/tmp/pawl-mermaid-viewer-browser/`. Do not run an open-ended polish loop.
- [x] Check all 22 diagrams still render with the existing connector-aware harness, adapting selectors only to legitimate wrapper changes. Do not weaken geometry assertions or alter the diagrams to satisfy the viewer.
- [x] Run the Impeccable mechanical detector once on task-owned UI paths, then pass findings/screenshots to an independent reviewer. Existing unrelated design metadata quirks are not permission to rewrite the design system.

## Task 4 — Independent review and final gates

**Final acceptance:** Independent review approved the implementation without material findings. Parent completed the serial full-suite gates and independently repeated browser behavior and snapshot checks; evidence is below.

- [x] Independent reviewer checks spec compliance first, then code quality/security/accessibility and screenshots. Review task-only differences against the snapshot, not the entire dirty Git diff. Supply exact evidence paths.
- [x] Resolve material findings in one bounded correction batch and get review of those corrections. Not required: the reviewer found no material issues.
- [x] Run `rtk bun lint`, focused diagram/viewer tests, and the full serial LocalStack-enabled suite with the existing secure `/tmp/pawl-run-tests-with-localstack.ts` runner. Never expose/store the SSM token. Start Docker only if needed. No real AWS deployment.
- [x] Verify source diagrams, package manifests/lockfiles and unrelated user work match the snapshot; generated differences must be solely the intentional wrapper/bootstrap/style changes.
- [x] Record the actual outcome, limitations and evidence below; do not claim manual assistive-technology testing that was not performed.

## Direction contract

**THESIS:** Let readers inspect the existing infrastructure drawing without changing what it says.
**OWN-WORLD:** Preserve the charcoal/warm-paper drafting table, dashed secondary controls and rare redline focus cues.
**STORY:** Read the diagram, enlarge its detail, then return to the article without losing position.
**FIRST VIEWPORT:** A fitted diagram with a top-right hover/focus toolbar on mouse devices; visible, non-obscuring controls on touch. No new page header or promotional framing.
**FORM:** Local extension of the established Read surface; no new-world seed or redesign.
**FINISH:** Unreviewed and undocumented is unfinished; finish with independent review and recorded interaction behavior, without rewriting unrelated global design artifacts.

## Evidence and outcome

### Implementation boundary and preservation

Preflight was approved without findings; no product or architecture changes were required. The controller is inlined verbatim by the shared fork into emitted module scripts. Rendering is awaited, sequential and block-isolated, with per-block fallback, explicit strict security, suppressed renderer error artifacts and a pinned 11.17.2 dynamic import. Controls use one state and one moved viewer, not cloned SVGs. Fit preserves intrinsic geometry, uses both dimensions and avoids enlarging intrinsically small diagrams at 100%. No gesture or node handlers were added.

Before the first edit, `/tmp/pawl-mermaid-viewer-before.json` captured 655 existing tracked/untracked files (complete file list in `files`), UTF-8 contents where applicable, hashes, dirty status and an empty index. Mutation boundary: shared plugin/controller, scoped CSS, two new test files, this plan, and 22 generated class pages changed only by the docs build. No source diagram, package/config/lockfile, PRODUCT.md, DESIGN.md or unrelated user file was changed. Generated article content and paired Mermaid source before the shared injected assets are byte-identical modulo trailing whitespace. The injection seam now correctly appends when Markdown has no closing head/body, rather than splitting its final character.

Task-authored paths:
- `docs/mermaid-viewer.mjs` (new browser controller and pure zoom/fit helpers)
- `docs/typedoc-plugin-mermaid.mjs` (controlled pinned bootstrap and fallback/theme visibility)
- `docs/src/styles/custom.css` (only appended, scoped viewer styles)
- `docs/tests/mermaid-viewer.test.ts` (new network/browser-free tests)
- `docs/tests/mermaid-viewer.browser.mjs` (new explicit Bun/Chromium/CDP harness)
- `docs/superpowers/plans/2026-09-09-mermaid-viewer-controls.md` (this evidence)

Build-only generated paths: `docs/src/content/docs/cdk/classes/{AgentCore,ApiDestination,ApiGateway,ApiGatewayV1,AuthoritativeRevisionArbitrationExhaustedError,CodeBuildProject,CodeCommit,CodeCommitAutoReviewer,CodeCommitReviewEvents,CodeCommitSourceLimitError,CodePipeline,DurableLambdaFunction,DynamoDbTable,DynamoDbTableWithStreams,EventBridge,LambdaFunction,LocalStack,PipelineDefinitionError,PipelineReviewDispatcher,Sqs,Stack,StaticSite}.md`. Exact changed-file list, scoped diff and preservation checks: `/tmp/pawl-mermaid-viewer-preservation.json`, `/tmp/pawl-mermaid-viewer-task.diff`.

### Actual red/green and commands

- **RED:** `rtk bun test docs/tests/mermaid-viewer.test.ts` — 1 pass, 2 expected assertion failures (unpinned delivered renderer and missing viewer helper/controller delivery), not import/environment failures. `/tmp/pawl-mermaid-viewer-red.log`.
- **Browser RED:** `rtk proxy sh -c 'PAWL_BROWSER_RED=1 bun docs/tests/mermaid-viewer.browser.mjs ...'` against pre-change built ApiGateway — expected assertion `0 !== 1`, missing delivered toolbar. `/tmp/pawl-mermaid-viewer-browser-red.log`. The finished harness always requires a ready viewer; its initial red-only environment branch was replaced by full assertions.
- **GREEN:** `rtk bun test docs/tests/mermaid-viewer.test.ts packages/cdk/tests/documentation-diagrams.test.ts` — 65 pass, 0 fail, 856 assertions. `/tmp/pawl-mermaid-viewer-green.log`. Three new deterministic viewer tests cover delivery, untouched non-diagram pages and zoom/fit arithmetic; the browser harness is not discovered by default Bun tests.
- `rtk bun run --cwd docs build` — 183 pages built successfully; final run in `/tmp/pawl-mermaid-viewer-build.log`. Existing missing-site sitemap warning retained, no config repair.
- `rtk bun lint` — final 300 files checked, zero errors/warnings. `/tmp/pawl-mermaid-viewer-lint.log`. Initial formatting failures were resolved with targeted `rtk bunx biome check --write` on task files only.
- `rtk bun docs/tests/mermaid-viewer.browser.mjs` — final **150 assertions, zero failures**, zero console errors; `/tmp/pawl-mermaid-viewer-browser.log` and browser `results.json`. Covers ApiGateway, dense CodePipeline and single-node AuthoritativeRevisionArbitrationExhaustedError at 1440/390 widths and dark/light themes; fit, zoom bounds, scroll edges, page width stability, repeated/concurrent setup, theme/resize shared state, native dialog keyboard focus, Escape/Restore, preserved inline placeholder height, no SVG geometry/content mutation, real malformed Mermaid, injected renderer rejection/error SVG, neighboring success, CDN blocked, and no-JS fallback. Native Enter needed CDP text and foreground page; the harness was corrected rather than replacing keyboard assertions with synthetic clicks. No physical-device or manual screen-reader test is claimed.
- `rtk proxy sh -c 'PAWL_BROWSER_DIR=/tmp/pawl-mermaid-viewer-browser/geometry bun /tmp/pawl-mermaid-viewer-geometry.mjs ...'` — all **22 pages / 88 views**, zero geometry/overlap/error/block-overflow/page-overflow failures. This is the existing `/tmp/pawl-check-connector-fix.mjs` with only direct-child selectors adapted to the new viewport. Connector sampling assertions are unchanged. `/tmp/pawl-mermaid-viewer-geometry.log`.
- Exact baseline geometry comparison: `/tmp/pawl-mermaid-viewer-baseline-geometry.mjs` serves current unchanged diagram sources with the **snapshotted pre-task bootstrap/style** substituted, then runs the original harness. All 88 baseline views pass, and their viewBoxes, service transforms, group rectangles and connector paths exactly match the new viewer results. `/tmp/pawl-mermaid-viewer-geometry-comparison.json` records **88 compared / zero differences**. An older unrelated accepted artifact directory had three stale pre-task diagrams, so it was not used as the final baseline.
- `rtk proxy /Users/jolo/.pi/agent/skills/impeccable/scripts/impeccable detect --json docs/typedoc-plugin-mermaid.mjs docs/mermaid-viewer.mjs docs/src/styles/custom.css` — run once after final UI changes. `/tmp/pawl-mermaid-viewer-detect.json`: three advisories, no blockers. Existing approved grid background retained; 1rem toolbar text and 0.875rem percentage are compact local control sizes, flagged because DESIGN.md has no corresponding ramp entries. Do not rewrite unrelated malformed design metadata to suppress these advisories.
- All build, test, lint and geometry commands ran serially. Full expensive LocalStack suite deliberately **not run**, assigned to parent after independent review. No installs, commits or staging.

### Bounded browser inspection

Read craft-floor and new-work references plus PRODUCT.md/DESIGN.md before implementation. One contact-sheet inspection found invalid full-page expanded captures; one correction/confirmation batch fixed screenshot capture to the viewport, retained article height during expansion and accounted for toolbar gap/padding in the expanded fit height. Final confirmation shows valid inline, clipped-at-300%-but-scrollable and enlarged native-dialog views with readable 44px controls. No further polish loop was run.

Final screenshots (all under `/tmp/pawl-mermaid-viewer-browser/`):
- `ApiGateway-{desktop,mobile}-{dark,light}-{inline,zoomed,expanded,expanded-zoomed}.png` (16 files)
- `CodePipeline-desktop-dark-inline.png`
- `AuthoritativeRevisionArbitrationExhaustedError-desktop-dark-inline.png`
- `contact-sheet.png` (all 18 focused screenshots inspected together; expanded mobile-light and desktop-dark also inspected at native size)

The geometry and baseline-geometry subdirectories also contain 88 SVGs/screenshots each, used as geometry evidence, not an additional visual-polish round.

### Final acceptance and remaining risks

Independent spec/code/accessibility/visual review approved with no findings: workflow `192f4e20-c9cf-4489-8a2d-64b30a4a48fb`, reviewer `a1be1231-b5e0-418b-925e-10f951d2d1fb`, artifact `mermaid-viewer/review.md` in that workflow's outputs. The parent inspected the controller, delivery wiring, CSS, tests and contact sheet, then independently ran:

- `rtk bun lint`: **300 files clean** — `/tmp/pawl-mermaid-viewer-final-lint.log`.
- `rtk bun test docs/tests/mermaid-viewer.test.ts packages/cdk/tests/documentation-diagrams.test.ts`: **65 pass, 0 fail** — `/tmp/pawl-mermaid-viewer-final-focused.log`.
- `rtk bun /tmp/pawl-run-tests-with-localstack.ts`: **1,095 pass, 8 existing skips, 0 fail**, 1,103 tests across 107 files in 138.45 seconds — `/tmp/pawl-mermaid-viewer-final-full-tests.log`.
- `rtk proxy env PAWL_BROWSER_DIR=/tmp/pawl-mermaid-viewer-final-browser bun docs/tests/mermaid-viewer.browser.mjs`: **150 assertions, 0 failures** — `/tmp/pawl-mermaid-viewer-final-browser.log` and the named output directory. This repeated the fixed behavioral suite without a further visual-polish loop.
- Recomputed all **655 snapshot file hashes**: only 25 intended existing-file changes and three new files; all 22 generated article/diagram bodies preserved after removing emitted script/style and trailing blank lines. No unexpected changes — `/tmp/pawl-mermaid-viewer-final-preservation.json`.
- Scoped raw whitespace check passed; Git index and running test-container list remained empty. No real AWS deployment or dependency changes.

Remaining limitations: Browser checks used headless Chromium and emulated mobile dimensions; Safari/Firefox, physical touch and assistive technology were not manually tested. External pinned CDN and existing remotely loaded icon packs retain their availability/trust dependency, with source fallback verified. The controller targets the current full-page navigation lifecycle; no speculative client-router integration or pan/node behavior was added. Mechanical detector advisories above are supplied for reviewer judgment. The Git index remains empty.

### Follow-up — floating hover toolbar

User requested: “the tools zoom/reset/expand let's float them over the image and we make them appear when hovering”. The desktop toolbar is now an absolutely positioned overlay, hidden at rest and revealed by `:hover` or `:focus-within` for `(hover: hover) and (pointer: fine)`. Opacity/pointer-events preserve the keyboard tab path; no gesture interception, animation or diagram changes were added. Touch controls stay visible with measured clearance above the diagram. Expanded fit calculations account for that clearance rather than always reserving a toolbar row. Pointer-capability changes also trigger layout.

Only three implementation/test paths changed: `docs/mermaid-viewer.mjs`, the viewer section of `docs/src/styles/custom.css`, and `docs/tests/mermaid-viewer.browser.mjs`. The 22 generated class pages were rebuilt, changing only their emitted module; this plan records the refinement.

- Snapshot: `/tmp/pawl-mermaid-hover-before.json`, 658 files. Preservation and task-only diff: `/tmp/pawl-mermaid-hover-preservation.json`, `/tmp/pawl-mermaid-hover-task.diff`. Runtime/source diagrams, configs, dependencies and unrelated work are unchanged.
- TDD: `/tmp/pawl-mermaid-hover-red.log` failed on missing absolute overlay. The first visual pass exposed touch occlusion; `/tmp/pawl-mermaid-hover-touch-red.log` then failed on the new content-clearance assertion before its fix.
- Final browser suite: **198 assertions, zero failures**, including real pointer hover, rest visibility, keyboard focus, touch capability and content clearance in both themes. Evidence: `/tmp/pawl-mermaid-hover-final-browser.log` and `/tmp/pawl-mermaid-hover-final-browser/`. One batched inspection and one correction/confirmation; no further polish loop.
- Connector-aware check: **22 pages / 88 views**, no failures — `/tmp/pawl-mermaid-hover-geometry.log`.
- Focused tests: **65 pass** — `/tmp/pawl-mermaid-hover-focused.log`.
- Docs build: **183 pages** — `/tmp/pawl-mermaid-hover-build.log`.
- Lint: **300 files clean** — `/tmp/pawl-mermaid-hover-lint.log`.
- Full serial LocalStack suite: **1,095 pass, 8 existing skips, 0 fail**, 1,103 tests in 141.22 seconds — `/tmp/pawl-mermaid-hover-full-tests.log`.
- Detector run once: `/tmp/pawl-mermaid-hover-detect.json`; the same three previously reviewed grid/type advisories, no new blocker.
- Independent review: approved with no issues, run `654fa10b-6a07-443d-b48e-810f1913e33a`, artifact `mermaid-hover-review.md`. The reviewer inspected all five requested final screenshots, source changes and red/green evidence. Browser coverage remains Chromium/emulated mobile, not a claim of physical-device or manual assistive-technology testing.


