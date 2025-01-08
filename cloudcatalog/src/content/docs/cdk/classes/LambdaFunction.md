---
editUrl: false
next: false
prev: false
title: "LambdaFunction"
---

<div class="mermaid-block"><div class="mermaid dark">%%{init:{"theme":"dark"}}%%
architecture-beta
  service lambda(logos:aws-lambda)[AWS Lambda]
  service authorizer(logos:aws-cognito)[Authorizer]</div><div class="mermaid light">%%{init:{"theme":"default"}}%%
architecture-beta
  service lambda(logos:aws-lambda)[AWS Lambda]
  service authorizer(logos:aws-cognito)[Authorizer]</div><pre><code class="language-mermaid">architecture-beta
  service lambda(logos:aws-lambda)[AWS Lambda]
  service authorizer(logos:aws-cognito)[Authorizer]</code></pre></div>

## Extends

- `BasicConstruct`

## Constructors

### new LambdaFunction()

> **new LambdaFunction**(`scope`, `id`, `props`): [`LambdaFunction`](/cdk/classes/lambdafunction/)

The above function is a TypeScript constructor that creates a Lambda function with specific
configurations, including using Node.js 22.x runtime and bundling to ESM format for efficiency.

#### Parameters

##### scope

[`Stack`](/cdk/classes/stack/)

The `scope` parameter in the constructor refers to the AWS CloudFormation
stack where the Lambda function will be deployed. It provides a way to define the logical
boundaries for the resources within the stack.

##### id

`string`

The `id` parameter in the constructor function represents the unique
identifier or name for the Lambda function being created. It is typically used to distinguish this
specific Lambda function from others within the same scope or stack.

##### props

[`LambdaProps`](/cdk/interfaces/lambdaprops/)

LambdaProps is a type that contains properties for configuring a
Lambda function. In this case, it includes an `authorizer` property that is being assigned to
`this.authorizer`. The `NodejsFunction` constructor is being used to create a new Lambda function
with specific configurations such as function name,

#### Returns

[`LambdaFunction`](/cdk/classes/lambdafunction/)

#### Overrides

`BasicConstruct.constructor`

#### Defined in

packages/cdk/src/lambda-function.ts:41

## Properties

### authorizer?

> `optional` **authorizer**: `boolean`

#### Defined in

packages/cdk/src/lambda-function.ts:26

***

### lambda

> **lambda**: `NodejsFunction`

#### Defined in

packages/cdk/src/lambda-function.ts:25

***

### node

> `readonly` **node**: `Node`

The tree node.

#### Inherited from

`BasicConstruct.node`

#### Defined in

node\_modules/constructs/lib/construct.d.ts:266

***

### stack

> `readonly` **stack**: [`Stack`](/cdk/classes/stack/)

#### Inherited from

`BasicConstruct.stack`

#### Defined in

packages/cdk/src/basic-construct.ts:11

## Methods

### createAlarm()

> **createAlarm**(`stack`): `void`

#### Parameters

##### stack

[`Stack`](/cdk/classes/stack/)

#### Returns

`void`

#### Overrides

`BasicConstruct.createAlarm`

#### Defined in

packages/cdk/src/lambda-function.ts:66

***

### toString()

> **toString**(): `string`

Returns a string representation of this construct.

#### Returns

`string`

#### Inherited from

`BasicConstruct.toString`

#### Defined in

node\_modules/constructs/lib/construct.d.ts:279

***

### isConstruct()

> `static` **isConstruct**(`x`): `x is Construct`

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

#### Defined in

node\_modules/constructs/lib/construct.d.ts:262
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

mermaid.registerIconPacks([
  {
    name: 'logos',
    loader: () =>
      fetch('https://unpkg.com/@iconify-json/logos@1/icons.json').then((res) => res.json()),
  },
  {
    name: 'hugeicons',
    loader: () =>
      fetch('https://unpkg.com/@iconify-json/hugeicons@1/icons.json').then((res) => res.json()),
  },
]);

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

