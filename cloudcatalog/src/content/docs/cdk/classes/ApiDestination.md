---
editUrl: false
next: false
prev: false
title: "ApiDestination"
---

https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_events.ApiDestination.html

## Extends

- `ApiDestination`

## Constructors

### new ApiDestination()

> **new ApiDestination**(`scope`, `id`, `props`): [`ApiDestination`](/cdk/classes/apidestination/)

The constructor function creates an ApiDestination with a Connection for your EventBridge.

#### Parameters

##### scope

[`Construct`](/cdk/classes/construct/)

The `scope` parameter in the constructor refers to the AWS
CloudFormation construct to which the ApiDestination is being added.

##### id

`string`

The `id` parameter in the constructor function is a string that represents
the unique identifier for the API destination being created. It is used to identify and reference
the specific instance of the API destination within the scope of the AWS CDK application.

##### props

[`ApiDestinationProps`](/cdk/interfaces/apidestinationprops/)

The `props` object in the constructor contains the following
properties:

#### Returns

[`ApiDestination`](/cdk/classes/apidestination/)

#### Overrides

`ApiDestinationEvent.constructor`

#### Defined in

packages/cdk/src/api-destination.ts:36

## Properties

### apiDestinationArn

> `readonly` **apiDestinationArn**: `string`

The ARN of the Api Destination created.

#### Attribute

#### Inherited from

`ApiDestinationEvent.apiDestinationArn`

#### Defined in

node\_modules/aws-cdk-lib/aws-events/lib/api-destination.d.ts:95

***

### apiDestinationName

> `readonly` **apiDestinationName**: `string`

The Name of the Api Destination created.

#### Attribute

#### Inherited from

`ApiDestinationEvent.apiDestinationName`

#### Defined in

node\_modules/aws-cdk-lib/aws-events/lib/api-destination.d.ts:90

***

### connection

> `readonly` **connection**: `IConnection`

The Connection to associate with Api Destination

#### Inherited from

`ApiDestinationEvent.connection`

#### Defined in

node\_modules/aws-cdk-lib/aws-events/lib/api-destination.d.ts:85

***

### env

> `readonly` **env**: `ResourceEnvironment`

The environment this resource belongs to.
For resources that are created and managed by the CDK
(generally, those created by creating new class instances like Role, Bucket, etc.),
this is always the same as the environment of the stack they belong to;
however, for imported resources
(those obtained from static methods like fromRoleArn, fromBucketName, etc.),
that might be different than the stack they were imported into.

#### Inherited from

`ApiDestinationEvent.env`

#### Defined in

node\_modules/aws-cdk-lib/core/lib/resource.d.ts:111

***

### node

> `readonly` **node**: `Node`

The tree node.

#### Inherited from

`ApiDestinationEvent.node`

#### Defined in

node\_modules/constructs/lib/construct.d.ts:266

***

### stack

> `readonly` **stack**: `Stack`

The stack in which this resource is defined.

#### Inherited from

`ApiDestinationEvent.stack`

#### Defined in

node\_modules/aws-cdk-lib/core/lib/resource.d.ts:110

## Methods

### applyRemovalPolicy()

> **applyRemovalPolicy**(`policy`): `void`

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

`ApiDestinationEvent.applyRemovalPolicy`

#### Defined in

node\_modules/aws-cdk-lib/core/lib/resource.d.ts:147

***

### toString()

> **toString**(): `string`

Returns a string representation of this construct.

#### Returns

`string`

#### Inherited from

`ApiDestinationEvent.toString`

#### Defined in

node\_modules/constructs/lib/construct.d.ts:279

***

### fromApiDestinationAttributes()

> `static` **fromApiDestinationAttributes**(`scope`, `id`, `attrs`): `ApiDestination`

Create an Api Destination construct from an existing Api Destination ARN.

#### Parameters

##### scope

[`Construct`](/cdk/classes/construct/)

The scope creating construct (usually `this`).

##### id

`string`

The construct's id.

##### attrs

`ApiDestinationAttributes`

The Api Destination import attributes.

#### Returns

`ApiDestination`

#### Inherited from

`ApiDestinationEvent.fromApiDestinationAttributes`

#### Defined in

node\_modules/aws-cdk-lib/aws-events/lib/api-destination.d.ts:81

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

#### Inherited from

`ApiDestinationEvent.isConstruct`

#### Defined in

node\_modules/constructs/lib/construct.d.ts:262

***

### isOwnedResource()

> `static` **isOwnedResource**(`construct`): `boolean`

Returns true if the construct was created by CDK, and false otherwise

#### Parameters

##### construct

`IConstruct`

#### Returns

`boolean`

#### Inherited from

`ApiDestinationEvent.isOwnedResource`

#### Defined in

node\_modules/aws-cdk-lib/core/lib/resource.d.ts:109

***

### isResource()

> `static` **isResource**(`construct`): `construct is Resource`

Check whether the given construct is a Resource

#### Parameters

##### construct

`IConstruct`

#### Returns

`construct is Resource`

#### Inherited from

`ApiDestinationEvent.isResource`

#### Defined in

node\_modules/aws-cdk-lib/core/lib/resource.d.ts:105
