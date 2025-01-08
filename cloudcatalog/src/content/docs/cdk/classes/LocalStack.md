---
editUrl: false
next: false
prev: false
title: "LocalStack"
---

## Extends

- [`Stack`](/cdk/classes/stack/)

## Constructors

### new LocalStack()

> **new LocalStack**(`scope`, `id`, `props`): [`LocalStack`](/cdk/classes/localstack/)

The constructor function checks for the existence of a directory specified in the props, creates
LambdaFunction instances for each TypeScript file in the directory, and outputs the function URLs.

#### Parameters

##### scope

[`Construct`](/cdk/classes/construct/)

The `scope` parameter in the constructor function represents the scope
in which the construct is created. It is typically the parent construct under which the current
construct is being created. This parameter is used to define the hierarchy and relationships
between constructs in an AWS CloudFormation template.

##### id

`string`

The `id` parameter in the constructor function represents the unique
identifier for the construct being created. It is used to identify and reference the construct
within the scope of the AWS CloudFormation template or CDK application.

##### props

`LocalStackProps`

The `props` parameter in the constructor function seems to be of
type `LocalStackProps`. It likely contains configuration options or properties related to a local
stack setup. The code snippet checks for the existence of a directory specified by
`props.lambdaDir`, reads the contents of the directory, and creates Lambda

#### Returns

[`LocalStack`](/cdk/classes/localstack/)

#### Overrides

[`Stack`](/cdk/classes/stack/).[`constructor`](/cdk/classes/stack/#constructors)

#### Defined in

packages/cdk/src/local-stack.ts:28

## Properties

### account

> `readonly` **account**: `string`

The AWS account into which this stack will be deployed.

This value is resolved according to the following rules:

1. The value provided to `env.account` when the stack is defined. This can
   either be a concrete account (e.g. `585695031111`) or the
   `Aws.ACCOUNT_ID` token.
3. `Aws.ACCOUNT_ID`, which represents the CloudFormation intrinsic reference
   `{ "Ref": "AWS::AccountId" }` encoded as a string token.

Preferably, you should use the return value as an opaque string and not
attempt to parse it to implement your logic. If you do, you must first
check that it is a concrete value an not an unresolved token. If this
value is an unresolved token (`Token.isUnresolved(stack.account)` returns
`true`), this implies that the user wishes that this stack will synthesize
into a **account-agnostic template**. In this case, your code should either
fail (throw an error, emit a synth error using `Annotations.of(construct).addError()`) or
implement some other region-agnostic behavior.

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`account`](/cdk/classes/stack/#account)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:226

***

### artifactId

> `readonly` **artifactId**: `string`

The ID of the cloud assembly artifact for this stack.

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`artifactId`](/cdk/classes/stack/#artifactid)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:262

***

### environment

> `readonly` **environment**: `string`

The environment coordinates in which this stack is deployed. In the form
`aws://account/region`. Use `stack.account` and `stack.region` to obtain
the specific values, no need to parse.

You can use this value to determine if two stacks are targeting the same
environment.

If either `stack.account` or `stack.region` are not concrete values (e.g.
`Aws.ACCOUNT_ID` or `Aws.REGION`) the special strings `unknown-account` and/or
`unknown-region` will be used respectively to indicate this stack is
region/account-agnostic.

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`environment`](/cdk/classes/stack/#environment)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:240

***

### monitoring

> **monitoring**: `MonitoringFacade`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`monitoring`](/cdk/classes/stack/#monitoring)

#### Defined in

packages/cdk/src/stack.ts:6

***

### nestedStackResource?

> `readonly` `optional` **nestedStackResource**: `CfnResource`

If this is a nested stack, this represents its `AWS::CloudFormation::Stack`
resource. `undefined` for top-level (non-nested) stacks.

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`nestedStackResource`](/cdk/classes/stack/#nestedstackresource)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:251

***

### node

> `readonly` **node**: `Node`

The tree node.

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`node`](/cdk/classes/stack/#node)

#### Defined in

node\_modules/constructs/lib/construct.d.ts:266

***

### region

> `readonly` **region**: `string`

The AWS region into which this stack will be deployed (e.g. `us-west-2`).

This value is resolved according to the following rules:

1. The value provided to `env.region` when the stack is defined. This can
   either be a concrete region (e.g. `us-west-2`) or the `Aws.REGION`
   token.
3. `Aws.REGION`, which is represents the CloudFormation intrinsic reference
   `{ "Ref": "AWS::Region" }` encoded as a string token.

Preferably, you should use the return value as an opaque string and not
attempt to parse it to implement your logic. If you do, you must first
check that it is a concrete value an not an unresolved token. If this
value is an unresolved token (`Token.isUnresolved(stack.region)` returns
`true`), this implies that the user wishes that this stack will synthesize
into a **region-agnostic template**. In this case, your code should either
fail (throw an error, emit a synth error using `Annotations.of(construct).addError()`) or
implement some other region-agnostic behavior.

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`region`](/cdk/classes/stack/#region)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:205

***

### synthesizer

> `readonly` **synthesizer**: `IStackSynthesizer`

Synthesis method for this stack

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`synthesizer`](/cdk/classes/stack/#synthesizer)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:267

***

### tags

> `readonly` **tags**: `TagManager`

Tags to be applied to the stack.

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`tags`](/cdk/classes/stack/#tags)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:180

***

### templateFile

> `readonly` **templateFile**: `string`

The name of the CloudFormation template file emitted to the output
directory during synthesis.

Example value: `MyStack.template.json`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`templateFile`](/cdk/classes/stack/#templatefile)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:258

***

### templateOptions

> `readonly` **templateOptions**: `ITemplateOptions`

Options for CloudFormation template (like version, transform, description).

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`templateOptions`](/cdk/classes/stack/#templateoptions)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:184

## Accessors

### availabilityZones

#### Get Signature

> **get** **availabilityZones**(): `string`[]

Returns the list of AZs that are available in the AWS environment
(account/region) associated with this stack.

If the stack is environment-agnostic (either account and/or region are
tokens), this property will return an array with 2 tokens that will resolve
at deploy-time to the first two availability zones returned from CloudFormation's
`Fn::GetAZs` intrinsic function.

If they are not available in the context, returns a set of dummy values and
reports them as missing, and let the CLI resolve them by calling EC2
`DescribeAvailabilityZones` on the target environment.

To specify a different strategy for selecting availability zones override this method.

##### Returns

`string`[]

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`availabilityZones`](/cdk/classes/stack/#availabilityzones)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:489

***

### bundlingRequired

#### Get Signature

> **get** **bundlingRequired**(): `boolean`

Indicates whether the stack requires bundling or not

##### Returns

`boolean`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`bundlingRequired`](/cdk/classes/stack/#bundlingrequired)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:749

***

### dependencies

#### Get Signature

> **get** **dependencies**(): `Stack`[]

Return the stacks this stack depends on

##### Returns

`Stack`[]

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`dependencies`](/cdk/classes/stack/#dependencies)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:407

***

### nested

#### Get Signature

> **get** **nested**(): `boolean`

Indicates if this is a nested stack, in which case `parentStack` will include a reference to it's parent.

##### Returns

`boolean`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`nested`](/cdk/classes/stack/#nested)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:444

***

### nestedStackParent

#### Get Signature

> **get** **nestedStackParent**(): `undefined` \| `Stack`

If this is a nested stack, returns it's parent stack.

##### Returns

`undefined` \| `Stack`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`nestedStackParent`](/cdk/classes/stack/#nestedstackparent)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:493

***

### notificationArns

#### Get Signature

> **get** **notificationArns**(): `string`[]

Returns the list of notification Amazon Resource Names (ARNs) for the current stack.

##### Returns

`string`[]

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`notificationArns`](/cdk/classes/stack/#notificationarns)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:440

***

### partition

#### Get Signature

> **get** **partition**(): `string`

The partition in which this stack is defined

##### Returns

`string`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`partition`](/cdk/classes/stack/#partition)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:424

***

### stackId

#### Get Signature

> **get** **stackId**(): `string`

The ID of the stack

##### Example

```ts
// After resolving, looks like
'arn:aws:cloudformation:us-west-2:123456789012:stack/teststack/51af3dc0-da77-11e4-872e-1234567db123'
```

##### Returns

`string`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`stackId`](/cdk/classes/stack/#stackid)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:436

***

### stackName

#### Get Signature

> **get** **stackName**(): `string`

The concrete CloudFormation physical stack name.

This is either the name defined explicitly in the `stackName` prop or
allocated based on the stack's location in the construct tree. Stacks that
are directly defined under the app use their construct `id` as their stack
name. Stacks that are defined deeper within the tree will use a hashed naming
scheme based on the construct path to ensure uniqueness.

If you wish to obtain the deploy-time AWS::StackName intrinsic,
you can use `Aws.STACK_NAME` directly.

##### Returns

`string`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`stackName`](/cdk/classes/stack/#stackname)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:420

***

### terminationProtection

#### Get Signature

> **get** **terminationProtection**(): `boolean`

Whether termination protection is enabled for this stack.

##### Returns

`boolean`

#### Set Signature

> **set** **terminationProtection**(`value`): `void`

##### Parameters

###### value

`boolean`

##### Returns

`void`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`terminationProtection`](/cdk/classes/stack/#terminationprotection)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:244

***

### urlSuffix

#### Get Signature

> **get** **urlSuffix**(): `string`

The Amazon domain suffix for the region in which this stack is defined

##### Returns

`string`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`urlSuffix`](/cdk/classes/stack/#urlsuffix)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:428

## Methods

### addDependency()

> **addDependency**(`target`, `reason`?): `void`

Add a dependency between this stack and another stack.

This can be used to define dependencies between any two stacks within an
app, and also supports nested stacks.

#### Parameters

##### target

`Stack`

##### reason?

`string`

#### Returns

`void`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`addDependency`](/cdk/classes/stack/#adddependency)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:403

***

### addMetadata()

> **addMetadata**(`key`, `value`): `void`

Adds an arbitrary key-value pair, with information you want to record about the stack.
These get translated to the Metadata section of the generated template.

#### Parameters

##### key

`string`

##### value

`any`

#### Returns

`void`

#### See

https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/metadata-section-structure.html

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`addMetadata`](/cdk/classes/stack/#addmetadata)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:515

***

### addTransform()

> **addTransform**(`transform`): `void`

Add a Transform to this stack. A Transform is a macro that AWS
CloudFormation uses to process your template.

Duplicate values are removed when stack is synthesized.

#### Parameters

##### transform

`string`

The transform to add

#### Returns

`void`

#### See

https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/transform-section-structure.html

#### Example

```ts
declare const stack: Stack;

stack.addTransform('AWS::Serverless-2016-10-31')
```

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`addTransform`](/cdk/classes/stack/#addtransform)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:508

***

### exportStringListValue()

> **exportStringListValue**(`exportedValue`, `options`?): `string`[]

Create a CloudFormation Export for a string list value

Returns a string list representing the corresponding `Fn.importValue()`
expression for this Export. The export expression is automatically wrapped with an
`Fn::Join` and the import value with an `Fn::Split`, since CloudFormation can only
export strings. You can control the name for the export by passing the `name` option.

If you don't supply a value for `name`, the value you're exporting must be
a Resource attribute (for example: `bucket.bucketName`) and it will be
given the same name as the automatic cross-stack reference that would be created
if you used the attribute in another Stack.

One of the uses for this method is to *remove* the relationship between
two Stacks established by automatic cross-stack references. It will
temporarily ensure that the CloudFormation Export still exists while you
remove the reference from the consuming stack. After that, you can remove
the resource and the manual export.

See `exportValue` for an example of this process.

#### Parameters

##### exportedValue

`any`

##### options?

`ExportValueOptions`

#### Returns

`string`[]

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`exportStringListValue`](/cdk/classes/stack/#exportstringlistvalue)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:638

***

### exportValue()

> **exportValue**(`exportedValue`, `options`?): `string`

Create a CloudFormation Export for a string value

Returns a string representing the corresponding `Fn.importValue()`
expression for this Export. You can control the name for the export by
passing the `name` option.

If you don't supply a value for `name`, the value you're exporting must be
a Resource attribute (for example: `bucket.bucketName`) and it will be
given the same name as the automatic cross-stack reference that would be created
if you used the attribute in another Stack.

One of the uses for this method is to *remove* the relationship between
two Stacks established by automatic cross-stack references. It will
temporarily ensure that the CloudFormation Export still exists while you
remove the reference from the consuming stack. After that, you can remove
the resource and the manual export.

Here is how the process works. Let's say there are two stacks,
`producerStack` and `consumerStack`, and `producerStack` has a bucket
called `bucket`, which is referenced by `consumerStack` (perhaps because
an AWS Lambda Function writes into it, or something like that).

It is not safe to remove `producerStack.bucket` because as the bucket is being
deleted, `consumerStack` might still be using it.

Instead, the process takes two deployments:

**Deployment 1: break the relationship**:

- Make sure `consumerStack` no longer references `bucket.bucketName` (maybe the consumer
  stack now uses its own bucket, or it writes to an AWS DynamoDB table, or maybe you just
  remove the Lambda Function altogether).
- In the `ProducerStack` class, call `this.exportValue(this.bucket.bucketName)`. This
  will make sure the CloudFormation Export continues to exist while the relationship
  between the two stacks is being broken.
- Deploy (this will effectively only change the `consumerStack`, but it's safe to deploy both).

**Deployment 2: remove the bucket resource**:

- You are now free to remove the `bucket` resource from `producerStack`.
- Don't forget to remove the `exportValue()` call as well.
- Deploy again (this time only the `producerStack` will be changed -- the bucket will be deleted).

#### Parameters

##### exportedValue

`any`

##### options?

`ExportValueOptions`

#### Returns

`string`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`exportValue`](/cdk/classes/stack/#exportvalue)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:616

***

### formatArn()

> **formatArn**(`components`): `string`

Creates an ARN from components.

If `partition`, `region` or `account` are not specified, the stack's
partition, region and account will be used.

If any component is the empty string, an empty string will be inserted
into the generated ARN at the location that component corresponds to.

The ARN will be formatted as follows:

  arn:{partition}:{service}:{region}:{account}:{resource}{sep}{resource-name}

The required ARN pieces that are omitted will be taken from the stack that
the 'scope' is attached to. If all ARN pieces are supplied, the supplied scope
can be 'undefined'.

#### Parameters

##### components

`ArnComponents`

#### Returns

`string`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`formatArn`](/cdk/classes/stack/#formatarn)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:462

***

### getLogicalId()

> **getLogicalId**(`element`): `string`

Allocates a stack-unique CloudFormation-compatible logical identity for a
specific resource.

This method is called when a `CfnElement` is created and used to render the
initial logical identity of resources. Logical ID renames are applied at
this stage.

This method uses the protected method `allocateLogicalId` to render the
logical ID for an element. To modify the naming scheme, extend the `Stack`
class and override this method.

#### Parameters

##### element

`CfnElement`

The CloudFormation element for which a logical identity is
needed.

#### Returns

`string`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`getLogicalId`](/cdk/classes/stack/#getlogicalid)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:396

***

### regionalFact()

> **regionalFact**(`factName`, `defaultValue`?): `string`

Look up a fact value for the given fact for the region of this stack

Will return a definite value only if the region of the current stack is resolved.
If not, a lookup map will be added to the stack and the lookup will be done at
CDK deployment time.

What regions will be included in the lookup map is controlled by the
`@aws-cdk/core:target-partitions` context value: it must be set to a list
of partitions, and only regions from the given partitions will be included.
If no such context key is set, all regions will be included.

This function is intended to be used by construct library authors. Application
builders can rely on the abstractions offered by construct libraries and do
not have to worry about regional facts.

If `defaultValue` is not given, it is an error if the fact is unknown for
the given region.

#### Parameters

##### factName

`string`

##### defaultValue?

`string`

#### Returns

`string`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`regionalFact`](/cdk/classes/stack/#regionalfact)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:571

***

### renameLogicalId()

> **renameLogicalId**(`oldId`, `newId`): `void`

Rename a generated logical identities

To modify the naming scheme strategy, extend the `Stack` class and
override the `allocateLogicalId` method.

#### Parameters

##### oldId

`string`

##### newId

`string`

#### Returns

`void`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`renameLogicalId`](/cdk/classes/stack/#renamelogicalid)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:380

***

### reportMissingContextKey()

> **reportMissingContextKey**(`report`): `void`

Indicate that a context key was expected

Contains instructions which will be emitted into the cloud assembly on how
the key should be supplied.

#### Parameters

##### report

`MissingContext`

The set of parameters needed to obtain the context

#### Returns

`void`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`reportMissingContextKey`](/cdk/classes/stack/#reportmissingcontextkey)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:373

***

### resolve()

> **resolve**(`obj`): `any`

Resolve a tokenized value in the context of the current stack.

#### Parameters

##### obj

`any`

#### Returns

`any`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`resolve`](/cdk/classes/stack/#resolve)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:356

***

### splitArn()

> **splitArn**(`arn`, `arnFormat`): `ArnComponents`

Splits the provided ARN into its components.
Works both if 'arn' is a string like 'arn:aws:s3:::bucket',
and a Token representing a dynamic CloudFormation expression
(in which case the returned components will also be dynamic CloudFormation expressions,
encoded as Tokens).

#### Parameters

##### arn

`string`

the ARN to split into its components

##### arnFormat

`ArnFormat`

the expected format of 'arn' - depends on what format the service 'arn' represents uses

#### Returns

`ArnComponents`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`splitArn`](/cdk/classes/stack/#splitarn)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:473

***

### toJsonString()

> **toJsonString**(`obj`, `space`?): `string`

Convert an object, potentially containing tokens, to a JSON string

#### Parameters

##### obj

`any`

##### space?

`number`

#### Returns

`string`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`toJsonString`](/cdk/classes/stack/#tojsonstring)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:360

***

### toString()

> **toString**(): `string`

Returns a string representation of this construct.

#### Returns

`string`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`toString`](/cdk/classes/stack/#tostring)

#### Defined in

node\_modules/constructs/lib/construct.d.ts:279

***

### toYamlString()

> **toYamlString**(`obj`): `string`

Convert an object, potentially containing tokens, to a YAML string

#### Parameters

##### obj

`any`

#### Returns

`string`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`toYamlString`](/cdk/classes/stack/#toyamlstring)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:364

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

[`Stack`](/cdk/classes/stack/).[`isConstruct`](/cdk/classes/stack/#isconstruct)

#### Defined in

node\_modules/constructs/lib/construct.d.ts:262

***

### isStack()

> `static` **isStack**(`x`): `x is Stack`

Return whether the given object is a Stack.

We do attribute detection since we can't reliably use 'instanceof'.

#### Parameters

##### x

`any`

#### Returns

`x is Stack`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`isStack`](/cdk/classes/stack/#isstack)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:171

***

### of()

> `static` **of**(`construct`): `Stack`

Looks up the first stack scope in which `construct` is defined. Fails if there is no stack up the tree.

#### Parameters

##### construct

`IConstruct`

The construct to start the search from.

#### Returns

`Stack`

#### Inherited from

[`Stack`](/cdk/classes/stack/).[`of`](/cdk/classes/stack/#of)

#### Defined in

node\_modules/aws-cdk-lib/core/lib/stack.d.ts:176
