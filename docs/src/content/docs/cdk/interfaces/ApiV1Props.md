---
editUrl: false
next: false
prev: false
title: "ApiV1Props"
---

Defined in: [packages/cdk/src/apigateway-v1.ts:30](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/apigateway-v1.ts#L30)

## Extends

- `BasicConstructProps`

## Properties

### authorizationType?

> `optional` **authorizationType?**: `AuthorizationType`

Defined in: [packages/cdk/src/apigateway-v1.ts:32](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/apigateway-v1.ts#L32)

***

### authorizer?

> `optional` **authorizer?**: `IAuthorizer`

Defined in: [packages/cdk/src/apigateway-v1.ts:31](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/apigateway-v1.ts#L31)

***

### permissions?

> `optional` **permissions?**: `ConstructPermission`[]

Defined in: [packages/cdk/src/basic-construct.ts:28](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/basic-construct.ts#L28)

Optional permissions to grant during creation

#### Inherited from

`BasicConstructProps.permissions`

***

### routes?

> `optional` **routes?**: `Record`\<`` `ANY /${string}` `` \| `` `DELETE /${string}` `` \| `` `GET /${string}` `` \| `` `HEAD /${string}` `` \| `` `OPTIONS /${string}` `` \| `` `PATCH /${string}` `` \| `` `POST /${string}` `` \| `` `PUT /${string}` ``, [`LambdaFunction`](/cdk/classes/lambdafunction/)\>

Defined in: [packages/cdk/src/apigateway-v1.ts:45](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/apigateway-v1.ts#L45)

Define the routes for the API.

```js
new ApiGatewayV1(stack, "api", {
  routes: {
    "GET  /notes"      : new LambdaFunction(this, "ApiNotes", entry),
    "POST /notes/{id}" : new LambdaFunction(this, "ApiNotesId", entry),
  }
})
```
