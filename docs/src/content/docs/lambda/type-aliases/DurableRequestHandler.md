---
editUrl: false
next: false
prev: false
title: "DurableRequestHandler"
---

> **DurableRequestHandler**\<`TEvent`, `TResult`\> = (`event`, `context`, `utilities`) => `Promise`\<`TResult`\>

Defined in: [durable-handler.ts:20](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/lambda/src/durable-handler.ts#L20)

Handles a durable request with shared Powertools utilities.

## Type Parameters

### TEvent

`TEvent`

### TResult

`TResult`

## Parameters

### event

`TEvent`

### context

`DurableContext`

### utilities

#### logger

`Logger`

#### metrics

`Metrics`

#### tracer

`Tracer`

## Returns

`Promise`\<`TResult`\>

## Remarks

Treat the supplied `Metrics` utility as physical-invocation scoped. Durable
replay and resumption can invoke this callback multiple times, and stored
metrics are published at the end of every physical invocation. Callers that
need a metric emitted once per logical execution must place that emission
behind a durable or otherwise idempotent boundary.
