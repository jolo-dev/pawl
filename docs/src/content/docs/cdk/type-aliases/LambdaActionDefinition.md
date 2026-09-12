---
editUrl: false
next: false
prev: false
title: "LambdaActionDefinition"
---

> **LambdaActionDefinition** = `AwsActionBase` & `LambdaParameters` & `object`

Defined in: [packages/cdk/src/pipeline/actions.ts:91](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L91)

## Type Declaration

### handler

> `readonly` **handler**: `OrdinaryLambdaFunction`

### inputs?

> `readonly` `optional` **inputs?**: readonly `string`[] \| `false`

### outputs?

> `readonly` `optional` **outputs?**: readonly `string`[]

### type

> `readonly` **type**: `"lambda"`
