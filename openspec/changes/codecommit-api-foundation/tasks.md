## 1. OpenSpec and workspace setup

- [x] 1.1 Add the `@pawl/codecommit` workspace package manifest, entrypoint, TypeScript configuration, and root path mapping; verify `bun run --filter @pawl/codecommit build` resolves the package.
- [x] 1.2 Add a minimal `@pawl/codecommit` dependency to `@pawl/cli`; verify Bun workspace resolution can import the package without adding a new third-party version.

## 2. Shared application API

- [x] 2.1 Write a failing test for normalized repository-list pagination, then implement the client port, AWS SDK adapter, request schemas, normalized DTOs, and repository-list operation; verify the targeted test passes.
- [x] 2.2 Write a failing test for repository metadata and branch pagination, then implement those service operations; verify the targeted tests pass.
- [x] 2.3 Write a failing test for repository-scoped pull-request discovery, then implement its state-filtered paginated service operation; verify the targeted test passes.
- [x] 2.4 Write failing tests for invalid inputs and mapped authorization errors, then implement validation and typed safe error translation; verify the tests prove no client call occurs for invalid input.

## 3. CLI integration

- [x] 3.1 Write a failing CLI unit test for `pawl codecommit repositories` default output, then add the command parser/renderer backed by `@pawl/codecommit`; verify the test passes with a scripted client.
- [x] 3.2 Write failing CLI tests for pagination forwarding and invalid page-size failure, then implement argument parsing and stderr/non-zero behavior; verify targeted tests pass.
- [x] 3.3 Wire the command into the non-interactive CLI dispatch path; verify the CLI command test uses the shared service rather than a direct AWS SDK command.

## 4. Verification and handoff

- [x] 4.1 Run `openspec validate codecommit-api-foundation --strict` and resolve all validation findings.
- [x] 4.2 Run `bun lint`, `bun test`, and package builds; verify no new failures and record actual results in the change handoff.
- [x] 4.3 Review the final change against issues #3 then #2, marking completed OpenSpec tasks and documenting that the TanStack Start UI remains the next prioritized change.
