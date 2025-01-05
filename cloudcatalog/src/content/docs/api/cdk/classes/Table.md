---
editUrl: false
next: false
prev: false
title: "Table"
---

A DynamoDB Table.

## Extends

- `TableBaseV2`

## Constructors

### new Table()

> **new Table**(`scope`, `id`, `props`): [`Table`](/api/cdk/classes/table/)

#### Parameters

##### scope

[`Construct`](/api/cdk/classes/construct/)

##### id

`string`

##### props

`TablePropsV2`

#### Returns

[`Table`](/api/cdk/classes/table/)

#### Overrides

`TableBaseV2.constructor`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:395

## Properties

### encryptionKey?

> `readonly` `optional` **encryptionKey**: `IKey`

The KMS encryption key for the table.

#### Overrides

`TableBaseV2.encryptionKey`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:368

***

### env

> `readonly` **env**: `ResourceEnvironment`

The environment this resource belongs to.
For resources that are created and managed by the CDK
(generally, those created by creating new class instances like Role, Bucket, etc.),
this is always the same as the environment of the stack they belong to;
however, for imported resources
(those obtained from static methods like fromRoleArn, fromBucketName, etc.),
that might be different than the stack they were imported into.

#### Inherited from

`TableBaseV2.env`

#### Defined in

node\_modules/aws-cdk-lib/core/lib/resource.d.ts:111

***

### node

> `readonly` **node**: `Node`

The tree node.

#### Inherited from

`TableBaseV2.node`

#### Defined in

node\_modules/constructs/lib/construct.d.ts:266

***

### resourcePolicy?

> `optional` **resourcePolicy**: `PolicyDocument`

#### Attribute

#### Overrides

`TableBaseV2.resourcePolicy`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:372

***

### stack

> `readonly` **stack**: `Stack`

The stack in which this resource is defined.

#### Inherited from

`TableBaseV2.stack`

#### Defined in

node\_modules/aws-cdk-lib/core/lib/resource.d.ts:110

***

### tableArn

> `readonly` **tableArn**: `string`

#### Attribute

#### Overrides

`TableBaseV2.tableArn`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:355

***

### tableId?

> `readonly` `optional` **tableId**: `string`

#### Attribute

#### Overrides

`TableBaseV2.tableId`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:367

***

### tableName

> `readonly` **tableName**: `string`

#### Attribute

#### Overrides

`TableBaseV2.tableName`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:359

***

### tableStreamArn?

> `readonly` `optional` **tableStreamArn**: `string`

#### Attribute

#### Overrides

`TableBaseV2.tableStreamArn`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:363

## Methods

### addGlobalSecondaryIndex()

> **addGlobalSecondaryIndex**(`props`): `void`

Add a global secondary index to the table.

Note: Global secondary indexes will be inherited by all replica tables.

#### Parameters

##### props

`GlobalSecondaryIndexPropsV2`

the properties of the global secondary index

#### Returns

`void`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:411

***

### addLocalSecondaryIndex()

> **addLocalSecondaryIndex**(`props`): `void`

Add a local secondary index to the table.

Note: Local secondary indexes will be inherited by all replica tables.

#### Parameters

##### props

`LocalSecondaryIndexProps`

the properties of the local secondary index

#### Returns

`void`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:419

***

### addReplica()

> **addReplica**(`props`): `void`

Add a replica table.

Note: Adding a replica table will allow you to use your table as a global table.

#### Parameters

##### props

`ReplicaTableProps`

the properties of the replica table to add

#### Returns

`void`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:403

***

### addToResourcePolicy()

> **addToResourcePolicy**(`statement`): `AddToResourcePolicyResult`

Adds a statement to the resource policy associated with this file system.
A resource policy will be automatically created upon the first call to `addToResourcePolicy`.

Note that this does not work with imported file systems.

#### Parameters

##### statement

`PolicyStatement`

The policy statement to add

#### Returns

`AddToResourcePolicyResult`

#### Inherited from

`TableBaseV2.addToResourcePolicy`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:243

***

### applyRemovalPolicy()

> **applyRemovalPolicy**(`policy`): `void`

Apply the given removal policy to this resource

The Removal Policy controls what happens to this resource when it stops
being managed by CloudFormation, either because you've removed it from the
CDK application or because you've made a change that requires the resource
to be replaced.

The resource can be deleted (`RemovalPolicy.DESTROY`), or left in your AWS
account for data recovery and cleanup later (`RemovalPolicy.RETAIN`).

#### Parameters

##### policy

`RemovalPolicy`

#### Returns

`void`

#### Inherited from

`TableBaseV2.applyRemovalPolicy`

#### Defined in

node\_modules/aws-cdk-lib/core/lib/resource.d.ts:147

***

### grant()

> **grant**(`grantee`, ...`actions`): `Grant`

Adds an IAM policy statement associated with this table to an IAM principal's policy.

Note: If `encryptionKey` is present, appropriate grants to the key needs to be added
separately using the `table.encryptionKey.grant*` methods.

#### Parameters

##### grantee

`IGrantable`

the principal (no-op if undefined)

##### actions

...`string`[]

the set of actions to allow (i.e., 'dynamodb:PutItem', 'dynamodb:GetItem', etc.)

#### Returns

`Grant`

#### Inherited from

`TableBaseV2.grant`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:64

***

### grantFullAccess()

> **grantFullAccess**(`grantee`): `Grant`

Permits an IAM principal to all DynamoDB operations ('dynamodb:*') on this table.

Note: Appropriate grants will also be added to the customer-managed KMS keys associated with this
table if one was configured.

#### Parameters

##### grantee

`IGrantable`

the principal to grant access to

#### Returns

`Grant`

#### Inherited from

`TableBaseV2.grantFullAccess`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:134

***

### grantReadData()

> **grantReadData**(`grantee`): `Grant`

Permits an IAM principal all data read operations on this table.

Actions: BatchGetItem, GetRecords, GetShardIterator, Query, GetItem, Scan, DescribeTable.

Note: Appropriate grants will also be added to the customer-managed KMS keys associated with this
table if one was configured.

#### Parameters

##### grantee

`IGrantable`

the principal to grant access to

#### Returns

`Grant`

#### Inherited from

`TableBaseV2.grantReadData`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:102

***

### grantReadWriteData()

> **grantReadWriteData**(`grantee`): `Grant`

Permits an IAM principal to all data read/write operations on this table.

Actions: BatchGetItem, GetRecords, GetShardIterator, Query, GetItem, Scan, BatchWriteItem, PutItem, UpdateItem,
DeleteItem, DescribeTable.

Note: Appropriate grants will also be added to the customer-managed KMS keys associated with this
table if one was configured.

#### Parameters

##### grantee

`IGrantable`

the principal to grant access to

#### Returns

`Grant`

#### Inherited from

`TableBaseV2.grantReadWriteData`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:125

***

### grantStream()

> **grantStream**(`grantee`, ...`actions`): `Grant`

Adds an IAM policy statement associated with this table to an IAM principal's policy.

Note: If `encryptionKey` is present, appropriate grants to the key needs to be added
separately using the `table.encryptionKey.grant*` methods.

#### Parameters

##### grantee

`IGrantable`

the principal (no-op if undefined)

##### actions

...`string`[]

the set of actions to allow (i.e., 'dynamodb:DescribeStream', 'dynamodb:GetRecords', etc.)

#### Returns

`Grant`

#### Inherited from

`TableBaseV2.grantStream`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:74

***

### grantStreamRead()

> **grantStreamRead**(`grantee`): `Grant`

Adds an IAM policy statement associated with this table to an IAM principal's policy.

Actions: DescribeStream, GetRecords, GetShardIterator, ListStreams.

Note: Appropriate grants will also be added to the customer-managed KMS keys associated with this
table if one was configured.

#### Parameters

##### grantee

`IGrantable`

the principal to grant access to

#### Returns

`Grant`

#### Inherited from

`TableBaseV2.grantStreamRead`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:85

***

### grantTableListStreams()

> **grantTableListStreams**(`grantee`): `Grant`

Permits an IAM principal to list streams attached to this table.

#### Parameters

##### grantee

`IGrantable`

the principal to grant access to

#### Returns

`Grant`

#### Inherited from

`TableBaseV2.grantTableListStreams`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:91

***

### grantWriteData()

> **grantWriteData**(`grantee`): `Grant`

Permits an IAM principal all data write operations on this table.

Actions: BatchWriteItem, PutItem, UpdateItem, DeleteItem, DescribeTable.

Note: Appropriate grants will also be added to the customer-managed KMS keys associated with this
table if one was configured.

#### Parameters

##### grantee

`IGrantable`

the principal to grant access to

#### Returns

`Grant`

#### Inherited from

`TableBaseV2.grantWriteData`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:113

***

### metric()

> **metric**(`metricName`, `props`?): `Metric`

Return the given named metric for this table.

By default, the metric will be calculated as a sum over a period of 5 minutes.
You can customize this by using the `statistic` and `period` properties.

#### Parameters

##### metricName

`string`

##### props?

`MetricOptions`

#### Returns

`Metric`

#### Inherited from

`TableBaseV2.metric`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:141

***

### metricConditionalCheckFailedRequests()

> **metricConditionalCheckFailedRequests**(`props`?): `Metric`

Metric for the conditional check failed requests for this table.

By default, the metric will be calculated as a sum over a period of 5 minutes.
You can customize this by using the `statistic` and `period` properties.

#### Parameters

##### props?

`MetricOptions`

#### Returns

`Metric`

#### Inherited from

`TableBaseV2.metricConditionalCheckFailedRequests`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:172

***

### metricConsumedReadCapacityUnits()

> **metricConsumedReadCapacityUnits**(`props`?): `Metric`

Metric for the consumed read capacity units for this table.

By default, the metric will be calculated as a sum over a period of 5 minutes.
You can customize this by using the `statistic` and `period` properties.

#### Parameters

##### props?

`MetricOptions`

#### Returns

`Metric`

#### Inherited from

`TableBaseV2.metricConsumedReadCapacityUnits`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:148

***

### metricConsumedWriteCapacityUnits()

> **metricConsumedWriteCapacityUnits**(`props`?): `Metric`

Metric for the consumed write capacity units for this table.

By default, the metric will be calculated as a sum over a period of 5 minutes.
You can customize this by using the `statistic` and `period` properties.

#### Parameters

##### props?

`MetricOptions`

#### Returns

`Metric`

#### Inherited from

`TableBaseV2.metricConsumedWriteCapacityUnits`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:155

***

### metricSuccessfulRequestLatency()

> **metricSuccessfulRequestLatency**(`props`?): `Metric`

Metric for the successful request latency for this table.

By default, the metric will be calculated as an average over a period of 5 minutes.
You can customize this by using the `statistic` and `period` properties.

#### Parameters

##### props?

`MetricOptions`

#### Returns

`Metric`

#### Inherited from

`TableBaseV2.metricSuccessfulRequestLatency`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:179

***

### ~~metricSystemErrors()~~

> **metricSystemErrors**(`props`?): `Metric`

Metric for the system errors this table

:::caution[Deprecated]
use `metricSystemErrorsForOperations`.
:::

#### Parameters

##### props?

`MetricOptions`

#### Returns

`Metric`

#### Inherited from

`TableBaseV2.metricSystemErrors`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:215

***

### metricSystemErrorsForOperations()

> **metricSystemErrorsForOperations**(`props`?): `IMetric`

Metric for the system errors for this table. This will sum errors across all possible operations.

By default, each individual metric will be calculated as a sum over a period of 5 minutes.
You can customize this by using the `statistic` and `period` properties.

#### Parameters

##### props?

`SystemErrorsForOperationsMetricOptions`

#### Returns

`IMetric`

#### Inherited from

`TableBaseV2.metricSystemErrorsForOperations`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:200

***

### ~~metricThrottledRequests()~~

> **metricThrottledRequests**(`props`?): `Metric`

How many requests are throttled on this table.

By default, each individual metric will be calculated as a sum over a period of 5 minutes.
You can customize this by using the `statistic` and `period` properties.

:::caution[Deprecated]
Do not use this function. It returns an invalid metric. Use `metricThrottledRequestsForOperation` instead.
:::

#### Parameters

##### props?

`MetricOptions`

#### Returns

`Metric`

#### Inherited from

`TableBaseV2.metricThrottledRequests`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:209

***

### metricThrottledRequestsForOperation()

> **metricThrottledRequestsForOperation**(`operation`, `props`?): `IMetric`

How many requests are throttled on this table for the given operation

By default, the metric will be calculated as an average over a period of 5 minutes.
You can customize this by using the `statistic` and `period` properties.

#### Parameters

##### operation

`string`

##### props?

`OperationsMetricOptions`

#### Returns

`IMetric`

#### Inherited from

`TableBaseV2.metricThrottledRequestsForOperation`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:186

***

### metricThrottledRequestsForOperations()

> **metricThrottledRequestsForOperations**(`props`?): `IMetric`

How many requests are throttled on this table. This will sum errors across all possible operations.

By default, each individual metric will be calculated as a sum over a period of 5 minutes.
You can customize this by using the `statistic` and `period` properties.

#### Parameters

##### props?

`OperationsMetricOptions`

#### Returns

`IMetric`

#### Inherited from

`TableBaseV2.metricThrottledRequestsForOperations`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:193

***

### metricUserErrors()

> **metricUserErrors**(`props`?): `Metric`

Metric for the user errors for this table.

Note: This metric reports user errors across all the tables in the account and region the table
resides in.

By default, the metric will be calculated as a sum over a period of 5 minutes.
You can customize this by using the `statistic` and `period` properties.

#### Parameters

##### props?

`MetricOptions`

#### Returns

`Metric`

#### Inherited from

`TableBaseV2.metricUserErrors`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:165

***

### replica()

> **replica**(`region`): `ITableV2`

Retrieve a replica table.

Note: Replica tables are not supported in a region agnostic stack.

#### Parameters

##### region

`string`

the region of the replica table

#### Returns

`ITableV2`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:427

***

### toString()

> **toString**(): `string`

Returns a string representation of this construct.

#### Returns

`string`

#### Inherited from

`TableBaseV2.toString`

#### Defined in

node\_modules/constructs/lib/construct.d.ts:279

***

### fromTableArn()

> `static` **fromTableArn**(`scope`, `id`, `tableArn`): `ITableV2`

Creates a Table construct that represents an external table via table ARN.

#### Parameters

##### scope

[`Construct`](/api/cdk/classes/construct/)

the parent creating construct (usually `this`)

##### id

`string`

the construct's name

##### tableArn

`string`

the table's ARN

#### Returns

`ITableV2`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:343

***

### fromTableAttributes()

> `static` **fromTableAttributes**(`scope`, `id`, `attrs`): `ITableV2`

Creates a Table construct that represents an external table.

#### Parameters

##### scope

[`Construct`](/api/cdk/classes/construct/)

the parent creating construct (usually `this`)

##### id

`string`

the construct's name

##### attrs

`TableAttributesV2`

attributes of the table

#### Returns

`ITableV2`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:351

***

### fromTableName()

> `static` **fromTableName**(`scope`, `id`, `tableName`): `ITableV2`

Creates a Table construct that represents an external table via table name.

#### Parameters

##### scope

[`Construct`](/api/cdk/classes/construct/)

the parent creating construct (usually `this`)

##### id

`string`

the construct's name

##### tableName

`string`

the table's name

#### Returns

`ITableV2`

#### Defined in

node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:335

***

### isConstruct()

> `static` **isConstruct**(`x`): `x is Construct`

Checks if `x` is a construct.

Use this method instead of `instanceof` to properly detect `Construct`
instances, even when the construct library is symlinked.

Explanation: in JavaScript, multiple copies of the `constructs` library on
disk are seen as independent, completely different libraries. As a
consequence, the class `Construct` in each copy of the `constructs` library
is seen as a different class, and an instance of one class will not test as
`instanceof` the other class. `npm install` will not create installations
like this, but users may manually symlink construct libraries together or
use a monorepo tool: in those cases, multiple copies of the `constructs`
library can be accidentally installed, and `instanceof` will behave
unpredictably. It is safest to avoid using `instanceof`, and using
this type-testing method instead.

#### Parameters

##### x

`any`

Any object

#### Returns

`x is Construct`

true if `x` is an object created from a class which extends `Construct`.

#### Inherited from

`TableBaseV2.isConstruct`

#### Defined in

node\_modules/constructs/lib/construct.d.ts:262

***

### isOwnedResource()

> `static` **isOwnedResource**(`construct`): `boolean`

Returns true if the construct was created by CDK, and false otherwise

#### Parameters

##### construct

`IConstruct`

#### Returns

`boolean`

#### Inherited from

`TableBaseV2.isOwnedResource`

#### Defined in

node\_modules/aws-cdk-lib/core/lib/resource.d.ts:109

***

### isResource()

> `static` **isResource**(`construct`): `construct is Resource`

Check whether the given construct is a Resource

#### Parameters

##### construct

`IConstruct`

#### Returns

`construct is Resource`

#### Inherited from

`TableBaseV2.isResource`

#### Defined in

node\_modules/aws-cdk-lib/core/lib/resource.d.ts:105
