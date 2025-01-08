---
editUrl: false
next: false
prev: false
title: "UserPoolClient"
---

Define a UserPool App Client

## Extends

- `Resource`

## Implements

- `IUserPoolClient`

## Constructors

### new UserPoolClient()

> **new UserPoolClient**(`scope`, `id`, `props`): [`UserPoolClient`](/cdk/classes/userpoolclient/)

#### Parameters

##### scope

[`Construct`](/cdk/classes/construct/)

##### id

`string`

##### props

`UserPoolClientProps`

#### Returns

[`UserPoolClient`](/cdk/classes/userpoolclient/)

#### Overrides

`Resource.constructor`

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool-client.d.ts:330

## Properties

### env

> `readonly` **env**: `ResourceEnvironment`

The environment this resource belongs to.
For resources that are created and managed by the CDK
(generally, those created by creating new class instances like Role, Bucket, etc.),
this is always the same as the environment of the stack they belong to;
however, for imported resources
(those obtained from static methods like fromRoleArn, fromBucketName, etc.),
that might be different than the stack they were imported into.

#### Implementation of

`IUserPoolClient.env`

#### Inherited from

`Resource.env`

#### Defined in

node\_modules/aws-cdk-lib/core/lib/resource.d.ts:111

***

### node

> `readonly` **node**: `Node`

The tree node.

#### Implementation of

`IUserPoolClient.node`

#### Inherited from

`Resource.node`

#### Defined in

node\_modules/constructs/lib/construct.d.ts:266

***

### oAuthFlows

> `readonly` **oAuthFlows**: `OAuthFlows`

The OAuth flows enabled for this client.

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool-client.d.ts:328

***

### stack

> `readonly` **stack**: `Stack`

The stack in which this resource is defined.

#### Implementation of

`IUserPoolClient.stack`

#### Inherited from

`Resource.stack`

#### Defined in

node\_modules/aws-cdk-lib/core/lib/resource.d.ts:110

***

### userPoolClientId

> `readonly` **userPoolClientId**: `string`

Name of the application client

#### Attribute

#### Implementation of

`IUserPoolClient.userPoolClientId`

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool-client.d.ts:321

## Accessors

### userPoolClientName

#### Get Signature

> **get** **userPoolClientName**(): `string`

The client name that was specified via the `userPoolClientName` property during initialization,
throws an error otherwise.

##### Returns

`string`

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool-client.d.ts:335

***

### userPoolClientSecret

#### Get Signature

> **get** **userPoolClientSecret**(): [`SecretValue`](/cdk/classes/secretvalue/)

The generated client secret. Only available if the "generateSecret" props is set to true

##### Attribute

##### Returns

[`SecretValue`](/cdk/classes/secretvalue/)

#### Implementation of

`IUserPoolClient.userPoolClientSecret`

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool-client.d.ts:336

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

#### Implementation of

`IUserPoolClient.applyRemovalPolicy`

#### Inherited from

`Resource.applyRemovalPolicy`

#### Defined in

node\_modules/aws-cdk-lib/core/lib/resource.d.ts:147

***

### toString()

> **toString**(): `string`

Returns a string representation of this construct.

#### Returns

`string`

#### Inherited from

`Resource.toString`

#### Defined in

node\_modules/constructs/lib/construct.d.ts:279

***

### fromUserPoolClientId()

> `static` **fromUserPoolClientId**(`scope`, `id`, `userPoolClientId`): `IUserPoolClient`

Import a user pool client given its id.

#### Parameters

##### scope

[`Construct`](/cdk/classes/construct/)

##### id

`string`

##### userPoolClientId

`string`

#### Returns

`IUserPoolClient`

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool-client.d.ts:320

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

`Resource.isConstruct`

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

`Resource.isOwnedResource`

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

`Resource.isResource`

#### Defined in

node\_modules/aws-cdk-lib/core/lib/resource.d.ts:105
