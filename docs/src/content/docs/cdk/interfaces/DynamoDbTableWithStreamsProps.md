---
editUrl: false
next: false
prev: false
title: "DynamoDbTableWithStreamsProps"
---

Defined in: [packages/cdk/src/dynamodb-streams.ts:33](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/dynamodb-streams.ts#L33)

The DynamoDbTableWithStreamsProp

## Properties

### billing?

> `readonly` `optional` **billing?**: `Billing`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:310

The billing mode and capacity settings to apply to the table.

#### Default

```ts
Billing.onDemand()
```

***

### ~~contributorInsights?~~

> `readonly` `optional` **contributorInsights?**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:175

Whether CloudWatch contributor insights is enabled.

:::caution[Deprecated]
use `contributorInsightsSpecification` instead
:::

#### Default

```ts
false
```

***

### contributorInsightsSpecification?

> `readonly` `optional` **contributorInsightsSpecification?**: `ContributorInsightsSpecification`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:180

Whether CloudWatch contributor insights is enabled and what mode is selected

#### Default

```ts
- contributor insights is not enabled
```

***

### deletionProtection?

> `readonly` `optional` **deletionProtection?**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:186

Whether deletion protection is enabled.

#### Default

```ts
false
```

***

### dynamoStream

> **dynamoStream**: `"KEYS_ONLY"` \| `"NEW_AND_OLD_IMAGES"` \| `"NEW_IMAGE"` \| `"OLD_IMAGE"`

Defined in: [packages/cdk/src/dynamodb-streams.ts:37](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/dynamodb-streams.ts#L37)

***

### encryption?

> `readonly` `optional` **encryption?**: `TableEncryptionV2`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:371

The server-side encryption.

#### Default

```ts
TableEncryptionV2.dynamoOwnedKey()
```

***

### eventSource

> **eventSource**: [`EventSource`](/cdk/interfaces/eventsource/)

Defined in: [packages/cdk/src/dynamodb-streams.ts:45](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/dynamodb-streams.ts#L45)

***

### existingTable?

> `optional` **existingTable?**: `string`

Defined in: [packages/cdk/src/dynamodb-streams.ts:44](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/dynamodb-streams.ts#L44)

***

### globalSecondaryIndexes?

> `readonly` `optional` **globalSecondaryIndexes?**: `GlobalSecondaryIndexPropsV2`[]

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:357

Global secondary indexes.

Note: You can provide a maximum of 20 global secondary indexes.

#### Default

```ts
- no global secondary indexes
```

***

### globalTableSettingsReplicationMode?

> `readonly` `optional` **globalTableSettingsReplicationMode?**: `GlobalTableSettingsReplicationMode`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:333

Controls whether table settings are synchronized across replicas.

When set to ALL, synchronizable settings (billing mode, throughput, TTL, streams view type, GSIs)
are automatically replicated across all replicas. When set to NONE, each replica manages its own
settings independently (billing mode must be PAY_PER_REQUEST).

Note: Some settings are always synchronized (key schema, LSIs) regardless of this setting,
and some are never synchronized (table class, SSE, deletion protection, PITR, tags, resource policy).

#### Default

```ts
GlobalTableSettingsReplicationMode.NONE
```

***

### kinesisStream?

> `readonly` `optional` **kinesisStream?**: `IStream`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:211

Kinesis Data Stream to capture item level changes.

#### Default

```ts
- no Kinesis Data Stream
```

***

### lambdaFunction

> **lambdaFunction**: [`LambdaFunction`](/cdk/classes/lambdafunction/)

Defined in: [packages/cdk/src/dynamodb-streams.ts:38](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/dynamodb-streams.ts#L38)

***

### localSecondaryIndexes?

> `readonly` `optional` **localSecondaryIndexes?**: `LocalSecondaryIndexProps`[]

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:365

Local secondary indexes.

Note: You can only provide a maximum of 5 local secondary indexes.

#### Default

```ts
- no local secondary indexes
```

***

### multiRegionConsistency?

> `readonly` `optional` **multiRegionConsistency?**: `MultiRegionConsistency`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:349

Specifies the consistency mode for a new global table.

#### Default

```ts
MultiRegionConsistency.EVENTUAL
```

***

### partitionKey

> **partitionKey**: `object`

Defined in: [packages/cdk/src/dynamodb-streams.ts:39](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/dynamodb-streams.ts#L39)

#### name

> **name**: `string`

#### type

> **type**: `"STRING"` \| `"NUMBER"` \| `"BINARY"`

***

### permissions?

> `optional` **permissions?**: `ConstructPermission`[]

Defined in: [packages/cdk/src/basic-construct.ts:28](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/basic-construct.ts#L28)

Optional permissions to grant during creation

***

### ~~pointInTimeRecovery?~~

> `readonly` `optional` **pointInTimeRecovery?**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:192

Whether point-in-time recovery is enabled.

:::caution[Deprecated]
use `pointInTimeRecoverySpecification` instead
:::

#### Default

```ts
false - point in time recovery is not enabled.
```

***

### pointInTimeRecoverySpecification?

> `readonly` `optional` **pointInTimeRecoverySpecification?**: `PointInTimeRecoverySpecification`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:199

Whether point-in-time recovery is enabled
and recoveryPeriodInDays is set.

#### Default

```ts
- point in time recovery is not enabled.
```

***

### removalPolicy?

> `readonly` `optional` **removalPolicy?**: `undefined`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:304

The removal policy applied to the table.

#### Default

```ts
RemovalPolicy.RETAIN
```

***

### replicas?

> `readonly` `optional` **replicas?**: `ReplicaTableProps`[]

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:320

Replica tables to deploy with the primary table.

Note: Adding replica tables allows you to use your table as a global table. You
cannot specify a replica table in the region that the primary table will be deployed
to. Replica tables will only be supported if the stack deployment region is defined.

#### Default

```ts
- no replica tables
```

***

### resourcePolicy?

> `readonly` `optional` **resourcePolicy?**: `PolicyDocument`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:223

Resource policy to assign to DynamoDB Table.

#### See

https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-dynamodb-globaltable-replicaspecification.html#cfn-dynamodb-globaltable-replicaspecification-resourcepolicy

#### Default

```ts
- No resource policy statements are added to the created table.
```

***

### sortKey?

> `readonly` `optional` **sortKey?**: `Attribute`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:277

Sort key attribute definition.

#### Default

```ts
- no sort key
```

***

### streamResourcePolicy?

> `readonly` `optional` **streamResourcePolicy?**: `PolicyDocument`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:229

Resource policy to assign to DynamoDB Stream.

#### See

https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-dynamodb-globaltable-replicastreamspecification.html#cfn-dynamodb-globaltable-replicastreamspecification-resourcepolicy

#### Default

```ts
- No resource policy statements are added to the stream.
```

***

### tableClass?

> `readonly` `optional` **tableClass?**: `TableClass`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:205

The table class.

#### Default

```ts
TableClass.STANDARD
```

***

### tags?

> `readonly` `optional` **tags?**: `CfnTag`[]

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:217

Tags to be applied to the primary table (default replica table).

#### Default

```ts
- no tags
```

***

### timeToLiveAttribute?

> `readonly` `optional` **timeToLiveAttribute?**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:289

The name of the TTL attribute.

#### Default

```ts
- TTL is disabled
```

***

### warmThroughput?

> `readonly` `optional` **warmThroughput?**: `WarmThroughput`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:377

The warm throughput configuration for the table.

#### Default

```ts
- no warm throughput is configured
```

***

### witnessRegion?

> `readonly` `optional` **witnessRegion?**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:343

The witness Region for the MRSC global table.
A MRSC global table can be configured with either three replicas, or with two replicas and one witness.

Note: Witness region cannot be specified for a Multi-Region Eventual Consistency (MREC) Global Table.
Witness regions are only supported for Multi-Region Strong Consistency (MRSC) Global Tables.

#### Default

```ts
- no witness region
```
