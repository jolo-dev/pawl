---
editUrl: false
next: false
prev: false
title: "ApiGateway"
---

Defined in: packages/cdk/src/apigateway.ts:52

This construct is an HTTP API Gateway v2. It has to use an authorizer and can trigger a list
of AWS Lambdas. The authorizer can be LambdaAuthorizer, IamAuthorizer, CognitoUserPoolAuthorizer, and HttpJwtAuthorizer

<div class="mermaid-block"><div class="mermaid dark">%%{init:{"theme":"dark"}}%%
architecture-beta
   group authorizer(logos:aws-cognito)[Authorizer]
   service api(logos:aws-api-gateway)[HTTP API Gateway v2]
   service lambda(logos:aws-lambda)[Lambda]
   service cognito(logos:aws-cognito)[AWS Cognito] in authorizer
   service iam(logos:aws-iam)[IAM] in authorizer
   service jwt(logos:jwt)[JWT] in authorizer
   service lambdaAuth(logos:aws-lambda)[Lambda] in authorizer
   auth{group}:L --&gt; R:api
   api:B --&gt; T:lambda</div><div class="mermaid light">%%{init:{"theme":"default"}}%%
architecture-beta
   group authorizer(logos:aws-cognito)[Authorizer]
   service api(logos:aws-api-gateway)[HTTP API Gateway v2]
   service lambda(logos:aws-lambda)[Lambda]
   service cognito(logos:aws-cognito)[AWS Cognito] in authorizer
   service iam(logos:aws-iam)[IAM] in authorizer
   service jwt(logos:jwt)[JWT] in authorizer
   service lambdaAuth(logos:aws-lambda)[Lambda] in authorizer
   auth{group}:L --&gt; R:api
   api:B --&gt; T:lambda</div><pre><code class="language-mermaid">architecture-beta
   group authorizer(logos:aws-cognito)[Authorizer]
   service api(logos:aws-api-gateway)[HTTP API Gateway v2]
   service lambda(logos:aws-lambda)[Lambda]
   service cognito(logos:aws-cognito)[AWS Cognito] in authorizer
   service iam(logos:aws-iam)[IAM] in authorizer
   service jwt(logos:jwt)[JWT] in authorizer
   service lambdaAuth(logos:aws-lambda)[Lambda] in authorizer
   auth{group}:L --&gt; R:api
   api:B --&gt; T:lambda</code></pre></div>

## Extends

- `BasicConstruct`

## Constructors

### new ApiGateway()

> **new ApiGateway**(`scope`, `id`, `props`): [`ApiGateway`](/cdk/classes/apigateway/)

Defined in: packages/cdk/src/apigateway.ts:70

The constructor function initializes an HTTP API with specified routes. Every API GW has an Authorizer(@see foo).
It is possible to give each route an individual Authorizer.

#### Parameters

##### scope

[`Stack`](/cdk/classes/stack/)

The `scope` parameter in the constructor represents the stack where the
resources will be created. It is typically an instance of the `Stack` class in an AWS
CloudFormation template.

##### id

`string`

The `id` parameter in the constructor represents the unique identifier or
name for the API being created. It is used to differentiate this specific instance of the API from
others and is often used in naming resources associated with this API.

##### props

[`ApiProps`](/cdk/interfaces/apiprops/)

The `props` parameter in the constructor function likely contains
configuration options and settings for the API being created. It seems to include an `authorizer`
property for setting a default authorizer for the API, and a `routes` property which is an object
containing route definitions for the API.

#### Returns

[`ApiGateway`](/cdk/classes/apigateway/)

#### Overrides

`BasicConstruct.constructor`

## Properties

### node

> `readonly` **node**: `Node`

Defined in: node\_modules/constructs/lib/construct.d.ts:266

The tree node.

#### Inherited from

`BasicConstruct.node`

***

### stack

> `readonly` **stack**: [`Stack`](/cdk/classes/stack/)

Defined in: packages/cdk/src/basic-construct.ts:11

#### Inherited from

`BasicConstruct.stack`

## Methods

### addRoute()

> **addRoute**(`routeKey`, `func`): `void`

Defined in: packages/cdk/src/apigateway.ts:102

The `addRoute` function in TypeScript adds a route with a specified key and Lambda function to a
class.

#### Parameters

##### routeKey

The `routeKey` parameter is a string that represents a combination of an HTTP
method (such as GET, POST, PUT, DELETE, etc.) and a route path (such as `/users`, `/products`,
etc.). It is used to define a specific route for handling incoming requests in a web

`` `ANY /${string}` `` | `` `DELETE /${string}` `` | `` `GET /${string}` `` | `` `HEAD /${string}` `` | `` `OPTIONS /${string}` `` | `` `PATCH /${string}` `` | `` `POST /${string}` `` | `` `PUT /${string}` ``

##### func

[`LambdaFunction`](/cdk/classes/lambdafunction/)

The `func` parameter is a Lambda function that will be executed
when the specified route is accessed.

#### Returns

`void`

***

### createAlarm()

> **createAlarm**(`stack`): `void`

Defined in: packages/cdk/src/apigateway.ts:132

The function `createAlarm` monitors an HTTP API Gateway using a given stack.

#### Parameters

##### stack

[`Stack`](/cdk/classes/stack/)

The `stack` parameter is a Stack object that is being passed into the
`createAlarm` function.

#### Returns

`void`

#### Overrides

`BasicConstruct.createAlarm`

***

### toString()

> **toString**(): `string`

Defined in: node\_modules/constructs/lib/construct.d.ts:279

Returns a string representation of this construct.

#### Returns

`string`

#### Inherited from

`BasicConstruct.toString`

***

### isConstruct()

> `static` **isConstruct**(`x`): `x is Construct`

Defined in: node\_modules/constructs/lib/construct.d.ts:262

Checks if `x` is a construct.

Use this method instead of `instanceof` to properly detect `Construct`
instances, even when the construct library is symlinked.

Explanation: in JavaScript, multiple copies of the `constructs` library on
disk are seen as independent, completely different libraries. As a
consequence, the class `Construct` in each copy of the `constructs` library
is seen as a different class, and an instance of one class will not test as
`instanceof` the other class. `npm install` will not create installations
like this, but users may manually symlink construct libraries together or
use a monorepo tool: in those cases, multiple copies of the `constructs`
library can be accidentally installed, and `instanceof` will behave
unpredictably. It is safest to avoid using `instanceof`, and using
this type-testing method instead.

#### Parameters

##### x

`any`

Any object

#### Returns

`x is Construct`

true if `x` is an object created from a class which extends `Construct`.

#### Inherited from

`BasicConstruct.isConstruct`
<style>
:root.mermaid-enabled .mermaid-block > pre {
  display: none;
}
:root:not(.mermaid-enabled) .mermaid-block > .mermaid {
  display: none !important;
}

.mermaid-block > .mermaid[data-inserted].dark {
  display: var(--mermaid-dark-display);
}
.mermaid-block > .mermaid[data-inserted].light {
  display: var(--mermaid-light-display);
}

:root {
  --mermaid-dark-display: none;
  --mermaid-light-display: block;
}
@media (prefers-color-scheme: light) {
  :root {
    --mermaid-dark-display: none;
    --mermaid-light-display: block;
  }
}
@media (prefers-color-scheme: dark) {
  :root {
    --mermaid-dark-display: block;
    --mermaid-light-display: none;
  }
}
body.light, :root[data-theme="light"] {
  --mermaid-dark-display: none;
  --mermaid-light-display: block;
}
body.dark, :root[data-theme="dark"] {
  --mermaid-dark-display: block;
  --mermaid-light-display: none;
}
</style>

<script type="module">
import mermaid from "https://unpkg.com/mermaid@latest/dist/mermaid.esm.min.mjs";

document.documentElement.classList.add("mermaid-enabled");

mermaid.initialize({startOnLoad:true});

requestAnimationFrame(function check() {
  let some = false;
  document.querySelectorAll("div.mermaid:not([data-inserted])").forEach(div => {
    some = true;
    if (div.querySelector("svg")) {
      div.dataset.inserted = true;
    }
  });

  if (some) {
    requestAnimationFrame(check);
  }
});
</script>

