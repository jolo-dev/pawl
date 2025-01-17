---
editUrl: false
next: false
prev: false
title: "useApiHandler"
---

> **useApiHandler**(`serviceName`, `handleRequest`): `HandlerWithHooks`\<`APIGatewayProxyHandlerV2`, `APIGatewayProxyEventV2`, `ApiResponse`\>

Defined in: api-handler.ts:27

The function `useApiHandler` returns a handler with hooks for processing API Gateway proxy events in
TypeScript.

## Parameters

### serviceName

`string`

The `serviceName` parameter is a string that represents the name of
the service or API being handled by the `useApiHandler` function.

### handleRequest

(`event`, `logger`) => `Promise`\<`ApiResponse`\>

The `handleRequest` parameter is a function that takes two arguments:

## Returns

`HandlerWithHooks`\<`APIGatewayProxyHandlerV2`, `APIGatewayProxyEventV2`, `ApiResponse`\>

The `useApiHandler` function is returning a `HandlerWithHooks` that is specific to handling
API Gateway proxy events in AWS Lambda. The handler is created using the `handlerFactory` function
with the provided `serviceName` and `handleRequest` function for processing the API request.
