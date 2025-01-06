---
editUrl: false
next: false
prev: false
title: "Construct"
---

Represents the building block of the construct graph.

All constructs besides the root construct must be created within the scope of
another construct.

## Implements

- `IConstruct`

## Constructors

### new Construct()

> **new Construct**(`scope`, `id`): [`Construct`](/public/api/cdk/classes/construct/)

Creates a new construct node.

#### Parameters

##### scope

[`Construct`](/public/api/cdk/classes/construct/)

The scope in which to define this construct

##### id

`string`

The scoped construct ID. Must be unique amongst siblings. If
the ID includes a path separator (`/`), then it will be replaced by double
dash `--`.

#### Returns

[`Construct`](/public/api/cdk/classes/construct/)

#### Defined in

node\_modules/constructs/lib/construct.d.ts:275

## Properties

### node

> `readonly` **node**: `Node`

The tree node.

#### Implementation of

`IConstruct.node`

#### Defined in

node\_modules/constructs/lib/construct.d.ts:266

## Methods

### toString()

> **toString**(): `string`

Returns a string representation of this construct.

#### Returns

`string`

#### Defined in

node\_modules/constructs/lib/construct.d.ts:279

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

#### Defined in

node\_modules/constructs/lib/construct.d.ts:262
