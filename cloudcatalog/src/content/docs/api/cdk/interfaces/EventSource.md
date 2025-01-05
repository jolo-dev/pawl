---
editUrl: false
next: false
prev: false
title: "EventSource"
---

## Properties

### batchSize?

> `readonly` `optional` **batchSize**: `number`

The largest number of records that AWS Lambda will retrieve from your event
source at the time of invoking your function. Your function receives an
event with all the retrieved records.

Valid Range:
* Minimum value of 1
* Maximum value of:
  * 1000 for `DynamoEventSource`
  * 10000 for `KinesisEventSource`, `ManagedKafkaEventSource` and `SelfManagedKafkaEventSource`

#### Default

```ts
100
```

#### Defined in

node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:22

***

### bisectBatchOnError?

> `readonly` `optional` **bisectBatchOnError**: `boolean`

If the function returns an error, split the batch in two and retry.

#### Default

```ts
false
```

#### Defined in

node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:77

***

### enabled?

> `readonly` `optional` **enabled**: `boolean`

If the stream event source mapping should be enabled.

#### Default

```ts
true
```

#### Defined in

node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:41

***

### filterEncryption?

> `readonly` `optional` **filterEncryption**: `IKey`

Add Customer managed KMS key to encrypt Filter Criteria.

#### See

 - https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventfiltering.html
By default, Lambda will encrypt Filter Criteria using AWS managed keys
 - https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#aws-managed-cmk

#### Default

```ts
- none
```

#### Defined in

node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:150

***

### filters?

> `readonly` `optional` **filters**: `object`[]

Add filter criteria option

#### Index Signature

 \[`key`: `string`\]: `any`

#### Default

```ts
- None
```

#### Defined in

node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:139

***

### maxBatchingWindow?

> `readonly` `optional` **maxBatchingWindow**: `Duration`

The maximum amount of time to gather records before invoking the function.
Maximum of Duration.minutes(5).

#### See

https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventsourcemapping.html#invocation-eventsourcemapping-batching

#### Default

```ts
- Duration.seconds(0) for Kinesis, DynamoDB, and SQS event sources, Duration.millis(500) for MSK, self-managed Kafka, and Amazon MQ.
```

#### Defined in

node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:35

***

### maxRecordAge?

> `readonly` `optional` **maxRecordAge**: `Duration`

The maximum age of a record that Lambda sends to a function for processing.
Valid Range:
* Minimum value of 60 seconds
* Maximum value of 7 days

The default value is -1, which sets the maximum age to infinite.
When the value is set to infinite, Lambda never discards old records.
Record are valid until it expires in the event source.

#### Default

```ts
-1
```

#### Defined in

node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:90

***

### metricsConfig?

> `readonly` `optional` **metricsConfig**: `MetricsConfig`

Configuration for enhanced monitoring metrics collection
When specified, enables collection of additional metrics for the stream event source

#### Default

```ts
- Enhanced monitoring is disabled
```

#### Defined in

node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:157

***

### onFailure?

> `readonly` `optional` **onFailure**: `IEventSourceDlq`

An Amazon SQS queue or Amazon SNS topic destination for discarded records.

#### Default

```ts
- discarded records are ignored
```

#### Defined in

node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:133

***

### parallelizationFactor?

> `readonly` `optional` **parallelizationFactor**: `number`

The number of batches to process from each shard concurrently.
Valid Range:
* Minimum value of 1
* Maximum value of 10

#### Default

```ts
1
```

#### Defined in

node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:112

***

### provisionedPollerConfig?

> `readonly` `optional` **provisionedPollerConfig**: `ProvisionedPollerConfig`

Configuration for provisioned pollers that read from the event source.
When specified, allows control over the minimum and maximum number of pollers
that can be provisioned to process events from the source.

#### Default

```ts
- no provisioned pollers
```

#### Defined in

node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:48

***

### reportBatchItemFailures?

> `readonly` `optional` **reportBatchItemFailures**: `boolean`

Allow functions to return partially successful responses for a batch of records.

#### See

https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html#services-ddb-batchfailurereporting

#### Default

```ts
false
```

#### Defined in

node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:120

***

### retryAttempts?

> `readonly` `optional` **retryAttempts**: `number`

Maximum number of retry attempts
Valid Range:
* Minimum value of 0
* Maximum value of 10000

The default value is -1, which sets the maximum number of retries to infinite.
When MaximumRetryAttempts is infinite, Lambda retries failed records until
the record expires in the event source.

#### Default

```ts
-1
```

#### Defined in

node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:103

***

### startingPosition

> **startingPosition**: `"LATEST"` \| `"TRIM_HORIZON"` \| `"AT_TIMESTAMP"`

#### Defined in

packages/cdk/src/dynamodb-streams.ts:21

***

### tumblingWindow?

> `readonly` `optional` **tumblingWindow**: `Duration`

The size of the tumbling windows to group records sent to DynamoDB or Kinesis
Valid Range: 0 - 15 minutes

#### Default

```ts
- None
```

#### Defined in

node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:127
