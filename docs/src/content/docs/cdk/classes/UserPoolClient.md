---
editUrl: false
next: false
prev: false
title: "UserPoolClient"
---

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool-client.d.ts:367

Define a UserPool App Client

## Extends

- `Resource`

## Implements

- `IUserPoolClient`

## Constructors

### Constructor

> **new UserPoolClient**(`scope`, `id`, `props`): `UserPoolClient`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool-client.d.ts:386

#### Parameters

##### scope

[`Construct`](/cdk/interfaces/construct/)

##### id

`string`

##### props

`UserPoolClientProps`

#### Returns

`UserPoolClient`

#### Overrides

`Resource.constructor`

## Properties

### node

> `readonly` **node**: `Node`

Defined in: node\_modules/constructs/lib/construct.d.ts:289

The tree node.

#### Implementation of

`IUserPoolClient.node`

#### Inherited from

`Resource.node`

***

### oAuthFlows

> `readonly` **oAuthFlows**: `OAuthFlows`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool-client.d.ts:383

The OAuth flows enabled for this client.

***

### userPoolClientId

> `readonly` **userPoolClientId**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool-client.d.ts:376

Name of the application client

#### Attribute

#### Implementation of

`IUserPoolClient.userPoolClientId`

***

### PROPERTY\_INJECTION\_ID

> `readonly` `static` **PROPERTY\_INJECTION\_ID**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool-client.d.ts:371

Uniquely identifies this class.

## Accessors

### env

#### Get Signature

> **get** **env**(): `ResourceEnvironment`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:94

The environment this resource belongs to.

For resources that are created and managed in a Stack (those created by
creating new class instances like `new Role()`, `new Bucket()`, etc.), this
is always the same as the environment of the stack they belong to.

For referenced resources (those obtained from referencing methods like
`Role.fromRoleArn()`, `Bucket.fromBucketName()`, etc.), they might be
different than the stack they were imported into.

##### Returns

`ResourceEnvironment`

#### Implementation of

`IUserPoolClient.env`

#### Inherited from

`Resource.env`

***

### stack

#### Get Signature

> **get** **stack**(): `Stack`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:93

The stack in which this resource is defined.

##### Returns

`Stack`

#### Implementation of

`IUserPoolClient.stack`

#### Inherited from

`Resource.stack`

***

### userPoolClientName

#### Get Signature

> **get** **userPoolClientName**(): `string`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool-client.d.ts:391

The client name that was specified via the `userPoolClientName` property during initialization,
throws an error otherwise.

##### Returns

`string`

***

### userPoolClientRef

#### Get Signature

> **get** **userPoolClientRef**(): `UserPoolClientReference`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool-client.d.ts:385

A reference to a UserPoolClient resource.

##### Returns

`UserPoolClientReference`

#### Implementation of

`IUserPoolClient.userPoolClientRef`

***

### userPoolClientSecret

#### Get Signature

> **get** **userPoolClientSecret**(): [`SecretValue`](/cdk/classes/secretvalue/)

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool-client.d.ts:392

The generated client secret. Only available if the "generateSecret" props is set to true

##### Attribute

##### Returns

[`SecretValue`](/cdk/classes/secretvalue/)

#### Implementation of

`IUserPoolClient.userPoolClientSecret`

## Methods

### applyCrossStackReferenceStrength()

> **applyCrossStackReferenceStrength**(`strength`): `void`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:139

Override the cross-stack reference strength for this resource.

When set, any cross-stack reference to this resource will use the specified
mechanism instead of the global default determined by the
`@aws-cdk/core:defaultCrossStackReferences` context key. This is useful for
selectively weakening specific references to avoid the "deadly embrace" problem
without changing the app-wide default.

#### Parameters

##### strength

`ReferenceStrength`

The reference strength to use for this resource.

#### Returns

`void`

#### Inherited from

`Resource.applyCrossStackReferenceStrength`

***

### applyRemovalPolicy()

> **applyRemovalPolicy**(`policy`): `void`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:127

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

#### Implementation of

`IUserPoolClient.applyRemovalPolicy`

#### Inherited from

`Resource.applyRemovalPolicy`

***

### toString()

> **toString**(): `string`

Defined in: node\_modules/constructs/lib/construct.d.ts:314

Returns a string representation of this construct.

#### Returns

`string`

#### Inherited from

`Resource.toString`

***

### with()

> **with**(...`mixins`): `IConstruct`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:95

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

`IUserPoolClient.with`

#### Inherited from

`Resource.with`

***

### fromUserPoolClientId()

> `static` **fromUserPoolClientId**(`scope`, `id`, `userPoolClientId`): `IUserPoolClient`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool-client.d.ts:375

Import a user pool client given its id.

#### Parameters

##### scope

[`Construct`](/cdk/interfaces/construct/)

##### id

`string`

##### userPoolClientId

`string`

#### Returns

`IUserPoolClient`

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

`Resource.isConstruct`

***

### isOwnedResource()

> `static` **isOwnedResource**(`construct`): `boolean`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:80

Returns true if the construct was created by CDK, and false otherwise

#### Parameters

##### construct

`IConstruct`

#### Returns

`boolean`

#### Inherited from

`Resource.isOwnedResource`

***

### isResource()

> `static` **isResource**(`construct`): `construct is Resource`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:76

Check whether the given construct is a Resource

#### Parameters

##### construct

`IConstruct`

#### Returns

`construct is Resource`

#### Inherited from

`Resource.isResource`
