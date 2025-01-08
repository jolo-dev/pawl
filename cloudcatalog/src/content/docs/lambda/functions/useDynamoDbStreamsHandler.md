---
editUrl: false
next: false
prev: false
title: "useDynamoDbStreamsHandler"
---

> **useDynamoDbStreamsHandler**(`serviceName`, `handleRequest`): `HandlerWithHooks`\<`DynamoDBStreamHandler`, `DynamoDBStreamEvent`, `DynamoDBBatchResponse`\>

## Parameters

### serviceName

`string`

### handleRequest

(`event`, `logger`) => `Promise`\<`void`\> \| `Promise`\<`DynamoDBBatchResponse`\>

## Returns

`HandlerWithHooks`\<`DynamoDBStreamHandler`, `DynamoDBStreamEvent`, `DynamoDBBatchResponse`\>

## Defined in

dynamodb-streams-handler.ts:6
