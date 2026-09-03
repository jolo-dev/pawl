## Why

Issue #2 requires a GitHub-like TanStack Start experience for AWS CodeCommit, while issue #3 requires the CLI and that UI to share one API. Building the UI first would duplicate AWS SDK mapping, authorization handling, pagination, and error semantics in the browser and CLI; a small, server-safe CodeCommit application API is the prerequisite.

## What Changes

- Add a new `@pawl/codecommit` workspace package that owns a typed, transport-agnostic CodeCommit application service.
- Provide a narrow first vertical slice for repository discovery and pull-request discovery: list repositories, read repository metadata/default branch, list branches, and list pull requests.
- Normalize AWS SDK v3 responses into stable Pawl DTOs, validate request inputs with Zod, support explicit pagination, and expose typed error categories without leaking SDK-specific response types.
- Make the service depend on an injectable CodeCommit client port so the CLI and a future TanStack Start server route use the same API while tests run without AWS credentials.
- Add a CLI command that exercises the shared API for repository listing, proving the CLI integration path. The TanStack Start web package, CloudFront deployment, authentication, detailed PR views, and write operations remain out of scope for this change.

## Capabilities

### New Capabilities
- `codecommit/application-api`: A validated, portable CodeCommit application API for repository and pull-request discovery that is reusable by CLI and server-side UI adapters.
- `codecommit/cli-discovery`: A Pawl CLI read-only repository-discovery command backed by the shared application API.

### Modified Capabilities

- None.

## Impact

- Creates `packages/codecommit` and adds it to the existing Bun workspace package set.
- Uses the already catalogued `@aws-sdk/client-codecommit` version; no new third-party version is introduced.
- Adds a read-only CLI dispatch path in `packages/cli`.
- Establishes the backend contract that issue #2's TanStack Start application will consume; the frontend itself is intentionally deferred until the shared API is verified.
