---
editUrl: false
next: false
prev: false
title: "PipelineStageDefinition"
---

Defined in: [packages/cdk/src/codepipeline.ts:124](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L124)

One sequential pipeline stage. Every action in `actions` has the same run
order and runs in parallel against the artifact frontier that existed before
the stage. Use separate stage objects for sequential work.

## Properties

### actions

> `readonly` **actions**: readonly \[[`PipelineActionDefinition`](/cdk/type-aliases/pipelineactiondefinition/), [`PipelineActionDefinition`](/cdk/type-aliases/pipelineactiondefinition/)\]

Defined in: [packages/cdk/src/codepipeline.ts:128](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L128)

One or more actions that run in parallel.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [packages/cdk/src/codepipeline.ts:126](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L126)

AWS stage name; derived from action names when omitted.
