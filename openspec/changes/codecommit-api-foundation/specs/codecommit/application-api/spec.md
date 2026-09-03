## Purpose

Provide a stable, validated CodeCommit discovery contract that both Pawl CLI commands and server-side web adapters can consume without coupling callers to AWS SDK response shapes.

## ADDED Requirements

### Requirement: Repository discovery
The system SHALL provide a repository discovery operation that returns normalized repository summaries and an opaque continuation token when AWS has additional results.

#### Scenario: First page of repositories
- **WHEN** a caller requests repositories without a continuation token
- **THEN** the system returns only normalized repository summaries and an optional continuation token

#### Scenario: Subsequent repository page
- **WHEN** a caller supplies a continuation token returned by repository discovery
- **THEN** the system requests and returns the corresponding next page without duplicating the token in the result items

### Requirement: Repository metadata and branches
The system SHALL provide operations that return normalized metadata for one named repository and a paginated list of its branches.

#### Scenario: Read repository metadata
- **WHEN** a caller requests an existing repository by name
- **THEN** the system returns its name, ARN, account identifier, default branch, description, and creation/update timestamps when supplied by CodeCommit

#### Scenario: List repository branches
- **WHEN** a caller requests branches for a valid repository name
- **THEN** the system returns branch names and an optional continuation token

### Requirement: Pull-request discovery
The system SHALL provide a repository-scoped pull-request discovery operation with an explicit state filter and pagination.

#### Scenario: List open pull requests
- **WHEN** a caller requests open pull requests for a valid repository
- **THEN** the system returns pull-request identifiers and an optional continuation token from CodeCommit

### Requirement: Input validation and normalized failures
The system SHALL reject invalid repository names, unsupported pull-request states, invalid page sizes, and blank continuation tokens before issuing an AWS request. The system SHALL expose failures through Pawl-owned typed error categories rather than raw AWS SDK error objects.

#### Scenario: Invalid repository name
- **WHEN** a caller supplies a blank or malformed repository name
- **THEN** the operation fails with a validation error and does not call CodeCommit

#### Scenario: AWS access failure
- **WHEN** CodeCommit rejects a valid request because access is denied
- **THEN** the operation fails with an authorization error that retains a safe operation context and excludes AWS SDK internals

### Requirement: Server-side credential boundary
The application API SHALL accept an injectable CodeCommit client port and SHALL NOT require callers to supply AWS credentials as API parameters.

#### Scenario: In-memory client integration
- **WHEN** a caller supplies a client port implementation
- **THEN** the application API uses that port for CodeCommit operations without constructing an additional credential source
