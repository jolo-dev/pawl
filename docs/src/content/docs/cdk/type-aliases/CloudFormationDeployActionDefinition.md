---
editUrl: false
next: false
prev: false
title: "CloudFormationDeployActionDefinition"
---

> **CloudFormationDeployActionDefinition** = `CloudFormationActionBase` & `CloudFormationPermissions` & `object`

Defined in: [packages/cdk/src/pipeline/actions.ts:121](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L121)

## Type Declaration

### account?

> `readonly` `optional` **account?**: `string`

### capabilities?

> `readonly` `optional` **capabilities?**: readonly `CfnCapabilities`[]

### extraInputs?

> `readonly` `optional` **extraInputs?**: readonly `string`[]

### input?

> `readonly` `optional` **input?**: `string`

### output?

> `readonly` `optional` **output?**: `object`

#### output.fileName

> `readonly` **fileName**: `string`

#### output.name?

> `readonly` `optional` **name?**: `string`

### parameterOverrides?

> `readonly` `optional` **parameterOverrides?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

### replaceOnFailure?

> `readonly` `optional` **replaceOnFailure?**: `boolean`

### stackName

> `readonly` **stackName**: `string`

### templateConfiguration?

> `readonly` `optional` **templateConfiguration?**: `object`

#### templateConfiguration.input?

> `readonly` `optional` **input?**: `string`

#### templateConfiguration.path

> `readonly` **path**: `string`

### templatePath

> `readonly` **templatePath**: `string`

### type

> `readonly` **type**: `"cloudFormationDeploy"`
