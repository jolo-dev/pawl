# Read an AWS account with per-service scanners, not AWS Config

Analyzing a user's infrastructure requires reading deployed resources, but pawl's users are arbitrary: their accounts, their permissions, and their existing setup are all unknown. No single AWS API returns every resource without a prerequisite, so pawl scans per service, bounded to the services its own constructs cover, and uses the Resource Groups Tagging API as a broad net for everything else. AWS Config is deliberately out of scope, because requiring a user to enable a paid recorder before they can run a CLI is not a prerequisite pawl is willing to impose.

## Considered Options

- **AWS Config.** Richest signal — inventory, relationships, and history — but the recorder must be enabled per account and region, and it charges. Rejected as a hard prerequisite; it remains the fallback if a question ever genuinely needs resource relationships.
- **AWS Resource Explorer.** Broad search with no usage charge, but it needs an index created per account and region first. Kept as an optional accelerator for users who already have one, never required.
- **Resource Groups Tagging API alone.** Free and one paged call, but it returns resources that carry tags, so an untagged resource is invisible — the opposite of "scan all resources".
- **A single generic scanner.** Rejected: there is no such API.

## Consequences

- One scanner per service, so the covered service list is bounded by the constructs pawl ships: Lambda, API Gateway v1 and v2, DynamoDB, SQS, SNS, S3, EventBridge, AppSync and WebSocket, CodeBuild, CodeCommit, CodePipeline, Cognito, CloudFront, IAM, KMS, EC2 and VPC, Logs, and AgentCore.
- Coverage is a first-class part of the result, not a footnote. A denied `List` call must surface as a gap, never as an absence of drift.
- Drift detection is largely not pawl's to build for CloudFormation-managed resources: `cdk diff` already compares the deployed stack with the local synthesis, and `DetectStackDrift` covers template against actual. Only resources outside CloudFormation need pawl's own matching, which relies on pawl's pinned physical names and its `team` and `stage` tags.
