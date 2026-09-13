---
name: pawl-codegen
description: Generate AWS CDK infrastructure code and Lambda handlers from an approved infrastructure plan. Always use @pawl/cdk and @pawl/lambda. Write actual files to disk.
---

# Infrastructure Code Generator

When generating infrastructure code from an approved plan, follow this workflow:

## Step 1: Read the Approved Plan

Read `.pawl/plan.md` to understand the approved architecture:

```bash
cat .pawl/plan.md
```

## Step 2: Generate CDK Infrastructure

Create the CDK stack files using `@pawl/cdk` constructs. Never use raw `aws-cdk-lib`.

### Stack Structure

```
infra/
├── cdk.json
├── package.json
├── src/
│   ├── stacks/
│   │   ├── api-stack.ts        # API Gateway + Lambda
│   │   ├── data-stack.ts       # DynamoDB / RDS
│   │   └── index.ts            # Exports all stacks
│   └── handlers/
│       ├── api-handler.ts      # Lambda handlers
│       └── worker-handler.ts   # Background workers
└── bin/
    └── app.ts                  # CDK app entry
```

### CDK Stack Example

```typescript
import { stacks, ApiGateway, LambdaFunction, DynamoDbTable } from "@pawl/cdk";

const apiStack = function ApiStack() {
  const table = new DynamoDbTable("UsersTable", {
    partitionKey: "pk",
    sortKey: "sk",
  });

  const handler = new LambdaFunction("ApiHandler", {
    entry: "./src/handlers/api-handler.ts",
    environment: {
      TABLE_NAME: table.tableName,
    },
  });

  table.grantReadWriteData(handler);

  new ApiGateway("Api", {
    routes: {
      "GET /users": handler,
      "POST /users": handler,
    },
  });
};

if (!stacks(apiStack)) {
  // Runtime code
}
```

## Step 3: Generate Lambda Handlers

Create Lambda handlers using `@pawl/lambda` handler factories. Never use raw Lambda types.

### Handler Examples

**API Handler:**
```typescript
import { apiHandlerFactory } from "@pawl/lambda";

export const handler = apiHandlerFactory("my-service", async (event, logger) => {
  logger.info("Request received", { path: event.path });
  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Hello" }),
  };
});
```

**EventBridge Handler:**
```typescript
import { eventBridgeHandlerFactory } from "@pawl/lambda";

export const handler = eventBridgeHandlerFactory("my-service", async (event, logger) => {
  logger.info("Event received", { detail: event.detail });
});
```

**SQS Handler:**
```typescript
import { sqsHandlerFactory } from "@pawl/lambda";

export const handler = sqsHandlerFactory("my-service", async (event, logger) => {
  for (const record of event.Records) {
    logger.info("Processing message", { body: record.body });
  }
});
```

**DynamoDB Streams Handler:**
```typescript
import { dynamodbStreamHandlerFactory } from "@pawl/lambda";

export const handler = dynamodbStreamHandlerFactory("my-service", async (event, logger) => {
  for (const record of event.Records) {
    logger.info("Stream record", { eventName: record.eventName });
  }
});
```

## Step 4: Write Files

Use the `write` tool to create all infrastructure files. Write:

1. `infra/cdk.json` — CDK configuration
2. `infra/package.json` — Dependencies (`@pawl/cdk`, `@pawl/lambda`, `aws-cdk-lib`, `typescript`)
3. `infra/src/stacks/*.ts` — CDK stacks
4. `infra/src/handlers/*.ts` — Lambda handlers
5. `infra/bin/app.ts` — CDK app entry point
6. `infra/tsconfig.json` — TypeScript configuration

## Rules

1. Always read `.pawl/plan.md` first — generate exactly what was approved
2. Use `@pawl/cdk` constructs exclusively — never raw `aws-cdk-lib`
3. Use `@pawl/lambda` handler factories — never raw Lambda handlers
4. Every Lambda handler gets a unique `serviceName` parameter
5. Include IAM permissions in the CDK stacks (use `grant*` methods)
6. Include CloudWatch alarms for error rates and latency
7. Use Zod for runtime validation in handlers if processing user input
8. Write actual files — don't just show code blocks
9. After writing, suggest next steps: `cd infra && bun install && npx cdk bootstrap && npx cdk deploy`
