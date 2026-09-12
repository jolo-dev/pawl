---
editUrl: false
next: false
prev: false
title: "SqsProps"
---

> **SqsProps** = `object` & `Omit`\<`QueueProps`, `"queueName"` \| `"contentBasedDeduplication"` \| `"deadLetterQueue"`\> & `BasicConstructProps`

Defined in: [packages/cdk/src/sqs.ts:12](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/sqs.ts#L12)

## Type Declaration

### fifo?

> `optional` **fifo?**: `boolean`

### fn

> **fn**: [`LambdaFunction`](/cdk/classes/lambdafunction/)

### retry

> **retry**: `number`
