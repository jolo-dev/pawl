# Branch Consolidation and CodePipeline Validation Design

## Goal

Consolidate viable Pawl development into `main` without reintroducing obsolete or intentionally broken code, then validate the durable-review CodePipeline bridge against the existing real-AWS example deployment using the `jolo` profile.

## Safety boundaries

- Preserve the uncommitted outer-repository edits in `AGENTS.md` and `packages/cdk/tests/codepipeline.test.ts`.
- Do not merge stale checkpoint branches, deliberate evil-test branches, or branches already contained by `main`.
- Do not persist or expose CodePipeline artifact credentials, raw job events, prompts, diffs, comments, or model output.
- Use an isolated worktree for deployment so the nested example repository's current `pr-test-evil` branch and uncommitted infrastructure edits remain recoverable.
- Review `cdk diff` before deploying and deploy only `CodePipelineReviewerStack`.
- Use AWS profile `jolo` in `eu-central-1`.

## Branch classification and consolidation

The outer repository currently has four classes of branches:

1. **Already incorporated:** `example/ci-test`, `feat/cli-harness-extraction`, `feat/codecommit-construct`, and `emdash/building-library-57o` are ancestors of `main`. They require no merge. Their clean worktrees and local branch references may be removed after verification.
2. **Superseded:** `chore/packages` is 111 commits behind `main`, overlaps nearly every changed file, and has only three untouched `.pi/prompts/*` files. The divergent `entire/*` branches are historical checkpoint/session snapshots with large deletions. These branches must not be merged.
3. **Intentionally broken:** `pr-test-evil` and remote evil-test branches exist to exercise review/build failures. They must not be merged into Pawl `main`.
4. **Operational branch:** `ops/consolidate-validate` contains only this audit/validation documentation and any narrowly required validation fixes. It is merged only after its tests pass.

Before deleting any worktree or branch, verify that its worktree is clean and that the branch classification still holds. Remote branches are not deleted without a separate explicit request.

## Example deployment isolation

`example/durable-lambda-reviewer` is a nested Git repository whose `origin` is the existing CodeCommit repository `codepipeline-autoreviewer-demo`. Its working tree is currently on `pr-test-evil` with two uncommitted infrastructure edits. Validation uses a temporary nested-repository worktree based on its clean `main`, not the broken PR branch.

Create the deployment worktree outside the outer repository at `/Users/jolo/Development/worktrees/durable-lambda-reviewer-deploy`. This avoids changing either Git index and prevents the deployment source archive from recursively including a worktree. Reuse the example's installed dependencies through a temporary `node_modules` symlink; its existing `@pawl/cdk` link resolves to the consolidated outer workspace. Do not regenerate or commit a lockfile in the deployment worktree.

The deployment worktree receives only the intended infrastructure configuration:

- pass `repositoryName` with the CodeCommit source;
- use the currently selected `eu.amazon.nova-2-lite-v1:0` reviewer model context;
- consume `@pawl/cdk` from the consolidated outer workspace.

No `evil.ts` source is introduced into the deployment worktree's `main` snapshot. The existing open PR remains the deliberate failure fixture.

## Pre-deployment validation

Run, in order:

1. focused Pawl Lambda/CDK tests and package builds;
2. example construct/unit tests relevant to `CodePipelineReviewerStack`;
3. CDK synth for `CodePipelineReviewerStack`;
4. `AWS_PROFILE=jolo` CDK diff against the deployed stack.

The diff must show the expected bridge architecture: six V2 pipeline variables, ordinary bridge Lambda action, bridge and reconciler functions, DynamoDB GSIs, one-minute reconciliation rule, environment variables, and callback IAM. Unexpected replacements, repository deletion, or unrelated stack changes stop deployment for review.

## Deployment and real-AWS validation

Deploy only `CodePipelineReviewerStack` with profile `jolo` and no interactive approval after the diff is accepted. After CloudFormation reaches `UPDATE_COMPLETE`, verify through AWS APIs that:

- the pipeline is V2 and declares all six Pawl variables;
- `AIReview` invokes the ordinary bridge function by function name, not a durable ARN or `$LATEST`;
- sanitized user parameters contain only execution and Pawl variable references;
- bridge and reconciler Lambdas, DynamoDB GSIs, and the static EventBridge rule exist;
- IAM allows the reconciler's bounded CodePipeline callbacks.

Trigger the existing open PR #49 by pushing an empty commit to `pr-test-evil`. This creates a new source revision without changing the deliberate failing fixture. Observe the lifecycle until terminal or until a documented bounded timeout:

1. router refetches authoritative PR state;
2. pipeline starts with the exact new source revision and sanitized variables;
3. bridge persists only normalized metadata;
4. durable reviewer records an immutable outcome;
5. reconciler performs the delayed idempotent callback;
6. `AIReview` reaches a terminal state independently of the deliberately failing Build action.

The overall pipeline is expected to fail because `src/evil.ts` intentionally contains TypeScript errors. That failure is acceptable only if `AIReview` itself no longer fails with the invalid-function-name configuration error and follows the designed outcome policy.

## Failure handling

- If tests, synth, or diff fail, diagnose before deployment.
- If deployment fails, capture CloudFormation events and leave the existing stack recoverable; do not destroy it.
- If the pipeline starts at the wrong revision or contains unsafe parameters, stop validation and fix the transport/wiring.
- If callback reconciliation remains pending beyond the configured deadline, inspect normalized DynamoDB state and metadata-only logs without exposing protected content.
- Preserve all pre-existing local changes and report every branch retained, removed, or skipped with the reason.

## Completion criteria

- No broken or superseded branch is merged.
- Clean worktrees for already-incorporated branches are removed.
- Pawl `main` contains all viable work and passes the focused feature suites/builds.
- `CodePipelineReviewerStack` deploys successfully with the bridge architecture.
- A real PR execution proves exact-revision start and delayed `AIReview` callback behavior, or any residual AWS issue is documented with concrete evidence.
