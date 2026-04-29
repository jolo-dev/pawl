# Example: Service with pawl

A complete example demonstrating `@pawl/cdk` constructs and `@pawl/lambda` handlers working together.

## What's Included

- API Gateway → Lambda (using `useApiHandler`)
- EventBridge rules with Lambda targets (using `useEventbridgeHandler`)
- DynamoDB Streams processing (using `useDynamoDbStreamsHandler`)
- Full Localstack integration for local development

## Local Development

### Prerequisites

- Docker
- `bun install`

### Deploy Locally

```bash
npx cdk deploy --app "npx tsx index.ts" --require-approval never
```

### Dev Mode (Hot Reload)

Adjust `local.dev.ts` to point to your Lambda source folder, then:

```bash
bun run dev
```

Lambdas use [Function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html) locally and are hot-swapped via CDK hotswap — changes reflect automatically without redeploying.

## Context

Set required CDK context in `cdk.json` or via CLI flags. See the [CDK context docs](https://docs.aws.amazon.com/cdk/v2/guide/get_context_var.html).
