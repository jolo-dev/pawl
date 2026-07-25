# durable-lambda-reviewer

A durable CodeCommit pull-request reviewer built on AWS Lambda Durable
Execution, [Pawl](../pawl) CDK constructs, Amazon Bedrock, CodeBuild, and
DynamoDB.

## Architecture

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
