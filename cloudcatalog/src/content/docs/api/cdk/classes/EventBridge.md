---
editUrl: false
next: false
prev: false
title: "EventBridge"
---

The Eventbridge Construct consists of an Eventbus that can have **multiple** rule with different targets (see below).
Every failed message will be put into a DLQ.

> Note: It can have multiple rules of different Types. For example, 2 Lambda rules, 1 SQS and many API destination for one Eventbus.

<div class="mermaid-block"><div class="mermaid dark">%%{init:{"theme":"dark"}}%%
architecture-beta
   group rules(hugeicons:paragraph-bullets-point-01)[Rules]
   service eventbridge(logos:aws-eventbridge)[AWS Eventbridge]
   service lambda(logos:aws-lambda)[AWS Lambda] in rules
   service sqs(logos:aws-sqs)[AWS SQS] in rules
   service api(hugeicons:api)[Api Destination] in rules
   service eventbridgerule(logos:aws-eventbridge)[AWS EventBus] in rules
   service dlq(logos:aws-sqs)[DLQ]
   api{group}:R --&gt; L:eventbridge
   eventbridge:B --&gt; T:dlq</div><div class="mermaid light">%%{init:{"theme":"default"}}%%
architecture-beta
   group rules(hugeicons:paragraph-bullets-point-01)[Rules]
   service eventbridge(logos:aws-eventbridge)[AWS Eventbridge]
   service lambda(logos:aws-lambda)[AWS Lambda] in rules
   service sqs(logos:aws-sqs)[AWS SQS] in rules
   service api(hugeicons:api)[Api Destination] in rules
   service eventbridgerule(logos:aws-eventbridge)[AWS EventBus] in rules
   service dlq(logos:aws-sqs)[DLQ]
   api{group}:R --&gt; L:eventbridge
   eventbridge:B --&gt; T:dlq</div><pre><code class="language-mermaid">architecture-beta
   group rules(hugeicons:paragraph-bullets-point-01)[Rules]
   service eventbridge(logos:aws-eventbridge)[AWS Eventbridge]
   service lambda(logos:aws-lambda)[AWS Lambda] in rules
   service sqs(logos:aws-sqs)[AWS SQS] in rules
   service api(hugeicons:api)[Api Destination] in rules
   service eventbridgerule(logos:aws-eventbridge)[AWS EventBus] in rules
   service dlq(logos:aws-sqs)[DLQ]
   api{group}:R --&gt; L:eventbridge
   eventbridge:B --&gt; T:dlq</code></pre></div>

## Example

```ts
const eventPattern = { source: ["foo"] };
declare lambda: LambdaFunction
new EventBridge(this, "test", {
   eventBusName: "TestEventBus",
   targets: [{
     type: lambda,
     eventPattern,
   },
   {
     type: new ApiDestination(this, "ApiDestination", {
       apiDestinationName: "foo",
       authorization: Authorization.basic("foo", SecretValue.unsafePlainText("test-unsafe")),
       description: "This goes to an API",
       endpoint: "https://foo.bar",
     }),
     eventPattern
   }],
 });
   ```

## Extends

- `BasicConstruct`

## Constructors

### new EventBridge()

> **new EventBridge**(`scope`, `id`, `props`): [`EventBridge`](/api/cdk/classes/eventbridge/)

The function creates an EventBridge with specified targets and sets up corresponding rules for
each target.

#### Parameters

##### scope

[`Stack`](/api/cdk/classes/stack/)

The `scope` parameter in the constructor refers to the AWS CloudFormation
stack where the EventBridge resources will be created. It provides a way to define the scope or
context for the resources being created within the stack.

##### id

`string`

The `id` parameter in the constructor function represents the unique
identifier for the EventBridge stack being created. It is used to distinguish this stack from
others and is typically provided by the user when instantiating the stack.

##### props

[`EventBridgeProps`](/api/cdk/interfaces/eventbridgeprops/)

The `props` parameter in the constructor function seems to be of
type `EventBridgeProps`. It likely contains information and configurations related to setting up
EventBridge rules and targets. Based on the code snippet provided, it seems to include details
such as the event bus name, targets for the rules, and

#### Returns

[`EventBridge`](/api/cdk/classes/eventbridge/)

#### Overrides

`BasicConstruct.constructor`

#### Defined in

packages/cdk/src/eventbridge.ts:88

## Properties

### eventBus

> **eventBus**: `EventBus`

#### Defined in

packages/cdk/src/eventbridge.ts:73

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

> `readonly` **stack**: [`Stack`](/api/cdk/classes/stack/)

#### Inherited from

`BasicConstruct.stack`

#### Defined in

packages/cdk/src/basic-construct.ts:11

## Methods

### createAlarm()

> **createAlarm**(`stack`): `void`

The function createAlarm creates an alarm factory for monitoring a stack using the node ID and
eventbridge.

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

packages/cdk/src/eventbridge.ts:178

***

### createRule()

> **createRule**(`ruleId`, `target`, `eventPattern`): `Rule`

The function `createRule` creates a new Rule object with the specified ruleId, target, and
eventPattern.

#### Parameters

##### ruleId

`string`

The `ruleId` parameter is a string that represents the unique identifier
for the rule being created. It is used to identify and reference the rule within the system.

##### target

`IRuleTarget`

The `target` parameter in the `createRule` function represents the
target where the rule will be applied. It should be an object that implements the `IRuleTarget`
interface. This interface likely contains properties or methods that define how the rule should be
triggered or executed.

##### eventPattern

`EventPattern`

The `eventPattern` parameter in the `createRule` function is
used to specify the event pattern that the rule should match. This event pattern defines the
criteria for events that will trigger the rule. It can include conditions based on event
attributes such as source, detail type, and other fields to filter

#### Returns

`Rule`

A Rule object is being returned.

#### Defined in

packages/cdk/src/eventbridge.ts:164

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

