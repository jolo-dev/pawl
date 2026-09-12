---
editUrl: false
next: false
prev: false
title: "useCodePipelineHandler"
---

> **useCodePipelineHandler**(`serviceName`, `handleRequest`): `HandlerWithHooks`\<[`CodePipelineHandler`](/lambda/type-aliases/codepipelinehandler/), [`CodePipelineJobEvent`](/lambda/interfaces/codepipelinejobevent/)\>

Defined in: [codepipeline-handler.ts:96](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/lambda/src/codepipeline-handler.ts#L96)

## Parameters

### serviceName

`string`

### handleRequest

(`event`, `logger`) => `Promise`\<`void`\>

## Returns

`HandlerWithHooks`\<[`CodePipelineHandler`](/lambda/type-aliases/codepipelinehandler/), [`CodePipelineJobEvent`](/lambda/interfaces/codepipelinejobevent/)\>
