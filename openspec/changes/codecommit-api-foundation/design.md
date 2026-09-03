## Context

See `proposal.md` for the motivation and `specs/codecommit/*` for observable requirements. Pawl currently has CodeCommit CDK constructs and reviewer-only SDK adapters, but no package that presents a stable CodeCommit application API to both command-line and web-server callers. The CLI entrypoint already dispatches non-interactive `init codecommit` and `init codepipeline` commands before starting its interactive flow.

## Goals / Non-Goals

**Goals:**

- Create one portable, read-only application boundary for the AWS CodeCommit discovery endpoints required by the first UI screens.
- Keep AWS SDK command construction and exception translation inside `@pawl/codecommit`.
- Make request validation and output DTOs independent of an HTTP framework, CLI rendering library, or browser runtime.
- Demonstrate reuse through a non-interactive CLI repository-list command.

**Non-Goals:**

- Creating the TanStack Start application, CloudFront hosting, Cognito login flow, or browser-side AWS credentials.
- Implementing repository writes, Git smart HTTP, PR detail/diff/comments, approvals, or merges.
- Replacing direct AWS IAM authorization; the caller's AWS credential source remains authoritative.
- Persisting CodeCommit data in a read model.

## Decisions

### Package-owned application service and DTOs

`packages/codecommit` will expose a `CodeCommitService` whose methods use Pawl-owned request and response types. Callers will not receive AWS SDK command outputs.

**Rationale:** The CLI and future TanStack Start server routes need the same data contract. Keeping that contract free of transport and AWS response details prevents browser/UI coupling to SDK internals.

**Alternatives considered:** Put methods in `@pawl/cdk` (rejected: runtime application code is not infrastructure) or call AWS SDK v3 directly from each consumer (rejected: duplicated mapping/error behavior).

### Injectable client port with AWS SDK adapter

The service will depend on a small command-oriented client port. The package will include a production adapter that wraps `CodeCommitClient`; tests will provide in-memory scripted ports.

**Rationale:** This preserves standard AWS credential-provider behavior in production and makes validation, pagination, and error translation deterministic without AWS credentials.

**Alternatives considered:** Dependency-inject a full AWS SDK client (rejected: SDK types leak into application tests) or require AWS credentials as service inputs (rejected: credentials are an infrastructure/runtime concern and unsafe API input).

### Strict Zod boundary validation

Request schemas validate repository names, page size and continuation tokens before client calls. The package reuses the CodeCommit-compatible repository-name character and length constraints, but does not import from `@pawl/cdk` to preserve package independence.

**Rationale:** `@pawl/codecommit` must be consumable without pulling CDK into a server or CLI bundle.

**Alternatives considered:** a dependency on `@pawl/cdk` for existing schemas (rejected: violates the codebase's package independence direction) or ad-hoc validation in each consumer (rejected: inconsistent failure behavior).

### Typed safe errors

`CodeCommitServiceError` exposes `validation`, `authorization`, `not-found`, `conflict`, `throttled`, and `unknown` categories, a stable operation name, and a safe message. The AWS SDK error object is retained only as an optional `cause` and never rendered by the CLI.

**Rationale:** Consumers can implement meaningful UX and CLI exit behavior without exposing request identifiers, credentials, raw response data, or unstable SDK messages.

### Focused CLI shape

The first command will be `pawl codecommit repositories [--max-results N] [--next-token TOKEN]`, print JSON, and call the shared service. It will be dispatched before the interactive CLI experience.

**Rationale:** JSON is stable for scripts and gives the future UI/API route a concrete contract; it validates dependency direction without prematurely designing a full CLI UI.

**Alternatives considered:** interactive selection output (rejected: unsuitable for scripts and testing) or a separate executable (rejected: needless command surface).

## Risks / Trade-offs

- [AWS CodeCommit API pagination semantics vary by endpoint] → Map each endpoint's documented token and result shapes behind the service and test command inputs/outputs using scripted client responses.
- [A Lambda/server role may over-authorize end users] → This change does not add an HTTP route; the future UI backend must make its IAM delegation model explicit before exposing the service over HTTP.
- [Copying validation can drift from CDK] → Keep the application schema minimal and CodeCommit-documented; consider extracting a dependency-free shared validation package only if a second runtime package needs it.
- [CodeCommit service availability constraints] → Keep the package AWS-SDK-based and deploy it only in CodeCommit-enabled customer accounts/regions.

## Migration Plan

1. Add the package and CLI command without changing existing commands or CDK constructs.
2. Release the new package as an additive API.
3. Have the future TanStack Start server adapter consume `@pawl/codecommit` rather than importing AWS SDK CodeCommit commands itself.
4. Roll back by removing the CLI command/package from a consumer release; it creates no data or infrastructure resources.
