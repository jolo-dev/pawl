---
editUrl: false
next: false
prev: false
title: "DynamoDbTableWithStreamsProps"
---

The DynamoDbTableWithStreamsProp

## Properties

### billing?

> `readonly` `optional` **billing**: `Billing`

The billing mode and capacity settings to apply to the table.

#### Default

```ts
Billing.onDemand()
```

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:218

***

### contributorInsights?

> `readonly` `optional` **contributorInsights**: `boolean`

Whether CloudWatch contributor insights is enabled.

#### Default

```ts
false
```

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:101

***

### deletionProtection?

> `readonly` `optional` **deletionProtection**: `boolean`

Whether deletion protection is enabled.

#### Default

```ts
false
```

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:107

***

### dynamoStream

> **dynamoStream**: `"KEYS_ONLY"` \| `"NEW_AND_OLD_IMAGES"` \| `"NEW_IMAGE"` \| `"OLD_IMAGE"`

#### Defined in

packages/cdk/src/dynamodb-streams.ts:32

***

### encryption?

> `readonly` `optional` **encryption**: `TableEncryptionV2`

The server-side encryption.

#### Default

```ts
TableEncryptionV2.dynamoOwnedKey()
```

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:250

***

### eventSource

> **eventSource**: [`EventSource`](/api/cdk/interfaces/eventsource/)

#### Defined in

packages/cdk/src/dynamodb-streams.ts:39

***

### existingTable?

> `optional` **existingTable**: `string`

#### Defined in

packages/cdk/src/dynamodb-streams.ts:38

***

### globalSecondaryIndexes?

> `readonly` `optional` **globalSecondaryIndexes**: `GlobalSecondaryIndexPropsV2`[]

Global secondary indexes.

Note: You can provide a maximum of 20 global secondary indexes.

#### Default

```ts
- no global secondary indexes
```

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:236

***

### kinesisStream?

> `readonly` `optional` **kinesisStream**: `IStream`

Kinesis Data Stream to capture item level changes.

#### Default

```ts
- no Kinesis Data Stream
```

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:125

***

### lambdaFunction

> **lambdaFunction**: [`LambdaFunction`](/api/cdk/classes/lambdafunction/)

#### Defined in

packages/cdk/src/dynamodb-streams.ts:33

***

### localSecondaryIndexes?

> `readonly` `optional` **localSecondaryIndexes**: `LocalSecondaryIndexProps`[]

Local secondary indexes.

Note: You can only provide a maximum of 5 local secondary indexes.

#### Default

```ts
- no local secondary indexes
```

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:244

***

### partitionKey

> **partitionKey**: `object`

#### name

> **name**: `string`

#### type

> **type**: `"STRING"` \| `"NUMBER"` \| `"BINARY"`

#### Defined in

packages/cdk/src/dynamodb-streams.ts:34

***

### pointInTimeRecovery?

> `readonly` `optional` **pointInTimeRecovery**: `boolean`

Whether point-in-time recovery is enabled.

#### Default

```ts
false
```

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:113

***

### removalPolicy?

> `readonly` `optional` **removalPolicy**: `RemovalPolicy`

The removal policy applied to the table.

#### Default

```ts
RemovalPolicy.RETAIN
```

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:212

***

### replicas?

> `readonly` `optional` **replicas**: `ReplicaTableProps`[]

Replica tables to deploy with the primary table.

Note: Adding replica tables allows you to use your table as a global table. You
cannot specify a replica table in the region that the primary table will be deployed
to. Replica tables will only be supported if the stack deployment region is defined.

#### Default

```ts
- no replica tables
```

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:228

***

### resourcePolicy?

> `readonly` `optional` **resourcePolicy**: `PolicyDocument`

Resource policy to assign to DynamoDB Table.

#### See

https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-dynamodb-globaltable-replicaspecification.html#cfn-dynamodb-globaltable-replicaspecification-resourcepolicy

#### Default

```ts
- No resource policy statements are added to the created table.
```

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:137

***

### sortKey?

> `readonly` `optional` **sortKey**: `Attribute`

Sort key attribute definition.

#### Default

```ts
- no sort key
```

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:185

***

### tableClass?

> `readonly` `optional` **tableClass**: `TableClass`

The table class.

#### Default

```ts
TableClass.STANDARD
```

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:119

***

### tags?

> `readonly` `optional` **tags**: `CfnTag`[]

Tags to be applied to the primary table (default replica table).

#### Default

```ts
- no tags
```

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:131

***

### timeToLiveAttribute?

> `readonly` `optional` **timeToLiveAttribute**: `string`

The name of the TTL attribute.

#### Default

```ts
- TTL is disabled
```

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:197

***

### warmThroughput?

> `readonly` `optional` **warmThroughput**: `WarmThroughput`

The warm throughput configuration for the table.

#### Default

```ts
- no warm throughput is configured
```

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:256
