# Mermaid Mouse Controls Implementation Plan

> **For agentic workers:** Use test-driven implementation and independent review. Do not commit, stage, install dependencies or modify diagram sources.

**Goal:** Match the user's Mermaid Live toolbar reference and add pointer-anchored wheel zoom and left-button dragging to the existing docs viewer.

**Architecture:** Keep the pinned Mermaid renderer and sanitized SVGs; implement an application-owned viewport camera around them. A compact icon-only hover toolbar remains outside the transformed drawing. Keep pure camera arithmetic testable and browser input handling local to the viewport.

**Tech Stack:** Existing DOM/SVG, Pointer/Wheel Events, native dialog, Bun and the existing Chromium/CDP harness. No new packages.

## User-approved reference and behavior

The user supplied a Mermaid Live URL and explicitly asked to change the tools to match it, zoom in/out by scrolling and drag to move. The reference was inspected in the real browser. Screenshot: `/tmp/pawl-mermaid-live-reference.png`. Its controls are an icon-only group: Reset view (frame corners), Zoom out/in (magnifying-glass minus/plus), Full Screen (diagonal arrows). The source URL is in the conversation; no need to reconstruct or modify its compressed state. Do not reproduce its editor, advertising, branding or unrelated controls.

- Use a compact grouped icon toolbar with accessible names and native title hints. Retain 44px hit targets, all four actions and a screen-reader zoom status; remove visible word labels and percentage to match the reference's compact treatment. Use authored SVG icons, not new icon dependencies. Expand remains an in-page dialog, with a distinct restore icon/label while open.
- Preserve the approved top-right hover/focus overlay for fine hover pointers. Touch controls stay available and clear of drawing content. Match the reference's grouped/rounded treatment within Pawl's existing charcoal/paper and redline palette; no unrelated design-system changes.
- Unmodified vertical wheel input **over the drawing viewport** zooms smoothly around the pointer. Handle wheel delta modes sensibly and clamp to the existing 50–300% range. Do not require Ctrl. Keep Ctrl/Meta browser zoom gestures and wheel over the surrounding article/toolbar untouched. At a zoom limit, avoid trapping normal page scrolling when no zoom can occur.
- Primary/left mouse drag pans freely, including at 100% fit; do not merely emulate bounded scrollbars. Use pointer capture so release outside the viewport, cancellation and lost capture cannot leave dragging stuck. Use grab/grabbing cursors and prevent text selection during dragging. Do not start drag on controls, links or non-primary buttons.
- Camera transform changes display only, not SVG viewBox, paths, node geometry or labels. Use a dedicated stage/transform if needed, with clipped overflow and no page-width growth. Keep the toolbar stationary while the drawing moves.
- Reset restores 100%, fits and centres the drawing in the available viewport; users can always recover a drawing panned offscreen. Expanded mode should centre rather than leave the entire drawing at the upper-left. Preserve logical zoom and the inspected world centre through theme, resize and expand/restore transitions where practical.
- Keep buttons usable by mouse and keyboard. Because native scrollbars will no longer be the pan mechanism, add scoped arrow-key panning and +/- zoom/reset keyboard equivalents when the viewport itself is focused. Do not hijack page or text-field shortcuts. Update the viewport's accessible instructions from the old scroll-to-explore wording.
- Touch/pen gestures are not part of this request: preserve touch page scrolling and browser pinch zoom, and keep explicit touch zoom/reset/expand controls. Do not accidentally capture touch pointers through the mouse drag code.
- Preserve strict security, Mermaid 11.17.2, both theme variants, per-block render failure isolation, source fallback, idempotent setup and native-dialog focus/Escape behavior.

This request intentionally supersedes the original viewport plan's prohibition on wheel interception **only within the diagram**. Outside it, page behavior remains native.

## Scope and files

Continue with one writer in the existing dirty workspace; a clean worktree would omit the approved implementation. Snapshot all existing state to `/tmp/pawl-mermaid-mouse-before.json` before edits. No source diagram, production package code, dependency/lockfile, unrelated configuration or global design changes.

- `docs/mermaid-viewer.mjs`: small pure camera helpers and viewport controller/toolbar changes. Keep one cohesive module unless a split is genuinely needed; the fork currently inlines this exact module, so any split must also work in actual emitted browser code, not just test imports.
- `docs/typedoc-plugin-mermaid.mjs`: only selector/serialization wiring required by a drawing stage; preserve pin/security and unrelated TypeDoc behavior.
- `docs/src/styles/custom.css`: scoped icon toolbar and camera viewport/stage/cursors only.
- `docs/tests/mermaid-viewer.test.ts`: deterministic camera, anchor invariance, clamping, delta handling and reset coverage; no browser/network requirement in default Bun tests.
- `docs/tests/mermaid-viewer.browser.mjs`: real CDP wheel/drag/button/keyboard evidence and existing regression coverage, adapted from scrollbars to the new explicitly approved camera behavior.
- This plan: evidence and outcome. Generated references change only through `rtk bun run --cwd docs build`.

## Task 1 — Red and camera model

- [x] Snapshot and inspect existing viewer, CSS, delivery fork and tests. Preserve baseline and create task-only diff independently of the dirty Git diff.
- [x] Add failing tests before implementation for camera transform, pointer-anchor zoom invariance, pan at fit, reset centre, bounds and wheel delta normalization. Verify actual expected failures, not import errors.
- [x] Add a browser red assertion for missing real wheel or drag behavior before writing handlers.
- [x] Implement the smallest coherent camera model. Recommended representation: logical zoom plus a drawing/world centre; derive scale/translation from current drawing and viewport dimensions so resize and theme changes need not throw away the inspected centre. Test positive/negative pan and off-centre zoom, not just origin arithmetic.

## Task 2 — Input and compact tools

- [x] Implement the icon-only toolbar with stable data-action hooks, accessible names/title hints, dynamic restore state and zoom announcement.
- [x] Wire the camera to both theme SVGs and deliver it through the real TypeDoc bootstrap; no standalone unbundled import that would break generated routes.
- [x] Implement local non-passive wheel handling, pointer-anchored zoom, primary mouse drag/capture/release/cancel and scoped keyboard equivalents. Do not change outside-page scrolling or native Ctrl/Meta/touch behavior.
- [x] Preserve hover/focus/touch visibility and native-dialog focus/return position. Keep controls visible while dragging if necessary and always provide recovery via Reset.
- [x] Run focused tests and lint; avoid unrelated formatting.

## Task 3 — Delivered browser and visual verification

- [x] Build docs serially. Use actual generated pages, not only injected test fixtures.
- [x] Exercise ApiGateway, a dense diagram and a single-node diagram in desktop/mobile and both themes. Verify real CDP wheel in/out, off-centre pointer anchor, real left drag at 100% and after zoom, release outside, cancel/lost capture recovery, disabled bounds, reset centre and stationary toolbar.
- [x] Test outside-viewport page scrolling and unchanged zoom; ignore wheel on toolbar and browser Ctrl/Meta gestures; no custom touch capture. Verify keyboard arrow pan/+/-/reset and normal button activation.
- [x] Retain failure/source, repeated setup, geometry, article-width, theme/resize, Escape and restore-focus checks. Replace old native-scrollbar assertions with equivalent camera reachability/fit assertions, documenting why. Do not weaken unrelated tests.
- [x] Test using actual pointer clicks on toolbar icons, not only HTMLElement.click(), to catch overlay hit-testing regressions.
- [x] Capture real final controls and interaction states under `/tmp/pawl-mermaid-mouse-browser/`. One batched visual inspection, one correction batch, one confirmation maximum. No open-ended polish loop.
- [x] Run existing 22-page/88-view connector-aware checks, adapting selectors only for the drawing stage and retaining raw SVG geometry checks.
- [x] Run the mechanical detector once on changed UI paths; report pre-existing advisories without rewriting the design system.

## Task 4 — Review and final verification

- [x] Independent review of task-only diff, model/input correctness, a11y, touch/page behavior, screenshots and preserved rendering/security behavior.
- [x] Resolve material review findings in a bounded batch and get a verdict on the fixes. Not required: independent review found no issues.
- [x] Parent final gates: lint, focused viewer/diagram tests, explicit browser suite and full serial LocalStack-enabled suite through `/tmp/pawl-run-tests-with-localstack.ts`. No real AWS deployments or token exposure.
- [x] Snapshot preservation: authored scope only; generated differences limited to emitted controller/style/wiring; all source diagrams unchanged. No staged files.

## Direction contract

**THESIS:** The diagram behaves like a navigable canvas instead of a scrollable enlarged image.
**OWN-WORLD:** Mermaid Live's compact grouped icons, translated to Pawl's existing paper/charcoal and redline interaction colors.
**STORY:** Hover, scroll to the detail under the pointer, drag to inspect, reset to recover, expand when more space is needed.
**FIRST VIEWPORT:** A fitted, centred drawing with a compact top-right hover toolbar; touch controls remain discoverable and do not obscure the drawing.
**FORM:** User-pinned local component reference; no new page or visual-world redesign.
**FINISH:** Ship after bounded rendered verification and independent review; record actual limitations, not claims of unperformed device or assistive-technology testing.

## Evidence and outcome

Implemented and independently approved without findings. Parent reran focused tests, browser interactions, lint and the full serial LocalStack suite, and independently verified snapshot hashes and generated-content preservation. All acceptance gates passed; limitations are recorded below.

### Decisions and scope

- Preflight approved without material findings. No product/scope decision was reopened.
- Use a normalized drawing centre (`x`/`y` fractions) and logical zoom, with a natural-size stage transformed through derived scale/translation. This preserves the inspected centre across variant dimensions, resize and dialog changes; panning is intentionally unbounded even at fit.
- Wheel uses an exponential scale response, 16px per line and viewport height per page. Ctrl/Meta, horizontal-only wheel and outward wheel at a zoom bound are not prevented. Touch/pen are excluded from mouse capture; native touch-action is unchanged.
- Four 44px icon actions in one 186px-wide rounded group, native titles and accessible names, visually hidden live zoom output; Restore has a distinct icon/name. Existing palette, hover/focus overlay and touch clearance retained. No visual correction was needed after the single batched inspection.
- Native scrollbar reachability/origin assertions were deliberately replaced by camera fit/centre, actual positive/negative drag displacement, clipping and unchanged article-width assertions. Unrelated rendering, fallback, geometry and modal assertions remain.
- Harness corrections only: Chromium CDP requires `button: "left"` as well as `buttons: 1` on held mouse movement; otherwise it emits lost capture. Outside-wheel proof now targets article prose rather than the independently scrolling sidebar, and wheel coordinates are used after recentering the viewer following modal transitions. These were test transport/target fixes, not viewer workarounds.

### Red / green and commands

Worker verification ran serially; no install, staging, commit or deployment was performed. The full integration suite was reserved for the parent's final acceptance run below.

- `rtk bun test docs/tests/mermaid-viewer.test.ts`: initial red 3 pass / 3 fail (missing helper assertions), followed by inert-model red 3 pass / 3 fail on **numeric transform, clamped zoom and wheel response**, not import errors. Logs: `/tmp/pawl-mermaid-mouse-red-unit.log`, `/tmp/pawl-mermaid-mouse-red-arithmetic.log`.
- `rtk proxy sh -c 'PAWL_BROWSER_DIR=/tmp/pawl-mermaid-mouse-browser/red bun docs/tests/mermaid-viewer.browser.mjs > /tmp/pawl-mermaid-mouse-red-browser.log 2>&1'`: red on real wheel over the existing delivered drawing (100% remained unchanged); bounded diagnostics, no document HTML dump.
- `rtk bunx biome check --write docs/mermaid-viewer.mjs docs/tests/mermaid-viewer.test.ts docs/tests/mermaid-viewer.browser.mjs`: scoped formatting only. Initial lint correctly caught new unformatted code; corrected with scoped formatter.
- `rtk bun test docs/tests/mermaid-viewer.test.ts packages/cdk/tests/documentation-diagrams.test.ts`: **68 pass, 0 fail, 886 assertions**. `/tmp/pawl-mermaid-mouse-green-unit.log`.
- `rtk bun lint`: **300 files, no errors**. `/tmp/pawl-mermaid-mouse-lint.log`.
- `rtk bun run --cwd docs build`: **183 pages built**. `/tmp/pawl-mermaid-mouse-build.log`. Existing missing-site sitemap advisory remains; no build error.
- `rtk proxy sh -c 'PAWL_BROWSER_DIR=/tmp/pawl-mermaid-mouse-browser bun docs/tests/mermaid-viewer.browser.mjs > /tmp/pawl-mermaid-mouse-browser.log 2>&1'`: **287 assertions, 0 failures**, actual delivered routes, real wheel/drag/click/key/touch input, 3 diagrams × desktop/mobile × both themes. Includes pointer-anchor invariance, pan at fit/zoom, stationary toolbar, release outside, injected cancellation/lost-capture recovery, centre preservation through theme/resize/expand/restore, hidden zoom names, boundaries, native article/toolbar/modified wheel, native touch swipe, fallback and modal focus. `/tmp/pawl-mermaid-mouse-browser/results.json`; `/tmp/pawl-mermaid-mouse-browser/console-errors.json` is empty.
- `rtk proxy sh -c 'PAWL_BROWSER_DIR=/tmp/pawl-mermaid-mouse-browser/geometry bun /tmp/pawl-mermaid-viewer-geometry.mjs > /tmp/pawl-mermaid-mouse-geometry.log 2>&1'`: **22 pages, 88 views, 0 failures, 0 page overflow**. Raw connector sampling, overlap and SVG size checks preserved; only `.mermaid-viewport > .mermaid` → `.mermaid-stage > .mermaid` selectors changed. Original harness: `/tmp/pawl-mermaid-mouse-geometry-before.mjs`; evidence: `/tmp/pawl-mermaid-mouse-browser/geometry/results.json`, `failures.json`, SVGs and PNGs.
- `rtk proxy /Users/jolo/.pi/agent/skills/impeccable/scripts/impeccable detect docs/mermaid-viewer.mjs docs/src/styles/custom.css docs/typedoc-plugin-mermaid.mjs`: exactly **one scan, 0 anti-patterns**. `/tmp/pawl-mermaid-mouse-detector.log`. Two advisories are pre-existing unchanged CSS: drafting grid at line 99 and toolbar `font-size: 1rem` now at line 671. No unrelated design rewrite.

### Screenshot evidence / bounded visual QA

One batched inspection of these exact files under `/tmp/pawl-mermaid-mouse-browser/`:

- `ApiGateway-desktop-dark-hover.png`
- `ApiGateway-desktop-light-hover.png`
- `ApiGateway-mobile-dark-expanded.png`
- `ApiGateway-mobile-light-hover.png`
- `ApiGateway-desktop-dark-mouse-panned.png`
- `CodePipeline-desktop-dark-inline.png`
- `AuthoritativeRevisionArbitrationExhaustedError-desktop-dark-inline.png`

Observed compact grouped icons in both palettes, stationary overlay after pan, centred mobile expansion, and touch controls clear of drawing content. Dense diagrams retain the approved hover overlay trade-off; reset and drag recover covered detail. Additional captured rest/focus/zoom/dialog states are enumerated in `/tmp/pawl-mermaid-mouse-browser/screenshots.json`. No correction or second visual inspection was needed.

### Preservation and review handoff

- Baseline before edits: `/tmp/pawl-mermaid-mouse-before.json` (Git-visible existing file bytes/hashes and dirty status; generated `public/` remains build output).
- Task-only authored diff: `/tmp/pawl-mermaid-mouse-task-only.diff`. Generated-only diff: `/tmp/pawl-mermaid-mouse-generated.diff`. Full changed-path manifest and preservation checks: `/tmp/pawl-mermaid-mouse-preservation.json`.
- Authored scope: viewer module, scoped CSS, selector-only fork change, the two viewer test files and this plan. Exactly 22 generated TypeDoc references changed through the docs build. After replacing the exact old/new serialized viewer module and normalizing the stage selectors, all 22 references are byte-identical to baseline. No generated diagram source changes.
- All existing production/package/example files, dependencies/lockfiles, DESIGN.md and PRODUCT.md remain byte-identical to snapshot. `git diff --cached --name-only` is empty.
- Residual risks: Chromium headless plus touch emulation, not physical-device or assistive-technology testing; cancellation events are injected after real captured drags. CDN access remains an existing runtime dependency with verified readable-source fallback. Independent review and parent acceptance are now complete, as recorded below.

### Independent review and parent acceptance

- Reviewer `a5768aae-1d82-44b8-a4b4-eeefdd979424` approved with no findings; workflow `5b12b3ba-f50d-4f1d-9759-2747c7e25864`, artifact `mermaid-mouse/review.md`. Its scope included the task-only code diff, delivered script, reference screenshot, seven final screenshots and saved behavior/geometry evidence. It did not claim independent test execution or a full baseline hash recomputation.
- Parent inspected the controller, delivery selectors and representative final screenshots, then ran all final checks serially:
  - `rtk bun lint`: **300 files clean** — `/tmp/pawl-mermaid-mouse-final-lint.log`.
  - `rtk bun test docs/tests/mermaid-viewer.test.ts packages/cdk/tests/documentation-diagrams.test.ts`: **68 pass, 0 fail** — `/tmp/pawl-mermaid-mouse-final-focused.log`.
  - `rtk proxy env PAWL_BROWSER_DIR=/tmp/pawl-mermaid-mouse-final-browser bun docs/tests/mermaid-viewer.browser.mjs`: **287 assertions, 0 failures** — `/tmp/pawl-mermaid-mouse-final-browser.log` and the named output directory. This is a repeat of the fixed behavioral suite, not another visual-polish round.
  - `rtk bun /tmp/pawl-run-tests-with-localstack.ts`: **1,098 pass, 8 existing skips, 0 fail**, 1,106 tests across 107 files in 157.02 seconds — `/tmp/pawl-mermaid-mouse-final-full-tests.log`.
- Independent preservation checker `/tmp/pawl-verify-mermaid-mouse.py` recomputed **659 baseline file hashes**. Exactly **28 expected changed files**, no new files, no unexpected changes. For all **22 generated references**, replacing only the exact serialized controller and three stage selectors produces the final bytes exactly. Evidence: `/tmp/pawl-mermaid-mouse-final-preservation.json`.
- Scoped raw whitespace check passed. Git index and running test-container list were empty. No installs, dependency changes, source-diagram changes, commits or real AWS deployments.


