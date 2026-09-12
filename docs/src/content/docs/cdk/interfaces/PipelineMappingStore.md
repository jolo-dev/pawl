---
editUrl: false
next: false
prev: false
title: "PipelineMappingStore"
---

Defined in: [packages/cdk/src/reviewer/pipeline-review-common.ts:57](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/reviewer/pipeline-review-common.ts#L57)

Runtime store for execution-to-PR mapping.

## Methods

### getMapping()

> **getMapping**(`executionId`): `Promise`\<\{ `destinationCommitId`: `string`; `pullRequestId`: `string`; `repositoryName`: `string`; `sourceCommitId`: `string`; \} \| `undefined`\>

Defined in: [packages/cdk/src/reviewer/pipeline-review-common.ts:65](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/reviewer/pipeline-review-common.ts#L65)

#### Parameters

##### executionId

`string`

#### Returns

`Promise`\<\{ `destinationCommitId`: `string`; `pullRequestId`: `string`; `repositoryName`: `string`; `sourceCommitId`: `string`; \} \| `undefined`\>

***

### putMapping()

> **putMapping**(`params`): `Promise`\<`void`\>

Defined in: [packages/cdk/src/reviewer/pipeline-review-common.ts:58](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/reviewer/pipeline-review-common.ts#L58)

#### Parameters

##### params

###### destinationCommitId

`string`

###### executionId

`string`

###### pullRequestId

`string`

###### repositoryName

`string`

###### sourceCommitId

`string`

#### Returns

`Promise`\<`void`\>
