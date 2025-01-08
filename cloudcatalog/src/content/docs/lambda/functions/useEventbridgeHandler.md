---
editUrl: false
next: false
prev: false
title: "useEventbridgeHandler"
---

> **useEventbridgeHandler**\<`TDetailType`, `TDetail`, `TResult`\>(`serviceName`, `handleRequest`): (`event`) => `Promise`\<`TResult`\> & `object`

## Type Parameters

• **TDetailType** *extends* `string`

• **TDetail**

• **TResult**

## Parameters

### serviceName

`string`

### handleRequest

(`event`, `logger`) => `Promise`\<`TResult`\>

## Returns

(`event`) => `Promise`\<`TResult`\> & `object`

## Defined in

eventbridge-handler.ts:5
