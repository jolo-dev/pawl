---
editUrl: false
next: false
prev: false
title: "DynamoDbTableWithStreams"
---

A Construct which uses DynamoDB Global Tables.
You can import an existing Table otherwise it will create a new table with Streams enabled
which can be triggered by AWS Lambda. <br />
More information [here](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb-readme.html)
<div class="mermaid-block"><div class="mermaid dark">%%{init:{"theme":"dark"}}%%
architecture-beta
   service dynamodb(logos:aws-dynamodb)[DynamoDB Table]
   service lambda(logos:aws-lambda)[Lambda]
   dynamodb:R --&gt; L:lambda</div><div class="mermaid light">%%{init:{"theme":"default"}}%%
architecture-beta
   service dynamodb(logos:aws-dynamodb)[DynamoDB Table]
   service lambda(logos:aws-lambda)[Lambda]
   dynamodb:R --&gt; L:lambda</div><pre><code class="language-mermaid">architecture-beta
   service dynamodb(logos:aws-dynamodb)[DynamoDB Table]
   service lambda(logos:aws-lambda)[Lambda]
   dynamodb:R --&gt; L:lambda</code></pre></div>

## Extends

- `BasicConstruct`

## Constructors

### new DynamoDbTableWithStreams()

> **new DynamoDbTableWithStreams**(`scope`, `id`, `props`): [`DynamoDbTableWithStreams`](/api/cdk/classes/dynamodbtablewithstreams/)

The constructor function creates a DynamoDB table with streams and adds a Lambda function as an
event source.

#### Parameters

##### scope

[`Stack`](/api/cdk/classes/stack/)

The `scope` parameter in the constructor refers to the stack where the
DynamoDB table and associated resources will be created.

##### id

`string`

The `id` parameter in the constructor represents the unique identifier for
the DynamoDB table being created. It is used to name the table and differentiate it from other
resources in the stack.

##### props

[`DynamoDbTableWithStreamsProps`](/api/cdk/interfaces/dynamodbtablewithstreamsprops/)

props is an object containing properties for
configuring a DynamoDB table with streams. It includes the following properties:

#### Returns

[`DynamoDbTableWithStreams`](/api/cdk/classes/dynamodbtablewithstreams/)

#### Overrides

`BasicConstruct.constructor`

#### Defined in

packages/cdk/src/dynamodb-streams.ts:67

## Properties

### node

> `readonly` **node**: `Node`

The tree node.

#### Inherited from

`BasicConstruct.node`

#### Defined in

node\_modules/constructs/lib/construct.d.ts:266

***

### stack

> `readonly` **stack**: [`Stack`](/api/cdk/classes/stack/)

#### Inherited from

`BasicConstruct.stack`

#### Defined in

packages/cdk/src/basic-construct.ts:11

***

### table

> **table**: [`Table`](/api/cdk/classes/table/)

#### Defined in

packages/cdk/src/dynamodb-streams.ts:55

## Methods

### createAlarm()

> **createAlarm**(`stack`): `MonitoringFacade`

The function createAlarm takes a Stack object as input and returns a MonitoringFacade object that
monitors a DynamoDB table specified in the input stack.

#### Parameters

##### stack

[`Stack`](/api/cdk/classes/stack/)

A stack object that contains information about the resources and
configurations of a cloud infrastructure.

#### Returns

`MonitoringFacade`

A MonitoringFacade object is being returned.

#### Overrides

`BasicConstruct.createAlarm`

#### Defined in

packages/cdk/src/dynamodb-streams.ts:96

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

