---
editUrl: false
next: false
prev: false
title: "useApiHandler"
---

> **useApiHandler**(`serviceName`, `handleRequest`): `HandlerWithHooks`\<`APIGatewayProxyHandlerV2`, `APIGatewayProxyEventV2`, `ApiResponse`\>

## Parameters

### serviceName

`string`

### handleRequest

(`event`, `logger`) => `Promise`\<`ApiResponse`\>

## Returns

`HandlerWithHooks`\<`APIGatewayProxyHandlerV2`, `APIGatewayProxyEventV2`, `ApiResponse`\>

## Defined in

packages/lambda/src/api-handler.ts:17
