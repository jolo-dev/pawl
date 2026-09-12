# CDK Architecture Diagrams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved architecture diagrams to Pawl-owned public class TypeDoc comments and regenerate the reference without hand-editing generated pages.

**Architecture:** `packages/cdk/index.ts` remains the public entry point. Class JSDoc is the source of truth; every diagram uses `architecture-beta` with the existing logos pack and built-in icons, following `docs/analysis/cdk-diagram-audit.md`. Third-party declarations and public exports are unchanged. Work in the current workspace to preserve and use the user's existing docs configuration; only one writer operates at a time.

**Tech Stack:** TypeScript JSDoc, Mermaid architecture diagrams, Bun tests, TypeDoc, Astro Starlight.

---

## Task 1: Guard and apply source documentation

**Files:**
- Create: `packages/cdk/tests/documentation-diagrams.test.ts`
- Modify: `packages/cdk/src/{agentcore,api-destination,apigateway-v1,codebuild-project,codecommit,codecommit-auto-reviewer,codecommit-review-events,codepipeline,durable-lambda-function,dynamodb-table,local-stack,stack,static-site}.ts`
- Modify: `packages/cdk/src/{codecommit-source,pipeline/errors,reviewer/pipeline-review-common}.ts`
- Correct existing diagrams: `packages/cdk/src/{apigateway,eventbridge,lambda-function,sqs}.ts`

- [x] Write a dependency-free source-documentation regression test first. Use existing TypeScript compiler API to locate exported class declarations and their attached JSDoc without importing infrastructure modules at runtime. Explicitly cover the 22 Pawl-owned public classes (17 missing plus five existing), requiring attached `architecture-beta` Mermaid blocks. Validate all diagram edge endpoints and group references with small local helpers; reject `flowchart` and `sequenceDiagram`. Include a check that the CodeCommit overview is attached to the public class, not its private helper. Do not require an exact byte copy of audit diagrams.
- [x] Run `rtk bun test packages/cdk/tests/documentation-diagrams.test.ts` and observe expected missing-documentation failures.
- [x] Add the exact approved architecture diagrams from audit sections A and B to their class JSDoc, preserving existing prose and API descriptions. Include the explanatory optional/external-resource caveats needed to interpret unlabeled architecture edges. Do not copy audit status text or source links into API comments.
- [x] Move the misplaced CodeCommit overview immediately before `export class CodeCommit`; give its private helper only a short implementation comment if needed.
- [x] Replace the four existing diagrams using audit section D. Correct immediately related misleading prose (optional API authorization; accurate EventBridge DLQ coverage) without changing runtime behavior. Keep the fifth existing DynamoDbTableWithStreams diagram.
- [x] Run the focused test and Biome on changed source/test files. Confirm TypeScript ASTs without comments match HEAD for all modified existing source files; no runtime/API changes are intended.

## Task 2: Review source changes

- [x] Independently review specification compliance: 22 class-attached architecture diagrams, no third-party changes, no new exports, and no generated-page edits.
- [x] Review documentation quality and the regression test. Check group/service identifiers, class-comment placement, optional modes, and consistency with implementation. Fix substantive findings before regenerating.

## Task 3: Regenerate and verify docs

**Files:** Generated `docs/src/content/docs/cdk/**` and `docs/src/content/docs/lambda/**` only through the configured generator. Preserve existing user changes in `docs/astro.config.ts`, `docs/package.json`, styles, overrides, and unrelated pages.

- [x] Verify existing docs dependencies/toolchain; install only already-declared dependencies if necessary, preserving package manifests/locks. Do not add dependencies or silently change versions. If the locked toolchain is unavailable, report the blocker rather than bypassing type checking or fabricating generated content.
- [x] Run `rtk bun run --cwd docs build` to regenerate through Astro/TypeDoc. Diagnose any failure before proposing a fix; do not silently suppress TypeDoc errors.
- [x] Verify every Pawl-owned public class has a generated page with a Mermaid architecture block. Verify all expected public classes appear. Generated third-party pages may have upstream comments but are not enriched by editing node_modules.
- [x] Parse source diagrams with the temporary Mermaid parser bundle already available at `/tmp/pawl-mermaid-parser-bundle.mjs` if present (otherwise document parser verification as unavailable). Check referenced icons against `/tmp/pawl-diagram-logos.json` if available. Do not add a parser dependency to the project.
- [x] Inspect rendered docs/browser layout if the existing toolchain supports it. Distinguish generated markup, parser validation, and browser rendering in the final result.
- [x] Run `rtk bun lint`, `rtk test bun test`, and `rtk git diff --check`. Existing baseline failures: lint 6 errors/4 warnings; tests 940 pass/26 fail/12 errors. Preserve test-generated `undefined/` output outside the repository if the suite creates it.
- [x] Summarize changed files, regeneration status, passing focused checks, and any remaining environment/repository failures. Do not commit unrelated user changes.

## Completion evidence

- Source implementation: 17 added diagrams, four replacements, and CodeCommit public overview reattached. All 22 Pawl-owned public classes have diagrams; runtime ASTs are unchanged across 20 source files.
- Independent plan, specification, and quality reviews found no important issues. Browser inspection subsequently required layout refinements in CodeBuildProject, CodePipeline, CodeCommitReviewEvents, and CodeCommitAutoReviewer. Alignment validation was added with an observed failing test before implementation.
- Focused suite: 26 tests passed. Biome on the 21 changed source/test files and docs TypeScript typecheck pass.
- Production docs build: 183 pages. All 22 Pawl class pages render both themes (44 SVGs), initialize successfully, switch themes correctly, and have no overlapping service icons or excessive canvas sizes.
- The updated generator emits 38 class pages and moves the type-only Construct export to interfaces/Construct.md. No export was added or removed.
- Existing declared/locked docs dependencies were installed without changing manifests or locks. An initial build using external symlinked dependencies hit Astro metadata resolution; placing those same dependencies in docs/node_modules fixed the environment issue.
- Full suite: 966 passed, 26 failed, 12 errors. Repository lint retains the baseline 6 errors and 4 warnings after moving test-generated undefined/ artifacts outside the repository.
- Source/test whitespace checks pass. Repository-wide git diff --check reports generator-produced blank EOF lines in three generated pages; they were not hand-edited.
- Generated reference changes include Lambda pages because the configured docs build regenerates both packages. Pre-existing user docs configuration and lockfile hashes remain unchanged. No commits or staged files.

