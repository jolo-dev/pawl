---
editUrl: false
next: false
prev: false
title: "Table"
---

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:506

A DynamoDB Table.

## Extends

- `TableBaseV2`

## Constructors

### Constructor

> **new Table**(`scope`, `id`, `props`): `TableV2`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:576

#### Parameters

##### scope

[`Construct`](/cdk/interfaces/construct/)

##### id

`string`

##### props

`TablePropsV2`

#### Returns

`TableV2`

#### Overrides

`TableBaseV2.constructor`

## Properties

### encryptionKey?

> `readonly` `optional` **encryptionKey?**: `IKey`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:535

The KMS encryption key for the table.

#### Overrides

`TableBaseV2.encryptionKey`

***

### grants

> `readonly` **grants**: `TableGrants`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:547

Grants for this table

#### Overrides

`TableBaseV2.grants`

***

### node

> `readonly` **node**: `Node`

Defined in: node\_modules/constructs/lib/construct.d.ts:289

The tree node.

#### Inherited from

`TableBaseV2.node`

***

### resourcePolicy?

> `optional` **resourcePolicy?**: `PolicyDocument`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:539

#### Attribute

#### Overrides

`TableBaseV2.resourcePolicy`

***

### streamResourcePolicy?

> `optional` **streamResourcePolicy?**: `PolicyDocument`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:543

Resource policy associated with this table's stream.

***

### PROPERTY\_INJECTION\_ID

> `readonly` `static` **PROPERTY\_INJECTION\_ID**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:510

Uniquely identifies this class.

## Accessors

### env

#### Get Signature

> **get** **env**(): `ResourceEnvironment`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:94

The environment this resource belongs to.

For resources that are created and managed in a Stack (those created by
creating new class instances like `new Role()`, `new Bucket()`, etc.), this
is always the same as the environment of the stack they belong to.

For referenced resources (those obtained from referencing methods like
`Role.fromRoleArn()`, `Bucket.fromBucketName()`, etc.), they might be
different than the stack they were imported into.

##### Returns

`ResourceEnvironment`

#### Inherited from

`TableBaseV2.env`

***

### stack

#### Get Signature

> **get** **stack**(): `Stack`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:93

The stack in which this resource is defined.

##### Returns

`Stack`

#### Inherited from

`TableBaseV2.stack`

***

### tableArn

#### Get Signature

> **get** **tableArn**(): `string`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:572

The ARN of the table.

##### Attribute

##### Returns

`string`

#### Overrides

`TableBaseV2.tableArn`

***

### tableId

#### Get Signature

> **get** **tableId**(): `string` \| `undefined`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:575

The ID of the table.

##### Attribute

##### Returns

`string` \| `undefined`

#### Overrides

`TableBaseV2.tableId`

***

### tableName

#### Get Signature

> **get** **tableName**(): `string`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:573

The name of the table.

##### Attribute

##### Returns

`string`

#### Overrides

`TableBaseV2.tableName`

***

### tableRef

#### Get Signature

> **get** **tableRef**(): `TableReference`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:70

A reference to this table.

##### Returns

`TableReference`

#### Inherited from

`TableBaseV2.tableRef`

***

### tableStreamArn

#### Get Signature

> **get** **tableStreamArn**(): `string` \| `undefined`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:574

The stream ARN of the table.

##### Attribute

##### Returns

`string` \| `undefined`

#### Overrides

`TableBaseV2.tableStreamArn`

## Methods

### addGlobalSecondaryIndex()

> **addGlobalSecondaryIndex**(`props`): `void`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:610

Add a global secondary index to the table.

Note: Global secondary indexes will be inherited by all replica tables.

#### Parameters

##### props

`GlobalSecondaryIndexPropsV2`

the properties of the global secondary index

#### Returns

`void`

***

### addLocalSecondaryIndex()

> **addLocalSecondaryIndex**(`props`): `void`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:618

Add a local secondary index to the table.

Note: Local secondary indexes will be inherited by all replica tables.

#### Parameters

##### props

`LocalSecondaryIndexProps`

the properties of the local secondary index

#### Returns

`void`

***

### addReplica()

> **addReplica**(`props`): `void`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:602

Add a replica table.

Note: Adding a replica table will allow you to use your table as a global table.

#### Parameters

##### props

`ReplicaTableProps`

the properties of the replica table to add

#### Returns

`void`

***

### addToResourcePolicy()

> **addToResourcePolicy**(`statement`): `AddToResourcePolicyResult`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:585

Adds a statement to the resource policy associated with this table.
A resource policy will be automatically created upon the first call to `addToResourcePolicy`.

Note that this does not work with imported tables.

#### Parameters

##### statement

`PolicyStatement`

The policy statement to add

#### Returns

`AddToResourcePolicyResult`

#### Overrides

`TableBaseV2.addToResourcePolicy`

***

### addToStreamResourcePolicy()

> **addToStreamResourcePolicy**(`statement`): `AddToResourcePolicyResult`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:594

Adds a statement to the resource policy associated with this table's stream.
A stream resource policy will be automatically created upon the first call to `addToStreamResourcePolicy`.

Note that this does not work with imported tables.

#### Parameters

##### statement

`PolicyStatement`

The policy statement to add

#### Returns

`AddToResourcePolicyResult`

***

### applyCrossStackReferenceStrength()

> **applyCrossStackReferenceStrength**(`strength`): `void`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:139

Override the cross-stack reference strength for this resource.

When set, any cross-stack reference to this resource will use the specified
mechanism instead of the global default determined by the
`@aws-cdk/core:defaultCrossStackReferences` context key. This is useful for
selectively weakening specific references to avoid the "deadly embrace" problem
without changing the app-wide default.

#### Parameters

##### strength

`ReferenceStrength`

The reference strength to use for this resource.

#### Returns

`void`

#### Inherited from

`TableBaseV2.applyCrossStackReferenceStrength`

***

### applyRemovalPolicy()

> **applyRemovalPolicy**(`policy`): `void`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:127

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

***

### grant()

> **grant**(`grantee`, ...`actions`): `Grant`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:82

Adds an IAM policy statement associated with this table to an IAM principal's policy.

Note: If `encryptionKey` is present, appropriate grants to the key needs to be added
separately using the `table.encryptionKey.grant*` methods.

[disable-awslint:no-grants]

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

***

### grantFullAccess()

> **grantFullAccess**(`grantee`): `Grant`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:166

Permits an IAM principal to all DynamoDB operations ('dynamodb:*') on this table.

Note: Appropriate grants will also be added to the customer-managed KMS keys associated with this
table if one was configured.

[disable-awslint:no-grants]

#### Parameters

##### grantee

`IGrantable`

the principal to grant access to

#### Returns

`Grant`

#### Inherited from

`TableBaseV2.grantFullAccess`

***

### grantOnKey()

> **grantOnKey**(`grantee`, ...`actions`): `GrantOnKeyResult`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:173

Grants permissions on the table's encryption key.

#### Parameters

##### grantee

`IGrantable`

the principal to grant access to

##### actions

...`string`[]

the KMS actions to grant

#### Returns

`GrantOnKeyResult`

#### Inherited from

`TableBaseV2.grantOnKey`

***

### grantReadData()

> **grantReadData**(`grantee`): `Grant`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:128

Permits an IAM principal all data read operations on this table.

Actions: BatchGetItem, GetRecords, GetShardIterator, Query, GetItem, Scan, DescribeTable.

Note: Appropriate grants will also be added to the customer-managed KMS keys associated with this
table if one was configured.

[disable-awslint:no-grants]

#### Parameters

##### grantee

`IGrantable`

the principal to grant access to

#### Returns

`Grant`

#### Inherited from

`TableBaseV2.grantReadData`

***

### grantReadWriteData()

> **grantReadWriteData**(`grantee`): `Grant`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:155

Permits an IAM principal to all data read/write operations on this table.

Actions: BatchGetItem, GetRecords, GetShardIterator, Query, GetItem, Scan, BatchWriteItem, PutItem, UpdateItem,
DeleteItem, DescribeTable.

Note: Appropriate grants will also be added to the customer-managed KMS keys associated with this
table if one was configured.

[disable-awslint:no-grants]

#### Parameters

##### grantee

`IGrantable`

the principal to grant access to

#### Returns

`Grant`

#### Inherited from

`TableBaseV2.grantReadWriteData`

***

### grantStream()

> **grantStream**(`grantee`, ...`actions`): `Grant`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:94

Adds an IAM policy statement associated with this table to an IAM principal's policy.

Note: If `encryptionKey` is present, appropriate grants to the key needs to be added
separately using the `table.encryptionKey.grant*` methods.

[disable-awslint:no-grants]

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

***

### grantStreamRead()

> **grantStreamRead**(`grantee`): `Grant`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:107

Adds an IAM policy statement associated with this table to an IAM principal's policy.

Actions: DescribeStream, GetRecords, GetShardIterator, ListStreams.

Note: Appropriate grants will also be added to the customer-managed KMS keys associated with this
table if one was configured.

[disable-awslint:no-grants]

#### Parameters

##### grantee

`IGrantable`

the principal to grant access to

#### Returns

`Grant`

#### Inherited from

`TableBaseV2.grantStreamRead`

***

### grantTableListStreams()

> **grantTableListStreams**(`grantee`): `Grant`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:115

Permits an IAM principal to list streams attached to this table.

[disable-awslint:no-grants]

#### Parameters

##### grantee

`IGrantable`

the principal to grant access to

#### Returns

`Grant`

#### Inherited from

`TableBaseV2.grantTableListStreams`

***

### grantWriteData()

> **grantWriteData**(`grantee`): `Grant`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:141

Permits an IAM principal all data write operations on this table.

Actions: BatchWriteItem, PutItem, UpdateItem, DeleteItem, DescribeTable.

Note: Appropriate grants will also be added to the customer-managed KMS keys associated with this
table if one was configured.

[disable-awslint:no-grants]

#### Parameters

##### grantee

`IGrantable`

the principal to grant access to

#### Returns

`Grant`

#### Inherited from

`TableBaseV2.grantWriteData`

***

### metric()

> **metric**(`metricName`, `props?`): `Metric`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:180

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

***

### metricConditionalCheckFailedRequests()

> **metricConditionalCheckFailedRequests**(`props?`): `Metric`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:211

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

***

### metricConsumedReadCapacityUnits()

> **metricConsumedReadCapacityUnits**(`props?`): `Metric`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:187

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

***

### metricConsumedWriteCapacityUnits()

> **metricConsumedWriteCapacityUnits**(`props?`): `Metric`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:194

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

***

### metricSuccessfulRequestLatency()

> **metricSuccessfulRequestLatency**(`props?`): `Metric`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:218

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

***

### ~~metricSystemErrors()~~

> **metricSystemErrors**(`props?`): `Metric`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:254

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

***

### metricSystemErrorsForOperations()

> **metricSystemErrorsForOperations**(`props?`): `IMetric`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:239

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

***

### ~~metricThrottledRequests()~~

> **metricThrottledRequests**(`props?`): `Metric`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:248

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

***

### metricThrottledRequestsForOperation()

> **metricThrottledRequestsForOperation**(`operation`, `props?`): `IMetric`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:225

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

***

### metricThrottledRequestsForOperations()

> **metricThrottledRequestsForOperations**(`props?`): `IMetric`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:232

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

***

### metricUserErrors()

> **metricUserErrors**(`props?`): `Metric`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2-base.d.ts:204

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

***

### replica()

> **replica**(`region`): `ITableV2`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:626

Retrieve a replica table.

Note: Replica tables are not supported in a region agnostic stack.

#### Parameters

##### region

`string`

the region of the replica table

#### Returns

`ITableV2`

***

### toString()

> **toString**(): `string`

Defined in: node\_modules/constructs/lib/construct.d.ts:314

Returns a string representation of this construct.

#### Returns

`string`

#### Inherited from

`TableBaseV2.toString`

***

### with()

> **with**(...`mixins`): `IConstruct`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:95

Applies one or more mixins to this construct.

Mixins are applied in order. The list of constructs is captured at the
start of the call, so constructs added by a mixin will not be visited.
Use multiple `with()` calls if subsequent mixins should apply to added
constructs.

#### Parameters

##### mixins

...`IMixin`[]

The mixins to apply

#### Returns

`IConstruct`

This construct for chaining

#### Inherited from

`TableBaseV2.with`

***

### fromTableArn()

> `static` **fromTableArn**(`scope`, `id`, `tableArn`): `ITableV2`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:526

Creates a Table construct that represents an external table via table ARN.

#### Parameters

##### scope

[`Construct`](/cdk/interfaces/construct/)

the parent creating construct (usually `this`)

##### id

`string`

the construct's name

##### tableArn

`string`

the table's ARN

#### Returns

`ITableV2`

***

### fromTableAttributes()

> `static` **fromTableAttributes**(`scope`, `id`, `attrs`): `ITableV2`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:534

Creates a Table construct that represents an external table.

#### Parameters

##### scope

[`Construct`](/cdk/interfaces/construct/)

the parent creating construct (usually `this`)

##### id

`string`

the construct's name

##### attrs

`TableAttributesV2`

attributes of the table

#### Returns

`ITableV2`

***

### fromTableName()

> `static` **fromTableName**(`scope`, `id`, `tableName`): `ITableV2`

Defined in: node\_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts:518

Creates a Table construct that represents an external table via table name.

#### Parameters

##### scope

[`Construct`](/cdk/interfaces/construct/)

the parent creating construct (usually `this`)

##### id

`string`

the construct's name

##### tableName

`string`

the table's name

#### Returns

`ITableV2`

***

### isConstruct()

> `static` **isConstruct**(`x`): `x is Construct`

Defined in: node\_modules/constructs/lib/construct.d.ts:285

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

***

### isOwnedResource()

> `static` **isOwnedResource**(`construct`): `boolean`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:80

Returns true if the construct was created by CDK, and false otherwise

#### Parameters

##### construct

`IConstruct`

#### Returns

`boolean`

#### Inherited from

`TableBaseV2.isOwnedResource`

***

### isResource()

> `static` **isResource**(`construct`): `construct is Resource`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:76

Check whether the given construct is a Resource

#### Parameters

##### construct

`IConstruct`

#### Returns

`construct is Resource`

#### Inherited from

`TableBaseV2.isResource`
