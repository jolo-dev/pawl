---
editUrl: false
next: false
prev: false
title: "UserPool"
---

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:901

Define a Cognito User Pool

## Extends

- `UserPoolBase`

## Constructors

### Constructor

> **new UserPool**(`scope`, `id`, `props?`): `UserPool`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:934

#### Parameters

##### scope

[`Construct`](/cdk/interfaces/construct/)

##### id

`string`

##### props?

`UserPoolProps`

#### Returns

`UserPool`

#### Overrides

`UserPoolBase.constructor`

## Properties

### identityProviders

> `readonly` **identityProviders**: `IUserPoolIdentityProvider`[]

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:886

Get all identity providers registered with this user pool.

#### Inherited from

`UserPoolBase.identityProviders`

***

### node

> `readonly` **node**: `Node`

Defined in: node\_modules/constructs/lib/construct.d.ts:289

The tree node.

#### Inherited from

`UserPoolBase.node`

***

### userPoolArn

> `readonly` **userPoolArn**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:921

The ARN of the user pool

#### Overrides

`UserPoolBase.userPoolArn`

***

### userPoolId

> `readonly` **userPoolId**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:917

The physical ID of this user pool resource

#### Overrides

`UserPoolBase.userPoolId`

***

### userPoolProviderName

> `readonly` **userPoolProviderName**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:926

User pool provider name

#### Attribute

#### Overrides

`UserPoolBase.userPoolProviderName`

***

### userPoolProviderUrl

> `readonly` **userPoolProviderUrl**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:931

User pool provider URL

#### Attribute

***

### PROPERTY\_INJECTION\_ID

> `readonly` `static` **PROPERTY\_INJECTION\_ID**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:905

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

#### Inherited from

`UserPoolBase.env`

***

### stack

#### Get Signature

> **get** **stack**(): `Stack`

Defined in: node\_modules/aws-cdk-lib/core/lib/resource.d.ts:93

The stack in which this resource is defined.

##### Returns

`Stack`

#### Inherited from

`UserPoolBase.stack`

***

### userPoolRef

#### Get Signature

> **get** **userPoolRef**(): `UserPoolReference`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:887

A reference to a UserPool resource.

##### Returns

`UserPoolReference`

#### Inherited from

`UserPoolBase.userPoolRef`

## Methods

### addClient()

> **addClient**(`id`, `options?`): [`UserPoolClient`](/cdk/classes/userpoolclient/)

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:888

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

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:889

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

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:891

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

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:890

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

> **addTrigger**(`operation`, `fn`, `lambdaVersion?`): `void`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:939

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

`UserPoolBase.applyCrossStackReferenceStrength`

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

#### Inherited from

`UserPoolBase.applyRemovalPolicy`

***

### grant()

> **grant**(`grantee`, ...`actions`): `Grant`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:896

[disable-awslint:no-grants]

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

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:892

Register an identity provider with this user pool.

#### Parameters

##### provider

`IUserPoolIdentityProviderRef`

#### Returns

`void`

#### Inherited from

`UserPoolBase.registerIdentityProvider`

***

### toString()

> **toString**(): `string`

Defined in: node\_modules/constructs/lib/construct.d.ts:314

Returns a string representation of this construct.

#### Returns

`string`

#### Inherited from

`UserPoolBase.toString`

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

#### Inherited from

`UserPoolBase.with`

***

### fromUserPoolArn()

> `static` **fromUserPoolArn**(`scope`, `id`, `userPoolArn`): `IUserPool`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:913

Import an existing user pool based on its ARN.

#### Parameters

##### scope

[`Construct`](/cdk/interfaces/construct/)

##### id

`string`

##### userPoolArn

`string`

#### Returns

`IUserPool`

***

### fromUserPoolId()

> `static` **fromUserPoolId**(`scope`, `id`, `userPoolId`): `IUserPool`

Defined in: node\_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts:909

Import an existing user pool based on its id.

#### Parameters

##### scope

[`Construct`](/cdk/interfaces/construct/)

##### id

`string`

##### userPoolId

`string`

#### Returns

`IUserPool`

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

`UserPoolBase.isConstruct`

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

`UserPoolBase.isOwnedResource`

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

`UserPoolBase.isResource`
