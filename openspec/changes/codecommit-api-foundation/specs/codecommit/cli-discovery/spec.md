## Purpose

Expose the shared CodeCommit repository-discovery API through a concise Pawl CLI command so developers can inspect the same normalized data that future server-side UI routes will use.

## ADDED Requirements

### Requirement: Repository listing command
The Pawl CLI SHALL provide a read-only CodeCommit repository-listing command that invokes the shared application API and writes normalized results to standard output.

#### Scenario: Default repository listing
- **WHEN** a user invokes the repository-listing command without pagination arguments
- **THEN** the CLI prints the first normalized repository page and exits successfully

#### Scenario: Pagination input
- **WHEN** a user provides a valid page size or continuation token
- **THEN** the CLI forwards those values to the shared application API and prints the resulting page

### Requirement: CLI validation and failure behavior
The Pawl CLI SHALL report invalid command arguments and application-API failures on standard error with a non-zero exit status, without printing credential material or raw AWS SDK objects.

#### Scenario: Invalid page size
- **WHEN** a user supplies an invalid page size
- **THEN** the CLI exits non-zero and reports a validation message without invoking CodeCommit

#### Scenario: Authorization failure
- **WHEN** the shared application API reports that CodeCommit access is denied
- **THEN** the CLI exits non-zero and presents the normalized authorization failure message
