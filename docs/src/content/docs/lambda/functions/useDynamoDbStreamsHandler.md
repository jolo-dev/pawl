---
editUrl: false
next: false
prev: false
title: "useDynamoDbStreamsHandler"
---

> **useDynamoDbStreamsHandler**(`serviceName`, `handleRequest`): `HandlerWithHooks`\<`DynamoDBStreamHandler`, `DynamoDBStreamEvent`, `DynamoDBBatchResponse`\>

Defined in: dynamodb-streams-handler.ts:17

The function `useDynamoDbStreamsHandler` creates a handler for processing DynamoDB stream events
with a specified service name and request handling function.

## Parameters

### serviceName

`string`

The `serviceName` parameter is a string that represents the name of
the service or function that will be handling the DynamoDB stream events.

### handleRequest

(`event`, `logger`) => `Promise`\<`void`\> \| `Promise`\<`DynamoDBBatchResponse`\>

The `handleRequest` parameter is a function that takes two arguments:

## Returns

`HandlerWithHooks`\<`DynamoDBStreamHandler`, `DynamoDBStreamEvent`, `DynamoDBBatchResponse`\>

The `useDynamoDbStreamsHandler` function is returning a handler function with hooks for
processing DynamoDB stream events. It takes in a `serviceName` as a string and a `handleRequest`
function that handles the DynamoDB stream event and logger. The `handleRequest` function returns a
promise that resolves to `void` or `DynamoDBBatchResponse`.
