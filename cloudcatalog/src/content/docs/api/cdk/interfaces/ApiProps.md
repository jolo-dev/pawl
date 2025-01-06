---
editUrl: false
next: false
prev: false
title: "ApiProps"
---

## Properties

### authorizer

> **authorizer**: [`HttpIamAuthorizer`](/public/api/cdk/classes/httpiamauthorizer/) \| [`HttpUserPoolAuthorizer`](/public/api/cdk/classes/httpuserpoolauthorizer/) \| [`HttpLambdaAuthorizer`](/public/api/cdk/classes/httplambdaauthorizer/) \| [`HttpJwtAuthorizer`](/public/api/cdk/classes/httpjwtauthorizer/)

#### Defined in

packages/cdk/src/apigateway.ts:16

***

### routes?

> `optional` **routes**: `Record`\<\`ANY /$\{string\}\` \| \`DELETE /$\{string\}\` \| \`GET /$\{string\}\` \| \`HEAD /$\{string\}\` \| \`OPTIONS /$\{string\}\` \| \`PATCH /$\{string\}\` \| \`POST /$\{string\}\` \| \`PUT /$\{string\}\`, [`LambdaFunction`](/public/api/cdk/classes/lambdafunction/)\>

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

#### Defined in

packages/cdk/src/apigateway.ts:31
