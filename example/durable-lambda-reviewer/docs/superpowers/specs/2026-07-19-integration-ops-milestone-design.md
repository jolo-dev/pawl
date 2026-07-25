# AWS Integration Tests & Operations Milestone Design

**Date:** 2026-07-19
**Status:** Draft — pending user approval
**Milestone:** Eighth of the durable reviewer feature implementation (master plan Task 17)

## 1. Purpose

Close out the master plan's verification + operability requirements: (a) opt-in AWS integration tests that exercise the full pipeline against disposable CodeCommit repositories, (b) a synth-based security review that catches IAM/infrastructure regressions without live AWS, and (c) operational docs + README onboarding. After this milestone, the only remaining work is Task 18 (final acceptance/handoff).

## 2. Confirmed decisions

- **Integration tests are opt-in and skip gracefully.** Each `tests/aws/*.integration.test.ts` gates on `RUN_AWS_INTEGRATION=1` + `AWS_PROFILE` + `AWS_REGION` + disposable repository name env vars. Without them, the test **skips** (not fails) with an explicit reason, so `bun test` stays green in CI/local. No live AWS calls ever run in the default suite.
- **Three integration test files** matching the master plan: `codecommit-reviewer.integration.test.ts` (clean PR → finding → duplicate/replay → human comment → fixing commit/resolved → merge/close), `durable-replay.integration.test.ts` (durable replay + callback), `repository-isolation.integration.test.ts` (two-repository isolation). Each registers cleanup in `afterAll`.
- **No local-SDK fakes for integration tests.** These tests use the real AWS SDK against live disposable resources. They are explicitly NOT part of the default `bun test` run. They cannot run in this environment (no disposable repos); their value is the structured scenario scaffolding + cleanup discipline for when an operator runs them with `RUN_AWS_INTEGRATION=1`.
- **Synth-based security test is verifiable now.** `tests/security/synth-security.test.ts` synthesizes the multi-repo stack and asserts: no unapproved wildcard IAM resources (only Pawl-owned `*` for callbacks), no `REPOSITORY_NAME`/secrets in CodeBuild env, DLQ present, alarms present, no public CodeBuild subnets (public-test is non-prod only), approved-registry package access only, encrypted state table. This runs in the default suite.
- **Operational docs are prose + examples**, not generated. `deploy.md` (deploy/remove/rollback, context vars, multi-repo config), `alerts.md` (alarms Pawl emits, DLQ replay, execution stop, replay/callback failures), `repository-config.md` (`.pawl/reviewer.json` schema, safe-defaults behavior, onboarding steps, model allowlist note).
- **README** gains an architecture overview, quick start (deploy), testing section (unit vs integration), and a link to `docs/operations/`.
- **No Pawl changes, no new application runtime code, no IAM changes.** This milestone is tests + docs only.

## 3. Scope

### 3.1 In scope

- `tests/aws/codecommit-reviewer.integration.test.ts` (opt-in, skip-able)
- `tests/aws/durable-replay.integration.test.ts` (opt-in, skip-able)
- `tests/aws/repository-isolation.integration.test.ts` (opt-in, skip-able)
- `tests/security/synth-security.test.ts` (synth-based, runs in default suite)
- `docs/operations/deploy.md`, `docs/operations/alerts.md`, `docs/operations/repository-config.md`
- `README.md` update

### 3.2 Out of scope

- Live execution of the integration tests (requires disposable AWS resources; operator-run), GitHub adapter, per-repo model allowlist enforcement, final handoff (Task 18).

## 4. Integration test design

### 4.1 Skip guard (shared)

```ts
const ENABLED = process.env.RUN_AWS_INTEGRATION === "1";
const PROFILE = process.env.AWS_PROFILE;
const REGION = process.env.AWS_REGION;
const REPO_A = process.env.PAWL_TEST_REPO_A; // disposable repo name
const REPO_B = process.env.PAWL_TEST_REPO_B;

function integrationDescribe(name: string, fn: () => void) {
  if (!ENABLED || !PROFILE || !REGION || !REPO_A) {
    describe.skip(name, fn); // explicit skip
    return;
  }
  describe(name, fn);
}
```

`afterAll` always registers cleanup (idempotent delete of test PRs/branches/repos) so a partially-run suite does not leak.

### 4.2 Scenarios

**`codecommit-reviewer.integration.test.ts`:**

1. Create a clean PR → assert the reviewer posts findings (or a no-findings pass) and never posts a success comment.
2. Duplicate event delivery → assert idempotent (no double-post).
3. Human comment context → assert the review incorporates it.
4. Fixing commit → assert resolved findings update the existing comment (not a new one).
5. Merge/close → assert the execution terminates cleanly.

**`durable-replay.integration.test.ts`:**

1. Force a durable replay mid-cycle → assert the store is not double-written and the review completes.
2. Callback wake → assert the reviewer resumes on the next event.

**`repository-isolation.integration.test.ts`:**

1. Two repos (`REPO_A`, `REPO_B`) → assert events for repo A do not touch repo B's state and vice versa.

Each uses the real `CodeCommitClient`/`LambdaClient`/DynamoDB against the deployed stack (stack name from `PAWL_TEST_STACK_NAME`).

## 5. Synth security test design

Synthesize with `repositories: ["repo-a", "repo-b"]`. Assert:

- **No unapproved wildcards:** every `Resource: "*"` IAM statement is a Pawl-owned callback/durable-execution grant (whitelist by action: `lambda:SendDurableExecutionCallbackSuccess`); no `codebuild:*`, `codecommit:*`, `dynamodb:*`, `logs:*` wildcards.
- **CodeBuild env has no secrets:** the buildspec/env contains no AWS credentials, only `PAWL_*` non-secret vars; `REPOSITORY_NAME` is absent.
- **DLQ present:** ≥1 `AWS::SQS::Queue` referenced by every `AWS::Events::Rule` target.
- **Alarms present:** ≥1 `AWS::CloudWatch::Alarm`; a `AWS::CloudWatch::Dashboard` exists.
- **No public CodeBuild subnets in prod:** with `stage: "prod"`, `public-test` network policy must fail synthesis (assert throws).
- **Approved-registry only:** CodeBuild project env has `PAWL_PACKAGE_ACCESS_MODE` / `PAWL_APPROVED_REGISTRY_ENDPOINT`.
- **Encrypted state table:** DynamoDB PITR enabled (already asserted by construct test; re-assert here as a security gate).

## 6. Operational docs

### 6.1 `docs/operations/deploy.md`

- Prerequisites (AWS profile, region, Docker for NodejsFunction bundling).
- Context variables (`team`, `stage`, `repositories`, `reviewerModelId`, `reviewerCodeBuildRegistryEndpoint`, `reviewerExecutionTimeoutSeconds`, `reviewerRetentionDays`, `botArnPatterns`).
- `bun run deploy` / `bun run remove`; rollback via CloudFormation.
- Multi-repo onboarding: add repo to `repositories`, redeploy.
- Prod constraints: private network policy (not `public-test`); set `stage: prod`.

### 6.2 `docs/operations/alerts.md`

- Alarms Pawl emits: CodeBuild failed builds, SQS DLQ depth, DynamoDB throttling.
- DLQ replay procedure (read messages, re-post to EventBridge).
- Durable execution stop procedure (`UpdateDurableExecution`/Lambda console).
- Replay/callback failure symptoms + runbook.

### 6.3 `docs/operations/repository-config.md`

- `.pawl/reviewer.json` schema (`version`, `checks`, `install`, `review` limits).
- Safe-defaults behavior (absent/malformed → defaults + warn).
- Read at destination commit (a PR cannot weaken its own policy).
- Onboarding steps: create the file at the mainline commit, push.
- Model allowlist note: deferred — model ID comes from stack env, not config.

### 6.4 `README.md`

- Architecture overview (router → durable reviewer → CodeBuild/Bedrock/reconciler → state table).
- Quick start (deploy).
- Testing: `bun test` (unit/construct/security), `RUN_AWS_INTEGRATION=1 bun test tests/aws` (live).
- Link to `docs/operations/`.

## 7. Acceptance criteria

1. Three `tests/aws/*.integration.test.ts` files exist, skip with an explicit reason when `RUN_AWS_INTEGRATION≠1`, and register cleanup in `afterAll`.
2. `tests/security/synth-security.test.ts` runs in the default suite and asserts the §5 security properties.
3. `docs/operations/deploy.md`, `alerts.md`, `repository-config.md` exist and cover the master plan's documented topics.
4. `README.md` updated with architecture, quick start, testing, and ops link.
5. Default `bun test` stays green (integration tests skip); `cdk synth` clean; tsc clean; no Pawl changes; no live AWS in the default suite.

## 8. Decisions (approved by user — use judgment on all 4)

1. **Integration tests skip (not fail) without the env var** — keeps the default suite green. Adopted.
2. **Synth-based security test runs in the default suite** — verifiable now, catches regressions. Adopted.
3. **Docs are prose + examples** (not generated from code). Adopted.
4. **No live integration test execution in this milestone** — operator-run with disposable repos; scaffolding + cleanup only. Adopted.
