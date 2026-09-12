---
editUrl: false
next: false
prev: false
title: "ApiProps"
---

Defined in: [packages/cdk/src/apigateway.ts:36](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/apigateway.ts#L36)

## Extends

- `BasicConstructProps`

## Properties

### authorizer?

> `optional` **authorizer?**: `AuthorizerType`

Defined in: [packages/cdk/src/apigateway.ts:37](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/apigateway.ts#L37)

***

### permissions?

> `optional` **permissions?**: `ConstructPermission`[]

Defined in: [packages/cdk/src/basic-construct.ts:28](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/basic-construct.ts#L28)

Optional permissions to grant during creation

#### Inherited from

`BasicConstructProps.permissions`

***

### routes?

> `optional` **routes?**: `Record`\<`` `ANY /${string}` `` \| `` `DELETE /${string}` `` \| `` `GET /${string}` `` \| `` `HEAD /${string}` `` \| `` `OPTIONS /${string}` `` \| `` `PATCH /${string}` `` \| `` `POST /${string}` `` \| `` `PUT /${string}` ``, [`LambdaFunction`](/cdk/classes/lambdafunction/) \| [`EventBridge`](/cdk/classes/eventbridge/)\>

Defined in: [packages/cdk/src/apigateway.ts:52](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/apigateway.ts#L52)

Define the routes for the API. Can be a function, proxy to another API, or point to an load balancer

#### Example

```js
new Api(stack, "api", {
  routes: {
    "GET  /notes"      : new LambdaFunction(this, "ApiNotes", entry),
    "POST /notes/{id}" : new LambdaFunction(this, "ApiNotesId", entry)
    "POST /notes/{id}" : new LambdaFunction(this, "ApiNotesId", entry)
  }
})
```
