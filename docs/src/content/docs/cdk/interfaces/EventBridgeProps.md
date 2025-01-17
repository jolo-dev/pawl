---
editUrl: false
next: false
prev: false
title: "EventBridgeProps"
---

Defined in: packages/cdk/src/eventbridge.ts:26

## Extends

- `Omit`\<`EventBusProps`, `"deadLetterQueue"`\>

## Properties

### description?

> `readonly` `optional` **description**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/event-bus.d.ts:91

The event bus description.

The description can be up to 512 characters long.

#### See

http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-events-eventbus.html#cfn-events-eventbus-description

#### Default

```ts
- no description
```

#### Inherited from

`Omit.description`

***

### eventBusName

> **eventBusName**: `string`

Defined in: packages/cdk/src/eventbridge.ts:27

The name of the event bus you are creating
Note: If 'eventSourceName' is passed in, you cannot set this

#### Link

https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-events-eventbus.html#cfn-events-eventbus-name

#### Default

```ts
- automatically generated name
```

#### Overrides

`Omit.eventBusName`

***

### eventSourceName?

> `readonly` `optional` **eventSourceName**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/event-bus.d.ts:73

The partner event source to associate with this event bus resource
Note: If 'eventBusName' is passed in, you cannot set this

#### Link

https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-events-eventbus.html#cfn-events-eventbus-eventsourcename

#### Default

```ts
- no partner event source
```

#### Inherited from

`Omit.eventSourceName`

***

### kmsKey?

> `readonly` `optional` **kmsKey**: `IKey`

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/event-bus.d.ts:97

The customer managed key that encrypt events on this event bus.

#### Default

```ts
- Use an AWS managed key
```

#### Inherited from

`Omit.kmsKey`

***

### secrets?

> `optional` **secrets**: `undefined`

Defined in: packages/cdk/src/eventbridge.ts:29

***

### targets

> **targets**: [`EventTarget`](/cdk/interfaces/eventtarget/)[]

Defined in: packages/cdk/src/eventbridge.ts:28
