---
editUrl: false
next: false
prev: false
title: "App"
---

Defined in: node\_modules/aws-cdk-lib/core/lib/app.d.ts:146

A construct which represents an entire CDK app. This construct is normally
the root of the construct tree.

You would normally define an `App` instance in your program's entrypoint,
then define constructs where the app is used as the parent scope.

After all the child constructs are defined within the app, you should call
`app.synth()` which will emit a "cloud assembly" from this app into the
directory specified by `outdir`. Cloud assemblies includes artifacts such as
CloudFormation templates and assets that are needed to deploy this app into
the AWS cloud.

## See

https://docs.aws.amazon.com/cdk/latest/guide/apps.html

## Extends

- `Stage`

## Constructors

### Constructor

> **new App**(`props?`): `App`

Defined in: node\_modules/aws-cdk-lib/core/lib/app.d.ts:171

Initializes a CDK application.

#### Parameters

##### props?

`AppProps`

initialization properties

#### Returns

`App`

#### Overrides

`Stage.constructor`

## Properties

### account?

> `readonly` `optional` **account?**: `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stage.d.ts:127

The default account for all resources defined within this stage.

#### Inherited from

`Stage.account`

***

### node

> `readonly` **node**: `Node`

Defined in: node\_modules/constructs/lib/construct.d.ts:289

The tree node.

#### Inherited from

`Stage.node`

***

### parentStage?

> `readonly` `optional` **parentStage?**: `Stage`

Defined in: node\_modules/aws-cdk-lib/core/lib/stage.d.ts:144

The parent stage or `undefined` if this is the app.
*

#### Inherited from

`Stage.parentStage`

***

### region?

> `readonly` `optional` **region?**: `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stage.d.ts:122

The default region for all resources defined within this stage.

#### Inherited from

`Stage.region`

***

### stageName

> `readonly` **stageName**: `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stage.d.ts:139

The name of the stage. Based on names of the parent stages separated by
hypens.

#### Inherited from

`Stage.stageName`

## Accessors

### artifactId

#### Get Signature

> **get** **artifactId**(): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stage.d.ts:188

Artifact ID of the assembly if it is a nested stage. The root stage (app)
will return an empty string.

Derived from the construct path.

##### Returns

`string`

#### Inherited from

`Stage.artifactId`

***

### assetOutdir

#### Get Signature

> **get** **assetOutdir**(): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stage.d.ts:181

The cloud assembly asset output directory.

##### Returns

`string`

#### Inherited from

`Stage.assetOutdir`

***

### outdir

#### Get Signature

> **get** **outdir**(): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stage.d.ts:177

The cloud assembly output directory.

##### Returns

`string`

#### Inherited from

`Stage.outdir`

***

### policyValidationBeta1

#### Get Signature

> **get** **policyValidationBeta1**(): `IPolicyValidationPluginBeta1`[]

Defined in: node\_modules/aws-cdk-lib/core/lib/stage.d.ts:159

Validation plugins to run during synthesis. If any plugin reports any violation,
synthesis will be interrupted and the report displayed to the user.

##### Default

```ts
- no validation plugins are used
```

##### Returns

`IPolicyValidationPluginBeta1`[]

#### Inherited from

`Stage.policyValidationBeta1`

## Methods

### synth()

> **synth**(`options?`): `CloudAssembly`

Defined in: node\_modules/aws-cdk-lib/core/lib/app.d.ts:179

Synthesize this App into a cloud assembly.

Once an assembly has been synthesized, it cannot be modified. Subsequent
calls will return the same assembly.

#### Parameters

##### options?

`StageSynthesisOptions`

#### Returns

`CloudAssembly`

#### Overrides

`Stage.synth`

***

### toString()

> **toString**(): `string`

Defined in: node\_modules/constructs/lib/construct.d.ts:314

Returns a string representation of this construct.

#### Returns

`string`

#### Inherited from

`Stage.toString`

***

### with()

> **with**(...`mixins`): `IConstruct`

Defined in: node\_modules/constructs/lib/construct.d.ts:310

Applies one or more mixins to this construct.

Mixins are applied in order. The list of constructs is captured at the
start of the call, so constructs added by a mixin will not be visited.
Use multiple `with()` calls if subsequent mixins should apply to added
constructs.

#### Parameters

##### mixins

...`IMixin`[]

The mixins to apply

#### Returns

`IConstruct`

This construct for chaining

#### Inherited from

`Stage.with`

***

### isApp()

> `static` **isApp**(`obj`): `obj is App`

Defined in: node\_modules/aws-cdk-lib/core/lib/app.d.ts:157

Checks if an object is an instance of the `App` class.

#### Parameters

##### obj

`any`

The object to evaluate

#### Returns

`obj is App`

`true` if `obj` is an `App`.

***

### isConstruct()

> `static` **isConstruct**(`x`): `x is Construct`

Defined in: node\_modules/constructs/lib/construct.d.ts:285

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

`Stage.isConstruct`

***

### isStage()

> `static` **isStage**(`this`, `x`): `x is Stage`

Defined in: node\_modules/aws-cdk-lib/core/lib/stage.d.ts:117

Test whether the given construct is a stage.

#### Parameters

##### this

`void`

##### x

`any`

#### Returns

`x is Stage`

#### Inherited from

`Stage.isStage`

***

### of()

> `static` **of**(`construct`): `Stage` \| `undefined`

Defined in: node\_modules/aws-cdk-lib/core/lib/app.d.ts:151

Return the app that is the root of the construct tree, if available.

#### Parameters

##### construct

`IConstruct`

#### Returns

`Stage` \| `undefined`

#### Overrides

`Stage.of`
