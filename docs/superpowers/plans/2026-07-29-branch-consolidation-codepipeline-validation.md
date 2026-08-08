# Branch Consolidation and CodePipeline Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate viable Pawl branches into `main`, clean already-merged worktrees, deploy the CodePipeline durable-review bridge to the existing AWS example stack, and prove the real callback lifecycle with PR #49.

**Architecture:** Treat `main` as canonical and classify branches by ancestry, divergence, and intent before changing references. Validate and deploy the committed outer-repository copy at `/Users/jolo/Development/pawl/.worktrees/consolidate-validate/example/durable-lambda-reviewer`, which has no nested Git repository and already uses the current fluent API through the workspace, then trigger the existing deliberately broken PR and inspect only normalized AWS metadata to prove exact-revision start and delayed reconciliation.

**Tech Stack:** Git worktrees, Bun, TypeScript, AWS CDK, `@pawl/cdk`, AWS CLI v2, CodeCommit, CodePipeline V2, Lambda, DynamoDB, EventBridge, CloudFormation.

---

## File map

- `docs/superpowers/specs/2026-07-29-branch-consolidation-codepipeline-validation-design.md` — approved safety and validation design.
- `docs/superpowers/plans/2026-07-29-branch-consolidation-codepipeline-validation.md` — executable checklist and evidence requirements.
- `example/durable-lambda-reviewer/` — committed outer-repository deployment source; deploy unchanged using the CDK model context override.
- `packages/cdk/src/codepipeline.ts` and `packages/cdk/src/codecommit-auto-reviewer.ts` — bridge infrastructure under validation; modify only if a verified defect is found.
- `packages/cdk/tests/codepipeline-bridge.test.ts` and related bridge tests — regression coverage if a real defect requires a fix.

## Task 1: Revalidate and classify every branch/worktree

- [ ] **Step 1: Capture protected local state**

Run:

```bash
cd /Users/jolo/Development/pawl
git status --short
git stash list
git worktree list --porcelain
```

Expected: `AGENTS.md`, `example/durable-lambda-reviewer/README.md`, `example/durable-lambda-reviewer/stacks/pipeline-stack.ts`, `example/durable-lambda-reviewer/tests/constructs/pipeline-stack.test.ts`, and the user-owned legacy `packages/cdk/tests/codepipeline.test.ts` remain modified; `.pi-subagents/` and `.serena/` remain untracked. Do not stash, commit, delete, or otherwise alter these paths.

- [ ] **Step 2: Prove incorporated branches are ancestors**

Run:

```bash
for branch in feat/cli-harness-extraction feat/codecommit-construct; do
  git merge-base --is-ancestor "$branch" main
  echo "$branch=$?"
done
git merge-base --is-ancestor origin/emdash/building-library-57o main
echo "origin/emdash/building-library-57o=$?"
```

Expected: every result is `0`. The local `example/ci-test` and `emdash/building-library-57o` refs are already absent. `/Users/jolo/Development/pawl/.worktrees/example-ci` is an independent nested repository with its own `.git` directory, not an outer Git worktree and not listed by the outer `git worktree list`; verify its HEAD separately. Retain all remote refs.

- [ ] **Step 3: Prove remaining divergent branches are excluded**

Inspect unique commits and diff sizes for `chore/packages`, `entire/3062434-e3b0c4`, `entire/checkpoints/v1`, and `pr-test-evil`. Confirm:

- `chore/packages` is an obsolete open-source/readme snapshot whose changes overlap the newer main implementation;
- `entire/*` are checkpoint/session snapshots with destructive deletions;
- `pr-test-evil` contains deliberate test failures.

Expected: none qualifies for merge. Record the reason in the final report; retain these local/remote refs unless the user separately requests deletion.

- [ ] **Step 4: Verify independent nested repository state**

Run in the independent `example-ci` repository:

```bash
cd /Users/jolo/Development/pawl/.worktrees/example-ci
git status --short
test -d .git
example_ci_head=$(git rev-parse HEAD)
git -C /Users/jolo/Development/pawl merge-base --is-ancestor "$example_ci_head" main
if git -C /Users/jolo/Development/pawl worktree list --porcelain | grep -F -- '/Users/jolo/Development/pawl/.worktrees/example-ci'; then
  echo "example-ci must not appear in the outer worktree list" >&2
  exit 1
fi
```

Expected: `git status --short` has no output, `.git` is a directory, the independent repository HEAD is an ancestor of outer `main`, and the outer worktree list does not contain this path. Explicitly retain this independent repository unless separately authorized to remove it. `/Users/jolo/Development/worktrees/building-library-57o` is already absent; do not clean-check it.

## Task 2: Establish the consolidated Pawl baseline

- [ ] **Step 1: Run the bridge-focused suite from the clean operational worktree**

Run from the clean `ops/consolidate-validate` worktree, which is the committed baseline under validation—not from the dirty, moving outer `main` worktree:

```bash
cd /Users/jolo/Development/pawl/.worktrees/consolidate-validate
bun test \
  packages/lambda/tests/codepipeline-handler.test.ts \
  packages/cdk/tests/codepipeline-bridge.test.ts \
  packages/cdk/tests/codepipeline-transport.test.ts \
  packages/cdk/tests/dynamodb-table.test.ts \
  packages/cdk/tests/pipeline-review-common.test.ts \
  packages/cdk/tests/pipeline-coordination-store.test.ts \
  packages/cdk/tests/pipeline-bridge.test.ts \
  packages/cdk/tests/pipeline-reconciler.test.ts \
  packages/cdk/tests/pipeline-reconciler-handler.test.ts \
  packages/cdk/tests/pipeline-review-dispatcher.test.ts \
  packages/cdk/tests/reviewer/unit/handlers/router.test.ts \
  packages/cdk/tests/reviewer/unit/workflows/reviewer-workflow.test.ts \
  packages/cdk/tests/codepipeline.test.ts \
  packages/cdk/tests/codebuild-project.test.ts
```

Expected: 239 passing, 0 failing. The outer `main` worktree's user-owned, uncommitted legacy `packages/cdk/tests/codepipeline.test.ts` is excluded from baseline evidence and must remain untouched. It currently fails against the committed fluent API; that failure is not a bridge regression.

- [ ] **Step 2: Build affected packages**

Continue in `/Users/jolo/Development/pawl/.worktrees/consolidate-validate` and run:

```bash
bun run --filter '@pawl/lambda' build
bun run --filter '@pawl/cdk' build
```

Expected: both pass.

- [ ] **Step 3: Stop on regression**

If either step fails, use `superpowers:systematic-debugging`. Add or update a focused failing test before modifying production code, then commit the minimal fix on `ops/consolidate-validate`.

## Task 3: Prepare the committed outer-repository deployment source

- [ ] **Step 1: Remove and verify absence of the obsolete external deployment worktree**

The external nested deployment worktree is obsolete and must be absent before any deployment preparation or validation. Remove it through the original nested repository, then verify both its absence and the protected original state:

```bash
cd /Users/jolo/Development/pawl/example/durable-lambda-reviewer
git worktree remove --force /Users/jolo/Development/worktrees/durable-lambda-reviewer-deploy
test ! -e /Users/jolo/Development/worktrees/durable-lambda-reviewer-deploy
git branch --show-current
git status --short
git worktree list --porcelain
```

Expected: the external path is absent and no longer appears in the nested repository worktree list; the original remains on `pr-test-evil` with its pre-existing dirty `cdk.json` and `stacks/pipeline-stack.ts` unchanged. Record that the obsolete deployment worktree is absent. Stop if removal would alter the protected original state.

- [ ] **Step 2: Verify deployment isolation and workspace dependency**

Run:

```bash
cd /Users/jolo/Development/pawl/.worktrees/consolidate-validate/example/durable-lambda-reviewer
test ! -e .git
node -e 'const packageJson = require("./package.json"); const pawlCdk = packageJson.dependencies?.["@pawl/cdk"] ?? packageJson.devDependencies?.["@pawl/cdk"]; if (pawlCdk !== "workspace:*") process.exit(1)'
git -C /Users/jolo/Development/pawl/.worktrees/consolidate-validate status --short -- example/durable-lambda-reviewer
```

Expected: `.git` is absent, `@pawl/cdk` is the `workspace:*` dependency resolved by the outer workspace, and the committed deployment source has no local edits. Do not enter or edit the original nested repository for deployment.

- [ ] **Step 3: Run focused tests**

Run:

```bash
bun test tests/constructs/pipeline-stack.test.ts tests/unit/scaffold-baseline.test.ts
test ! -e .git
```

Expected: focused tests pass. Do not create a symlink, a nested worktree, or any deployment-source edit.

- [ ] **Step 4: Confirm the fluent deployment API is already committed**

Inspect the deployment source and the synthesized configuration without editing it. The CodePipeline source must use the current fluent API already committed in this worktree. Supply `-c reviewerModelId=eu.amazon.nova-2-lite-v1:0` explicitly in synth, diff, and deploy commands as a redundant safety override: `cdk.json` already commits that same value, and the override must not edit `cdk.json`. Do not modify `pipeline-stack.ts`, a lockfile, or `.gitignore`.

## Task 4: Validate the example before deployment

- [ ] **Step 1: Run focused example tests**

Run from `/Users/jolo/Development/pawl/.worktrees/consolidate-validate/example/durable-lambda-reviewer`:

```bash
bun test tests/constructs/pipeline-stack.test.ts tests/unit/scaffold-baseline.test.ts
```

Expected: functional synthesis assertions pass. If stale repository-name or CDK Nag assertions fail while synth succeeds, classify them explicitly; do not suppress a new compliance finding without confirming whether it predates the bridge change.

- [ ] **Step 2: Synthesize only the target stack**

Run:

```bash
AWS_PROFILE=jolo bunx cdk synth CodePipelineReviewerStack \
  -c reviewerModelId=eu.amazon.nova-2-lite-v1:0
```

Expected: successful synth; template contains bridge/reconciler Lambdas, two table GSIs, one-minute rule, and six pipeline variables.

- [ ] **Step 3: Inspect the generated CodeCommit source asset**

The synthesized CodeCommit source asset is the `cdk.out/codecommit-source-*.zip` archive (not a pruned source-tree listing). Inspect that actual archive after synth:

```bash
source_asset=$(/usr/bin/find cdk.out -maxdepth 1 -type f -name 'codecommit-source-*.zip' -print -quit)
test -n "$source_asset"
unzip -Z1 "$source_asset" | tee /tmp/durable-lambda-reviewer-codecommit-source-asset-files.txt
if grep -E '(^|/)(\.git|node_modules|cdk\.out)(/|$)' /tmp/durable-lambda-reviewer-codecommit-source-asset-files.txt; then
  echo "generated CodeCommit source asset contains an excluded path" >&2
  exit 1
fi
```

Expected: the archive exists and its retained file list contains no nested `.git/`, `node_modules/`, or `cdk.out/` paths. Retain the list as validation evidence. Stop before diff or deploy if an excluded path is found.

- [ ] **Step 4: Run and save the real AWS diff**

Run:

```bash
AWS_PROFILE=jolo bunx cdk diff CodePipelineReviewerStack --profile jolo \
  -c reviewerModelId=eu.amazon.nova-2-lite-v1:0
```

Expected additions/updates:

- ordinary bridge Lambda and reconciler Lambda;
- static one-minute EventBridge reconciliation rule;
- GSI1 and GSI2 on the existing state table;
- six CodePipeline V2 variables;
- `AIReview` function name changed from durable `$LATEST` ARN to the bridge function name;
- normalized user parameters;
- router/reviewer/bridge/reconciler invoke and callback IAM.

Stop if the diff deletes the repository, replaces the state table, destroys retained data, changes another stack, or contains unrelated infrastructure.

## Task 5: Deploy the bridge stack

- [ ] **Step 1: Confirm AWS identity and current stack health**

Run:

```bash
aws sts get-caller-identity --profile jolo
aws cloudformation describe-stacks \
  --profile jolo --region eu-central-1 \
  --stack-name CodePipelineReviewerStack \
  --query 'Stacks[0].StackStatus' --output text
```

Expected account: `246350246460`; stack status: `UPDATE_COMPLETE`.

- [ ] **Step 2: Deploy only the target stack**

Run:

```bash
AWS_PROFILE=jolo bunx cdk deploy CodePipelineReviewerStack \
  --profile jolo \
  --require-approval never \
  -c reviewerModelId=eu.amazon.nova-2-lite-v1:0
```

Expected: CloudFormation reaches `UPDATE_COMPLETE`. Do not run `deploy --all` or destroy any stack.

- [ ] **Step 3: Capture deployment failure evidence if needed**

On failure, run:

```bash
aws cloudformation describe-stack-events \
  --profile jolo --region eu-central-1 \
  --stack-name CodePipelineReviewerStack \
  --max-items 30
```

Do not retry until the root cause is identified.

## Task 6: Verify deployed static architecture

- [ ] **Step 1: Resolve the physical pipeline name**

Read `Pipeline9850B417` from `list-stack-resources`; do not hardcode the previous physical suffix.

- [ ] **Step 2: Verify pipeline configuration**

Use `aws codepipeline get-pipeline` and inspect only configuration metadata. Assert:

- pipeline type V2;
- six Pawl variables exist;
- `AIReview.Configuration.FunctionName` is the bridge function name with no `arn:` and no `$LATEST`;
- `UserParameters` contains only execution ID and Pawl variable references.

- [ ] **Step 3: Verify supporting resources**

Use CloudFormation and service APIs to assert:

- bridge and reconciler functions exist;
- DynamoDB table has GSI1 and GSI2 active;
- reconciliation EventBridge rule uses a one-minute rate;
- reconciler role includes `PutJobSuccessResult` and `PutJobFailureResult`.

Do not print Lambda environment secrets or IAM credentials.

## Task 7: Trigger and observe PR #49

- [ ] **Step 1: Record the prior execution set**

List recent pipeline executions and save only IDs, status, source revision, and timestamps.

- [ ] **Step 2: Push an empty validation commit**

From the original nested repository worktree on `pr-test-evil`:

```bash
git commit --allow-empty -m "test: validate CodePipeline review bridge"
git push origin pr-test-evil
```

Expected: a new commit SHA on the existing open PR #49; uncommitted `cdk.json` and `stacks/pipeline-stack.ts` remain untouched.

- [ ] **Step 3: Find the exact-revision execution**

Poll `list-pipeline-executions` with a bounded timeout until an execution appears whose source revision equals the new commit SHA. Record the pipeline execution ID.

Expected: one new execution for the exact PR source revision. Duplicate delivery must not create a distinct logical generation for the same revision.

- [ ] **Step 4: Observe the bridge lifecycle**

Poll action states and normalized coordination metadata until `AIReview` is terminal or the bounded observation window expires. Verify:

- initial bridge registration is pending;
- reviewer outcome is generation/revision matched;
- reconciler callback makes `AIReview` terminal;
- no invalid-function-name configuration error occurs;
- no artifact credentials, prompts, diffs, comments, or model output are printed or stored during validation.

Expected: Build fails because `src/evil.ts` is deliberately invalid. `AIReview` independently succeeds for a reviewed outcome or fails only for a documented operational/blocked/timeout outcome.

- [ ] **Step 5: Verify terminal metadata**

Record only execution/action status, callback category, PR ID, generation, revision, and timestamps. Do not retrieve or print comment bodies or model output.

## Task 8: Cleanup and consolidate the operational branch

- [ ] **Step 1: Retain independent and absent worktree paths**

No already-incorporated outer worktrees remain to remove. `/Users/jolo/Development/worktrees/building-library-57o` is absent. `/Users/jolo/Development/pawl/.worktrees/example-ci` is an independent clean nested repository with its own `.git` directory, not an outer worktree; retain it and do not plan Git worktree removal, branch-ref deletion, or directory deletion unless separately authorized. Retain divergent superseded/broken branches and all remote refs.

- [ ] **Step 2: Commit any verified fixes**

If AWS validation required a Pawl code fix, run focused tests/builds and commit only the code and tests. Do not commit generated `cdk.out`, deployment-worktree edits, `.pi-subagents`, `.serena`, or the preserved local modifications.

- [ ] **Step 3: Merge `ops/consolidate-validate` into outer `main`**

Preserve the dirty outer files with a path-limited stash if necessary, then fast-forward or merge the operational branch. Before restoring the stash, run the bridge-focused suite and package builds against the clean committed `HEAD` and record that result as the post-merge validation. Then restore the exact stash without using restored dirty user files as validation evidence. In particular, leave the user-owned legacy `packages/cdk/tests/codepipeline.test.ts` untouched; its known failure against the committed fluent API must be reported separately from the clean-`HEAD` result and is not a bridge regression.

- [ ] **Step 4: Report final state**

Report:

- branches merged, removed, retained, and skipped with reasons;
- worktrees removed;
- outer `main` and `origin/main` divergence (do not push unless explicitly requested);
- CloudFormation deployment result;
- pipeline execution ID and exact revision;
- Build and `AIReview` terminal states;
- residual risks or follow-up work.
