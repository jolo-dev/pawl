---
editUrl: false
next: false
prev: false
title: "CfnOutput"
---

Defined in: node\_modules/aws-cdk-lib/core/lib/cfn-output.d.ts:37

## Extends

- `CfnElement`

## Constructors

### Constructor

> **new CfnOutput**(`scope`, `id`, `props`): `CfnOutput`

Defined in: node\_modules/aws-cdk-lib/core/lib/cfn-output.d.ts:48

Creates a CfnOutput value for this stack.

#### Parameters

##### scope

[`Construct`](/cdk/interfaces/construct/)

The parent construct.

##### id

`string`

##### props

`CfnOutputProps`

CfnOutput properties.

#### Returns

`CfnOutput`

#### Overrides

`CfnElement.constructor`

## Properties

### logicalId

> `readonly` **logicalId**: `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/cfn-element.d.ts:25

The logical ID for this CloudFormation stack element. The logical ID of the element
is calculated from the path of the resource node in the construct tree.

To override this value, use `overrideLogicalId(newLogicalId)`.

#### Returns

the logical ID as a stringified token. This value will only get
resolved during synthesis.

#### Inherited from

`CfnElement.logicalId`

***

### node

> `readonly` **node**: `Node`

Defined in: node\_modules/constructs/lib/construct.d.ts:289

The tree node.

#### Inherited from

`CfnElement.node`

***

### stack

> `readonly` **stack**: `Stack`

Defined in: node\_modules/aws-cdk-lib/core/lib/cfn-element.d.ts:29

The stack in which this element is defined. CfnElements must be defined within a stack scope (directly or indirectly).

#### Inherited from

`CfnElement.stack`

## Accessors

### condition

#### Get Signature

> **get** **condition**(): `CfnCondition` \| `undefined`

Defined in: node\_modules/aws-cdk-lib/core/lib/cfn-output.d.ts:70

A condition to associate with this output value. If the condition evaluates
to `false`, this output value will not be included in the stack.

##### Default

```ts
- No condition is associated with the output.
```

##### Returns

`CfnCondition` \| `undefined`

#### Set Signature

> **set** **condition**(`condition`): `void`

Defined in: node\_modules/aws-cdk-lib/core/lib/cfn-output.d.ts:71

##### Parameters

###### condition

`CfnCondition` \| `undefined`

##### Returns

`void`

***

### creationStack

#### Get Signature

> **get** **creationStack**(): `string`[]

Defined in: node\_modules/aws-cdk-lib/core/lib/cfn-element.d.ts:81

##### Returns

`string`[]

the stack trace of the point where this Resource was created from, sourced
     from the +metadata+ entry typed +aws:cdk:logicalId+, and with the bottom-most
     node +internal+ entries filtered.

#### Inherited from

`CfnElement.creationStack`

***

### description

#### Get Signature

> **get** **description**(): `string` \| `undefined`

Defined in: node\_modules/aws-cdk-lib/core/lib/cfn-output.d.ts:55

A String type that describes the output value.
The description can be a maximum of 4 K in length.

##### Default

```ts
- No description.
```

##### Returns

`string` \| `undefined`

#### Set Signature

> **set** **description**(`description`): `void`

Defined in: node\_modules/aws-cdk-lib/core/lib/cfn-output.d.ts:56

##### Parameters

###### description

`string` \| `undefined`

##### Returns

`void`

***

### exportName

#### Get Signature

> **get** **exportName**(): `string` \| `undefined`

Defined in: node\_modules/aws-cdk-lib/core/lib/cfn-output.d.ts:80

The name used to export the value of this output across stacks.

To use the value in another stack, pass the value of
`output.importValue` to it.

##### Default

```ts
- the output is not exported
```

##### Returns

`string` \| `undefined`

#### Set Signature

> **set** **exportName**(`exportName`): `void`

Defined in: node\_modules/aws-cdk-lib/core/lib/cfn-output.d.ts:81

##### Parameters

###### exportName

`string` \| `undefined`

##### Returns

`void`

***

### importValue

#### Get Signature

> **get** **importValue**(): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/cfn-output.d.ts:98

Return the `Fn.importValue` expression to import this value into another stack

The returned value should not be used in the same stack, but in a
different one. It must be deployed to the same environment, as
CloudFormation exports can only be imported in the same Region and
account.

The is no automatic registration of dependencies between stacks when using
this mechanism, so you should make sure to deploy them in the right order
yourself.

You can use this mechanism to share values across Stacks in different
Stages. If you intend to share the value to another Stack inside the same
Stage, the automatic cross-stack referencing mechanism is more convenient.

##### Returns

`string`

***

### value

#### Get Signature

> **get** **value**(): `any`

Defined in: node\_modules/aws-cdk-lib/core/lib/cfn-output.d.ts:62

The value of the property returned by the aws cloudformation describe-stacks command.
The value of an output can include literals, parameter references, pseudo-parameters,
a mapping value, or intrinsic functions.

##### Returns

`any`

#### Set Signature

> **set** **value**(`value`): `void`

Defined in: node\_modules/aws-cdk-lib/core/lib/cfn-output.d.ts:63

##### Parameters

###### value

`any`

##### Returns

`void`

## Methods

### overrideLogicalId()

> **overrideLogicalId**(`newLogicalId`): `void`

Defined in: node\_modules/aws-cdk-lib/core/lib/cfn-element.d.ts:53

Overrides the auto-generated logical ID with a specific ID.

#### Parameters

##### newLogicalId

`string`

The new logical ID to use for this stack element.

#### Returns

`void`

#### Inherited from

`CfnElement.overrideLogicalId`

***

### toString()

> **toString**(): `string`

Defined in: node\_modules/constructs/lib/construct.d.ts:314

Returns a string representation of this construct.

#### Returns

`string`

#### Inherited from

`CfnElement.toString`

***

### with()

> **with**(...`mixins`): `IConstruct`

Defined in: node\_modules/aws-cdk-lib/core/lib/cfn-element.d.ts:48

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

`CfnElement.with`

***

### isCfnElement()

> `static` **isCfnElement**(`x`): `x is CfnElement`

Defined in: node\_modules/aws-cdk-lib/core/lib/cfn-element.d.ts:15

Returns `true` if a construct is a stack element (i.e. part of the
synthesized cloudformation template).

Uses duck-typing instead of `instanceof` to allow stack elements from different
versions of this library to be included in the same stack.

#### Parameters

##### x

`any`

#### Returns

`x is CfnElement`

The construct as a stack element or undefined if it is not a stack element.

#### Inherited from

`CfnElement.isCfnElement`

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

`CfnElement.isConstruct`
