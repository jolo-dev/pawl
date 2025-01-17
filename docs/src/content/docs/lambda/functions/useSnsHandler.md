---
editUrl: false
next: false
prev: false
title: "useSnsHandler"
---

> **useSnsHandler**(`serviceName`, `handleRequest`): `HandlerWithHooks`\<`SNSHandler`, `SNSEvent`\>

Defined in: sns-handler.ts:17

The function `useSnsHandler` returns a handler function for processing SNS events with the specified
service name and request handling function.

## Parameters

### serviceName

`string`

The `serviceName` parameter is a string that represents the name of
the SNS service that you are working with.

### handleRequest

(`event`, `logger`) => `Promise`\<`void`\>

The `handleRequest` parameter is a function that takes two arguments:

## Returns

`HandlerWithHooks`\<`SNSHandler`, `SNSEvent`\>

A function named `useSnsHandler` is being returned. This function takes two parameters:
`serviceName` of type string and `handleRequest` which is a function that takes `event` of type
`SNSEvent` and `logger` of type `Logger` as arguments and returns a `Promise<void>`. The
`useSnsHandler` function returns a `HandlerWithHooks<SNS
