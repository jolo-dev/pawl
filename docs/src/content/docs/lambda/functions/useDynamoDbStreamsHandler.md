---
editUrl: false
next: false
prev: false
title: "useDynamoDbStreamsHandler"
---

> **useDynamoDbStreamsHandler**(`serviceName`, `handleRequest`): `HandlerWithHooks`\<`DynamoDBStreamHandler`, `DynamoDBStreamEvent`, `DynamoDBStreamResult`\>

Defined in: [dynamodb-streams-handler.ts:19](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/lambda/src/dynamodb-streams-handler.ts#L19)

## Parameters

### serviceName

`string`

### handleRequest

(`event`, `logger`) => `Promise`\<`DynamoDBStreamResult`\>

## Returns

`HandlerWithHooks`\<`DynamoDBStreamHandler`, `DynamoDBStreamEvent`, `DynamoDBStreamResult`\>
