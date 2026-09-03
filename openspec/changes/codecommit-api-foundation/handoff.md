# Handoff: CodeCommit API foundation

## Completed

Issue #3 was implemented before issue #2 because the shared, server-safe CodeCommit application API is the dependency for both the CLI and the future TanStack Start UI. The TanStack Start UI remains intentionally out of scope and is the next prioritized change.

## Verification (2026-08-31)

- `openspec validate codecommit-api-foundation --strict` — passed.
- `bun test packages/codecommit/tests packages/cli/tests/codecommit-repositories.test.ts packages/cli/tests/codecommit-repositories-entrypoint.test.ts` — passed: 9 tests, 0 failures, 36 assertions.
- `bun run --filter @pawl/codecommit build` — passed.
- `bunx biome check packages/codecommit packages/cli/index.ts packages/cli/src/codecommit-repositories packages/cli/tests/codecommit-repositories.test.ts packages/cli/tests/codecommit-repositories-entrypoint.test.ts` — passed.
- `bun packages/cli/index.ts codecommit repositories --max-results 0` — correctly wrote `--max-results must be an integer between 1 and 1000.` to stderr and exited 1 without an AWS call.
- `bun install` — passed and saved the workspace lockfile; it reported the existing TypeScript peer-dependency warning.

## Workspace-wide verification limitations

- `bun lint` remains non-zero due to pre-existing template parse/format failures and formatting failures outside this change (118 errors, 26 warnings). The changed CodeCommit/CLI files pass their targeted Biome check.
- `bun test` ran 1,004 passing tests and 8 skipped tests, but had 21 failures and 6 errors outside this change: LocalStack auth/container-runtime is unavailable, and existing CDK/CLI-template tests fail. The new CodeCommit tests passed.
- `bunx tsc -p packages/cli/tsconfig.json --noEmit` remains blocked by pre-existing invalid template TypeScript files under `packages/cli/templates/`. `@pawl/cli` has no `build` script, while the new code is covered by targeted Bun tests and Biome validation.

## Operational limitation

AWS CodeCommit's `ListRepositories` and `ListBranches` commands do not accept `maxResults`. The portable service and CLI retain and validate/forward `maxResults` for the application boundary, but the AWS adapter can only forward it to `ListPullRequests`; it omits it for those two AWS commands. AWS therefore controls the repository-list page size (up to its API default/limit). Continuation tokens remain opaque and are forwarded unchanged.
