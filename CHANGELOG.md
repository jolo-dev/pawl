# Changelog

## [0.1.0] — 2026-07-25

### Added

- `pawl init codecommit` CLI command to generate a standalone Pawl CDK project that creates and initially seeds a CodeCommit repository.
- `CodeCommit` high-level construct supports create/import modes, optional source seeding via deterministic ZIP assets, and optional durable auto-review.
- `CodeCommitRepositoryNameSchema` and `CodeCommitBranchNameSchema` shared validation schemas.
- `analyzeCodeCommitSource` and `createCodeCommitSourceArchive` for security-first source analysis and exact ZIP creation with CodeCommit initial-import limit enforcement.
- Repository resource pass-through for `CodeCommitReviewEvents`, `CodeBuildProject`, and `CodeCommitAutoReviewer`.
- `Template` re-exported from `@pawl/cdk` for generated consumer tests.
- `App`, `CfnOutput`, and `Construct` explicitly exported from `@pawl/cdk` for generated consumer code.

### Changed

- **Breaking (pre-1.0):** `CodeCommit.events` changed from required to optional. Consumers must narrow before use:
  ```ts
  if (codeCommit.events === undefined) {
    throw new Error("Expected review event resources");
  }
  ```
- `@pawl/cdk` version bumped from `0.0.1` to `0.1.0`.
- `CodeCommitReviewEvents` and `CodeBuildProject` accept an exact-one repository target (name or concrete resource).
- `CodeCommitAutoReviewer` accepts an optional `repositoryResources` map for concrete created repositories.
- `checkCredentials` and `checkBedrockAccess` now accept an explicit region parameter and use `fromIni` credentials.

### Security

- Immutable source denylist excludes nested `.git`, `node_modules`, `cdk.out`, secrets, and private keys at every depth.
- Symlink-aware source enumeration prevents dereferencing external symlinks.
- Parent-directory TOCTOU defenses verify canonical containment and file identity before archiving.

### AWS Initial-Import Limits

The source preflight enforces CodeCommit's CloudFormation initial-import constraints:
- Maximum 100 files
- Maximum 6,000,000 bytes per file
- Maximum 20,000,000 bytes total uncompressed content
- Maximum 4,000,000 bytes for the staged ZIP
- Repository-relative file paths of 1–4,096 characters

References:
- [CloudFormation Code property](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-codecommit-repository-code.html)
- [CodeCommit quotas](https://docs.aws.amazon.com/codecommit/latest/userguide/limits.html)
