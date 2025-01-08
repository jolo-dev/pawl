---
editUrl: false
next: false
prev: false
title: "UserPool"
---

Define a Cognito User Pool

## Extends

- `UserPoolBase`

## Constructors

### new UserPool()

> **new UserPool**(`scope`, `id`, `props`?): [`UserPool`](/cdk/classes/userpool/)

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

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:777

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

#### Inherited from

`UserPoolBase.env`

#### Defined in

node\_modules/aws-cdk-lib/core/lib/resource.d.ts:111

***

### identityProviders

> `readonly` **identityProviders**: `IUserPoolIdentityProvider`[]

Get all identity providers registered with this user pool.

#### Inherited from

`UserPoolBase.identityProviders`

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:737

***

### node

> `readonly` **node**: `Node`

The tree node.

#### Inherited from

`UserPoolBase.node`

#### Defined in

node\_modules/constructs/lib/construct.d.ts:266

***

### stack

> `readonly` **stack**: `Stack`

The stack in which this resource is defined.

#### Inherited from

`UserPoolBase.stack`

#### Defined in

node\_modules/aws-cdk-lib/core/lib/resource.d.ts:110

***

### userPoolArn

> `readonly` **userPoolArn**: `string`

The ARN of the user pool

#### Overrides

`UserPoolBase.userPoolArn`

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:764

***

### userPoolId

> `readonly` **userPoolId**: `string`

The physical ID of this user pool resource

#### Overrides

`UserPoolBase.userPoolId`

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:760

***

### userPoolProviderName

> `readonly` **userPoolProviderName**: `string`

User pool provider name

#### Attribute

#### Overrides

`UserPoolBase.userPoolProviderName`

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:769

***

### userPoolProviderUrl

> `readonly` **userPoolProviderUrl**: `string`

User pool provider URL

#### Attribute

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:774

## Methods

### addClient()

> **addClient**(`id`, `options`?): [`UserPoolClient`](/cdk/classes/userpoolclient/)

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

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:738

***

### addDomain()

> **addDomain**(`id`, `options`): `UserPoolDomain`

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

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:739

***

### addGroup()

> **addGroup**(`id`, `options`): `UserPoolGroup`

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

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:741

***

### addResourceServer()

> **addResourceServer**(`id`, `options`): `UserPoolResourceServer`

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

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:740

***

### addTrigger()

> **addTrigger**(`operation`, `fn`, `lambdaVersion`?): `void`

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

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:782

***

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

`UserPoolBase.applyRemovalPolicy`

#### Defined in

node\_modules/aws-cdk-lib/core/lib/resource.d.ts:147

***

### grant()

> **grant**(`grantee`, ...`actions`): `Grant`

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

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:743

***

### registerIdentityProvider()

> **registerIdentityProvider**(`provider`): `void`

Register an identity provider with this user pool.

#### Parameters

##### provider

`IUserPoolIdentityProvider`

#### Returns

`void`

#### Inherited from

`UserPoolBase.registerIdentityProvider`

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:742

***

### toString()

> **toString**(): `string`

Returns a string representation of this construct.

#### Returns

`string`

#### Inherited from

`UserPoolBase.toString`

#### Defined in

node\_modules/constructs/lib/construct.d.ts:279

***

### fromUserPoolArn()

> `static` **fromUserPoolArn**(`scope`, `id`, `userPoolArn`): `IUserPool`

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

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:756

***

### fromUserPoolId()

> `static` **fromUserPoolId**(`scope`, `id`, `userPoolId`): `IUserPool`

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

#### Defined in

node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:752

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

`UserPoolBase.isConstruct`

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

`UserPoolBase.isOwnedResource`

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

`UserPoolBase.isResource`

#### Defined in

node\_modules/aws-cdk-lib/core/lib/resource.d.ts:105
