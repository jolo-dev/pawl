---
editUrl: false
next: false
prev: false
title: "PrPipelineDispatcher"
---

Defined in: [packages/cdk/src/reviewer/pipeline-review-common.ts:212](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/reviewer/pipeline-review-common.ts#L212)

## Methods

### completeTerminalRequest()

> **completeTerminalRequest**(`input`): `Promise`\<`void`\>

Defined in: [packages/cdk/src/reviewer/pipeline-review-common.ts:223](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/reviewer/pipeline-review-common.ts#L223)

#### Parameters

##### input

###### generation

`number`

###### request

`RequestKey`

###### status

`"merged"` \| `"closed"`

#### Returns

`Promise`\<`void`\>

***

### startReviewPipeline()

> **startReviewPipeline**(`input`): `Promise`\<`void` \| [`PipelineDispatchReceipt`](/cdk/interfaces/pipelinedispatchreceipt/)\>

Defined in: [packages/cdk/src/reviewer/pipeline-review-common.ts:213](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/reviewer/pipeline-review-common.ts#L213)

#### Parameters

##### input

###### dispatchIntent?

`PipelineDispatchIntent`

###### eventId

`string`

###### generation

`number`

###### observedAt

`string`

###### refetchSnapshot

() => `Promise`\<`Readonly`\<\{ `destinationBranch`: `string`; `destinationRevision`: `string`; `key`: `Readonly`\<\{ `provider`: `string`; `repository`: `string`; `requestId`: `string`; \}\>; `sourceBranch`: `string`; `sourceRevision`: `string`; `status`: `"open"` \| `"merged"` \| `"closed"`; `title`: `string`; \}\>\>

###### replayAcceptedIntent?

`boolean`

###### snapshot

`ReviewRequest`

#### Returns

`Promise`\<`void` \| [`PipelineDispatchReceipt`](/cdk/interfaces/pipelinedispatchreceipt/)\>
