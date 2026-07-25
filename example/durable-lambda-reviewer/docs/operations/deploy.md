# Deployment

This guide covers deploying, updating, and removing the durable CodeCommit
pull-request reviewer stack.

## Prerequisites

- An AWS account and a configured profile (default: `jolo`).
- A deployment region (e.g. `eu-central-1`).
- **Docker** — the Pawl `LambdaFunction` construct bundles handlers with
  esbuild via Docker (`NodejsFunction`). Ensure Docker is running before
  `cdk synth` / `cdk deploy`.
- A CodeCommit repository (or several) you want reviewed.

## Configuration (CDK context)

All configuration flows through CDK context in `cdk.json` (overridable with
`--context key=value`). The schema is Zod-validated at synthesis time.

| Key                                 | Required | Default                      | Notes                                                                  |
| ----------------------------------- | -------- | ---------------------------- | ---------------------------------------------------------------------- |
| `team`                              | yes      | —                            | Used in resource naming (`${team}-${stage}-...`).                      |
| `stage`                             | yes      | —                            | `dev`, `prod`, etc. `prod` forbids the `public-test` CodeBuild policy. |
| `repositories`                      | yes      | —                            | Non-empty array of CodeCommit repository names.                        |
| `reviewerModelId`                   | no       | `anthropic.claude-opus-4-8`  | Bedrock foundation model ID.                                           |
| `reviewerCodeBuildRegistryEndpoint` | no       | `https://registry.npmjs.org` | HTTPS endpoint for the approved package registry.                      |
| `reviewerExecutionTimeoutSeconds`   | no       | `2592000` (30 days)          | Durable reviewer max execution time.                                   |
| `reviewerRetentionDays`             | no       | `14`                         | CloudWatch log retention for the reviewer.                             |
| `reviewerAlias`                     | no       | `live`                       | Published alias the router invokes.                                    |
| `botArnPatterns`                    | no       | `""`                         | Comma-separated ARN patterns for bot identities to suppress.           |

## Deploy

```bash
bun run deploy
# or explicitly:
AWS_PROFILE=jolo bunx cdk deploy --all
```

The stack creates, per repository: one CodeBuild project and one CodeCommit
event construct (pull-request + comment rules with a shared DLQ). A single
durable reviewer Lambda, one router Lambda, and one DynamoDB state table are
shared across all repositories.

## Onboard a new repository

1. Ensure the repository exists in CodeCommit.
2. Add its name to the `repositories` array in `cdk.json`.
3. Re-run `bun run deploy`.
4. Commit a `.pawl/reviewer.json` to the repository's mainline (see
   [repository-config.md](./repository-config.md)).

The reviewer reads `.pawl/reviewer.json` from the **destination commit** at
review time; a PR cannot weaken its own review policy.

## Remove

```bash
bun run remove
# or:
AWS_PROFILE=jolo bunx cdk destroy --all
```

The DynamoDB state table is **retained** on stack deletion (`DeletionPolicy:
Retain`) to preserve review history. Delete it manually if required.

## Rollback

CloudFormation rollbacks are performed via the AWS Console or:

```bash
AWS_PROFILE=jolo aws cloudformation rollback-stack \
  --stack-name <stack-name> --rollback-configuration ...
```

For Lambda code rollbacks, use the alias's version history in the console.

## Production constraints

- **`stage: prod` forbids the `public-test` CodeBuild network policy.** Supply
  a private network policy (VPC + CodeArtifact) via a follow-up configuration;
  the current default is non-prod only.
- Review the [alerts guide](./alerts.md) for operational runbooks.
