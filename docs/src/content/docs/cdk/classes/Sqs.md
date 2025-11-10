---
editUrl: false
next: false
prev: false
title: "Sqs"
---

Defined in: packages/cdk/src/sqs.ts:22

<div class="mermaid-block"><div class="mermaid dark">%%{init:{"theme":"dark"}}%%
architecture-beta
 service sqs(logos:aws-sqs)[AWS SQS]
 service dlq(logos:aws-sqs)[AWS DLQ]</div><div class="mermaid light">%%{init:{"theme":"default"}}%%
architecture-beta
 service sqs(logos:aws-sqs)[AWS SQS]
 service dlq(logos:aws-sqs)[AWS DLQ]</div><pre><code class="language-mermaid">architecture-beta
 service sqs(logos:aws-sqs)[AWS SQS]
 service dlq(logos:aws-sqs)[AWS DLQ]</code></pre></div>

## Extends

- `BasicConstruct`

## Constructors

### new Sqs()

> **new Sqs**(`scope`, `id`, `props`): [`Sqs`](/cdk/classes/sqs/)

Defined in: packages/cdk/src/sqs.ts:37

The constructor function creates an SQS queue with a dead-letter queue (DLQ) and sets up event
source mapping for a Lambda function to consume messages from the queue.

#### Parameters

##### scope

[`Stack`](/cdk/classes/stack/)

The `scope` parameter in the constructor refers to the stack where the
resources will be created. It is typically an instance of the `Stack` class in an AWS
CloudFormation template. The stack provides a scope for creating AWS resources within a specific
context, allowing you to manage and deploy related resources together

##### id

`string`

The `id` parameter in the constructor function represents the identifier or
name for the resources being created within the stack.

##### props

[`SqsProps`](/cdk/type-aliases/sqsprops/)

The `props` parameter in the constructor function contains the
configuration properties for setting up the SQS (Simple Queue Service) and SNS (Simple
Notification Service) resources. These properties include:

#### Returns

[`Sqs`](/cdk/classes/sqs/)

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

### prefix

> **prefix**: `string` = `"hems-"`

Defined in: packages/cdk/src/basic-construct.ts:37

#### Inherited from

`BasicConstruct.prefix`

***

### queue

> **queue**: `Queue`

Defined in: packages/cdk/src/sqs.ts:23

***

### stack

> `readonly` **stack**: [`Stack`](/cdk/classes/stack/)

Defined in: packages/cdk/src/basic-construct.ts:36

#### Inherited from

`BasicConstruct.stack`

## Methods

### createAlarm()

> **createAlarm**(`stack`): `void`

Defined in: packages/cdk/src/sqs.ts:73

The `createAlarm` function sets up monitoring for an SQS queue in a given stack.

#### Parameters

##### stack

[`Stack`](/cdk/classes/stack/)

The `stack` parameter is a Stack object that is being passed to the
`createAlarm` function.

#### Returns

`void`

#### Overrides

`BasicConstruct.createAlarm`

***

### grantPermission()

> **grantPermission**(`construct`, `policyStatement`): `void`

Defined in: packages/cdk/src/basic-construct.ts:86

Grant specified permissions to another construct

#### Parameters

##### construct

[`Construct`](/cdk/classes/construct/)

The construct to grant permissions to

##### policyStatement

`PolicyStatement`

The permission policy to grant

#### Returns

`void`

#### Inherited from

`BasicConstruct.grantPermission`

***

### grantPermissions()

> **grantPermissions**(`permissions`): `void`

Defined in: packages/cdk/src/basic-construct.ts:101

Grant multiple permissions to constructs

#### Parameters

##### permissions

`ConstructPermission`[]

Array of [construct, policyStatement] tuples

#### Returns

`void`

#### Inherited from

`BasicConstruct.grantPermissions`

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
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

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
  }
]);

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

