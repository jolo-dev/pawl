# Dependency upgrade verification

Updated existing dependency declarations in the root catalog, every `packages/` workspace, examples, and the standalone docs project using npm's `latest` dist-tags. Updated CLI scaffold dependency versions and regenerated `bun.lock` and `docs/bun.lock`. Local `@pawl/*` workspace links are preserved.

## Compatibility exceptions

- TypeScript remains at **6.0.3**, the latest 6.x release. TypeScript 7.0.2 no longer exposes the compiler API expected by current consumers (the initial test run failed reading `ts.ScriptTarget.ESNext`). The docs toolchain also requires that API.
- `cdk-nag` remains at **2.38.2**, the latest 2.x release. Version 3.0.2 removes `NagSuppressions` and replaces Aspect-based checks with policy-validation plugins. A complete compliance and suppression migration is required before adopting it; simply updating the dependency breaks builds and compliance tests.

## Compatibility changes

- Migrated the CLI's Pi model discovery and session services to `ModelRuntime` for `@earendil-works/pi-coding-agent` 1.0.4.
- Resolve the SSO browser opener against the current PATH explicitly; Bun's shell otherwise selected the original executable rather than the isolated test fixture.
- Updated the Biome schema, applied its new formatting, and excluded generated Excalidraw SVG assets from the newly supported SVG linting.
- Corrected an unsafe optional-chain access in a CDK test.
- Updated the transitive Bedrock alpha peer to match the AgentCore alpha version without adding a direct dependency.

## Verification

- Root and docs `bun install --frozen-lockfile`: passed.
- `bun lint`: passed with zero errors (six CSS specificity warnings and one informational diagnostic remain).
- `bun run build`: passed for Lambda, AgentCore, and CDK.
- `bun run --cwd docs build`: passed, generating 183 pages. Generated TypeDoc source changes were restored rather than included in this upgrade.
- Explicit local test run covering `packages/` and `docs/tests/`, excluding directories named `integration`: **1,050 passed, zero failed**, across 93 files, with a 30-second per-test timeout.
- Full test run before the SSO shell fix: 1,090 passed, eight skipped, eight failed. Two SSO failures were subsequently fixed and verified by the local suite. Remaining failures involve missing `LOCALSTACK_AUTH_TOKEN`, a missing CloudWatch log group in the example integration environment, and a Docker fixture without its expected published port. End-to-end verification therefore remains incomplete.
- An additional CLI typecheck using a temporary config to exclude scaffold templates exposed typing errors in CLI prompts/init/tests and CDK source under the CLI's stricter flags. This extra check does not pass; the normal workspace builds above do. It should be addressed separately before advertising the CLI as fully typecheck-clean.

No deployments were performed, credentials were not fetched, and no new direct dependencies were retained.
