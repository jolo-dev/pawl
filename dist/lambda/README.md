 <a name="readme-top"></a>

<div align="center">

# @hem-lib/lambda

An internal FEH IT package which contains best practices and a small library for using AWS Lambda in your next project.

</div>

 <details>
<summary>Table of Contents</summary>

- [@hem-lib/lambda](#hem-liblambda)
  - [ℹ️ About the Project](#about-the-project)
  - [⚙ ️Setup](#setup)
    - [Installation](#installation)
</details>

## ℹ️ About the Project

This is an internal package which contains typed AWS Lambda methods to use AWS Lambda with best practices.
It contains all the necessary organisational requirements by leveraging the core of [AWS Lambda Powertools](https://docs.powertools.aws.dev/lambda/typescript/latest/) such as Logger, Tracer, etc.

## ❓ Why

- Standardized implementation of AWS Lambda withing FEH IT
- Correctly typed Lambda Handler
- No worrying about AWS LAmbda Powertools

## Usage

```sh
npm install @hems-lib/lambda
```

It is aligned with the `@hems-lib/cdk`.
First, the `handler` has to be `export`-ed. Otherwise, the handler won't be found.
The first parameter is the name of the service. This will identify the Lambda in Cloudwatch.
The second parameter is a callback async function which has `event` and an optional [`logger`](https://docs.powertools.aws.dev/lambda/typescript/latest/core/logger/) from Powertools.
The `event` is respectively typed.

For example:

```ts
import { useApiHandler } from "@hems-lib/lambda";

export const handler = useApiHandler("eig-control-charging", async (event, logger) => {
                                                                    //^ APIGatewayProxyEventV2
  logger.info('This is an optional logger')
  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Hello World!" }),
  };
});


```

Here the structure of each events:

| handler | Event Type |
|---------|------------|
| useApiHandler | [APIGatewayProxyEventV2](https://typestrong.org/typedoc-auto-docs/_types_aws-lambda/interfaces/APIGatewayProxyEventV2.html) |
| useSqsHandler | Array<[SQSEvent](https://typestrong.org/typedoc-auto-docs/_types_aws-lambda/interfaces/SQSEvent.html)> |
| useEventBridge | [EventBridgeEvent](https://typestrong.org/typedoc-auto-docs/_types_aws-lambda/interfaces/EventBridgeEvent.html) |
| useDynamoDbStream | Array<[DynamoDBStreamEvent](https://typestrong.org/typedoc-auto-docs/_types_aws-lambda/interfaces/DynamoDBStreamEvent.html)> |

## Development

If you are missing a Handler, you can extend the `src` by adding your Handler and use the `handlerFactory`.

```ts
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

Don't forget to export the handler in the [`index.ts`](./index.ts).

```ts
export { useS3Handler } from "./src/s3-handler";
```


<p align="right"><a href="#readme-top">Top ⬆️</a></p>