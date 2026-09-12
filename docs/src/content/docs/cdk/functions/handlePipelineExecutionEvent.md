---
editUrl: false
next: false
prev: false
title: "handlePipelineExecutionEvent"
---

> **handlePipelineExecutionEvent**(`event`, `config`): `Promise`\<`void`\>

Defined in: [packages/cdk/src/reviewer/pipeline-review-common.ts:144](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/reviewer/pipeline-review-common.ts#L144)

Handle a CodePipeline Execution State Change event.

Resolves the execution-to-PR mapping from the store, fetches execution
details, formats a CI summary, and posts it as a PR comment. Ignores events
without a mapping (manual triggers, non-PR pushes, expired mappings).

## Parameters

### event

[`PipelineExecutionEventParams`](/cdk/interfaces/pipelineexecutioneventparams/)

### config

[`PipelineDispatchConfig`](/cdk/interfaces/pipelinedispatchconfig/)

## Returns

`Promise`\<`void`\>
