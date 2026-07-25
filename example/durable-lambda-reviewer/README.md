# durable-lambda-reviewer

Two example stacks demonstrating Pawl's durable auto-review constructs:

1. **`DurableLambdaReviewerStack`** — Event-only review using `CodeCommitAutoReviewer`
2. **`CodePipelineReviewerStack`** — PR-gated CI + AI review using `CodePipeline`

## Stack 1: Event-only review (`CodeCommitAutoReviewer`)

A durable CodeCommit pull-request reviewer built on AWS Lambda Durable
Execution, Pawl CDK constructs, Amazon Bedrock, CodeBuild, and DynamoDB.

```
CodeCommit PR/comment events
        │
        ▼
 EventBridge ──► router Lambda ──► (invoke) ──► durable reviewer Lambda
 (per-repo rules, DLQ)            (claim/dedupe)    │
                                                    ▼
                          ┌─────────────────────────┴──────────────────────┐
                          ▼                  ▼                  ▼            ▼
                     CodeBuild checks   Bedrock review    reconciler    DynamoDB state
                     (per-repo project) (Claude)          (post/update   table (shared)
                                                          comments)
```

- **Router** — normal Lambda; normalizes + deduplicates CodeCommit events,
  claims them per generation, and invokes the durable reviewer.
- **Reviewer** — durable Lambda; loads the PR snapshot + `.pawl/reviewer.json`,
  runs CodeBuild checks, calls Bedrock for review, and reconciles findings
  (post/update comments). Replays are safe: every store mutation is inside a
  durable `step`.
- **Per repository** — one CodeBuild project + one CodeCommit event construct.
- **Shared** — one reviewer, one router, one DynamoDB state table.

## Stack 2: PR-gated CI + AI review (`CodePipeline`)

A CodePipeline CI/CD pipeline with durable auto-review. When a pull request is
opened, the router starts a pipeline execution and invokes the durable
reviewer in parallel. CI build results and AI review comments are posted
independently as they complete.

```
CodeCommit PR event
        │
        ▼
 router Lambda
  ├──► StartPipelineExecution (sourceRevision = PR commit)
  │         │
  │         ▼
  │    CodePipeline (Source → Build → Approve)
  │         │
  │         ▼
  │    Execution State Change ──► router ──► post CI comment on PR
  │
  └──► Invoke durable reviewer ──► Bedrock AI review ──► post review comment
```

- **Pipeline** — `CodePipeline` with `onPullRequest: true` and
  `CodeCommitTrigger.NONE`. The router starts executions explicitly with the
  PR's source commit.
- **Build stage** — `CodeBuildProject` in `pipelineMode` runs the repo's
  `buildspec.yml`.
- **Approve stage** — Manual approval gate before merge.
- **Auto-review** — Same durable reviewer infrastructure as Stack 1, extended
  with pipeline dispatch via the common runtime module.

### Deploy Stack 2

```bash
bunx cdk deploy CodePipelineReviewerStack
```

## Package manager

- bun

## AWS

- Profile: `jolo`

## Quick start

```bash
bun install
bun run deploy        # AWS_PROFILE=jolo bunx cdk deploy --all
```

See [docs/operations/deploy.md](./docs/operations/deploy.md) for context
variables, multi-repo onboarding, and production constraints.

## Testing

### Unit, construct, and security tests (default suite)

```bash
bun test              # unit + construct + synth-security
bunx tsc --noEmit
bunx cdk synth
bun run lint
bun run fmt:check
```

### AWS integration tests (opt-in, live)

These exercise the full pipeline against disposable CodeCommit repositories and
a deployed stack. They are **skipped** unless explicitly enabled.

```bash
RUN_AWS_INTEGRATION=1 \
AWS_PROFILE=jolo \
AWS_REGION=eu-central-1 \
PAWL_TEST_REPO_A=<disposable-repo> \
PAWL_TEST_REPO_B=<disposable-repo-2> \
PAWL_TEST_STACK_NAME=<deployed-stack> \
bun test tests/aws
```

See [tests/aws/integration-harness.ts](./tests/aws/integration-harness.ts) for
the required environment variables.

## Operations

- [Deployment & onboarding](./docs/operations/deploy.md)
- [Alerts & runbooks](./docs/operations/alerts.md)
- [Repository configuration (`.pawl/reviewer.json`)](./docs/operations/repository-config.md)
