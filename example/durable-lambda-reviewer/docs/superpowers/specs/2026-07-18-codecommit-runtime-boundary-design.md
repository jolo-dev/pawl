# CodeCommit Runtime Boundary Design

**Date:** 2026-07-18  
**Status:** User-approved design; pending written-spec review

## 1. Purpose

Remove the dedicated `@pawl/codecommit` runtime package. Keep reusable CodeCommit infrastructure in Pawl's existing `@pawl/cdk` `CodeCommitReviewEvents` construct, while moving CodeCommit SDK execution and validation into the durable reviewer application that consumes it.

This change also removes the durable reviewer's workspace dependency on `../pawl/packages/codecommit`, allowing the application to depend only on Pawl packages that provide reusable CDK, CLI, and Lambda abstractions.

## 2. Confirmed decisions

- `durable-lambda-reviewer` owns its CodeCommit runtime adapter and raw AWS SDK calls.
- `@pawl/cdk` owns reusable deployment-time CodeCommit infrastructure.
- The existing `CodeCommitReviewEvents` construct remains the Pawl abstraction for EventBridge routing, the dead-letter queue, monitoring, and repository-scoped IAM grants.
- `@pawl/codecommit` is deleted rather than moved into `@pawl/cdk`.
- Runtime code does not import `@pawl/cdk`.
- CDK code does not export or bundle a runtime CodeCommit client.
- The application stack is not wired in this change because the router Lambda has not been assembled yet.
- Existing runtime behavior and provider-neutral application interfaces remain unchanged.

## 3. Scope

### 3.1 In scope

- Add an app-local CodeCommit runtime client and app-owned DTOs.
- Preserve CodeCommit request validation, response validation, pagination limits, repeated-token detection, binary-file detection, immutable revision use, and comment behavior.
- Preserve dependency injection for deterministic AWS command contract tests.
- Update `CodeCommitProvider` to use the local client.
- Move the runtime client's contract tests and fixtures from Pawl into the app.
- Replace the app's `@pawl/codecommit` dependency with `@aws-sdk/client-codecommit`.
- Delete `packages/codecommit/**` from the paired Pawl worktree.
- Remove Pawl aliases and lockfile entries that exist only for `@pawl/codecommit`.
- Update the durable reviewer design and implementation documentation so it no longer requires a Pawl runtime package.
- Verify the existing Pawl CDK construct remains exported, tested, and compliant.

### 3.2 Out of scope

- Changing the provider-neutral `SourceControlProvider` interface.
- Changing finding formatting, hunk construction, fingerprints, or comment-resolution policy.
- Adding new CodeCommit API behavior.
- Changing `CodeCommitReviewEvents` behavior or its public API.
- Instantiating `CodeCommitReviewEvents` in the currently empty application stack.
- Adding a runtime client to `@pawl/cdk`.
- Refactoring unrelated Pawl packages or durable-reviewer components.

## 4. Architecture

### 4.1 Deployment-time boundary

`@pawl/cdk` continues to expose `CodeCommitReviewEvents`. The construct:

- imports a configured CodeCommit repository;
- creates native pull-request and comment EventBridge rules;
- optionally creates the CloudTrail comment fallback;
- targets the Pawl router Lambda;
- supplies a retained, encrypted dead-letter queue and monitoring;
- grants repository-scoped read, comment, and configuration permissions.

The construct remains infrastructure-only. No AWS SDK runtime transport, response schema, or runtime DTO is added to the CDK package.

### 4.2 Runtime boundary

The durable reviewer owns two focused app-local units:

- `src/adapters/codecommit-review-client.ts` owns AWS SDK command construction, external input/output validation, pagination, file decoding, and transport injection.
- `src/adapters/codecommit-review-types.ts` owns the client transport interface and CodeCommit-specific DTOs used between the client and `CodeCommitProvider`.

`src/adapters/codecommit-provider.ts` continues to own application mapping:

- translating CodeCommit snapshots into provider-neutral review requests;
- loading file contents and constructing hunks;
- mapping provider comments;
- formatting findings;
- generating idempotency and finding identifiers;
- validating inline locations;
- resolving existing comments.

This preserves the existing dependency direction:

```text
application services
  -> SourceControlProvider
  -> CodeCommitProvider
  -> app-local CodeCommitReviewClient
  -> @aws-sdk/client-codecommit
```

Deployment code separately depends on `@pawl/cdk` and does not participate in this runtime call chain.

## 5. Runtime behavior to preserve

The migrated client must retain the current behavior exactly:

- `getPullRequest` validates the response, selects the target matching the requested repository, and normalizes open, closed, and merged status.
- `getDifferences` requests the exact destination and source commits, validates page size, maps add/modify/delete values, detects repeated pagination tokens, and enforces the existing maximum page count.
- `getFile` requests an explicit commit, rejects a response for a different commit, validates metadata, decodes valid UTF-8, and marks NUL-containing or invalid UTF-8 content as binary.
- `getComments` requests the exact pull-request revision pair, validates and flattens comment groups, preserves author, reply, location, and timestamps, and applies the same pagination safeguards.
- `postComment` preserves summary and inline locations and passes through the caller-provided idempotency token.
- `updateComment` preserves the original comment body and appends the resolution body before replacing the provider comment.

All AWS responses remain untrusted external data and are validated before mapping. Validation and pagination failures remain explicit operational errors; they must not be converted into review findings.

## 6. File boundaries

### 6.1 Durable reviewer

- Create `src/adapters/codecommit-review-client.ts` for runtime transport behavior.
- Create `src/adapters/codecommit-review-types.ts` for client DTOs and the injectable transport contract.
- Create `tests/unit/codecommit-review-client.test.ts` for SDK command and response contracts.
- Create `tests/fixtures/codecommit/**` for migrated deterministic response fixtures.
- Modify `src/adapters/codecommit-provider.ts` only to replace package imports with local imports and construct the local client.
- Modify `package.json` and `bun.lock` to remove `@pawl/codecommit`, remove its workspace path, and add direct `@aws-sdk/client-codecommit` usage.
- Modify `docs/superpowers/specs/2026-07-17-durable-code-reviewer-design.md` to replace the Pawl runtime-package boundary with app-local ownership.
- Modify `docs/superpowers/plans/2026-07-17-durable-code-reviewer.md` to replace its historical `@pawl/codecommit` package task and downstream imports with the local-client migration; do not leave Task 7 as an executable instruction to recreate the deleted package.

### 6.2 Pawl

- Keep `packages/cdk/src/codecommit-review-events.ts` unchanged unless tests expose a regression.
- Keep `packages/cdk/tests/codecommit-review-events.test.ts` and the public export in `packages/cdk/index.ts`.
- Delete `packages/codecommit/**`, including its source, package metadata, tests, fixtures, and TypeScript build configuration.
- Modify Pawl's root `tsconfig.json` to remove the `@pawl/codecommit` path alias.
- Modify Pawl's root `package.json` to remove the `@aws-sdk/client-codecommit` catalog entry after repository search confirms the deleted package is its only consumer.
- Regenerate Pawl's `bun.lock` so no workspace entry or now-unused CodeCommit SDK resolution remains.
- Retain shared catalog dependencies still used by other packages; dependency cleanup must be evidence-based rather than inferred from package deletion.

## 7. Migration sequence

1. Add app-local contract tests and fixtures against the desired local client API.
2. Run those tests and verify they fail because the local client modules do not exist.
3. Add the local types and minimal client implementation until the migrated contract tests pass.
4. Switch `CodeCommitProvider` to the local client and run its existing tests.
5. Replace the durable app's workspace and package dependency, regenerate its lockfile, and run a frozen install.
6. Confirm the durable app contains no `@pawl/codecommit` references outside historical migration context being intentionally updated.
7. Delete the Pawl package, remove its alias and package-specific SDK catalog entry, regenerate the Pawl lockfile, and verify the CDK construct independently.
8. Update the durable reviewer design and historical implementation plan to reflect the final ownership boundary and prevent later recreation of the package.
9. Run complete quality gates in both repositories and review both diffs for scope and behavioral preservation.

The app migration becomes green before the Pawl package is deleted, preventing a period where the consumer has no runtime implementation.

## 8. Testing strategy

### 8.1 App-local client contract tests

Migrate the existing Pawl tests and fixtures rather than replacing them with broad mocks. Tests must continue to verify:

- exact AWS SDK command classes and inputs;
- pull-request target selection and status mapping;
- differences and comments pagination;
- repeated-token and maximum-page failures;
- exact revision pinning;
- text, binary, and invalid UTF-8 file handling;
- malformed AWS response rejection;
- inline and summary comment payloads;
- idempotency-token propagation;
- comment update content.

The injected transport remains the seam for deterministic tests; production-only test hooks are not added.

### 8.2 Adapter regression tests

Run the existing `CodeCommitProvider` suite unchanged where possible. These tests prove that moving the transport implementation does not alter provider-neutral requests, hunks, comments, finding posts, inline-location validation, or resolution behavior.

### 8.3 Pawl construct tests

Run the focused `CodeCommitReviewEvents` tests with Pawl's local `esbuild` on `PATH`, plus the existing supplemental CDK TypeScript check with Bun ambient types. Existing tests must continue to cover EventBridge patterns, retry and dead-letter behavior, IAM scope and deduplication, validation, tags, monitoring, and cdk-nag compliance.

The preserved Pawl baseline has unrelated broad failures: its standard CDK/root builds lack required Node/DOM ambient types, its full test suite includes Docker-backed tests when Docker is unavailable, and repository-wide Biome scans include untracked subagent artifacts and templated JSON that is intentionally not parseable before rendering. This migration must not widen scope to repair those failures. Broad commands are rerun and reported for regression evidence; focused checks over every changed and preserved migration file are the hard gates.

### 8.4 Repository quality gates

For the durable reviewer:

- client and provider focused tests;
- full Bun test suite;
- Oxlint;
- Oxfmt check;
- TypeScript typecheck;
- frozen Bun install;
- `git diff --check`;
- dependency and import boundary searches;
- a non-empty implementation diff review proving every changed path remains within this migration's scope.

For Pawl:

- focused CDK construct tests with local `esbuild` resolution;
- supplemental CDK TypeScript validation with Bun ambient types;
- focused Biome checks over all changed root files and preserved CDK construct files;
- frozen Bun install;
- `git diff --check`;
- searches proving the deleted package, alias, catalog entry, and workspace resolution are absent;
- a non-empty implementation diff review proving no unrelated Pawl path changed;
- broad tests, standard builds, and repository-wide Biome rerun as non-regression evidence, with their pre-existing Docker, ambient-type, template, and untracked-artifact failures reported rather than repaired.

## 9. Commit strategy

Use separate repository-local commits:

1. Durable reviewer: migrate the runtime client and dependency boundary.
2. Pawl: remove the obsolete runtime package and repository references.
3. Durable reviewer: update architecture and implementation documentation if those changes are not included with the boundary migration.

Do not combine changes from the two repositories into one commit or modify Pawl's unrelated worktrees.

## 10. Acceptance criteria

1. `durable-lambda-reviewer` no longer lists `../pawl/packages/codecommit` as a workspace.
2. `durable-lambda-reviewer` no longer depends on or imports `@pawl/codecommit`.
3. The app directly depends on `@aws-sdk/client-codecommit` and constructs its local client by default.
4. All runtime behaviors listed in Section 5 have deterministic app-local contract coverage.
5. Existing `CodeCommitProvider` behavior and tests remain green.
6. `packages/codecommit/**` no longer exists in the paired Pawl branch.
7. Pawl contains no `@pawl/codecommit` alias or lockfile workspace entry.
8. Pawl's root catalog and lockfile no longer retain `@aws-sdk/client-codecommit` when repository search confirms no remaining Pawl consumer.
9. `CodeCommitReviewEvents` remains exported from `@pawl/cdk` and its existing tests and cdk-nag checks pass.
10. No runtime client is exported from or bundled through `@pawl/cdk`.
11. No application stack wiring or unrelated refactoring is introduced.
12. All app checks and focused Pawl migration checks pass, both `git diff --check` commands are clean, and manual diff review finds only migration-scoped changes. Broad Pawl commands introduce no new migration-related failure beyond the documented baseline limitations in Section 8.3.
