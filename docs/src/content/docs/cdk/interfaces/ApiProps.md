---
editUrl: false
next: false
prev: false
title: "ApiProps"
---

Defined in: packages/cdk/src/apigateway.ts:21

## Extends

- `BasicConstructProps`

## Properties

### authorizer

> **authorizer**: [`HttpIamAuthorizer`](/cdk/classes/httpiamauthorizer/) \| [`HttpUserPoolAuthorizer`](/cdk/classes/httpuserpoolauthorizer/) \| [`HttpLambdaAuthorizer`](/cdk/classes/httplambdaauthorizer/) \| [`HttpJwtAuthorizer`](/cdk/classes/httpjwtauthorizer/)

Defined in: packages/cdk/src/apigateway.ts:22

***

### permissions?

> `optional` **permissions**: `ConstructPermission`[]

Defined in: packages/cdk/src/basic-construct.ts:28

Optional permissions to grant during creation

#### Inherited from

`BasicConstructProps.permissions`

***

### routes?

> `optional` **routes**: `Record`\<`` `ANY /${string}` `` \| `` `DELETE /${string}` `` \| `` `GET /${string}` `` \| `` `HEAD /${string}` `` \| `` `OPTIONS /${string}` `` \| `` `PATCH /${string}` `` \| `` `POST /${string}` `` \| `` `PUT /${string}` ``, [`LambdaFunction`](/cdk/classes/lambdafunction/)\>

Defined in: packages/cdk/src/apigateway.ts:37

Define the routes for the API. Can be a function, proxy to another API, or point to an load balancer

#### Example

```js
new Api(stack, "api", {
  routes: {
    "GET  /notes"      : new LambdaFunction(this, "ApiNotes", entry),
    "POST /notes/{id}" : new LambdaFunction(this, "ApiNotesId", entry)
  }
})
```
