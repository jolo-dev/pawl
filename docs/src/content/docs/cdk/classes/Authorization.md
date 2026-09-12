---
editUrl: false
next: false
prev: false
title: "Authorization"
---

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:49

Authorization type for an API Destination Connection

## Constructors

### Constructor

> **new Authorization**(): `Authorization`

#### Returns

`Authorization`

## Methods

### apiKey()

> `static` **apiKey**(`apiKeyName`, `apiKeyValue`): `Authorization`

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:56

Use API key authorization

API key authorization has two components: an API key name and an API key value.
What these are depends on the target of your connection.

#### Parameters

##### apiKeyName

`string`

##### apiKeyValue

[`SecretValue`](/cdk/classes/secretvalue/)

#### Returns

`Authorization`

***

### basic()

> `static` **basic**(`username`, `password`): `Authorization`

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:60

Use username and password authorization

#### Parameters

##### username

`string`

##### password

[`SecretValue`](/cdk/classes/secretvalue/)

#### Returns

`Authorization`

***

### oauth()

> `static` **oauth**(`props`): `Authorization`

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:64

Use OAuth authorization

#### Parameters

##### props

`OAuthAuthorizationProps`

#### Returns

`Authorization`
