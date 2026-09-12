---
editUrl: false
next: false
prev: false
title: "ApiDestinationProps"
---

Defined in: [packages/cdk/src/api-destination.ts:14](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/api-destination.ts#L14)

## Properties

### apiDestinationName

> `readonly` **apiDestinationName**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/api-destination.d.ts:16

The name for the API destination.

#### Default

```ts
- A unique name will be generated
```

***

### authorization

> **authorization**: [`Authorization`](/cdk/classes/authorization/)

Defined in: [packages/cdk/src/api-destination.ts:20](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/api-destination.ts#L20)

***

### bodyParameters?

> `readonly` `optional` **bodyParameters?**: `Record`\<`string`, `HttpParameter`\>

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:32

Additional string parameters to add to the invocation bodies

#### Default

```ts
- No additional parameters
```

***

### description

> `readonly` **description**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/api-destination.d.ts:22

A description for the API destination.

#### Default

```ts
- none
```

***

### endpoint

> `readonly` **endpoint**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/api-destination.d.ts:30

The URL to the HTTP invocation endpoint for the API destination..

***

### headerParameters?

> `readonly` `optional` **headerParameters?**: `Record`\<`string`, `HttpParameter`\>

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:38

Additional string parameters to add to the invocation headers

#### Default

```ts
- No additional parameters
```

***

### httpMethod?

> `optional` **httpMethod?**: `"GET"` \| `"POST"` \| `"PUT"`

Defined in: [packages/cdk/src/api-destination.ts:21](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/api-destination.ts#L21)

***

### queryStringParameters?

> `readonly` `optional` **queryStringParameters?**: `Record`\<`string`, `HttpParameter`\>

Defined in: node\_modules/aws-cdk-lib/aws-events/lib/connection.d.ts:44

Additional string parameters to add to the invocation query strings

#### Default

```ts
- No additional parameters
```

***

### rateLimitPerSecond?

> `optional` **rateLimitPerSecond?**: `number`

Defined in: [packages/cdk/src/api-destination.ts:22](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/api-destination.ts#L22)
