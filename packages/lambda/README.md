<div align="center">

# @pawl/lambda

Typed AWS Lambda handler wrappers with built-in Powertools (Logger, Tracer, Metrics).

</div>

## About

`@pawl/lambda` provides correctly typed Lambda handler functions that automatically wire up [AWS Lambda Powertools](https://docs.powertools.aws.dev/lambda/typescript/latest/) for observability. No boilerplate — just write your business logic.

## Installation

```bash
bun add @pawl/lambda
```

## Usage

The handler must be `export`-ed. The first parameter is the service name (used for CloudWatch identification). The second parameter is an async callback with the typed `event` and an optional `logger`.

```typescript
import { useApiHandler } from "@pawl/lambda";

export const handler = useApiHandler("my-service", async (event, logger) => {
  logger.info("Request received");
  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Hello World!" }),
  };
});
```

## Available Handlers

| Handler | Event Type |
|---------|------------|
| `useApiHandler` | `APIGatewayProxyEventV2` |
| `useSqsHandler` | `SQSEvent` (array of records) |
| `useEventbridgeHandler` | `EventBridgeEvent` |
| `useDynamoDbStreamsHandler` | `DynamoDBStreamEvent` (array of records) |
| `useSnsHandler` | `SNSEvent` |
| `useAuthorizerHandler` | Custom authorizer event |

## Adding a New Handler

If you need a handler for an event source not listed above, extend the library:

```typescript
import type { Logger } from "@aws-lambda-powertools/logger";
import type { S3Event, S3Handler } from "aws-lambda";
import { handlerFactory } from "./base/handler-factory";
import type { HandlerWithHooks } from "./base/hooks";

export function useS3Handler(
  serviceName: string,
  handleRequest: (event: S3Event, logger: Logger) => Promise<void>,
): HandlerWithHooks<S3Handler, S3Event> {
  return handlerFactory<S3Event>(serviceName, handleRequest);
}
```

Then export from `index.ts`:

```typescript
export { useS3Handler } from "./src/s3-handler";
```
