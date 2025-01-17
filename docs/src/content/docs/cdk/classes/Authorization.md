---
editUrl: false
next: false
prev: false
title: "Authorization"
---

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:47

Authorization type for an API Destination Connection

## Constructors

### new Authorization()

> **new Authorization**(): [`Authorization`](/cdk/classes/authorization/)

#### Returns

[`Authorization`](/cdk/classes/authorization/)

## Methods

### apiKey()

> `static` **apiKey**(`apiKeyName`, `apiKeyValue`): [`Authorization`](/cdk/classes/authorization/)

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:54

Use API key authorization

API key authorization has two components: an API key name and an API key value.
What these are depends on the target of your connection.

#### Parameters

##### apiKeyName

`string`

##### apiKeyValue

[`SecretValue`](/cdk/classes/secretvalue/)

#### Returns

[`Authorization`](/cdk/classes/authorization/)

***

### basic()

> `static` **basic**(`username`, `password`): [`Authorization`](/cdk/classes/authorization/)

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:58

Use username and password authorization

#### Parameters

##### username

`string`

##### password

[`SecretValue`](/cdk/classes/secretvalue/)

#### Returns

[`Authorization`](/cdk/classes/authorization/)

***

### oauth()

> `static` **oauth**(`props`): [`Authorization`](/cdk/classes/authorization/)

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:62

Use OAuth authorization

#### Parameters

##### props

`OAuthAuthorizationProps`

#### Returns

[`Authorization`](/cdk/classes/authorization/)
