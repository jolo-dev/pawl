---
editUrl: false
next: false
prev: false
title: "Sqs"
---

<div class="mermaid-block"><div class="mermaid dark">%%{init:{"theme":"dark"}}%%
architecture-beta
 service sqs(logos:aws-sqs)[AWS SQS]
 service dlq(logos:aws-dlq)[AWS DLQ]</div><div class="mermaid light">%%{init:{"theme":"default"}}%%
architecture-beta
 service sqs(logos:aws-sqs)[AWS SQS]
 service dlq(logos:aws-dlq)[AWS DLQ]</div><pre><code class="language-mermaid">architecture-beta
 service sqs(logos:aws-sqs)[AWS SQS]
 service dlq(logos:aws-dlq)[AWS DLQ]</code></pre></div>

## Extends

- `BasicConstruct`

## Constructors

### new Sqs()

> **new Sqs**(`scope`, `id`, `props`): [`Sqs`](/api/cdk/classes/sqs/)

The constructor function creates an SQS queue with a dead-letter queue (DLQ) and sets up event
source mapping for a Lambda function to consume messages from the queue.

#### Parameters

##### scope

[`Stack`](/api/cdk/classes/stack/)

The `scope` parameter in the constructor refers to the stack where the
resources will be created. It is typically an instance of the `Stack` class in an AWS
CloudFormation template. The stack provides a scope for creating AWS resources within a specific
context, allowing you to manage and deploy related resources together

##### id

`string`

The `id` parameter in the constructor function represents the identifier or
name for the resources being created within the stack. It is used to uniquely identify and name
the SNS topic, SQS queues, and other resources created within the constructor.

##### props

`SqsProps`

The `props` parameter in the constructor function contains the
configuration properties for setting up the SQS (Simple Queue Service) and SNS (Simple
Notification Service) resources. These properties include:

#### Returns

[`Sqs`](/api/cdk/classes/sqs/)

#### Overrides

`BasicConstruct.constructor`

#### Defined in

packages/cdk/src/sqs.ts:41

## Properties

### node

> `readonly` **node**: `Node`

The tree node.

#### Inherited from

`BasicConstruct.node`

#### Defined in

node\_modules/constructs/lib/construct.d.ts:266

***

### queue

> **queue**: `Queue`

#### Defined in

packages/cdk/src/sqs.ts:26

***

### stack

> `readonly` **stack**: [`Stack`](/api/cdk/classes/stack/)

#### Inherited from

`BasicConstruct.stack`

#### Defined in

packages/cdk/src/basic-construct.ts:11

## Methods

### createAlarm()

> **createAlarm**(`stack`): `void`

The `createAlarm` function sets up monitoring for an SQS queue in a given stack.

#### Parameters

##### stack

[`Stack`](/api/cdk/classes/stack/)

The `stack` parameter is a Stack object that is being passed to the
`createAlarm` function.

#### Returns

`void`

#### Overrides

`BasicConstruct.createAlarm`

#### Defined in

packages/cdk/src/sqs.ts:88

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

