# CodePipeline with Auto-Reviewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `CodePipeline` `@pawl/cdk` construct and `pawl init codepipeline` CLI command that creates a CI/CD pipeline for a CodeCommit repository with optional durable auto-review and PR-gated triggering.

**Architecture:** A single `CodePipeline` construct extends `BasicConstruct` and creates an `aws-codepipeline.Pipeline` with configurable stages. When `autoReview` is enabled, it additionally creates the reviewer Lambda, router, state table, and event routing. When `onPullRequest` is true, the pipeline uses `CodeCommitTrigger.NONE` and the router starts executions on PR events with parallel AI review via `Promise.allSettled`. A shared runtime module (`pipeline-review-common.ts`) provides pipeline dispatch, execution-to-PR mapping, and comment posting interfaces used by both the new and refactored routers.

**Tech Stack:** TypeScript 5 strict, Bun, Zod, AWS CDK v2 (`aws-codepipeline`, `aws-codepipeline-actions`, `aws-codebuild`, `aws-s3`), `@aws-sdk/client-codepipeline`, `@clack/prompts`, Bun test, CDK assertions, cdk-nag.

---

## File Structure

### CDK package

- Create `packages/cdk/src/reviewer/pipeline-review-common.ts` — runtime-only module with `PipelineTransport`, `PipelineMappingStore`, `PrCommentPoster` interfaces and `startPipelineForPr`/`handlePipelineExecutionEvent` functions.
- Create `packages/cdk/src/codepipeline.ts` — `CodePipeline` construct with `PipelineSource`, `PipelineStage`, `PipelineAction` types.
- Create `packages/cdk/tests/pipeline-review-common.test.ts` — unit tests for common module.
- Create `packages/cdk/tests/codepipeline.test.ts` — CDK synthesis tests for all four combinations.
- Modify `packages/cdk/src/codebuild-project.ts` — add `pipelineMode` option.
- Modify `packages/cdk/src/reviewer/handlers/router.ts` — compose `PipelineDispatchConfig`, call common module functions.
- Modify `packages/cdk/src/codecommit-auto-reviewer.ts` — pass `pipeline: undefined` to dispatch config.
- Modify `packages/cdk/tests/codebuild-project.test.ts` — pipeline mode tests.
- Modify `packages/cdk/tests/codecommit-auto-reviewer.test.ts` — regression: no pipeline wiring.
- Modify `packages/cdk/index.ts` — export new modules.
- Modify `packages/cdk/package.json` — add `@aws-sdk/client-codepipeline` dependency.

### CLI package

- Create `packages/cli/src/codepipeline-init/` — `cli.ts`, `config.ts`, `prompts.ts`, `generator.ts`, `index.ts`.
- Create `packages/cli/templates/codepipeline-init/` — template files.
- Create `packages/cli/tests/codepipeline-init-*.test.ts` — focused tests.
- Modify `packages/cli/index.ts` — dispatch `pawl init codepipeline`.
- Modify `packages/cli/README.md` — document command.

## Task 1: Add `pipelineMode` to `CodeBuildProject`

**Files:**
- Modify: `packages/cdk/src/codebuild-project.ts`
- Modify: `packages/cdk/tests/codebuild-project.test.ts`

- [ ] **Step 1: Write failing pipeline-mode tests**

Add tests asserting:
- `pipelineMode: true` uses `Source.s3` placeholder (not `Source.codeCommit`)
- No internal no-op buildspec is generated in pipeline mode
- `repository`/`repositoryName` are optional when `pipelineMode: true`
- Existing review mode (`pipelineMode` omitted) is unchanged — `Source.codeCommit`, internal buildspec, repository required

- [ ] **Step 2: Run tests to verify RED**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cdk/tests/codebuild-project.test.ts
```
Expected: FAIL — `pipelineMode` not recognized.

- [ ] **Step 3: Implement `pipelineMode`**

Add `pipelineMode?: boolean` to `CodeBuildProjectProps`. When true:
- Skip `normalizeCodeBuildRepositoryTarget` (repository optional)
- Use `Source.s3({ bucket: placeholderBucket, path: "pipeline-placeholder" })` instead of `Source.codeCommit`
- Suppress internal no-op buildspec (let pipeline supply it)
- Create a minimal internal S3 bucket for the placeholder (or use a dummy `Bucket.fromBucketName`)
- Keep all existing security (KMS, network policy, retention, cdk-nag)

When false/omitted: existing behavior unchanged.

- [ ] **Step 4: Run tests to verify GREEN**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cdk/tests/codebuild-project.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cdk/src/codebuild-project.ts packages/cdk/tests/codebuild-project.test.ts
git commit -m "feat(cdk): add pipelineMode to CodeBuildProject"
```

## Task 2: Common runtime module

**Files:**
- Create: `packages/cdk/src/reviewer/pipeline-review-common.ts`
- Create: `packages/cdk/tests/pipeline-review-common.test.ts`
- Modify: `packages/cdk/index.ts`

- [ ] **Step 1: Write failing unit tests**

Cover:
- `startPipelineForPr` calls `pipelineTransport.startExecution` with `sourceRevision`, persists mapping in `mappingStore`
- `startPipelineForPr` is a no-op when `pipelineTransport` is undefined
- `handlePipelineExecutionEvent` resolves mapping, fetches execution summary, formats comment, posts via `commentPoster`
- `handlePipelineExecutionEvent` ignores events without a mapping
- `handlePipelineExecutionEvent` handles `Superseded` status without posting (or posts superseded marker)
- Mapping store failure propagates error
- Comment poster failure propagates error

Use mock implementations of all interfaces. No real AWS calls.

- [ ] **Step 2: Run tests to verify RED**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cdk/tests/pipeline-review-common.test.ts
```
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the runtime module**

Define `PipelineTransport`, `PipelineMappingStore`, `PrCommentPoster`, `PipelineDispatchConfig` interfaces. Implement `startPipelineForPr` and `handlePipelineExecutionEvent` as pure runtime functions. Format CI summary from `PipelineExecutionSummary` (status, stage names, failed actions). No CDK construct imports — runtime only.

Export from `packages/cdk/index.ts`.

- [ ] **Step 4: Run tests to verify GREEN**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cdk/tests/pipeline-review-common.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cdk/src/reviewer/pipeline-review-common.ts packages/cdk/tests/pipeline-review-common.test.ts packages/cdk/index.ts
git commit -m "feat(cdk): add pipeline review common runtime module"
```

## Task 3: Refactor router to use common module

**Files:**
- Modify: `packages/cdk/src/reviewer/handlers/router.ts`
- Modify: `packages/cdk/src/codecommit-auto-reviewer.ts`
- Modify: `packages/cdk/tests/codecommit-auto-reviewer.test.ts`

- [ ] **Step 1: Write failing regression tests**

Assert in the existing `CodeCommitAutoReviewer` tests:
- No `codepipeline:*` IAM grants in synthesized template
- No pipeline EventBridge rule
- No `PIPELINE_NAME` environment variable in router Lambda
- Existing review behavior unchanged (durable reviewer, state table, EventBridge PR rules, Bedrock IAM)

- [ ] **Step 2: Run tests to verify RED**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cdk/tests/codecommit-auto-reviewer.test.ts
```
Expected: Some FAIL if assertions are new (or PASS if already correct — then just implement the refactor without breaking).

- [ ] **Step 3: Refactor the router handler**

In `router.ts`:
- Compose `PipelineDispatchConfig` from environment variables (`PIPELINE_NAME` if present, otherwise `pipelineTransport: undefined`)
- Call `startPipelineForPr` alongside existing durable reviewer invocation (no-op when pipeline is undefined)
- Add a branch for CodePipeline Execution State Change events that calls `handlePipelineExecutionEvent`
- Existing `EventRouter` dispatch for CodeCommit events is unchanged

In `codecommit-auto-reviewer.ts`:
- Do not set `PIPELINE_NAME` environment variable (it's only set by `CodePipeline` when `onPullRequest + autoReview`)
- Everything else unchanged

- [ ] **Step 4: Run tests to verify GREEN**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cdk/tests/codecommit-auto-reviewer.test.ts packages/cdk/tests/codebuild-project.test.ts
```
Expected: PASS — regression tests confirm event-only mode is preserved.

- [ ] **Step 5: Commit**

```bash
git add packages/cdk/src/reviewer/handlers/router.ts packages/cdk/src/codecommit-auto-reviewer.ts packages/cdk/tests/codecommit-auto-reviewer.test.ts
git commit -m "refactor(cdk): router delegates to pipeline review common module"
```

## Task 4: `CodePipeline` construct — push mode

**Files:**
- Create: `packages/cdk/src/codepipeline.ts`
- Create: `packages/cdk/tests/codepipeline.test.ts`
- Modify: `packages/cdk/index.ts`
- Modify: `packages/cdk/package.json` (add `@aws-sdk/client-codepipeline`)

- [ ] **Step 1: Write failing push-mode tests**

Cover:
- `CodePipeline` with CodeCommit source, default stages (Build + ManualApproval) — assert pipeline structure, stage count, action types, artifact bucket KMS encryption
- `CodePipeline` with custom stages — assert user stages are wired
- `CodePipeline` without `autoReview` — no reviewer Lambda, no router, no state table, no Bedrock IAM
- `CodePipeline` with `autoReview` but `onPullRequest: false` — assert reviewer + router + state table + PR EventBridge rules exist, but NO pipeline EventBridge rule, NO `codepipeline:*` grants
- Source action uses standard detection (not `CodeCommitTrigger.NONE`) in push mode
- cdk-nag compliance

- [ ] **Step 2: Run tests to verify RED**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cdk/tests/codepipeline.test.ts
```
Expected: FAIL — construct doesn't exist.

- [ ] **Step 3: Implement `CodePipeline` push mode**

Create `CodePipeline` extending `BasicConstruct`:
- `PipelineSource` union (codecommit/s3/github)
- `PipelineStage` and `PipelineAction` union (5 action types)
- `onPullRequest?: boolean` (default false)
- `autoReview?: AutoReviewConfig`
- Create `Pipeline`, artifact bucket (KMS-encrypted), source action
- When `autoReview` set: create `CodeCommitAutoReviewer` infrastructure (reuse existing construct internally or replicate its creation logic with the pipeline's repository)
- Push mode: standard source detection (no `CodeCommitTrigger.NONE`)
- Map each `PipelineAction` to the correct CDK action class with artifact wiring

Add `@aws-sdk/client-codepipeline` to `packages/cdk/package.json` dependencies.

- [ ] **Step 4: Run tests to verify GREEN**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cdk/tests/codepipeline.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cdk/src/codepipeline.ts packages/cdk/tests/codepipeline.test.ts packages/cdk/index.ts packages/cdk/package.json
git commit -m "feat(cdk): add CodePipeline construct with push mode"
```

## Task 5: `CodePipeline` construct — PR-gated mode

**Files:**
- Modify: `packages/cdk/src/codepipeline.ts`
- Modify: `packages/cdk/tests/codepipeline.test.ts`

- [ ] **Step 1: Write failing PR-gated mode tests**

Cover:
- `onPullRequest: true` without `autoReview` — assert `CodeCommitTrigger.NONE` on source action, no router/reviewer
- `onPullRequest: true` with `autoReview` — assert:
  - `CodeCommitTrigger.NONE` on source action
  - Pipeline EventBridge rule (`onStateChange`) scoped to pipeline ARN
  - `codepipeline:StartPipelineExecution` grant scoped to pipeline ARN
  - `codepipeline:GetPipelineExecution` grant scoped to pipeline ARN
  - `PIPELINE_NAME` environment variable set on router Lambda
  - Router, reviewer, state table, PR EventBridge rules, Bedrock IAM all present
  - cdk-nag compliance

- [ ] **Step 2: Run tests to verify RED**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cdk/tests/codepipeline.test.ts
```
Expected: FAIL — `onPullRequest` not implemented.

- [ ] **Step 3: Implement PR-gated mode**

When `onPullRequest: true`:
- Set `trigger: CodeCommitTrigger.NONE` on CodeCommit source action
- When `autoReview` is also set:
  - Add `PIPELINE_NAME` env var to router
  - Create `pipeline.onStateChange()` EventBridge rule targeting the router
  - Grant router `codepipeline:StartPipelineExecution` and `GetPipelineExecution` on the pipeline ARN
  - The router handler (refactored in Task 3) will compose `PipelineDispatchConfig` with the pipeline transport

- [ ] **Step 4: Run tests to verify GREEN**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cdk/tests/codepipeline.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cdk/src/codepipeline.ts packages/cdk/tests/codepipeline.test.ts
git commit -m "feat(cdk): add CodePipeline PR-gated mode"
```

## Task 6: Add JSDoc to CodePipeline APIs

**Files:**
- Modify: `packages/cdk/src/codepipeline.ts`
- Modify: `packages/cdk/src/reviewer/pipeline-review-common.ts`

- [ ] **Step 1: Add JSDoc**

Add comprehensive JSDoc to:
- `CodePipeline` class — all four combinations, trigger modes, examples
- `CodePipelineProps` — all props with constraints
- `PipelineSource` — three source types
- `PipelineStage`, `PipelineAction` — action types and artifact flow
- `PipelineTransport`, `PipelineMappingStore`, `PrCommentPoster` — runtime interfaces
- `startPipelineForPr`, `handlePipelineExecutionEvent` — params, behavior, no-op mode
- `pipelineMode` on `CodeBuildProjectProps`

- [ ] **Step 2: Run focused tests and Biome**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cdk/tests/codepipeline.test.ts packages/cdk/tests/pipeline-review-common.test.ts
PATH="$PWD/node_modules/.bin:$PATH" bunx biome check packages/cdk/src/codepipeline.ts packages/cdk/src/reviewer/pipeline-review-common.ts
```
Expected: PASS, clean.

- [ ] **Step 3: Commit**

```bash
git add packages/cdk/src/codepipeline.ts packages/cdk/src/reviewer/pipeline-review-common.ts
git commit -m "docs(cdk): add JSDoc to CodePipeline APIs"
```

## Task 7: CLI parser and config

**Files:**
- Create: `packages/cli/src/codepipeline-init/config.ts`
- Create: `packages/cli/src/codepipeline-init/cli.ts`
- Create: `packages/cli/tests/codepipeline-init-cli.test.ts`
- Create: `packages/cli/tests/codepipeline-init-config.test.ts`

- [ ] **Step 1: Write failing parser and config tests**

Cover:
- Parse all flags: `--source`, `--source-name`, `--source-branch`, `--pipeline-stage` (repeatable), `--on-pr`/`--on-pull-request`, `--autoreviewer`/`--no-autoreviewer`, `--model`, `--team`, `--stage`, `--install`/`--no-install`, `--deploy`/`--no-deploy`, `--aws-profile`, `--region`, `--help`
- Non-TTY validation: `--source`, `--source-name`, `--team` required; exactly one auto/install/deploy pair; `--model` with `--autoreviewer`; deploy requires install + profile + region
- `--pipeline-stage` grammar: `codebuild`, `manualApproval`, `lambda:<name>`, `s3Deploy:<bucket>:<key>`, `cloudFormationDeploy:<stack>`
- `--on-pr` is optional boolean (default false)
- Help text includes all flags and non-TTY requirements
- Typed `CodePipelineInitConfigError` aggregating Zod issues

- [ ] **Step 2: Run tests to verify RED**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cli/tests/codepipeline-init-cli.test.ts packages/cli/tests/codepipeline-init-config.test.ts
```
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement parser and config**

Reuse patterns from `codecommit-init/config.ts` and `cli.ts`. Adapt for pipeline-specific flags. `formatCodePipelineInitHelp()` lists all flags.

- [ ] **Step 4: Run tests to verify GREEN**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cli/tests/codepipeline-init-cli.test.ts packages/cli/tests/codepipeline-init-config.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/codepipeline-init/config.ts packages/cli/src/codepipeline-init/cli.ts packages/cli/tests/codepipeline-init-cli.test.ts packages/cli/tests/codepipeline-init-config.test.ts
git commit -m "feat(cli): validate CodePipeline init options"
```

## Task 8: CLI generator and templates

**Files:**
- Create: `packages/cli/templates/codepipeline-init/` — `.gitignore`, `package.json`, `tsconfig.json`, `cdk.json`, `index.ts`, `README.md`, `stacks/codepipeline-stack.ts`, `tests/codepipeline-stack.test.ts`
- Create: `packages/cli/src/codepipeline-init/generator.ts`
- Create: `packages/cli/tests/codepipeline-init-generator.test.ts`

- [ ] **Step 1: Write failing generator tests**

Cover:
- Manifest contains exactly the documented files, no LocalStack/local.dev.ts
- Generated `package.json` uses `@pawl/cdk ^0.1.0` registry semver, no `workspace:`/`file:`/`link:`/`catalog:`
- Generated stack imports only from `@pawl/cdk`
- `--on-pr` renders `onPullRequest: true` in generated stack
- `--autoreviewer` renders `autoReview: { modelId: ... }` in generated stack
- Default stages (Build + ManualApproval) when `--pipeline-stage` omitted
- Custom stages from `--pipeline-stage` grammar
- Atomic generation: temp sibling, rename, cleanup on failure
- Pre-existing files unchanged

- [ ] **Step 2: Run tests to verify RED**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cli/tests/codepipeline-init-generator.test.ts
```
Expected: FAIL — generator doesn't exist.

- [ ] **Step 3: Implement generator and templates**

Generated stack renders `CodePipeline` with all prop combinations. Standalone tsconfig (no `../../tsconfig.json` extends). `Template` imported from `@pawl/cdk`. Reuse atomic generation pattern from `codecommit-init/generator.ts`.

- [ ] **Step 4: Run tests to verify GREEN**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cli/tests/codepipeline-init-generator.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/templates/codepipeline-init packages/cli/src/codepipeline-init/generator.ts packages/cli/tests/codepipeline-init-generator.test.ts
git commit -m "feat(cli): generate CodePipeline projects"
```

## Task 9: CLI prompts and orchestration

**Files:**
- Create: `packages/cli/src/codepipeline-init/prompts.ts`
- Create: `packages/cli/src/codepipeline-init/index.ts`
- Create: `packages/cli/tests/codepipeline-init-prompts.test.ts`
- Create: `packages/cli/tests/codepipeline-init-orchestration.test.ts`

- [ ] **Step 1: Write failing prompt and orchestration tests**

Cover:
- TTY prompt order: source type → source name → branch → pipeline stages (repeatable) → team → stage → auto-review → model → confirm → install → deploy → profile → region
- `--on-pr` prompt: "Trigger pipeline on pull requests instead of branch pushes?"
- Non-TTY: no prompts, all required flags
- Orchestration: parse → prompt/validate → layout → generate → optional install → optional deploy
- Reuses `layout.ts` and `deploy.ts` from `codecommit-init/`

- [ ] **Step 2: Run tests to verify RED**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cli/tests/codepipeline-init-prompts.test.ts packages/cli/tests/codepipeline-init-orchestration.test.ts
```
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement prompts and orchestration**

Reuse two-phase TTY pattern from `codecommit-init/`. Adapt prompts for pipeline-specific choices. `runCodePipelineInit()` orchestrates the full pipeline.

- [ ] **Step 4: Run tests to verify GREEN**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cli/tests/codepipeline-init-prompts.test.ts packages/cli/tests/codepipeline-init-orchestration.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/codepipeline-init/prompts.ts packages/cli/src/codepipeline-init/index.ts packages/cli/tests/codepipeline-init-prompts.test.ts packages/cli/tests/codepipeline-init-orchestration.test.ts
git commit -m "feat(cli): orchestrate CodePipeline initialization"
```

## Task 10: CLI dispatch and documentation

**Files:**
- Modify: `packages/cli/index.ts`
- Modify: `packages/cli/README.md`
- Create: `packages/cli/tests/codepipeline-init-entrypoint.test.ts`

- [ ] **Step 1: Write failing dispatch test**

Assert `pawl init codepipeline` calls `runCodePipelineInit` with args after the subcommand. Generic `pawl init` and `pawl init codecommit` still work.

- [ ] **Step 2: Run tests to verify RED**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cli/tests/codepipeline-init-entrypoint.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement dispatch and documentation**

Add `init codepipeline` branch in `packages/cli/index.ts` before generic `init`. Add README section with examples, flags, `--on-pr` explanation, and non-TTY requirements.

- [ ] **Step 4: Run tests to verify GREEN**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cli/tests/codepipeline-init-entrypoint.test.ts packages/cli/tests/scaffold-cli.test.ts packages/cli/tests/codecommit-init-entrypoint.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/index.ts packages/cli/README.md packages/cli/tests/codepipeline-init-entrypoint.test.ts
git commit -m "feat(cli): dispatch CodePipeline init subcommand"
```

## Task 11: End-to-end verification

- [ ] **Step 1: Run all CDK tests**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cdk/tests/
```
Expected: All pass except pre-existing Docker-dependent integration tests.

- [ ] **Step 2: Run all CLI tests**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cli/tests/codepipeline-init-*.test.ts packages/cli/tests/codecommit-init-*.test.ts packages/cli/tests/scaffold-*.test.ts
```
Expected: All pass.

- [ ] **Step 3: Run Biome on all new files**

```bash
PATH="$PWD/node_modules/.bin:$PATH" bunx biome check packages/cdk/src/codepipeline.ts packages/cdk/src/reviewer/pipeline-review-common.ts packages/cli/src/codepipeline-init/ packages/cli/tests/codepipeline-init-*.test.ts
```
Expected: Clean.

- [ ] **Step 4: Verify generated projects**

Generate both push+review and PR+review projects in temp directories. Install packed `@pawl/cdk` tarball. Assert `package.json` unchanged after install. Run `bunx tsc --noEmit` and `bunx cdk synth` in each.

- [ ] **Step 5: Inspect final diff**

```bash
git diff --check
git status --short
```
Confirm: no `cdk.out/` changes, no new monorepo dependency beyond `@aws-sdk/client-codepipeline`, no raw `aws-cdk-lib` in generated consumer code.

- [ ] **Step 6: Request final code review**

Use @superpowers:requesting-code-review against the specification and this plan.
