---
editUrl: false
next: false
prev: false
title: "useSqsHandler"
---

> **useSqsHandler**(`serviceName`, `handleRequest`): `HandlerWithHooks`\<`SQSHandler`, `SQSEvent`\>

Defined in: sqs-handler.ts:16

The useSqsHandler function returns a handler with hooks for processing SQS events in TypeScript.

## Parameters

### serviceName

`string`

The `serviceName` parameter is a string that represents the name of
the service or function that will be handling the SQS events.

### handleRequest

(`event`, `logger`) => `Promise`\<`void`\>

The `handleRequest` parameter is a function that takes two arguments:

## Returns

`HandlerWithHooks`\<`SQSHandler`, `SQSEvent`\>

A function named `useSqsHandler` is being returned. This function takes two parameters:
`serviceName` of type string and `handleRequest` which is a function that takes `event` of type
`SQSEvent` and `logger` of type `Logger` as arguments and returns a `Promise<void>`. The
`useSqsHandler` function returns a `HandlerWithHooks<SQS
