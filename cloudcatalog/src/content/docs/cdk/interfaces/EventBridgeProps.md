---
editUrl: false
next: false
prev: false
title: "EventBridgeProps"
---

## Extends

- `Omit`\<`EventBusProps`, `"deadLetterQueue"`\>

## Properties

### description?

> `readonly` `optional` **description**: `string`

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

#### Defined in

node\_modules/aws-cdk-lib/aws-events/lib/event-bus.d.ts:91

***

### eventBusName

> **eventBusName**: `string`

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

#### Defined in

packages/cdk/src/eventbridge.ts:27

***

### eventSourceName?

> `readonly` `optional` **eventSourceName**: `string`

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

#### Defined in

node\_modules/aws-cdk-lib/aws-events/lib/event-bus.d.ts:73

***

### kmsKey?

> `readonly` `optional` **kmsKey**: `IKey`

The customer managed key that encrypt events on this event bus.

#### Default

```ts
- Use an AWS managed key
```

#### Inherited from

`Omit.kmsKey`

#### Defined in

node\_modules/aws-cdk-lib/aws-events/lib/event-bus.d.ts:97

***

### secrets?

> `optional` **secrets**: `undefined`

#### Defined in

packages/cdk/src/eventbridge.ts:29

***

### targets

> **targets**: [`EventTarget`](/cdk/interfaces/eventtarget/)[]

#### Defined in

packages/cdk/src/eventbridge.ts:28
