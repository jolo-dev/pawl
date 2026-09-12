---
editUrl: false
next: false
prev: false
title: "CodeBuildActionDefinition"
---

Defined in: [packages/cdk/src/pipeline/actions.ts:52](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L52)

## Extends

- `AwsActionBase`

## Properties

### actionType?

> `readonly` `optional` **actionType?**: [`CodeBuildActionType`](/cdk/enumerations/codebuildactiontype/)

Defined in: [packages/cdk/src/pipeline/actions.ts:58](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L58)

***

### checkSecretsInPlainTextEnvVariables?

> `readonly` `optional` **checkSecretsInPlainTextEnvVariables?**: `boolean`

Defined in: [packages/cdk/src/pipeline/actions.ts:62](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L62)

***

### combineBatchBuildArtifacts?

> `readonly` `optional` **combineBatchBuildArtifacts?**: `boolean`

Defined in: [packages/cdk/src/pipeline/actions.ts:64](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L64)

***

### environmentVariables?

> `readonly` `optional` **environmentVariables?**: `Readonly`\<`Record`\<`string`, `BuildEnvironmentVariable`\>\>

Defined in: [packages/cdk/src/pipeline/actions.ts:59](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L59)

***

### executeBatchBuild?

> `readonly` `optional` **executeBatchBuild?**: `boolean`

Defined in: [packages/cdk/src/pipeline/actions.ts:63](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L63)

***

### extraInputs?

> `readonly` `optional` **extraInputs?**: readonly `string`[]

Defined in: [packages/cdk/src/pipeline/actions.ts:56](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L56)

***

### input?

> `readonly` `optional` **input?**: `string`

Defined in: [packages/cdk/src/pipeline/actions.ts:55](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L55)

***

### name

> `readonly` **name**: `string`

Defined in: [packages/cdk/src/pipeline/actions.ts:35](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L35)

#### Inherited from

`AwsActionBase.name`

***

### outputs?

> `readonly` `optional` **outputs?**: `false` \| readonly `string`[]

Defined in: [packages/cdk/src/pipeline/actions.ts:57](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L57)

***

### project

> `readonly` **project**: [`CodeBuildProject`](/cdk/classes/codebuildproject/)

Defined in: [packages/cdk/src/pipeline/actions.ts:54](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L54)

***

### role?

> `readonly` `optional` **role?**: `IRole`

Defined in: [packages/cdk/src/pipeline/actions.ts:36](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L36)

#### Inherited from

`AwsActionBase.role`

***

### type

> `readonly` **type**: `"codebuild"`

Defined in: [packages/cdk/src/pipeline/actions.ts:53](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L53)

***

### variablesNamespace?

> `readonly` `optional` **variablesNamespace?**: `string`

Defined in: [packages/cdk/src/pipeline/actions.ts:37](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L37)

#### Inherited from

`AwsActionBase.variablesNamespace`
