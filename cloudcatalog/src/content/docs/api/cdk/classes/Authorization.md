---
editUrl: false
next: false
prev: false
title: "Authorization"
---

Authorization type for an API Destination Connection

## Constructors

### new Authorization()

> **new Authorization**(): [`Authorization`](/api/cdk/classes/authorization/)

#### Returns

[`Authorization`](/api/cdk/classes/authorization/)

## Methods

### apiKey()

> `static` **apiKey**(`apiKeyName`, `apiKeyValue`): [`Authorization`](/api/cdk/classes/authorization/)

Use API key authorization

API key authorization has two components: an API key name and an API key value.
What these are depends on the target of your connection.

#### Parameters

##### apiKeyName

`string`

##### apiKeyValue

[`SecretValue`](/api/cdk/classes/secretvalue/)

#### Returns

[`Authorization`](/api/cdk/classes/authorization/)

#### Defined in

node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:54

***

### basic()

> `static` **basic**(`username`, `password`): [`Authorization`](/api/cdk/classes/authorization/)

Use username and password authorization

#### Parameters

##### username

`string`

##### password

[`SecretValue`](/api/cdk/classes/secretvalue/)

#### Returns

[`Authorization`](/api/cdk/classes/authorization/)

#### Defined in

node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:58

***

### oauth()

> `static` **oauth**(`props`): [`Authorization`](/api/cdk/classes/authorization/)

Use OAuth authorization

#### Parameters

##### props

`OAuthAuthorizationProps`

#### Returns

[`Authorization`](/api/cdk/classes/authorization/)

#### Defined in

node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:62
