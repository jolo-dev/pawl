---
name: pawl-constructs
description: Use @pawl/cdk, @pawl/agentcore, and @pawl/lambda when architecting, generating, or deploying AWS infrastructure. These are the opinionated construct libraries for this project. Always prefer pawl abstractions over raw aws-cdk-lib or raw AWS SDK types.
---

# Pawl Constructs

When designing or generating AWS infrastructure for this project, **always use the `@pawl/*` packages** instead of raw `aws-cdk-lib` constructs or AWS SDK types.

## Packages

### `@pawl/cdk` — CDK Construct Library

Opinionated CDK constructs that wrap `aws-cdk-lib` with built-in IAM, alarms, tagging, and compliance.

#### Key Constructs

| Construct | Purpose |
|-----------|---------|
| `BasicConstruct` | Base class all constructs extend. Provides prefix, monitoring dashboard, and IAM policy helpers |
| `ApiGateway` | REST API Gateway with route-to-Lambda mapping |
| `LambdaFunction` | Lambda function with bundling, IAM, and CloudWatch alarms |
| `DynamoDbTable` | DynamoDB table with streams and auto-scaling |
| `EventBridge` | EventBridge bus with targets (Lambda, API Destination, etc.) |
| `SqsQueue` | SQS queue with DLQ and alarms |
| `Websocket` | AppSync WebSocket API |
| `AgentCore` | Bedrock AgentCore runtime |
| `LocalStack` | Local development stack |
| `SnsTopic` | SNS topic with subscriptions |
| `Schedule` | EventBridge scheduled rule |

#### Conventions

- Every construct extends `BasicConstruct`
- Props interfaces use **Zod** for runtime validation
- Constructs are self-contained: IAM permissions, alarms, and tags are included
- Use `cdk-nag` for compliance validation
- No raw `aws-cdk-lib` in consumer code — use `@pawl/cdk` abstractions

#### Stack Definition

Use `defineStacks()` or the `stacks()` pattern for synth/execution mode:

```typescript
import { stacks, ApiGateway, LambdaFunction } from "@pawl/cdk";

const myStack = function MyServiceStack() {
  const fn = new LambdaFunction("Handler", {
    entry: "./src/handler.ts",
  });

  new ApiGateway("Api", {
    routes: {
      "GET /items": fn,
    },
  });
};

if (!stacks(myStack)) {
  // Runtime code (deploy, test, etc.)
}
```

### `@pawl/lambda` — Lambda Handler Wrappers

Handler factory pattern wrapping AWS Lambda Powertools (Logger, Tracer, Metrics).

#### Handlers

| Handler | Event Type |
|---------|------------|
| `apiHandlerFactory` | API Gateway REST / HTTP API |
| `eventBridgeHandlerFactory` | EventBridge events |
| `sqsHandlerFactory` | SQS batch events |
| `dynamodbStreamHandlerFactory` | DynamoDB Streams |

#### Conventions

- Use `handlerFactory` pattern — not raw Lambda handlers
- First parameter is always `serviceName` (used for CloudWatch)
- Every handler wraps Powertools Logger, Tracer, and Metrics
- Never use raw AWS Lambda types — use `@pawl/lambda` wrappers
- All handlers are `export`-ed (required for Lambda runtime)

#### Example

```typescript
import { apiHandlerFactory } from "@pawl/lambda";

export const handler = apiHandlerFactory("my-service", async (event, logger) => {
  logger.info("Request received", { path: event.path });
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
});
```

### `@pawl/agentcore` — Bedrock AgentCore SDK

SDK for building Bedrock AgentCore runtimes with Strands Agents.

#### Key API

```typescript
import { useAgentcore } from "@pawl/agentcore";

const agentcore = useAgentcore("my-agent", {
  agent: {
    async invoke(prompt: string) {
      // Agent logic
      return { lastMessage: { content: [{ text: "response" }] } };
    },
  },
});

agentcore.serve({ port: 8080 });
```

## Rules

1. **Always use `@pawl/cdk` constructs** over raw `aws-cdk-lib`
2. **Always use `@pawl/lambda` handlers** over raw Lambda types
3. **Always use `@pawl/agentcore`** for AgentCore runtimes
4. **Never use `any`** — use `unknown` with type narrowing or Zod parsing
5. **Use `export`**, never `export default`
6. **Validate props with Zod** schemas
7. **Constructs must extend `BasicConstruct`**
8. **Include IAM, alarms, and tags** in constructs
