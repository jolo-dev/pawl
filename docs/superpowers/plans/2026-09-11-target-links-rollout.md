# Supported-Target Links Rollout Implementation Plan

> **For agentic workers:** Use test-driven implementation and independent review. Do not commit, stage, install dependencies or modify infrastructure code/diagram sources. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extend the approved ApiGateway supported-target link interaction to every Pawl construct whose code declares an explicit relationship to other Pawl construct classes.

**Architecture:** Generalize the pilot's single-entry, hardcoded link constant into a small allowlisted registry keyed by owning class, and let the chooser carry non-linked entries for relationships that are imported CDK interfaces or plain names. Generation-time identity and runtime activation behavior stay exactly as reviewed in the pilot.

**Tech Stack:** Existing TypeDoc/Starlight, Mermaid 11.17.2, DOM/SVG, Bun and Chromium/CDP; no new dependencies.

## Relationship to the pilot

This plan **extends** the reviewed pilot; it does not redesign it. Read these first and follow them rather than re-deriving:

- Pattern, safety model, interaction/a11y contract and verification contract: `docs/superpowers/plans/2026-09-10-apigateway-target-links.md`
- Settled terminology (`supported target type` vs `configured target`): `CONTEXT.md`
- Ownership-diagram conventions: `docs/analysis/cdk-diagram-audit.md`
- Pilot evidence and recovered runner: `/Users/jolo/.pi/agent/subagent-evidence/pawl-target-links-recovery-b8036577/`

## User-confirmed rollout scope

Confirmed with "yes to all recommendations":

1. **Constructs in scope** (Pawl-class relationships only): `ApiGatewayV1`, `EventBridge`, `Sqs`, `CodePipeline` — plus the existing `ApiGateway`. `LambdaFunction` (`events` / `onSuccess` / `onFailure`) and `ApiDestination` (endpoint URL) relate only to imported CDK interfaces and are **out of scope**.
2. **Affordance placement**: attach the interaction to the node that already summarizes the relationship. Do **not** add new resource nodes or edges; the ownership-only diagram content must not change.
3. **Mixed relationships**: link only Pawl classes; represent imported CDK interfaces and plain names as non-linked text entries inside the same chooser so the list stays honest.

### Registry rows (verify each against source before implementing; guard with a source-drift test)

| Owner | Node (verified diagram id) | Linked targets | Non-linked entries |
| --- | --- | --- | --- |
| `ApiGateway` | `routes` ("Routes and integrations") | `LambdaFunction`, `EventBridge` | — (already shipped) |
| `ApiGatewayV1` | `routes` ("Routes and integrations") | `LambdaFunction` (single ⇒ direct anchor) | — |
| `EventBridge` | `rules` ("Rules and target bindings") | `LambdaFunction`, `ApiDestination`, `Sqs`, `EventBridge` | `EventPipe` — not a Pawl class: a supplied source/target-bus pair that creates the separate `pipe` node, not a rule on this bus |
| `Sqs` | `mapping` ("Event source mapping batch 10") | `LambdaFunction` (single ⇒ direct anchor) | — |
| `CodePipeline` | `actions` ("Configured stages and actions") | `CodeBuildProject`, `LambdaFunction` | `IBucket` (artifact and S3 deploy buckets), `IKey` (S3 deploy encryption key), `IRole` (action and CloudFormation deployment roles), `ITopic` (approval notification topic), `IAction` (custom action), `stackName` (CloudFormation deployment stack name) |

Derive each row from the real type union (e.g. `EventTarget`, `SqsProps.fn`, `PipelineActionDefinition`) and keep relative hrefs consistent with real generated routes. All five verified: `../lambdafunction/`, `../eventbridge/`, `../apidestination/`, `../sqs/`, `../codebuildproject/` (each corresponds to a generated `docs/…/cdk/classes/<Class>.md` page and is asserted by the test). **Deliberately excluded Pawl-class relationships** (structurally similar, deliberately out of the confirmed five-owner scope): `DynamoDbTableWithStreams.lambdaFunction` and `CodeCommit.router`.

## Required changes

- **`docs/mermaid-viewer.mjs`**: replace the `apiGatewayTargetLinks` constant with an allowlisted registry keyed by owner. Each row is `{ owner, source, pagePath, node, caption, targets, unlinked? }`; `owner` is the serialized field, `source` is the generator's `packages/cdk/src/<file>.ts` identity check, `caption` is the authored node label. `parseTargetEntry` selects the entry by the emitted `owner`, validates every linked target against that owner's allowlist (cardinality is bounded by `row.targets.length`, no fixed numeric cap), enforces the page-path match for that owner, rejects malformed, duplicate, foreign-owner or unsafe entries, rejects any non-linked entry the row does not declare, and fails closed to `undefined` (the viewer then leaves the diagram non-interactive). `findTargetNode` uses the owner's node id. Non-linked entries render inside a labelled `role="group"` / `Supplied values` section as plain text spans, never as anchors and never focusable. Keep the single-target ⇒ real SVG anchor and multi-target ⇒ chooser behavior, Escape/focus/scroll/dialog lifecycle, and the click-versus-drag threshold untouched.
- **`docs/typedoc-plugin-mermaid.mjs`**: select the registry row by class kind + exact class name + `packages/cdk/src/<file>.ts` source identity, and serialize only `{ owner, node, targets, unlinked? }` (unchanged for `ApiGateway`). Keep the literal wrapper-detection string consistent with the emitted wrapper or the bootstrap silently drops. Preserve strict Mermaid pin/security and escaping.
- **`docs/src/styles/custom.css`**: only minimal scoped additions if non-linked chooser entries need a distinct treatment. No visual-world changes.
- **`docs/tests/mermaid-viewer.test.ts`**: per-owner registry/allowlist/round-trip coverage, cardinality (0/1/2+/whole-row), non-linked entries, cross-owner rejection (an EventBridge metadata block on the ApiGateway page must fail closed), unsafe/malformed/duplicate rejection, node-id resolution per owner, and a source-drift test asserting each registry row still matches the real union in the row's own source file, including `packages/cdk/src/pipeline/actions.ts` and its `OrdinaryLambdaFunction` alias, plus generated-route existence for every href.
- **`docs/tests/mermaid-viewer.browser.mjs`**: extend the delivered suite to exercise each new construct's real page — single-target direct anchor (ApiGatewayV1, Sqs), multi-target chooser (EventBridge, CodePipeline), non-linked entries rendered as text and not focusable as links, plus same-tab and modified/middle-click behavior. The non-interactive walk keeps a still-non-interactive page (CodePipeline moved to `AgentCore`, since CodePipeline is now interactive). The 48 reconstructed original check call sites and all 86 pilot call sites stay byte-for-byte; all 360 pilot runtime checks are retained, with five CodePipeline loop labels mechanically moving to `AgentCore` and the sixth (`CodePipeline: delivered viewer ready`) still emitted by the new rollout coverage.
- This plan records outcome. Generated pages change only through the docs build.

## Preserved constraints

- Ownership-only diagrams: no new nodes/edges; geometry, connectors and source Mermaid stay byte-identical.
- Hover-revealed compact toolbar, wheel zoom, drag-to-pan, native dialog, strict security, source fallback and per-block failure isolation all keep working.
- No new dependencies, no changes to `packages/` source or production APIs, no `CONTEXT.md` semantics changes unless a genuinely new term is agreed.
- Preserve every unrelated dirty file and all prior pilot work.

## Resolved preflight findings and decisions

Every material preflight finding was resolved inside the confirmed five-owner scope; nothing was reopened.

1. **P0 — the delivered `CodePipeline: no pilot metadata or interactive nodes` check contradicted the new row.** Resolved by adapting that single check (pilot precedent): the non-interactive walk now runs `ApiGateway`, `AgentCore`, `AuthoritativeRevisionArbitrationExhaustedError` with the same call sites. `AgentCore` is still non-interactive, so the walk keeps its purpose. Five pilot labels are mechanically renamed `CodePipeline…` → `AgentCore…`; the sixth (`CodePipeline: delivered viewer ready`) is still emitted by the new rollout coverage. Retention is recomputed by machine, not by hand.
2. **P1 — EventBridge misattribution of `EventPipe`.** Confirmed: only the four class branches call `createRule`; an `EventPipe`-shaped target creates the separate `pipe` node via `new Pipe(...)` (`packages/cdk/src/eventbridge.ts:164-169`). Kept as a non-linked entry (the union member is real and not a Pawl class) but reworded to `supplied source and target bus create an independent Pipe, not a rule on this bus`, and moved out of the supported-target framing into the labelled **Supplied values** group.
3. **P1 — the hardcoded `targets.length > 2` cap would silently disable the four-target EventBridge row.** Replaced with `value.targets.length > row.targets.length`, derived from the selected row. Unit cardinality now covers 0/1/2/3/4 on the EventBridge row and an over-long/foreign-target rejection.
4. **P1 — the multi-target accessible label was hardcoded to ApiGateway's caption.** The registry row carries `caption` (the authored node label) and the trigger announces `` `${caption}: supported targets` ``, which is byte-identical to the pilot for `ApiGateway`.
5. **P2 — scope framing.** The Goal and exclusion list now name `DynamoDbTableWithStreams.lambdaFunction` and `CodeCommit.router` as deliberately excluded Pawl-class relationships, so the completeness claim stays bounded to the confirmed five owners.
6. **P2 — registry row shape.** Documented and implemented as `{ owner, source, pagePath, node, caption, targets, unlinked? }`, with `owner` the serialized field, `source` the plugin's identity check, `targets` the linked allowlist and `unlinked` the supplied-value allowlist.
7. **P2 — href placeholder.** `../apidesignation` replaced by the verified `../apidestination/`; every href is now asserted against a real generated class page.
8. **P2 — CodePipeline supplied set was incomplete against the plan's own honesty contract.** The set is now exhaustive against the union member properties: `IBucket`, `IKey`, `IRole`, `ITopic`, `IAction` (the imported CDK interface receivers) and `stackName` (a plain name). A drift test derives the interface set from the real union instead of restating it.
9. **P2 — supplied values were presented under the supported-target heading.** They now sit in a nested `role="group"` labelled **Supplied values** with its own visible heading, preserving `CONTEXT.md`'s supported-target-type definition.
10. **P2 — the CodePipeline drift test could not locate the real union.** It now names `packages/cdk/src/pipeline/actions.ts` and resolves the `OrdinaryLambdaFunction` alias (and the `AwsActionBase`/`CloudFormationActionBase` aliases) to `LambdaFunction`.
11. **P2 — EventBridge self-link was an unstated decision.** Kept deliberately: `EventBridge` is a real `EventTarget.type` member (a bus-to-bus rule target), so the entry links to the `EventBridge` class page even when that page is the current one.

## Tasks

- [x] **Task 1 — Red.** Fresh full pre-edit snapshot of Git-visible state (`fresh-before.json`, 665 paths / 662 content-snapshotted) plus non-file supplement and tracked diff in the durable evidence dir. Failing unit tests for the generalized registry, per-owner allowlists, non-linked entries and cross-owner rejection; failing delivered-browser assertion for a new construct. Recorded expected assertion failures, not import/environment errors.
- [x] **Task 2 — Implement.** Registry, `parseTargetEntry`, plugin selection by class kind + exact name + source identity, new rows, non-linked chooser section, minimal scoped CSS. Interaction contract unchanged.
- [x] **Task 3 — Verify.** Focused tests, `rtk bun lint`, no-base + production docs builds, delivered browser suite, 22-page/88-view geometry, one batched visual inspection, one mechanical detector run.
- [x] **Task 4 — Review and gates.** Independent review requested by the parent on the task-only diff, evidence and screenshots; preservation recomputed; no staged files. The full serial LocalStack suite is owned by the parent's follow-up workflow, not by this worker.
- [x] **Task 5 — Final gates (parent-owned follow-up, executed 2026-09-11).** Lint, focused tests and the full serial LocalStack suite re-run on the frozen tree; no lingering test containers; empty Git index; preservation recomputed. Outcome, counts and remaining gaps are recorded in **Final verification** below.

## Evidence and outcome

Implemented on top of the approved pilot, following TDD. **All green:** 18/18 focused unit tests, 80/80 with the diagram tests, `rtk bun lint` (300 files, zero errors), 183-page no-base and 183-page production builds, **416/416 delivered browser checks**, **22 pages / 88 views geometry with zero connector, overlap or overflow failures**.

**Exact chosen targets and nodes (verified against source and the real build).**

| Owner | Serialized metadata | Node id in the emitted SVG | Chooser |
| --- | --- | --- | --- |
| `ApiGateway` | `{owner, node:"routes", targets:[LambdaFunction ../lambdafunction/, EventBridge ../eventbridge/]}` | `…-service-routes` | multi (2) |
| `ApiGatewayV1` | `{owner, node:"routes", targets:[LambdaFunction ../lambdafunction/]}` | `…-service-routes` | single ⇒ direct SVG `<a>` |
| `EventBridge` | `{owner, node:"rules", targets:[LambdaFunction, ApiDestination ../apidestination/, Sqs ../sqs/, EventBridge ../eventbridge/], unlinked:[EventPipe]}` | `…-service-rules` | multi (4) + 1 supplied value |
| `Sqs` | `{owner, node:"mapping", targets:[LambdaFunction ../lambdafunction/]}` | `…-service-mapping` | single ⇒ direct SVG `<a>` |
| `CodePipeline` | `{owner, node:"actions", targets:[CodeBuildProject ../codebuildproject/, LambdaFunction ../lambdafunction/], unlinked:[IBucket, IKey, IRole, ITopic, IAction, stackName]}` | `…-service-actions` | multi (2) + 6 supplied values |

**Source unions the rows were derived from:** `ApiProps.routes` + `ApiGateway.addRoute`; `ApiV1Props.routes` + `ApiGatewayV1.addRoute`; `SqsProps.fn`; `EventTarget.type` (`LambdaFunction | ApiDestination | Sqs | EventBridge | EventPipe`); `PipelineActionDefinition` in `packages/cdk/src/pipeline/actions.ts` (with `OrdinaryLambdaFunction` resolved to `LambdaFunction`).

| Command | Result / durable evidence |
| --- | --- |
| `rtk python3 …/snapshot.py` | 665 Git-visible paths, 662 content-snapshotted, 3 non-file entries, HEAD `f406884…`, nothing staged. `fresh-before.json`, `fresh-non-file supplement`, `fresh-before-tracked.diff`. |
| `rtk bun test docs/tests/mermaid-viewer.test.ts` (red) | **8 pass / 10 expected failures** — missing registry, missing `parseTargetEntry`, missing per-owner drift coverage. `unit-red.log`. |
| `PAWL_BROWSER_DIR=…/red rtk bun docs/tests/mermaid-viewer.browser.mjs` (red) | 323 checks pass, then the expected assertion failure `ApiGatewayV1: delivered page carries only its own allowlisted metadata`. `browser-red.log`, `red/results.json`. |
| `rtk bun test docs/tests/mermaid-viewer.test.ts packages/cdk/tests/documentation-diagrams.test.ts` | **80 pass, 0 fail, 1179 expectations**. `focused-tests.log`. |
| `rtk bun lint` | **300 files checked, zero errors, no fixes.** `lint.log`. |
| `cd docs && rtk bun run build --base / --outDir …/no-base-site` | **183 no-base pages.** `build-no-base.log`. |
| `cd docs && rtk bun run build` | **183 production pages.** `build-production.log`. Existing TypeDoc cross-reference/schema and missing-sitemap warnings remain. |
| `PAWL_BROWSER_DIR=… rtk bun docs/tests/mermaid-viewer.browser.mjs` | **416 recorded checks, 0 failures, empty `console-errors.json`.** `browser.log`, `results.json`. |
| `rtk bun …/check-preserved-assertions.mjs` | All **48 pre-pilot** and all **86 pilot** `check(...)` call sites preserved byte-for-byte inside the current 98 call sites. `preserved-assertions.json`. |
| `PAWL_BROWSER_DIR=…/geometry PAWL_BROWSER_NAMES=<22 pages> rtk bun …/pawl-mermaid-viewer-geometry.mjs` | **22 pages / 88 views, zero connector/overlap/group failures, zero page overflow**, empty `geometry/failures.json`. `geometry.log`. |
| `rtk python3 …/verify-preservation.py` | Only the six authored files (the five implementation files plus this plan) and the 22 diagram pages changed; **68 unrelated generated pages restored byte-for-byte** after the build normalized their link bases; no added/removed Git-visible paths; HEAD/index/status unchanged; nothing staged. `preservation.json`, `task-only.diff`. |
| `rtk /…/impeccable detect src/styles/custom.css mermaid-viewer.mjs --json` | One detector run: **no primary findings**. The same two pre-existing advisories as the pilot (toolbar `1rem` type size, neutral 15% soft shadow). `detector.json`. |
| `rtk git diff --check`; `rtk node --check` on both modules and the browser test; `rtk git diff --cached --name-only` | Pass; empty staged list. `static-checks.log`. |

**New delivered-browser coverage (56 new checks).** Each new owner's real page asserts: only its own allowlisted metadata is present (owner, node, linked names, supplied names with non-empty notes); only the authored node is enhanced (2 theme wrappers, both ending `-service-<node>`); single-target rows expose a genuine SVG anchor with `Supported target: <name>` and no chooser, and their click, keyboard Enter, modified-click, middle-click and drag behaviour is exercised; multi-target rows open a chooser listing exactly their own linked targets, announce `<caption>: supported targets`, render supplied values as non-link, non-focusable text under a labelled **Supplied values** group, skip them on Tab, and navigate by click, modified click and middle click. A compact desktop/mobile × dark/light pass covers a single-target page (ApiGatewayV1, Sqs) and a multi-target page (EventBridge, CodePipeline) and proves the enhancement leaves Mermaid geometry byte-identical at rest.

**Retention.** The pilot's **360** runtime checks: **355 labels retained verbatim**, five `CodePipeline` loop labels mechanically renamed to `AgentCore` because CodePipeline is now interactive (same call sites, same expressions, same page-battery semantics), and the sixth `CodePipeline: delivered viewer ready` label is still emitted because the new rollout coverage navigates the real CodePipeline page. Non-interactive coverage is preserved by `AgentCore` and `AuthoritativeRevisionArbitrationExhaustedError`.

**Visual inspection (one batch, six screenshots, no correction round).** `target-ApiGatewayV1-desktop-dark.png` (single target, focus affordance), `target-Sqs-mobile-light.png` (single target, mobile), `target-EventBridge-desktop-dark.png` and `target-EventBridge-mobile-light.png` (multi target plus the EventPipe supplied value), `target-CodePipeline-desktop-dark.png` and `target-CodePipeline-desktop-light.png` (multi target plus six supplied values). The choosers are unclipped, the supplied-value section reads as text, the node affordance is unchanged, and the pilot's ApiGateway screenshots still show the same behaviour. No cosmetic edits were needed.

**Honest limitations.** Browser evidence is Chromium/CDP (Helium 0.16.6.1), including touch emulation, not physical-device, Safari/Firefox or assistive-technology testing; platform-native Ctrl-click on Windows/Linux was not run (native anchors keep default behaviour). The `EventBridge` row intentionally contains a self-referential `../eventbridge/` entry. The docs build regenerated link bases in unrelated generated pages because the pre-edit tree held a leftover no-base generation; those 68 pages were restored byte-for-byte, and the 22 diagram pages carry both the viewer delivery and that incidental production link normalization. The full LocalStack suite was not run by this worker (parent-owned follow-up); it was run green in **Final verification** below.

## Final verification (2026-09-11)

Final verification ran on the frozen tree after the independent review; no implementation file was changed in this pass (only this plan was updated, to record the outcome below).

**Independent review outcome: `OK with notes`** — no P0/P1 findings. The reviewer verified each registry row against the real source unions, the per-owner fail-closed allowlist, the non-linked supplied-values rendering, the untouched interaction/security contract and byte-identical diagram geometry, and confirmed the reported counts from the evidence. Three P2 findings were recorded as report-only (listed under **Remaining gaps**). Review artifact: `/Users/jolo/.pi/agent/sessions/--Users-jolo-Development-pawl--/subagent-artifacts/outputs/32800e64-38d9-4e9c-9392-c7ff0097fe68/rollout/review.md`.

| Gate | Result | Evidence |
| --- | --- | --- |
| Docker preflight | `29.5.2 / Docker Desktop`, engine reachable, zero containers | `final/docker-preflight.log` |
| `rtk bun lint` | **300 files checked, zero errors, no fixes** | `final/lint.log` |
| `rtk bun test docs/tests/mermaid-viewer.test.ts packages/cdk/tests/documentation-diagrams.test.ts` | **80 pass, 0 fail, 1179 expect() calls** | `final/focused-tests.log` |
| `rtk bun …/pawl-run-tests-with-localstack.ts` (full serial suite) | **1110 pass, 8 skip, 0 fail, 4356 expect() calls, 1118 tests across 107 files, 155.24s**, exit 0. The 8 skips are the pre-existing live-AWS integration suites (`durable replay`, `repository isolation`, `codecommit reviewer`), skipped by their own live-only guard. `docs/tests/mermaid-viewer.test.ts` and `packages/cdk/tests/documentation-diagrams.test.ts` are included in this run. | `final/full-tests.log` |
| `rtk git diff --check`; `rtk git diff --cached --name-only` | Clean; **empty index, nothing staged** | `final/git-checks.log` |
| `rtk python3 …/verify-preservation.py` (recomputed) | **665 Git-visible paths, no added/removed paths, HEAD/index/status byte-identical** to the fresh pre-edit snapshot; only the 6 authored files and the 22 diagram pages differ | `final/preservation.log`, `final/preservation.json`, `final/task-only.diff` (the reviewed pre-update copies remain at the evidence root) |
| Test-container cleanup | Transient containers created by the suite (a `nodejs:24` runtime container and `testcontainers/ryuk`) were gone on re-check. The only container left is a **pre-existing** `localstack/localstack-pro` container (`localstack-main`, `Exited (137)`, created 2026-07-27, i.e. six weeks before this task); it was left untouched because it predates this work. | `final/container-check.log` |

The LocalStack token was retrieved from SSM inside the recovered runner only, held in the child process environment, and never logged, persisted or passed on a command line; the runner redacts it from both forwarded streams. No redaction marker was needed in this run's log, and no token-like string appears in it.

**Remaining gaps.**

1. P2 (report-only, no rework): the chooser — and with it the supplied-values block — is appended only when `targets.length > 1` (`docs/mermaid-viewer.mjs:191`), so a future registry row with a single linked target *and* `unlinked` entries would render no supplied text. No approved row has that shape (EventBridge 4 + 1, CodePipeline 2 + 6; the two single-target rows declare no `unlinked`), so the delivered build is unaffected.
2. P2 (report-only): rebuilding normalized link bases (`/cdk/…` → `/pawl/cdk/…`) inside the 22 diagram pages while the 68 unrelated pages were restored byte-for-byte, so a checkout can briefly mix both bases. It cannot survive a rebuild and no added absolute link is anything but `/pawl/cdk/…`.
3. P2 (report-only): `EventPipe` stays a supplied value although it is an exported Pawl type with a generated type-alias page; this is the approved decision (it is not a class and creates the separate `pipe` node).
4. Browser evidence is Chromium/CDP (Helium 0.16.6.1) with touch emulation, not physical-device, assistive-technology, Safari or Firefox testing; native Ctrl-click on Windows/Linux was not exercised (native anchors keep default behaviour).
5. Redirect or no-trailing-slash hosting is untested and fails closed to a non-interactive diagram because `pagePath` matching requires the trailing slash.
6. The 8 live-AWS integration suites remain skipped and no live AWS deployment was performed.

The `EventBridge` row intentionally keeps its self-referential `../eventbridge/` entry. No unrelated file, dependency, `packages/` source or production API was changed.
