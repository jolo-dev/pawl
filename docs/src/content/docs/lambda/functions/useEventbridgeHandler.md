---
editUrl: false
next: false
prev: false
title: "useEventbridgeHandler"
---

> **useEventbridgeHandler**\<`TDetailType`, `TDetail`, `TResult`\>(`serviceName`, `handleRequest`, `options?`): (`event`) => `Promise`\<`TResult`\> & `object`

Defined in: [eventbridge-handler.ts:23](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/lambda/src/eventbridge-handler.ts#L23)

The function `useEventbridgeHandler` is a TypeScript function that creates a handler for processing
EventBridge events with a specified detail type and detail data.

## Type Parameters

### TDetailType

`TDetailType` *extends* `string`

### TDetail

`TDetail`

### TResult

`TResult`

## Parameters

### serviceName

`string`

The `serviceName` parameter is a string that represents the name of
the service or component that will be handling the EventBridge events.

### handleRequest

(`event`, `logger`) => `Promise`\<`TResult`\>

The `handleRequest` parameter is a function that takes two arguments:

### options?

`EventbridgeHandlerOptions`

## Returns

(`event`) => `Promise`\<`TResult`\> & `object`

The `useEventbridgeHandler` function is returning a handler function that takes an event
and a logger as parameters, and returns a Promise of a result. This handler function is created
using the `handlerFactory` function, which is passed the `serviceName` and `handleRequest` function
provided to the `useEventbridgeHandler` function.
