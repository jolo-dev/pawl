---
editUrl: false
next: false
prev: false
title: "useAuthorizerHandler"
---

> **useAuthorizerHandler**\<`T`\>(`serviceName`, `handleRequest`): `HandlerWithHooks`\<`T` *extends* *typeof* [`SIMPLE`](/lambda/variables/authorizer/#simple) ? `APIGatewayRequestSimpleAuthorizerHandlerV2` : `APIGatewayRequestIAMAuthorizerHandlerV2`, `APIGatewayRequestAuthorizerEventV2`, `T` *extends* *typeof* [`SIMPLE`](/lambda/variables/authorizer/#simple) ? `APIGatewaySimpleAuthorizerResult` : `APIGatewayIAMAuthorizerResult`\>

## Type Parameters

• **T** *extends* `Authorizer`

## Parameters

### serviceName

`string`

### handleRequest

(`event`, `logger`) => `Promise`\<`T` *extends* `"simple"` ? `APIGatewaySimpleAuthorizerResult` : `APIGatewayIAMAuthorizerResult`\>

## Returns

`HandlerWithHooks`\<`T` *extends* *typeof* [`SIMPLE`](/lambda/variables/authorizer/#simple) ? `APIGatewayRequestSimpleAuthorizerHandlerV2` : `APIGatewayRequestIAMAuthorizerHandlerV2`, `APIGatewayRequestAuthorizerEventV2`, `T` *extends* *typeof* [`SIMPLE`](/lambda/variables/authorizer/#simple) ? `APIGatewaySimpleAuthorizerResult` : `APIGatewayIAMAuthorizerResult`\>

## Defined in

authorizer-handler.ts:19
