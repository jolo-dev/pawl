---
editUrl: false
next: false
prev: false
title: "DynamoDbTableConfig"
---

> **DynamoDbTableConfig** = `object`

Defined in: [packages/cdk/src/dynamodb-table.ts:101](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/dynamodb-table.ts#L101)

Durable state-table settings accepted by Pawl.

## Type Declaration

### globalSecondaryIndexes?

> `optional` **globalSecondaryIndexes?**: `object`[]

### partitionKey

> **partitionKey**: `object` = `KeySchema`

#### partitionKey.name

> **name**: `string`

#### partitionKey.type

> **type**: `"STRING"` \| `"NUMBER"` \| `"BINARY"`

### pointInTimeRecovery

> **pointInTimeRecovery**: `boolean`

### retain

> **retain**: `boolean`

### sortKey?

> `optional` **sortKey?**: `object`

#### sortKey.name

> **name**: `string`

#### sortKey.type

> **type**: `"STRING"` \| `"NUMBER"` \| `"BINARY"`

### timeToLiveAttribute?

> `optional` **timeToLiveAttribute?**: `string`
