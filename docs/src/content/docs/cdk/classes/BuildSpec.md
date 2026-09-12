---
editUrl: false
next: false
prev: false
title: "BuildSpec"
---

Defined in: node\_modules/aws-cdk-lib/aws-codebuild/lib/build-spec.d.ts:5

BuildSpec for CodeBuild projects

## Properties

### isImmediate

> `abstract` `readonly` **isImmediate**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-codebuild/lib/build-spec.d.ts:32

Whether the buildspec is directly available or deferred until build-time

## Methods

### toBuildSpec()

> `abstract` **toBuildSpec**(`scope?`): `string`

Defined in: node\_modules/aws-cdk-lib/aws-codebuild/lib/build-spec.d.ts:37

Render the represented BuildSpec

#### Parameters

##### scope?

[`Construct`](/cdk/interfaces/construct/)

#### Returns

`string`

***

### fromAsset()

> `static` **fromAsset**(`path`): `BuildSpec`

Defined in: node\_modules/aws-cdk-lib/aws-codebuild/lib/build-spec.d.ts:28

Use the contents of a local file as the build spec string

Use this if you have a local .yml or .json file that you want to use as the buildspec

#### Parameters

##### path

`string`

#### Returns

`BuildSpec`

***

### fromObject()

> `static` **fromObject**(`value`): `BuildSpec`

Defined in: node\_modules/aws-cdk-lib/aws-codebuild/lib/build-spec.d.ts:6

#### Parameters

##### value

#### Returns

`BuildSpec`

***

### fromObjectToYaml()

> `static` **fromObjectToYaml**(`value`): `BuildSpec`

Defined in: node\_modules/aws-cdk-lib/aws-codebuild/lib/build-spec.d.ts:14

Create a buildspec from an object that will be rendered as YAML in the resulting CloudFormation template.

#### Parameters

##### value

the object containing the buildspec that will be rendered as YAML

#### Returns

`BuildSpec`

***

### fromSourceFilename()

> `static` **fromSourceFilename**(`filename`): `BuildSpec`

Defined in: node\_modules/aws-cdk-lib/aws-codebuild/lib/build-spec.d.ts:22

Use a file from the source as buildspec

Use this if you want to use a file different from 'buildspec.yml'`

#### Parameters

##### filename

`string`

#### Returns

`BuildSpec`
