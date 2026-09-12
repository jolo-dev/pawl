---
editUrl: false
next: false
prev: false
title: "Construct"
---

Defined in: node\_modules/constructs/lib/construct.d.ts:264

Represents the building block of the construct graph.

All constructs besides the root construct must be created within the scope of
another construct.

## Implements

- `IConstruct`

## Properties

### node

> `readonly` **node**: `Node`

Defined in: node\_modules/constructs/lib/construct.d.ts:289

The tree node.

#### Implementation of

`IConstruct.node`

## Methods

### toString()

> **toString**(): `string`

Defined in: node\_modules/constructs/lib/construct.d.ts:314

Returns a string representation of this construct.

#### Returns

`string`

***

### with()

> **with**(...`mixins`): `IConstruct`

Defined in: node\_modules/constructs/lib/construct.d.ts:310

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

#### Implementation of

`IConstruct.with`
