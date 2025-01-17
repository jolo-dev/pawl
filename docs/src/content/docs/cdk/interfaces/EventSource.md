---
editUrl: false
next: false
prev: false
title: "EventSource"
---

Defined in: packages/cdk/src/dynamodb-streams.ts:20

## Properties

### batchSize?

> `readonly` `optional` **batchSize**: `number`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:22

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

***

### bisectBatchOnError?

> `readonly` `optional` **bisectBatchOnError**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:77

If the function returns an error, split the batch in two and retry.

#### Default

```ts
false
```

***

### enabled?

> `readonly` `optional` **enabled**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:41

If the stream event source mapping should be enabled.

#### Default

```ts
true
```

***

### filterEncryption?

> `readonly` `optional` **filterEncryption**: `IKey`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:150

Add Customer managed KMS key to encrypt Filter Criteria.

#### See

 - https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventfiltering.html
By default, Lambda will encrypt Filter Criteria using AWS managed keys
 - https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#aws-managed-cmk

#### Default

```ts
- none
```

***

### filters?

> `readonly` `optional` **filters**: `object`[]

Defined in: node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:139

Add filter criteria option

#### Index Signature

\[`key`: `string`\]: `any`

#### Default

```ts
- None
```

***

### maxBatchingWindow?

> `readonly` `optional` **maxBatchingWindow**: `Duration`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:35

The maximum amount of time to gather records before invoking the function.
Maximum of Duration.minutes(5).

#### See

https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventsourcemapping.html#invocation-eventsourcemapping-batching

#### Default

```ts
- Duration.seconds(0) for Kinesis, DynamoDB, and SQS event sources, Duration.millis(500) for MSK, self-managed Kafka, and Amazon MQ.
```

***

### maxRecordAge?

> `readonly` `optional` **maxRecordAge**: `Duration`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:90

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

***

### metricsConfig?

> `readonly` `optional` **metricsConfig**: `MetricsConfig`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:157

Configuration for enhanced monitoring metrics collection
When specified, enables collection of additional metrics for the stream event source

#### Default

```ts
- Enhanced monitoring is disabled
```

***

### onFailure?

> `readonly` `optional` **onFailure**: `IEventSourceDlq`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:133

An Amazon SQS queue or Amazon SNS topic destination for discarded records.

#### Default

```ts
- discarded records are ignored
```

***

### parallelizationFactor?

> `readonly` `optional` **parallelizationFactor**: `number`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:112

The number of batches to process from each shard concurrently.
Valid Range:
* Minimum value of 1
* Maximum value of 10

#### Default

```ts
1
```

***

### provisionedPollerConfig?

> `readonly` `optional` **provisionedPollerConfig**: `ProvisionedPollerConfig`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:48

Configuration for provisioned pollers that read from the event source.
When specified, allows control over the minimum and maximum number of pollers
that can be provisioned to process events from the source.

#### Default

```ts
- no provisioned pollers
```

***

### reportBatchItemFailures?

> `readonly` `optional` **reportBatchItemFailures**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:120

Allow functions to return partially successful responses for a batch of records.

#### See

https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html#services-ddb-batchfailurereporting

#### Default

```ts
false
```

***

### retryAttempts?

> `readonly` `optional` **retryAttempts**: `number`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:103

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

***

### startingPosition

> **startingPosition**: `"LATEST"` \| `"TRIM_HORIZON"` \| `"AT_TIMESTAMP"`

Defined in: packages/cdk/src/dynamodb-streams.ts:21

***

### tumblingWindow?

> `readonly` `optional` **tumblingWindow**: `Duration`

Defined in: node\_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts:127

The size of the tumbling windows to group records sent to DynamoDB or Kinesis
Valid Range: 0 - 15 minutes

#### Default

```ts
- None
```
