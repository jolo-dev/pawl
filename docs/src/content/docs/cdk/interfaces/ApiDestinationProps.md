---
editUrl: false
next: false
prev: false
title: "ApiDestinationProps"
---

Defined in: packages/cdk/src/api-destination.ts:14

## Properties

### apiDestinationName

> `readonly` **apiDestinationName**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/api-destination.d.ts:12

The name for the API destination.

#### Default

```ts
- A unique name will be generated
```

***

### authorization

> **authorization**: [`Authorization`](/cdk/classes/authorization/)

Defined in: packages/cdk/src/api-destination.ts:17

***

### bodyParameters?

> `readonly` `optional` **bodyParameters**: `Record`\<`string`, `HttpParameter`\>

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:30

Additional string parameters to add to the invocation bodies

#### Default

```ts
- No additional parameters
```

***

### description

> `readonly` **description**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/api-destination.d.ts:18

A description for the API destination.

#### Default

```ts
- none
```

***

### endpoint

> `readonly` **endpoint**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/api-destination.d.ts:26

The URL to the HTTP invocation endpoint for the API destination..

***

### headerParameters?

> `readonly` `optional` **headerParameters**: `Record`\<`string`, `HttpParameter`\>

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:36

Additional string parameters to add to the invocation headers

#### Default

```ts
- No additional parameters
```

***

### httpMethod?

> `optional` **httpMethod**: `"GET"` \| `"POST"` \| `"PUT"`

Defined in: packages/cdk/src/api-destination.ts:18

***

### queryStringParameters?

> `readonly` `optional` **queryStringParameters**: `Record`\<`string`, `HttpParameter`\>

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:42

Additional string parameters to add to the invocation query strings

#### Default

```ts
- No additional parameters
```

***

### rateLimitPerSecond?

> `optional` **rateLimitPerSecond**: `number`

Defined in: packages/cdk/src/api-destination.ts:19
