# Contained Construct Diagrams Implementation Plan

> **For agentic workers:** Use subagent-driven-development or executing-plans for this approved documentation-only rollout. Do not commit or change infrastructure behavior.

**Goal:** Apply the approved ApiGateway ownership-first diagram convention across all 22 existing Pawl-owned public class diagrams.

**Architecture:** Source TypeDoc is authoritative. Depict only components the construct contains, provisions, or directly configures/uses; remove external actors and surrounding application architecture. Distinguish unconditional, conditional, and imported/referenced components honestly. Prefer the actual integration/binding resource over its supplied external target, as in the approved ApiGateway pilot. Keep diagrams compact logical summaries, not exhaustive CloudFormation inventories.

**Tech Stack:** TypeScript/JSDoc, Mermaid architecture-beta and existing icon packs, Bun tests, Astro/TypeDoc documentation generation.

## Scope and safeguards

- Preserve `packages/cdk/src/apigateway.ts` as the approved pilot.
- Update other existing diagrams under `packages/cdk/src/`; public class coverage is listed in `packages/cdk/tests/documentation-diagrams.test.ts`.
- Do not add diagrams for private/non-exported classes or alter third-party declarations, exports, dependencies, runtime configuration, shared site styling, or user design work.
- For non-provisioning helper/error classes, show their actual contained state or implementation responsibilities, explicitly not deployed AWS infrastructure. Do not invent resource nodes or external failure/caller stories just to retain a diagram. A single-node diagram is valid where appropriate.
- Imported resources must not be presented as created. Where only an imported reference exists, explain that in prose; include a reference node only when essential to explain the class's own contained responsibility, not surrounding context.
- Preserve mandatory/optional behavior such as LOCAL monitoring, runtime endpoint creation, source modes, reviewer phases, conditional IAM grants, and imported targets.
- Source examples and unrelated comments remain intact. Generated pages are rebuilt, never hand-edited.
- Keep exactly one repository writer. Parallel scouts and reviews are read-only.

## Tasks

- [x] **1. Audit ownership in two read-only groups.** Foundations: AgentCore, ApiDestination, ApiGatewayV1, LambdaFunction, DurableLambdaFunction, DynamoDbTable, DynamoDbTableWithStreams, EventBridge, Sqs, Stack, LocalStack, StaticSite. Delivery/helpers: CodeBuildProject, CodeCommit, CodeCommitAutoReviewer, CodeCommitReviewEvents, CodePipeline, CodeCommitSourceLimitError, PipelineDefinitionError, AuthoritativeRevisionArbitrationExhaustedError, PipelineReviewDispatcher. Cite implementation evidence for retained/removed nodes and conditions.
- [x] **2. Add failing ownership regressions.** Extend `packages/cdk/tests/documentation-diagrams.test.ts` with an explicit per-class primary-node inventory or equivalent focused checks. Preserve the approved ApiGateway assertions. Allow valid single-node diagrams if required, while retaining endpoint/group/alignment validation and negative cases. Run `rtk bun test packages/cdk/tests/documentation-diagrams.test.ts` and record the expected failures.
- [x] **3. Apply only source documentation changes.** Update the 21 remaining class diagrams and accompanying ownership/condition explanations. Retain architecture-beta and AWS/service icons. Avoid disconnected speculative context, fake resources, and overly detailed IAM expansions.
- [x] **4. Synchronize the audit.** Update the Pawl-owned examples/current status in `docs/analysis/cdk-diagram-audit.md`; preserve its historical and third-party proposal sections. Record a concise 22-class ownership/condition inventory there or in an adjacent analysis document.
- [x] **5. Regenerate and visually validate.** Run `rtk bun run --cwd docs build`. Adapt `/tmp/pawl-check-generated-diagrams.mjs` for all 22 classes, dark/light themes and desktop/mobile views. Check real parser/rendering, service and group overlap, label collisions, excessive canvas size, and page overflow. Use bounded batched inspection and one correction batch rather than an open-ended polishing loop.
- [x] **6. Verify unchanged behavior.** Compare comment-free TypeScript output for all snapshotted CDK source files against `/tmp/pawl-contained-diagrams-before.json`. Ensure the approved pilot and protected user docs settings/styles/lockfiles are unchanged. Run focused tests, `rtk bun lint`, and sequential full tests through `rtk bun /tmp/pawl-run-tests-with-localstack.ts`, keeping logs in `/tmp`. The token helper retrieves an already-authorized SSM secret in memory; never print or persist the token. No live AWS deployment is authorized.
- [x] **7. Fresh review and bounded fixes.** Review scope, node ownership, condition accuracy, test strength, rendered evidence, and AST/config preservation. Apply concrete in-scope findings through the same writer, re-run affected gates, and hand final evidence to the parent.

## Baseline

- 22 Pawl-owned public class diagrams; ApiGateway ownership-only pilot accepted.
- Full suite: 1,057 pass, 8 existing live-AWS skips, 0 fail. Lint clean; docs build emits 183 pages.
- Substantial pre-existing dirty work is intentional. No commits, resets, or broad formatting.
- Existing generated EOF whitespace in unrelated ApiDestination/LocalStack/Stack pages is a generator artifact; do not hand-edit generated pages to eliminate it.


## Initial implementation evidence — 2026-09-08

- Ownership audit: both supplied read-only audits were resolved against implementation. Exact node IDs, source links, and mandatory/conditional/imported/helper semantics for all 22 classes are in `docs/analysis/cdk-diagram-audit.md`. No new public diagrams or runtime resources were introduced.
- Regression red phase: `/tmp/pawl-contained-diagrams-red.log` records **28 pass / 21 fail** before any source diagram edits. All 21 new ownership inventories failed as intended. Final suite adds exact service/group inventories, inventory completeness, condition prose and independent-Pipe checks, single-node acceptance, while retaining ApiGateway assertions and malformed-reference/alignment rejection.
- Final focused tests: `rtk bun test packages/cdk/tests/documentation-diagrams.test.ts` — **51 pass / 0 fail**, `/tmp/pawl-contained-diagrams-focused.log`.
- Source rollout: **21 class diagrams in 20 source files**, ApiGateway preserved. Generated output changed 21 class pages and three owned function pages (source-definition line shifts only for those functions). Source examples and non-class comments are unchanged.
- Regeneration: `rtk bun run --cwd docs build` — **183 pages**, `/tmp/pawl-contained-diagrams-build.log`. Existing i18n/404/sitemap warnings remain outside scope. Generated pages were never hand-edited.
- Browser: `/tmp/pawl-check-contained-diagrams.mjs` serves the built `public/` and launches only headless Chromium. **22 pages × dark/light × desktop 1440/mobile 390 = 88 captures**, all initialized, both SVG variants rendered, exactly one theme visible, zero errors or page/block overflow. Service/icon, service-label, label-label, label-icon, partial group-group and group-service bounds pass; largest canvas is **1000 × 990** rounded up. Initial CodePipeline alignment failure and group boundary collisions in four classes were corrected with compact layouts and fewer conditional boxes, retaining conditions in labels/prose.
- Browser evidence: `/tmp/pawl-contained-diagrams-browser-accepted/` contains results, zero-failure report, 88 PNGs, 88 SVGs and four inspected all-page contact sheets. Complex desktop/mobile renders were also inspected individually. No interactive browser/visual companion was opened. Mobile inherits existing SVG scaling, so dense diagrams remain small at 390px; no shared styling was changed.
- Lint: `rtk bun lint` — **297 files checked, no errors**, `/tmp/pawl-contained-diagrams-lint.log`.
- Sequential full suite: `rtk bun /tmp/pawl-run-tests-with-localstack.ts` — **1,081 pass / 8 existing live-AWS skips / 0 fail**, 1,089 tests across 106 files, `/tmp/pawl-contained-diagrams-full-tests.log`. Authorized token retrieved only in memory and redacted; no live AWS deployment.
- Preservation: `rtk bun /tmp/pawl-verify-contained-diagrams.ts` compares TypeScript printer output with `removeComments: true` across **78 snapshotted source files**: no AST changes. The **11 other protected snapshot files**, pilot, and third-party audit proposals are byte-identical. Removing only the 21 target class JSDoc blocks leaves every changed source file byte-identical to its snapshot. `/tmp/pawl-contained-diagrams-preservation.json` records the checks.
- Scope review: ownership/binding nodes exclude supplied targets; CodeCommit import-only can create nothing; AgentCore endpoint is mandatory; storage keys/PR execution rules/reviewer phases remain conditional; helper diagrams contain implementation/state, not injected AWS deployments. Fresh independent parent acceptance review remains the unchecked final task.
- Task-only diff: `/tmp/pawl-contained-diagrams.diff`, **47 files** built against the supplied source/protected snapshot and a supplemental generated-page/plan snapshot captured before implementation. `rtk proxy git diff --check` reports only the three known generated EOF blank lines (ApiDestination/LocalStack/Stack); these pre-existing generator artifacts were not hand-edited. `/tmp/pawl-contained-diagrams-git-diff-check.log` records them. No commits, resets, dependencies, exports or staged files.
- Initial evidence is copied beside the implementation report under `/Users/jolo/.pi/agent/sessions/--Users-jolo-Development-pawl--/subagent-artifacts/outputs/99e5f960-70f6-4e53-ac86-530b352e41f5/`: `browser/`, `evidence/`, and `implementation.md`. The final evidence below supersedes the initial render and test results.

## Final review corrections and recovery — 2026-09-08

- Independent review confirmed all 22 node inventories and conditions against implementation, but found connectors striking through labels. Geometry-only fixes cover CodeBuildProject, CodeCommit, CodeCommitAutoReviewer, CodeCommitReviewEvents, CodePipeline, PipelineReviewDispatcher, Sqs, Stack, and StaticSite. No service inventory, ownership condition, runtime, or shared style changed during these corrections.
- The workflow timed out before its planned final-review stage and interrupted the final test run. The parent confirmed no writer/test process remained, preserved the edits, rebuilt references, and completed the final visual review and verification directly. The failed workflow is not claimed as a successful final review.
- Final production build: **183 pages**, `/tmp/pawl-contained-recovery-build.log`.
- Strengthened browser checker samples actual SVG connectors against label bounds. All **22 pages / 88 theme-and-viewport views pass**, with no connector/label, node, label, group-boundary collisions or page/block overflow. Final screenshots/SVGs and results: `/tmp/pawl-contained-recovery-browser/`; checker: `/tmp/pawl-check-connector-fix.mjs`; log: `/tmp/pawl-contained-recovery-browser.log`. The parent inspected the corrected dispatcher, pipeline, build-project and reviewer screenshots. Largest final canvas is approximately **1719 × 720** across the collection; dense diagrams retain the existing mobile scaling.
- Final focused documentation tests: **60 pass / 0 fail**, `/tmp/pawl-contained-recovery-focused.log`. Nine connector-port regressions supplement the ownership checks.
- Final sequential full suite: **1,090 pass / 8 existing live-AWS skips / 0 fail**, 1,098 tests across 106 files, `/tmp/pawl-contained-recovery-full-tests.log`.
- Final lint: **297 files checked, no errors**, `/tmp/pawl-contained-recovery-lint.log`.
- Final preservation checks: **78 comment-free source outputs unchanged**, 11 protected files unchanged, approved pilot byte-identical, no source changes outside the intended class JSDoc, and third-party audit proposals unchanged. Evidence: `/tmp/pawl-contained-recovery-preservation.log` and `/tmp/pawl-contained-diagrams-preservation.json`.
- Final review disposition: the initial ownership review stands; its connector-collision finding is resolved by regenerated screenshots and the strengthened all-page checker. No unresolved in-scope correctness findings remain. No commits or real AWS deployments were made.
