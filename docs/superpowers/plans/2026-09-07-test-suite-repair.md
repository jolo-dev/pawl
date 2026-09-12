# Test Suite Repair Implementation Plan

> **For agentic workers:** Execute inline with systematic debugging and test-driven development; preserve the existing dirty workspace. Do not commit unrelated changes.

**Goal:** Finish repairing the test suite without real AWS profile/browser dependencies or unsupported LocalStack AgentCore operations.

**Architecture:** Use the public `@smithy/core/config` helpers already supplied by the installed AWS SDK, declaring the dependency explicitly in the CLI (user approved). Replace the AgentCore LocalStack deployment test with a bundled fixture running in a Node 22 container and CDK synthesis checks for that same asset. This validates runtime HTTP behavior and infrastructure configuration, not AWS control-plane deployment.

**Tech Stack:** Bun, TypeScript, AWS SDK/Smithy, Docker CLI for Node 22 (existing Testcontainers for LocalStack), @pawl/cdk, @pawl/agentcore, Biome.

## Baseline / completed investigation

- [x] Reproduce and repair stale CDK fixtures and process-environment leaks.
- [x] Restore stale example dependency links and correct outdated infrastructure assertions.
- [x] Exclude unrendered scaffold templates from Bun discovery, not actual test suites.
- [x] Verify supported LocalStack API Gateway, pipeline, and example integrations with the SSM token kept out of logs and repository files.
- [x] Confirm LocalStack 2026.5.0 and 2026.8.1 do not implement the required AgentCore resources/runtime operations.
- [x] Obtain approval for a direct Smithy dependency and Node/Docker plus synthesis replacement.

## CLI credentials

Files: `packages/cli/package.json`, `bun.lock`, `packages/cli/src/aws-credentials.ts`, `packages/cli/index.ts`, `packages/cli/src/codecommit-init/prompts.ts`, `packages/cli/tests/aws-credentials.test.ts`.

- [x] Replace live credential tests with temporary config/cache fixtures, stubbed SDK transports, and a harmless browser-command fixture; restore all state.
- [x] Observe failing imports before migrating them.
- [x] Declare the installed `@smithy/core` version and replace obsolete loader imports, including the missing `parseKnownFiles` import.
- [x] Run credential and scaffold tests; verify exact profile/region results, token expiry, SDK errors, and SSO cache output without real authentication.

## AgentCore replacement

Files: `packages/cdk/tests/integration/agentcore.test.ts` and existing `agentcore/index.ts` fixture.

- [x] Bundle the fixture into an owned temporary directory; keep the unused optional S3 peer external.
- [x] Synthesize @pawl/cdk AgentCore from the same asset and assert Node 22, HTTP, S3 asset configuration, and default endpoint linkage.
- [x] Run the bundle in a Node 22 Docker container without forwarding AWS credentials or LocalStack token.
- [x] Check health, JSON invocation, and error/route behavior over real HTTP; clean up container and temporary files even on failure.

The synthesis test runs cdk-nag with policy-local, exact exceptions for existing upstream CDK runtime/asset grants. The two `Resource: "*"` telemetry statements are separately asserted, including the CloudWatch namespace condition. Production IAM is unchanged.

## Regression gates

File: `.github/workflows/ci.yml`.

- [x] Restore previously excluded fixed tests to CI; keep only actual LocalStack-dependent suites separate and ignore raw templates.
- [x] Run focused tests, relevant type checks, `bun install --frozen-lockfile`, and `bun lint`.
- [x] Run the complete `bun test` suite with Docker and an SSM-fetched LocalStack token; confirm no `undefined/` artifact is recreated.
- [x] Complete independent review of task-owned diffs and address both findings. Profile enumeration now preserves raw SDK section identity, with reserved-looking valid profile fixtures. Docker cleanup starts with the startup attempt, tolerates only absence, and has a real failed-start regression test. Scoped whitespace checks pass; unrelated docs/design changes are preserved.

## Verification evidence

- Full suite: **1,050 pass, 8 skip, 0 fail**; `/tmp/pawl-tests-final-with-localstack.log`.
- CI-equivalent suite: **1,034 pass, 8 skip, 0 fail**; `/tmp/pawl-ci-repaired-isolated.log`.
- Parallel verification attempts timed out; both final gates were rerun separately and passed. A generated fixture left by the interrupted run was preserved outside the repository before the final clean lint check.
- The eight existing live-AWS reviewer tests remain gated; no new test skips were added.
- `bun lint` and `bun install --frozen-lockfile` pass. Lockfile adds only the approved direct Smithy declaration; no resolved package changes.
- Focused TypeScript check of credential implementation and AgentCore integration test passes (`/tmp/pawl-repairs-focused-typecheck.log`). Expanding it through the existing prompt module exposes eight pre-existing diagnostics in unchanged prompt validation/return typing, not introduced by this repair (`/tmp/pawl-credentials-typecheck.log`).
- No running test containers or root `undefined/` output remain. Node/LocalStack assets and stale installation artifacts were cleaned up or preserved outside the repository as appropriate.
