---
editUrl: false
next: false
prev: false
title: "UserPool"
---

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:748

Define a Cognito User Pool

## Extends

- `UserPoolBase`

## Constructors

### new UserPool()

> **new UserPool**(`scope`, `id`, `props`?): [`UserPool`](/cdk/classes/userpool/)

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:777

#### Parameters

##### scope

[`Construct`](/cdk/classes/construct/)

##### id

`string`

##### props?

`UserPoolProps`

#### Returns

[`UserPool`](/cdk/classes/userpool/)

#### Overrides

`UserPoolBase.constructor`

## Properties

### env

> `readonly` **env**: `ResourceEnvironment`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:111

The environment this resource belongs to.
For resources that are created and managed by the CDK
(generally, those created by creating new class instances like Role, Bucket, etc.),
this is always the same as the environment of the stack they belong to;
however, for imported resources
(those obtained from static methods like fromRoleArn, fromBucketName, etc.),
that might be different than the stack they were imported into.

#### Inherited from

`UserPoolBase.env`

***

### identityProviders

> `readonly` **identityProviders**: `IUserPoolIdentityProvider`[]

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:737

Get all identity providers registered with this user pool.

#### Inherited from

`UserPoolBase.identityProviders`

***

### node

> `readonly` **node**: `Node`

Defined in: node\_modules/constructs/lib/construct.d.ts:266

The tree node.

#### Inherited from

`UserPoolBase.node`

***

### stack

> `readonly` **stack**: `Stack`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:110

The stack in which this resource is defined.

#### Inherited from

`UserPoolBase.stack`

***

### userPoolArn

> `readonly` **userPoolArn**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:764

The ARN of the user pool

#### Overrides

`UserPoolBase.userPoolArn`

***

### userPoolId

> `readonly` **userPoolId**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:760

The physical ID of this user pool resource

#### Overrides

`UserPoolBase.userPoolId`

***

### userPoolProviderName

> `readonly` **userPoolProviderName**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:769

User pool provider name

#### Attribute

#### Overrides

`UserPoolBase.userPoolProviderName`

***

### userPoolProviderUrl

> `readonly` **userPoolProviderUrl**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:774

User pool provider URL

#### Attribute

## Methods

### addClient()

> **addClient**(`id`, `options`?): [`UserPoolClient`](/cdk/classes/userpoolclient/)

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:738

Add a new app client to this user pool.

#### Parameters

##### id

`string`

##### options?

`UserPoolClientOptions`

#### Returns

[`UserPoolClient`](/cdk/classes/userpoolclient/)

#### See

https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html

#### Inherited from

`UserPoolBase.addClient`

***

### addDomain()

> **addDomain**(`id`, `options`): `UserPoolDomain`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:739

Associate a domain to this user pool.

#### Parameters

##### id

`string`

##### options

`UserPoolDomainOptions`

#### Returns

`UserPoolDomain`

#### See

https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-assign-domain.html

#### Inherited from

`UserPoolBase.addDomain`

***

### addGroup()

> **addGroup**(`id`, `options`): `UserPoolGroup`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:741

Add a new group to this user pool.

#### Parameters

##### id

`string`

##### options

`UserPoolGroupOptions`

#### Returns

`UserPoolGroup`

#### See

https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-user-groups.html

#### Inherited from

`UserPoolBase.addGroup`

***

### addResourceServer()

> **addResourceServer**(`id`, `options`): `UserPoolResourceServer`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:740

Add a new resource server to this user pool.

#### Parameters

##### id

`string`

##### options

`UserPoolResourceServerOptions`

#### Returns

`UserPoolResourceServer`

#### See

https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-resource-servers.html

#### Inherited from

`UserPoolBase.addResourceServer`

***

### addTrigger()

> **addTrigger**(`operation`, `fn`, `lambdaVersion`?): `void`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:782

Add a lambda trigger to a user pool operation

#### Parameters

##### operation

`UserPoolOperation`

##### fn

`IFunction`

##### lambdaVersion?

`LambdaVersion`

#### Returns

`void`

#### See

https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools-working-with-aws-lambda-triggers.html

***

### applyRemovalPolicy()

> **applyRemovalPolicy**(`policy`): `void`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:147

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

`UserPoolBase.applyRemovalPolicy`

***

### grant()

> **grant**(`grantee`, ...`actions`): `Grant`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:743

Adds an IAM policy statement associated with this user pool to an
IAM principal's policy.

#### Parameters

##### grantee

`IGrantable`

##### actions

...`string`[]

#### Returns

`Grant`

#### Inherited from

`UserPoolBase.grant`

***

### registerIdentityProvider()

> **registerIdentityProvider**(`provider`): `void`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:742

Register an identity provider with this user pool.

#### Parameters

##### provider

`IUserPoolIdentityProvider`

#### Returns

`void`

#### Inherited from

`UserPoolBase.registerIdentityProvider`

***

### toString()

> **toString**(): `string`

Defined in: node\_modules/constructs/lib/construct.d.ts:279

Returns a string representation of this construct.

#### Returns

`string`

#### Inherited from

`UserPoolBase.toString`

***

### fromUserPoolArn()

> `static` **fromUserPoolArn**(`scope`, `id`, `userPoolArn`): `IUserPool`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:756

Import an existing user pool based on its ARN.

#### Parameters

##### scope

[`Construct`](/cdk/classes/construct/)

##### id

`string`

##### userPoolArn

`string`

#### Returns

`IUserPool`

***

### fromUserPoolId()

> `static` **fromUserPoolId**(`scope`, `id`, `userPoolId`): `IUserPool`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:752

Import an existing user pool based on its id.

#### Parameters

##### scope

[`Construct`](/cdk/classes/construct/)

##### id

`string`

##### userPoolId

`string`

#### Returns

`IUserPool`

***

### isConstruct()

> `static` **isConstruct**(`x`): `x is Construct`

Defined in: node\_modules/constructs/lib/construct.d.ts:262

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

`UserPoolBase.isConstruct`

***

### isOwnedResource()

> `static` **isOwnedResource**(`construct`): `boolean`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:109

Returns true if the construct was created by CDK, and false otherwise

#### Parameters

##### construct

`IConstruct`

#### Returns

`boolean`

#### Inherited from

`UserPoolBase.isOwnedResource`

***

### isResource()

> `static` **isResource**(`construct`): `construct is Resource`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:105

Check whether the given construct is a Resource

#### Parameters

##### construct

`IConstruct`

#### Returns

`construct is Resource`

#### Inherited from

`UserPoolBase.isResource`
