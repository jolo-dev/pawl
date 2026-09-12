---
editUrl: false
next: false
prev: false
title: "PipelineTransport"
---

Defined in: [packages/cdk/src/reviewer/pipeline-review-common.ts:45](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/reviewer/pipeline-review-common.ts#L45)

Runtime transport for starting and monitoring pipeline executions.

## Methods

### getExecution()

> **getExecution**(`params`): `Promise`\<[`PipelineExecutionSummary`](/cdk/interfaces/pipelineexecutionsummary/)\>

Defined in: [packages/cdk/src/reviewer/pipeline-review-common.ts:50](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/reviewer/pipeline-review-common.ts#L50)

#### Parameters

##### params

###### executionId

`string`

###### pipelineName

`string`

#### Returns

`Promise`\<[`PipelineExecutionSummary`](/cdk/interfaces/pipelineexecutionsummary/)\>

***

### startExecution()

> **startExecution**(`params`): `Promise`\<\{ `executionId`: `string`; \}\>

Defined in: [packages/cdk/src/reviewer/pipeline-review-common.ts:46](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/reviewer/pipeline-review-common.ts#L46)

#### Parameters

##### params

###### pipelineName

`string`

###### sourceRevision?

`string`

#### Returns

`Promise`\<\{ `executionId`: `string`; \}\>
