<div align="center">

# @pawl/cdk

Opinionated AWS CDK constructs with built-in compliance, IAM, alarms, and tags.

</div>

## About

`@pawl/cdk` provides high-level CDK constructs that enforce best practices out of the box. Each construct includes proper IAM permissions, CloudWatch alarms, tagging, and passes cdk-nag compliance checks.

This should be the only CDK dependency in your project — no need to import `aws-cdk-lib`, `aws-cdk`, or `constructs` directly.

## Available Constructs

| Construct | Description |
|-----------|-------------|
| `ApiGateway` | HTTP API Gateway with Lambda integration |
| `LambdaFunction` | Lambda function with Powertools, bundling, and alarms |
| `EventBridge` | EventBridge rules with targets |
| `Sqs` | SQS queue with DLQ and alarms |
| `DynamoDbTableWithStreams` | DynamoDB table with stream processing |
| `ApiDestination` | EventBridge API destination |
| `Stack` | Base stack with tags and context |
| `LocalStack` | Localstack integration for local development |

## Setup

### Prerequisites

- Docker (for local development)
- [AWS SSO configured](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html) (for deploying)

### Installation

```bash
bun add @pawl/cdk
```

### Context

Each stack requires [CDK context](https://docs.aws.amazon.com/cdk/v2/guide/get_context_var.html) for tags and resource configuration.

Set context via:
- `cdk.context.json`
- A `context` block in `cdk.json`
- In your stack: `this.node.setContext("key", "value")`
- CLI: `npx cdk -c key=value`

## Usage

```typescript
import { ApiGateway, LambdaFunction, defineStacks } from "@pawl/cdk";

defineStacks((app) => {
  const stack = new Stack(app, "MyStack");

  const fn = new LambdaFunction(stack, "Handler", {
    entry: "./src/handler.ts",
    serviceName: "my-service",
  });

  new ApiGateway(stack, "Api", {
    lambdaFunction: fn,
  });
});
```

## Local Development

Deploy locally against [Localstack](https://docs.localstack.cloud/):

```bash
npx cdk deploy --app "npx tsx index.ts" --require-approval never
```

### Dev Mode

Use the `Local` helper for hot-reloading Lambda functions during development:

```typescript
import { Local } from "@pawl/cdk";

Local({ lambdaDir: "./src" });
```

Changes are reflected automatically via [CDK hotswap](https://aws.amazon.com/blogs/containers/accelerating-development-feedback-loops-with-aws-cdk-hotswap-deployments-for-amazon-ecs/).

## Troubleshooting

If redeploying fails locally, remove the stack and redeploy:

```bash
npx cdk destroy --app "npx tsx index.ts" --all
npx cdk deploy --app "npx tsx index.ts" --require-approval never
```
