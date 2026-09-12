---
editUrl: false
next: false
prev: false
title: "startPipelineForPr"
---

> **startPipelineForPr**(`params`, `config`): `Promise`\<`void`\>

Defined in: [packages/cdk/src/reviewer/pipeline-review-common.ts:108](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/reviewer/pipeline-review-common.ts#L108)

Start a pipeline execution for a PR and persist the execution-to-PR mapping.

No-op when `pipelineTransport` is undefined (event-only review mode).
Uses `sourceRevision` to ensure the pipeline builds the exact PR commit.

## Parameters

### params

[`StartPipelineForPrParams`](/cdk/interfaces/startpipelineforprparams/)

### config

[`PipelineDispatchConfig`](/cdk/interfaces/pipelinedispatchconfig/)

## Returns

`Promise`\<`void`\>
