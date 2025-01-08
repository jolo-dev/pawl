---
editUrl: false
next: false
prev: false
title: "ApiDestinationProps"
---

## Properties

### apiDestinationName

> `readonly` **apiDestinationName**: `string`

The name for the API destination.

#### Default

```ts
- A unique name will be generated
```

#### Defined in

node\_modules/aws-cdk-lib/aws-events/lib/api-destination.d.ts:12

***

### authorization

> **authorization**: [`Authorization`](/cdk/classes/authorization/)

#### Defined in

packages/cdk/src/api-destination.ts:17

***

### bodyParameters?

> `readonly` `optional` **bodyParameters**: `Record`\<`string`, `HttpParameter`\>

Additional string parameters to add to the invocation bodies

#### Default

```ts
- No additional parameters
```

#### Defined in

node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:30

***

### description

> `readonly` **description**: `string`

A description for the API destination.

#### Default

```ts
- none
```

#### Defined in

node\_modules/aws-cdk-lib/aws-events/lib/api-destination.d.ts:18

***

### endpoint

> `readonly` **endpoint**: `string`

The URL to the HTTP invocation endpoint for the API destination..

#### Defined in

node\_modules/aws-cdk-lib/aws-events/lib/api-destination.d.ts:26

***

### headerParameters?

> `readonly` `optional` **headerParameters**: `Record`\<`string`, `HttpParameter`\>

Additional string parameters to add to the invocation headers

#### Default

```ts
- No additional parameters
```

#### Defined in

node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:36

***

### httpMethod?

> `optional` **httpMethod**: `"GET"` \| `"POST"` \| `"PUT"`

#### Defined in

packages/cdk/src/api-destination.ts:18

***

### queryStringParameters?

> `readonly` `optional` **queryStringParameters**: `Record`\<`string`, `HttpParameter`\>

Additional string parameters to add to the invocation query strings

#### Default

```ts
- No additional parameters
```

#### Defined in

node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:42

***

### rateLimitPerSecond?

> `optional` **rateLimitPerSecond**: `number`

#### Defined in

packages/cdk/src/api-destination.ts:19
