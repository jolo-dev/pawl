---
editUrl: false
next: false
prev: false
title: "useAuthorizerHandler"
---

> **useAuthorizerHandler**\<`T`\>(`serviceName`, `handleRequest`): `HandlerWithHooks`\<`T` *extends* `"simple"` ? `APIGatewayRequestSimpleAuthorizerHandlerV2` : `APIGatewayRequestIAMAuthorizerHandlerV2`, `APIGatewayRequestAuthorizerEventV2`, `T` *extends* `"simple"` ? `APIGatewaySimpleAuthorizerResult` : `APIGatewayIAMAuthorizerResult`\>

Defined in: authorizer-handler.ts:34

The function `useAuthorizerHandler` is a TypeScript function that returns a handler with hooks for
authorizing API Gateway requests based on the specified authorizer type.

## Type Parameters

• **T** *extends* `Authorizer`

## Parameters

### serviceName

`string`

The `serviceName` parameter is a string that represents the name of
the service for which the authorizer handler is being created.

### handleRequest

(`event`, `logger`) => `Promise`\<`T` *extends* `"simple"` ? `APIGatewaySimpleAuthorizerResult` : `APIGatewayIAMAuthorizerResult`\>

The `handleRequest` parameter is a function that takes two arguments:

## Returns

`HandlerWithHooks`\<`T` *extends* `"simple"` ? `APIGatewayRequestSimpleAuthorizerHandlerV2` : `APIGatewayRequestIAMAuthorizerHandlerV2`, `APIGatewayRequestAuthorizerEventV2`, `T` *extends* `"simple"` ? `APIGatewaySimpleAuthorizerResult` : `APIGatewayIAMAuthorizerResult`\>

The `useAuthorizerHandler` function returns a handler function with hooks for handling API
Gateway request authorizer events. The specific type of handler returned depends on the type of
authorizer specified (either SIMPLE or IAM). The handler function will call the `handleRequest`
function with the event and logger parameters and return a promise with the appropriate authorizer
result based on the authorizer type.
