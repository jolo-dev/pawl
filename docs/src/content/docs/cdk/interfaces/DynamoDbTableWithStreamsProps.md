---
editUrl: false
next: false
prev: false
title: "DynamoDbTableWithStreamsProps"
---

Defined in: packages/cdk/src/dynamodb-streams.ts:29

The DynamoDbTableWithStreamsProp

## Properties

### billing?

> `readonly` `optional` **billing**: `Billing`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:218

The billing mode and capacity settings to apply to the table.

#### Default

```ts
Billing.onDemand()
```

***

### contributorInsights?

> `readonly` `optional` **contributorInsights**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:101

Whether CloudWatch contributor insights is enabled.

#### Default

```ts
false
```

***

### deletionProtection?

> `readonly` `optional` **deletionProtection**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:107

Whether deletion protection is enabled.

#### Default

```ts
false
```

***

### dynamoStream

> **dynamoStream**: `"KEYS_ONLY"` \| `"NEW_AND_OLD_IMAGES"` \| `"NEW_IMAGE"` \| `"OLD_IMAGE"`

Defined in: packages/cdk/src/dynamodb-streams.ts:33

***

### encryption?

> `readonly` `optional` **encryption**: `TableEncryptionV2`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:250

The server-side encryption.

#### Default

```ts
TableEncryptionV2.dynamoOwnedKey()
```

***

### eventSource

> **eventSource**: [`EventSource`](/cdk/interfaces/eventsource/)

Defined in: packages/cdk/src/dynamodb-streams.ts:41

***

### existingTable?

> `optional` **existingTable**: `string`

Defined in: packages/cdk/src/dynamodb-streams.ts:40

***

### globalSecondaryIndexes?

> `readonly` `optional` **globalSecondaryIndexes**: `GlobalSecondaryIndexPropsV2`[]

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:236

Global secondary indexes.

Note: You can provide a maximum of 20 global secondary indexes.

#### Default

```ts
- no global secondary indexes
```

***

### kinesisStream?

> `readonly` `optional` **kinesisStream**: `IStream`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:125

Kinesis Data Stream to capture item level changes.

#### Default

```ts
- no Kinesis Data Stream
```

***

### lambdaFunction

> **lambdaFunction**: [`LambdaFunction`](/cdk/classes/lambdafunction/)

Defined in: packages/cdk/src/dynamodb-streams.ts:34

***

### localSecondaryIndexes?

> `readonly` `optional` **localSecondaryIndexes**: `LocalSecondaryIndexProps`[]

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:244

Local secondary indexes.

Note: You can only provide a maximum of 5 local secondary indexes.

#### Default

```ts
- no local secondary indexes
```

***

### partitionKey

> **partitionKey**: `object`

Defined in: packages/cdk/src/dynamodb-streams.ts:35

#### name

> **name**: `string`

#### type

> **type**: `"STRING"` \| `"NUMBER"` \| `"BINARY"`

***

### permissions?

> `optional` **permissions**: `ConstructPermission`[]

Defined in: packages/cdk/src/basic-construct.ts:28

Optional permissions to grant during creation

***

### pointInTimeRecovery?

> `readonly` `optional` **pointInTimeRecovery**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:113

Whether point-in-time recovery is enabled.

#### Default

```ts
false
```

***

### removalPolicy?

> `readonly` `optional` **removalPolicy**: `undefined`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:212

The removal policy applied to the table.

#### Default

```ts
RemovalPolicy.RETAIN
```

***

### replicas?

> `readonly` `optional` **replicas**: `ReplicaTableProps`[]

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:228

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

> `readonly` `optional` **resourcePolicy**: `PolicyDocument`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:137

Resource policy to assign to DynamoDB Table.

#### See

https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-dynamodb-globaltable-replicaspecification.html#cfn-dynamodb-globaltable-replicaspecification-resourcepolicy

#### Default

```ts
- No resource policy statements are added to the created table.
```

***

### sortKey?

> `readonly` `optional` **sortKey**: `Attribute`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:185

Sort key attribute definition.

#### Default

```ts
- no sort key
```

***

### tableClass?

> `readonly` `optional` **tableClass**: `TableClass`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:119

The table class.

#### Default

```ts
TableClass.STANDARD
```

***

### tags?

> `readonly` `optional` **tags**: `CfnTag`[]

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:131

Tags to be applied to the primary table (default replica table).

#### Default

```ts
- no tags
```

***

### timeToLiveAttribute?

> `readonly` `optional` **timeToLiveAttribute**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:197

The name of the TTL attribute.

#### Default

```ts
- TTL is disabled
```

***

### warmThroughput?

> `readonly` `optional` **warmThroughput**: `WarmThroughput`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:256

The warm throughput configuration for the table.

#### Default

```ts
- no warm throughput is configured
```
