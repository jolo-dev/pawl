---
editUrl: false
next: false
prev: false
title: "LocalStack"
---

Defined in: [packages/cdk/src/local-stack.ts:32](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/local-stack.ts#L32)

Scans the configured lambdaDir and creates a Node.js 24 LambdaFunction, function
URL, and URL output per directory entry. An empty directory creates none. Entries
are not filtered to TypeScript files. The legacy runtime hint does not override
the runtime pinned by LambdaFunction. This class does not start Docker or a
LocalStack container; its name does not enable LOCAL. It inherits Stack's
monitoring mode. The standalone Local helper, not this class, creates an App.
Undirected edges show URL configuration and output, not request routing.

<div class="mermaid-block"><div class="mermaid dark">%%{init:{"theme":"dark"}}%%
architecture-beta
  group entryGroup(logos:aws-lambda)[Per directory entry]
  service lambda(logos:aws-lambda)[Node 24 LambdaFunction] in entryGroup
  service url(internet)[Function URL] in entryGroup
  service outputs(logos:aws-cloudformation)[URL output] in entryGroup
  lambda:R -- L:url
  url:R -- L:outputs</div><div class="mermaid light">%%{init:{"theme":"default"}}%%
architecture-beta
  group entryGroup(logos:aws-lambda)[Per directory entry]
  service lambda(logos:aws-lambda)[Node 24 LambdaFunction] in entryGroup
  service url(internet)[Function URL] in entryGroup
  service outputs(logos:aws-cloudformation)[URL output] in entryGroup
  lambda:R -- L:url
  url:R -- L:outputs</div><pre><code class="language-mermaid">architecture-beta
  group entryGroup(logos:aws-lambda)[Per directory entry]
  service lambda(logos:aws-lambda)[Node 24 LambdaFunction] in entryGroup
  service url(internet)[Function URL] in entryGroup
  service outputs(logos:aws-cloudformation)[URL output] in entryGroup
  lambda:R -- L:url
  url:R -- L:outputs</code></pre></div>

## Extends

- [`Stack`](/pawl/cdk/classes/stack/)

## Constructors

### Constructor

> **new LocalStack**(`scope`, `id`, `props`): `LocalStack`

Defined in: [packages/cdk/src/local-stack.ts:48](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/local-stack.ts#L48)

The constructor function checks for the existence of a directory specified in the props, creates
LambdaFunction instances for each TypeScript file in the directory, and outputs the function URLs.

#### Parameters

##### scope

[`Construct`](/pawl/cdk/interfaces/construct/)

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

`LocalStack`

#### Overrides

[`Stack`](/pawl/cdk/classes/stack/).[`constructor`](/pawl/cdk/classes/stack/#constructor)

## Properties

### account

> `readonly` **account**: `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:281

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
into an **account-agnostic template**. In this case, your code should either
fail (throw an error, emit a synth error using `Annotations.of(construct).addError()`) or
implement some other account-agnostic behavior.

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`account`](/pawl/cdk/classes/stack/#account)

***

### artifactId

> `readonly` **artifactId**: `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:317

The ID of the cloud assembly artifact for this stack.

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`artifactId`](/pawl/cdk/classes/stack/#artifactid)

***

### environment

> `readonly` **environment**: `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:295

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

[`Stack`](/pawl/cdk/classes/stack/).[`environment`](/pawl/cdk/classes/stack/#environment)

***

### monitoring

> **monitoring**: `MonitoringFacade`

Defined in: [packages/cdk/src/stack.ts:31](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/stack.ts#L31)

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`monitoring`](/pawl/cdk/classes/stack/#monitoring)

***

### nestedStackResource?

> `readonly` `optional` **nestedStackResource?**: `CfnResource`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:306

If this is a nested stack, this represents its `AWS::CloudFormation::Stack`
resource. `undefined` for top-level (non-nested) stacks.

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`nestedStackResource`](/pawl/cdk/classes/stack/#nestedstackresource)

***

### node

> `readonly` **node**: `Node`

Defined in: node\_modules/constructs/lib/construct.d.ts:289

The tree node.

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`node`](/pawl/cdk/classes/stack/#node)

***

### region

> `readonly` **region**: `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:260

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

[`Stack`](/pawl/cdk/classes/stack/).[`region`](/pawl/cdk/classes/stack/#region)

***

### synthesizer

> `readonly` **synthesizer**: `IStackSynthesizer`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:322

Synthesis method for this stack

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`synthesizer`](/pawl/cdk/classes/stack/#synthesizer)

***

### tags

> `readonly` **tags**: `TagManager`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:235

Tags to be applied to the stack.

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`tags`](/pawl/cdk/classes/stack/#tags)

***

### templateFile

> `readonly` **templateFile**: `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:313

The name of the CloudFormation template file emitted to the output
directory during synthesis.

Example value: `MyStack.template.json`

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`templateFile`](/pawl/cdk/classes/stack/#templatefile)

***

### templateOptions

> `readonly` **templateOptions**: `ITemplateOptions`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:239

Options for CloudFormation template (like version, transform, description).

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`templateOptions`](/pawl/cdk/classes/stack/#templateoptions)

## Accessors

### availabilityZones

#### Get Signature

> **get** **availabilityZones**(): `string`[]

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:545

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

[`Stack`](/pawl/cdk/classes/stack/).[`availabilityZones`](/pawl/cdk/classes/stack/#availabilityzones)

***

### bundlingRequired

#### Get Signature

> **get** **bundlingRequired**(): `boolean`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:805

Indicates whether the stack requires bundling or not

##### Returns

`boolean`

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`bundlingRequired`](/pawl/cdk/classes/stack/#bundlingrequired)

***

### dependencies

#### Get Signature

> **get** **dependencies**(): `Stack`[]

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:463

Return the stacks this stack depends on

##### Returns

`Stack`[]

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`dependencies`](/pawl/cdk/classes/stack/#dependencies)

***

### env

#### Get Signature

> **get** **env**(): `ResourceEnvironment`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:821

The environment this Stack deploys to

##### Returns

`ResourceEnvironment`

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`env`](/pawl/cdk/classes/stack/#env)

***

### nested

#### Get Signature

> **get** **nested**(): `boolean`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:500

Indicates if this is a nested stack, in which case `parentStack` will include a reference to its parent.

##### Returns

`boolean`

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`nested`](/pawl/cdk/classes/stack/#nested)

***

### nestedStackParent

#### Get Signature

> **get** **nestedStackParent**(): `Stack` \| `undefined`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:549

If this is a nested stack, returns its parent stack.

##### Returns

`Stack` \| `undefined`

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`nestedStackParent`](/pawl/cdk/classes/stack/#nestedstackparent)

***

### notificationArns

#### Get Signature

> **get** **notificationArns**(): `string`[]

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:496

Returns the list of notification Amazon Resource Names (ARNs) for the current stack.

##### Returns

`string`[]

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`notificationArns`](/pawl/cdk/classes/stack/#notificationarns)

***

### partition

#### Get Signature

> **get** **partition**(): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:480

The partition in which this stack is defined

##### Returns

`string`

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`partition`](/pawl/cdk/classes/stack/#partition)

***

### stackId

#### Get Signature

> **get** **stackId**(): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:492

The ID of the stack

##### Example

```ts
// After resolving, looks like
'arn:aws:cloudformation:us-west-2:123456789012:stack/teststack/51af3dc0-da77-11e4-872e-1234567db123'
```

##### Returns

`string`

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`stackId`](/pawl/cdk/classes/stack/#stackid)

***

### stackName

#### Get Signature

> **get** **stackName**(): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:476

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

[`Stack`](/pawl/cdk/classes/stack/).[`stackName`](/pawl/cdk/classes/stack/#stackname)

***

### terminationProtection

#### Get Signature

> **get** **terminationProtection**(): `boolean`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:299

Whether termination protection is enabled for this stack.

##### Returns

`boolean`

#### Set Signature

> **set** **terminationProtection**(`value`): `void`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:300

##### Parameters

###### value

`boolean`

##### Returns

`void`

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`terminationProtection`](/pawl/cdk/classes/stack/#terminationprotection)

***

### urlSuffix

#### Get Signature

> **get** **urlSuffix**(): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:484

The Amazon domain suffix for the region in which this stack is defined

##### Returns

`string`

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`urlSuffix`](/pawl/cdk/classes/stack/#urlsuffix)

## Methods

### addDependency()

> **addDependency**(`target`, `reason?`): `void`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:459

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

[`Stack`](/pawl/cdk/classes/stack/).[`addDependency`](/pawl/cdk/classes/stack/#adddependency)

***

### addMetadata()

> **addMetadata**(`key`, `value`): `void`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:571

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

[`Stack`](/pawl/cdk/classes/stack/).[`addMetadata`](/pawl/cdk/classes/stack/#addmetadata)

***

### addStackTag()

> **addStackTag**(`tagName`, `tagValue`): `void`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:811

Configure a stack tag

At deploy time, CloudFormation will automatically apply all stack tags to all resources in the stack.

#### Parameters

##### tagName

`string`

##### tagValue

`string`

#### Returns

`void`

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`addStackTag`](/pawl/cdk/classes/stack/#addstacktag)

***

### addTransform()

> **addTransform**(`transform`): `void`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:564

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

[`Stack`](/pawl/cdk/classes/stack/).[`addTransform`](/pawl/cdk/classes/stack/#addtransform)

***

### exportStringListValue()

> **exportStringListValue**(`exportedValue`, `options?`): `string`[]

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:694

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

[`Stack`](/pawl/cdk/classes/stack/).[`exportStringListValue`](/pawl/cdk/classes/stack/#exportstringlistvalue)

***

### exportValue()

> **exportValue**(`exportedValue`, `options?`): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:672

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

[`Stack`](/pawl/cdk/classes/stack/).[`exportValue`](/pawl/cdk/classes/stack/#exportvalue)

***

### formatArn()

> **formatArn**(`components`): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:518

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

[`Stack`](/pawl/cdk/classes/stack/).[`formatArn`](/pawl/cdk/classes/stack/#formatarn)

***

### getLogicalId()

> **getLogicalId**(`element`): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:452

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

[`Stack`](/pawl/cdk/classes/stack/).[`getLogicalId`](/pawl/cdk/classes/stack/#getlogicalid)

***

### regionalFact()

> **regionalFact**(`factName`, `defaultValue?`): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:627

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

[`Stack`](/pawl/cdk/classes/stack/).[`regionalFact`](/pawl/cdk/classes/stack/#regionalfact)

***

### removeStackTag()

> **removeStackTag**(`tagName`): `void`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:817

Remove a stack tag

At deploy time, CloudFormation will automatically apply all stack tags to all resources in the stack.

#### Parameters

##### tagName

`string`

#### Returns

`void`

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`removeStackTag`](/pawl/cdk/classes/stack/#removestacktag)

***

### renameLogicalId()

> **renameLogicalId**(`oldId`, `newId`): `void`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:436

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

[`Stack`](/pawl/cdk/classes/stack/).[`renameLogicalId`](/pawl/cdk/classes/stack/#renamelogicalid)

***

### reportMissingContextKey()

> **reportMissingContextKey**(`report`): `void`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:429

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

[`Stack`](/pawl/cdk/classes/stack/).[`reportMissingContextKey`](/pawl/cdk/classes/stack/#reportmissingcontextkey)

***

### resolve()

> **resolve**(`obj`): `any`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:412

Resolve a tokenized value in the context of the current stack.

#### Parameters

##### obj

`any`

#### Returns

`any`

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`resolve`](/pawl/cdk/classes/stack/#resolve)

***

### splitArn()

> **splitArn**(`arn`, `arnFormat`): `ArnComponents`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:529

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

[`Stack`](/pawl/cdk/classes/stack/).[`splitArn`](/pawl/cdk/classes/stack/#splitarn)

***

### toJsonString()

> **toJsonString**(`this`, `obj`, `space?`): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:416

Convert an object, potentially containing tokens, to a JSON string

#### Parameters

##### this

`void`

##### obj

`any`

##### space?

`number`

#### Returns

`string`

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`toJsonString`](/pawl/cdk/classes/stack/#tojsonstring)

***

### toString()

> **toString**(): `string`

Defined in: node\_modules/constructs/lib/construct.d.ts:314

Returns a string representation of this construct.

#### Returns

`string`

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`toString`](/pawl/cdk/classes/stack/#tostring)

***

### toYamlString()

> **toYamlString**(`obj`): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:420

Convert an object, potentially containing tokens, to a YAML string

#### Parameters

##### obj

`any`

#### Returns

`string`

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`toYamlString`](/pawl/cdk/classes/stack/#toyamlstring)

***

### with()

> **with**(...`mixins`): `IConstruct`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:408

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

[`Stack`](/pawl/cdk/classes/stack/).[`with`](/pawl/cdk/classes/stack/#with)

***

### consumeListReference()

> `static` **consumeListReference**(`value`, `strength?`): `string`[]

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:231

Override the reference strength for a specific cross-stack string list reference.

This is the string list equivalent of `consumeReference`.

#### Parameters

##### value

`string`[]

A tokenized string list reference.

##### strength?

`ReferenceStrength`

The reference strength to use. Defaults to `BOTH`.

#### Returns

`string`[]

A token that resolves to the same value but uses the overridden strength.

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`consumeListReference`](/pawl/cdk/classes/stack/#consumelistreference)

***

### consumeReference()

> `static` **consumeReference**(`value`, `strength?`): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:221

Override the reference strength for a specific cross-stack reference value.

Use this to weaken (or strengthen) an individual reference without
affecting other references to the same resource. For example:

```ts
// producerStack defines an SNS topic
declare const topic: sns.Topic;

// consumerStack subscribes to it with a weak reference,
// so the producer can be torn down without blocking on this consumer
const consumerStack = new Stack(app, 'Consumer', {
  env: { account: '123456789012', region: 'us-east-1' },
});
new sns.Subscription(consumerStack, 'Subscription', {
  topic: sns.Topic.fromTopicArn(consumerStack, 'Topic', Stack.consumeReference(topic.topicArn)),
  endpoint: 'https://example.com/webhook',
  protocol: sns.SubscriptionProtocol.HTTPS,
});
```

#### Parameters

##### value

`string`

A tokenized string reference (e.g. `bucket.bucketArn`).

##### strength?

`ReferenceStrength`

The reference strength to use. Defaults to `BOTH`.

#### Returns

`string`

A token that resolves to the same value but uses the overridden strength.

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`consumeReference`](/pawl/cdk/classes/stack/#consumereference)

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

[`Stack`](/pawl/cdk/classes/stack/).[`isConstruct`](/pawl/cdk/classes/stack/#isconstruct)

***

### isStack()

> `static` **isStack**(`this`, `x`): `x is Stack`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:186

Return whether the given object is a Stack.

We do attribute detection since we can't reliably use 'instanceof'.

#### Parameters

##### this

`void`

##### x

`any`

#### Returns

`x is Stack`

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`isStack`](/pawl/cdk/classes/stack/#isstack)

***

### of()

> `static` **of**(`construct`): `Stack`

Defined in: node\_modules/aws-cdk-lib/core/lib/stack.d.ts:194

Looks up the first stack scope in which `construct` is defined. Fails if there is no stack up the tree.

Will return the closest containing `Stack` or `NestedStack`.

#### Parameters

##### construct

`IConstruct`

The construct to start the search from.

#### Returns

`Stack`

#### Inherited from

[`Stack`](/pawl/cdk/classes/stack/).[`of`](/pawl/cdk/classes/stack/#of)

<style>
.mermaid-block[data-viewer-state="ready"] > pre { display: none; }
.mermaid-block > .mermaid { display: none !important; }
.mermaid-stage > .mermaid { margin: 0; }
.mermaid-stage > .mermaid.dark { display: var(--mermaid-dark-display); }
.mermaid-stage > .mermaid.light { display: var(--mermaid-light-display); }
:root { --mermaid-dark-display: none; --mermaid-light-display: block; }
@media (prefers-color-scheme: dark) {
  :root { --mermaid-dark-display: block; --mermaid-light-display: none; }
}
body.light, :root[data-theme="light"] { --mermaid-dark-display: none; --mermaid-light-display: block; }
body.dark, :root[data-theme="dark"] { --mermaid-dark-display: block; --mermaid-light-display: none; }
</style>
<script type="module">
// Supported target types, not configured resources. Hrefs stay relative to the generated class page.
// Every row is verified against the owning construct's declared receiver union by docs/tests/mermaid-viewer.test.ts.
export const targetLinkRegistry = {
	ApiGateway: {
		owner: "ApiGateway",
		source: "packages/cdk/src/apigateway.ts",
		pagePath: "/cdk/classes/apigateway/",
		node: "routes",
		caption: "Routes and integrations",
		targets: [
			{ name: "LambdaFunction", href: "../lambdafunction/" },
			{ name: "EventBridge", href: "../eventbridge/" },
		],
	},
	ApiGatewayV1: {
		owner: "ApiGatewayV1",
		source: "packages/cdk/src/apigateway-v1.ts",
		pagePath: "/cdk/classes/apigatewayv1/",
		node: "routes",
		caption: "Routes and integrations",
		targets: [{ name: "LambdaFunction", href: "../lambdafunction/" }],
	},
	EventBridge: {
		owner: "EventBridge",
		source: "packages/cdk/src/eventbridge.ts",
		pagePath: "/cdk/classes/eventbridge/",
		node: "rules",
		caption: "Rules and target bindings",
		targets: [
			{ name: "LambdaFunction", href: "../lambdafunction/" },
			{ name: "ApiDestination", href: "../apidestination/" },
			{ name: "Sqs", href: "../sqs/" },
			{ name: "EventBridge", href: "../eventbridge/" },
		],
		unlinked: [
			{
				name: "EventPipe",
				note: "supplied source and target bus create an independent Pipe, not a rule on this bus",
			},
		],
	},
	Sqs: {
		owner: "Sqs",
		source: "packages/cdk/src/sqs.ts",
		pagePath: "/cdk/classes/sqs/",
		node: "mapping",
		caption: "Event source mapping batch 10",
		targets: [{ name: "LambdaFunction", href: "../lambdafunction/" }],
	},
	CodePipeline: {
		owner: "CodePipeline",
		source: "packages/cdk/src/codepipeline.ts",
		pagePath: "/cdk/classes/codepipeline/",
		node: "actions",
		caption: "Configured stages and actions",
		targets: [
			{ name: "CodeBuildProject", href: "../codebuildproject/" },
			{ name: "LambdaFunction", href: "../lambdafunction/" },
		],
		unlinked: [
			{ name: "IBucket", note: "artifact and S3 deploy buckets" },
			{ name: "IKey", note: "S3 deploy encryption key" },
			{ name: "IRole", note: "action and CloudFormation deployment roles" },
			{ name: "ITopic", note: "approval notification topic" },
			{ name: "IAction", note: "custom action" },
			{ name: "stackName", note: "CloudFormation deployment stack name" },
		],
	},
};

// Selects the generated row that owns this page and rejects anything the row does not allow.
export function parseTargetEntry(serialized, pageUrl) {
	try {
		const value = JSON.parse(serialized);
		const page = new URL(pageUrl);
		const row =
			value &&
			typeof value.owner === "string" &&
			Object.hasOwn(targetLinkRegistry, value.owner)
				? targetLinkRegistry[value.owner]
				: undefined;
		if (
			!row ||
			value.node !== row.node ||
			!Array.isArray(value.targets) ||
			value.targets.length > row.targets.length ||
			!["http:", "https:"].includes(page.protocol) ||
			!page.pathname.endsWith(row.pagePath)
		)
			return undefined;
		const names = new Set();
		const targets = [];
		for (const target of value.targets) {
			if (
				!target ||
				names.has(target.name) ||
				!row.targets.some(
					(allowed) =>
						target.name === allowed.name && target.href === allowed.href,
				)
			)
				return undefined;
			names.add(target.name);
			targets.push({
				name: target.name,
				href: new URL(target.href, page).href,
			});
		}
		const allowedUnlinked = row.unlinked ?? [];
		const notes = new Set();
		const unlinked = [];
		if (value.unlinked !== undefined) {
			if (
				!Array.isArray(value.unlinked) ||
				value.unlinked.length > allowedUnlinked.length
			)
				return undefined;
			for (const note of value.unlinked) {
				if (
					!note ||
					notes.has(note.name) ||
					!allowedUnlinked.some(
						(allowed) =>
							note.name === allowed.name && note.note === allowed.note,
					)
				)
					return undefined;
				notes.add(note.name);
				unlinked.push({ name: note.name, note: note.note });
			}
		}
		return {
			owner: row.owner,
			node: row.node,
			caption: row.caption,
			targets,
			unlinked,
		};
	} catch {
		return undefined;
	}
}

// Mermaid 11.17.2 architecture services use <render id>-service-<authored id>.
// The render prefix is scoped to this SVG; it is never stored as diagram identity.
export function findTargetNode(svg, node) {
	const matches = [...svg.querySelectorAll(".architecture-service")].filter(
		(service) => service.id === `${svg.id}-service-${node}`,
	);
	return matches.length === 1 ? matches[0] : undefined;
}

function enhanceTargetLinks(block, viewer, variants, viewport) {
	const entry = parseTargetEntry(block.dataset.targetLinks, location.href);
	if (!entry?.targets.length) return () => {};
	const nodes = variants.map((variant) =>
		findTargetNode(variant.querySelector("svg"), entry.node),
	);
	if (nodes.some((node) => !node)) return () => {};
	const targets = entry.targets;
	const chooser = document.createElement("div");
	chooser.className = "mermaid-target-chooser";
	chooser.id = `mermaid-targets-${crypto.randomUUID()}`;
	chooser.hidden = true;
	chooser.setAttribute("popover", "manual");
	chooser.setAttribute("role", "group");
	chooser.setAttribute("aria-label", "Supported targets");
	const heading = document.createElement("strong");
	heading.textContent = "Supported targets";
	chooser.append(heading);
	for (const target of targets) {
		const link = document.createElement("a");
		link.href = target.href;
		link.textContent = target.name;
		chooser.append(link);
	}
	if (entry.unlinked.length) {
		const supplied = document.createElement("div");
		supplied.className = "mermaid-target-supplied";
		supplied.setAttribute("role", "group");
		supplied.setAttribute("aria-label", "Supplied values");
		const label = document.createElement("strong");
		label.textContent = "Supplied values";
		supplied.append(label);
		for (const item of entry.unlinked) {
			const note = document.createElement("span");
			note.className = "mermaid-target-note";
			note.textContent = `${item.name}: ${item.note}`;
			supplied.append(note);
		}
		chooser.append(supplied);
	}
	if (targets.length > 1) viewer.append(chooser);
	let trigger;
	function close(restoreFocus = true) {
		if (chooser.hidden) return;
		const focused = chooser.contains(document.activeElement);
		chooser.hidePopover();
		chooser.hidden = true;
		trigger.setAttribute("aria-expanded", "false");
		if (restoreFocus && focused) {
			const visible = !trigger.closest(".mermaid").inert;
			(visible ? trigger : viewport).focus({ preventScroll: true });
		}
	}
	function open(control) {
		if (trigger === control && !chooser.hidden) {
			close();
			return;
		}
		close(false);
		trigger = control;
		control.setAttribute("aria-expanded", "true");
		chooser.hidden = false;
		chooser.showPopover();
		const node = control.getBoundingClientRect();
		const box = chooser.getBoundingClientRect();
		const margin = 8;
		chooser.style.left = `${Math.max(margin, Math.min(innerWidth - box.width - margin, node.left + node.width / 2 - box.width / 2))}px`;
		const below = node.bottom + margin;
		chooser.style.top = `${Math.max(margin, Math.min(innerHeight - box.height - margin, below + box.height <= innerHeight - margin ? below : node.top - box.height - margin))}px`;
		chooser.querySelector("a").focus({ preventScroll: true });
	}
	for (const node of nodes) {
		const control = document.createElementNS(
			"http://www.w3.org/2000/svg",
			targets.length === 1 ? "a" : "g",
		);
		control.classList.add("mermaid-target");
		control.setAttribute("tabindex", "0");
		control.setAttribute(
			"aria-label",
			targets.length === 1
				? `Supported target: ${targets[0].name}`
				: `${entry.caption}: supported targets`,
		);
		if (targets.length === 1) control.setAttribute("href", targets[0].href);
		else {
			control.setAttribute("role", "button");
			control.setAttribute("aria-expanded", "false");
			control.setAttribute("aria-controls", chooser.id);
			control.addEventListener("click", () => open(control));
			control.addEventListener("keydown", (event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				if (!event.repeat) open(control);
			});
		}
		node.before(control);
		control.append(node);
	}
	viewer.addEventListener(
		"keydown",
		(event) => {
			if (event.key !== "Escape" || chooser.hidden) return;
			event.preventDefault();
			event.stopPropagation();
			close();
		},
		true,
	);
	document.addEventListener(
		"pointerdown",
		(event) => {
			if (
				!chooser.hidden &&
				!chooser.contains(event.target) &&
				!trigger.contains(event.target)
			)
				close(false);
		},
		true,
	);
	document.addEventListener(
		"scroll",
		(event) => {
			if (!chooser.contains(event.target)) close();
		},
		true,
	);
	viewer.addEventListener("focusout", (event) => {
		if (
			!chooser.hidden &&
			!chooser.contains(event.relatedTarget) &&
			!trigger.contains(event.relatedTarget)
		)
			close(false);
	});
	return close;
}

export function nextZoom(zoom, action) {
	if (action === "reset") return 100;
	return Math.min(300, Math.max(50, zoom + (action === "in" ? 25 : -25)));
}

export function fitDiagram(
	width,
	height,
	availableWidth,
	availableHeight,
	zoom,
) {
	const scale = Math.min(1, availableWidth / width, availableHeight / height);
	return {
		width: (width * scale * zoom) / 100,
		height: (height * scale * zoom) / 100,
	};
}

// Centre coordinates are fractions of the drawing, shared across theme variants.
export function resetCamera() {
	return { zoom: 100, x: 0.5, y: 0.5 };
}

export function cameraTransform(camera, drawing, viewport) {
	const scale =
		(Math.min(
			1,
			viewport.width / drawing.width,
			viewport.height / drawing.height,
		) *
			camera.zoom) /
		100;
	return {
		scale,
		x: viewport.width / 2 - camera.x * drawing.width * scale,
		y: viewport.height / 2 - camera.y * drawing.height * scale,
	};
}

export function panCamera(camera, drawing, viewport, dx, dy) {
	const { scale } = cameraTransform(camera, drawing, viewport);
	return {
		...camera,
		x: camera.x - dx / (drawing.width * scale),
		y: camera.y - dy / (drawing.height * scale),
	};
}

export function zoomCamera(
	camera,
	drawing,
	viewport,
	zoom,
	anchor = { x: viewport.width / 2, y: viewport.height / 2 },
) {
	const before = cameraTransform(camera, drawing, viewport);
	const next = { ...camera, zoom: Math.min(300, Math.max(50, zoom)) };
	const after = cameraTransform(next, drawing, viewport);
	return panCamera(
		next,
		drawing,
		viewport,
		anchor.x - (((anchor.x - before.x) / before.scale) * after.scale + after.x),
		anchor.y - (((anchor.y - before.y) / before.scale) * after.scale + after.y),
	);
}

export function wheelZoom(zoom, delta, mode, pageHeight) {
	const pixels = delta * (mode === 1 ? 16 : mode === 2 ? pageHeight : 1);
	return Math.min(300, Math.max(50, zoom * Math.exp(-pixels * 0.002)));
}

function enhanceViewer(block, variants) {
	const viewer = document.createElement("div");
	viewer.className = "mermaid-viewer not-content";
	// Only static application markup; diagram labels never enter this template.
	const expandPath = "M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7";
	const restorePath = "M20 10h-6V4M14 10l7-7M4 14h6v6M10 14l-7 7";
	viewer.innerHTML = `<div class="mermaid-toolbar" role="group" aria-label="Diagram controls">
<button type="button" data-action="reset" aria-label="Reset view" title="Reset view"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v4M16 4h4v4M20 16v4h-4M4 16v4h4"/></svg></button>
<button type="button" data-action="out" aria-label="Zoom out" title="Zoom out"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6"/></svg></button>
<button type="button" data-action="in" aria-label="Zoom in" title="Zoom in"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6M10 7v6"/></svg></button>
<button type="button" data-action="expand" aria-label="Expand diagram" title="Expand diagram" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${expandPath}"/></svg></button>
<output aria-live="polite" aria-label="Diagram zoom">100%</output>
</div><div class="mermaid-viewport" tabindex="0" role="region" aria-label="Diagram — wheel to zoom, drag to move. Keyboard: arrows to move, plus or minus to zoom, zero to reset."><div class="mermaid-stage"></div></div>`;
	const viewport = viewer.querySelector(".mermaid-viewport");
	const stage = viewer.querySelector(".mermaid-stage");
	const output = viewer.querySelector("output");
	const expand = viewer.querySelector('[data-action="expand"]');
	const dialog = document.createElement("dialog");
	dialog.className = "mermaid-dialog";
	dialog.setAttribute("aria-label", "Expanded diagram");
	stage.append(...variants);
	block.prepend(viewer);
	let camera = resetCamera();
	let drawing;
	let size;
	let drag;
	const hover = matchMedia("(hover: hover) and (pointer: fine)");
	const closeTargets = enhanceTargetLinks(block, viewer, variants, viewport);
	let suppressActivation = false;

	function paint() {
		closeTargets();
		const { scale, x, y } = cameraTransform(camera, drawing, size);
		stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
		output.textContent = `${Math.round(camera.zoom)}%`;
		viewer.querySelector('[data-action="out"]').disabled = camera.zoom === 50;
		viewer.querySelector('[data-action="in"]').disabled = camera.zoom === 300;
	}
	function layout() {
		// Always-visible touch controls need room instead of masking diagram content.
		const inset = hover.matches
			? 0
			: viewer.querySelector(".mermaid-toolbar").offsetHeight + 16;
		viewer.style.paddingBlockStart = `${inset}px`;
		const dialogStyle = getComputedStyle(dialog);
		const cap = dialog.open
			? Math.max(
					1,
					dialog.clientHeight -
						Number.parseFloat(dialogStyle.paddingTop) -
						Number.parseFloat(dialogStyle.paddingBottom) -
						inset,
				)
			: Math.max(1, Math.min(640, innerHeight * 0.65) - inset);
		for (const variant of variants) {
			const visible = getComputedStyle(variant).display !== "none";
			variant.inert = !visible;
			variant.setAttribute("aria-hidden", String(!visible));
			if (!visible) continue;
			const svg = variant.querySelector("svg");
			const { width, height } = svg.viewBox.baseVal;
			drawing = { width, height };
			const fit = fitDiagram(width, height, viewport.clientWidth, cap, 100);
			size = {
				width: viewport.clientWidth,
				height: dialog.open ? cap : fit.height,
			};
			viewport.style.height = `${size.height}px`;
			stage.style.width = `${width}px`;
			stage.style.height = `${height}px`;
			svg.style.maxWidth = "none";
			svg.style.width = `${width}px`;
			svg.style.height = `${height}px`;
		}
		paint();
	}
	function endDrag() {
		if (!drag) return;
		const { id, moved } = drag;
		if (moved) suppressActivation = true;
		drag = undefined;
		viewer.classList.remove("is-dragging");
		if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
	}
	function setExpandedLabel(open) {
		const label = open ? "Restore diagram" : "Expand diagram";
		expand.setAttribute("aria-label", label);
		expand.title = label;
		expand
			.querySelector("path")
			.setAttribute("d", open ? restorePath : expandPath);
	}
	function restore() {
		closeTargets();
		endDrag();
		block.prepend(viewer);
		block.style.minHeight = "";
		dialog.remove();
		setExpandedLabel(false);
		layout();
		expand.focus({ preventScroll: true });
	}
	function changeZoom(zoom, anchor) {
		camera = zoomCamera(camera, drawing, size, zoom, anchor);
		paint();
	}
	dialog.addEventListener("close", restore);
	viewer.addEventListener("click", (event) => {
		const button = event.target.closest("button[data-action]");
		if (!button) return;
		const action = button.dataset.action;
		if (action === "expand") {
			closeTargets();
			endDrag();
			if (dialog.open) dialog.close();
			else {
				block.style.minHeight = `${block.getBoundingClientRect().height}px`;
				document.body.append(dialog);
				dialog.append(viewer);
				setExpandedLabel(true);
				dialog.showModal();
				layout();
				expand.focus();
			}
			return;
		}
		if (action === "reset") {
			camera = resetCamera();
			paint();
		} else changeZoom(nextZoom(camera.zoom, action));
	});
	viewport.addEventListener(
		"wheel",
		(event) => {
			if (event.ctrlKey || event.metaKey || !event.deltaY) return;
			const zoom = wheelZoom(
				camera.zoom,
				event.deltaY,
				event.deltaMode,
				size.height,
			);
			if (zoom === camera.zoom) return;
			event.preventDefault();
			const rect = viewport.getBoundingClientRect();
			changeZoom(zoom, {
				x: event.clientX - rect.left,
				y: event.clientY - rect.top,
			});
		},
		{ passive: false },
	);
	for (const type of ["click", "auxclick"])
		viewport.addEventListener(
			type,
			(event) => {
				if (!suppressActivation || event.detail === 0) return;
				event.preventDefault();
				event.stopImmediatePropagation();
			},
			true,
		);
	viewport.addEventListener("dragstart", (event) => {
		if (event.target.closest(".mermaid-target")) event.preventDefault();
	});
	viewport.addEventListener("pointerdown", (event) => {
		suppressActivation = false;
		const target = event.target.closest(".mermaid-target");
		if (
			event.pointerType !== "mouse" ||
			!event.isPrimary ||
			event.button !== 0 ||
			(target &&
				(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)) ||
			(!target &&
				event.target.closest(
					"a, button, input, textarea, select, [contenteditable]",
				))
		)
			return;
		// Delay capture for linked nodes: capturing on down retargets a real click.
		if (target) {
			drag = {
				id: event.pointerId,
				x: event.clientX,
				y: event.clientY,
				pending: true,
				moved: false,
			};
			return;
		}
		event.preventDefault();
		viewport.focus({ preventScroll: true });
		drag = {
			id: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			moved: false,
		};
		viewport.setPointerCapture(event.pointerId);
		viewer.classList.add("is-dragging");
	});
	// Observe pending node drags outside the viewport before capture begins.
	window.addEventListener("pointermove", (event) => {
		if (!drag || drag.id !== event.pointerId) return;
		if (!(event.buttons & 1)) {
			endDrag();
			return;
		}
		if (drag.pending) {
			if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5)
				return;
			drag.pending = false;
			viewport.setPointerCapture(event.pointerId);
			viewport.focus({ preventScroll: true });
			viewer.classList.add("is-dragging");
		}
		drag.moved = true;
		camera = panCamera(
			camera,
			drawing,
			size,
			event.clientX - drag.x,
			event.clientY - drag.y,
		);
		drag.x = event.clientX;
		drag.y = event.clientY;
		paint();
	});
	for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
		window.addEventListener(
			type,
			(event) => {
				if (drag?.id !== event.pointerId) return;
				if (type !== "pointerup") suppressActivation = true;
				endDrag();
			},
			true,
		);
	}
	window.addEventListener("blur", () => {
		if (drag) suppressActivation = true;
		endDrag();
	});
	viewport.addEventListener("keydown", (event) => {
		if (
			event.target !== viewport ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey
		)
			return;
		const arrows = {
			ArrowLeft: [40, 0],
			ArrowRight: [-40, 0],
			ArrowUp: [0, 40],
			ArrowDown: [0, -40],
		};
		if (arrows[event.key])
			camera = panCamera(camera, drawing, size, ...arrows[event.key]);
		else if (["+", "=", "-"].includes(event.key))
			camera = zoomCamera(
				camera,
				drawing,
				size,
				nextZoom(camera.zoom, event.key === "-" ? "out" : "in"),
			);
		else if (event.key === "0") camera = resetCamera();
		else return;
		event.preventDefault();
		paint();
	});
	const resize = new ResizeObserver(layout);
	resize.observe(viewport);
	const theme = new MutationObserver(layout);
	theme.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme", "class"],
	});
	theme.observe(document.body, {
		attributes: true,
		attributeFilter: ["class"],
	});
	const preference = matchMedia("(prefers-color-scheme: dark)");
	preference.addEventListener("change", layout);
	hover.addEventListener("change", layout);
	window.addEventListener("resize", layout);
	layout();
}

// Render each logical block independently; a failed theme retains the common source.
export async function initializeMermaidViewers(mermaid, root = document) {
	for (const block of root.querySelectorAll(".mermaid-block")) {
		if (block.dataset.viewerState) continue;
		block.dataset.viewerState = "rendering";
		const variants = [...block.querySelectorAll(":scope > .mermaid")];
		try {
			for (const variant of variants) {
				if (!variant.hasAttribute("data-inserted")) {
					const host = document.createElement("div");
					document.body.append(host);
					try {
						const { svg } = await mermaid.render(
							`pawl-mermaid-${crypto.randomUUID()}`,
							variant.textContent,
							host,
						);
						variant.innerHTML = svg;
					} finally {
						host.remove();
					}
				}
				const svg = variant.querySelector("svg");
				if (
					!svg ||
					variant.querySelector(".error-icon, .error-text") ||
					!(svg.viewBox.baseVal.width > 0 && svg.viewBox.baseVal.height > 0)
				) {
					throw new Error("Mermaid did not produce a valid diagram");
				}
				variant.dataset.inserted = "true";
			}
			if (!variants.length) throw new Error("Missing Mermaid variants");
			await document.fonts.ready;
			enhanceViewer(block, variants);
			block.dataset.viewerState = "ready";
		} catch (error) {
			block.dataset.viewerState = "error";
			const message = document.createElement("p");
			message.className = "mermaid-error";
			message.textContent =
				"Diagram unavailable. Mermaid source is shown below.";
			block.prepend(message);
			console.warn("Unable to render Mermaid diagram", error);
		}
	}
}

if (!document.documentElement.hasAttribute("data-mermaid-bootstrap")) {
  document.documentElement.setAttribute("data-mermaid-bootstrap", "");
  try {
    const { default: mermaid } = await import("https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs");
    mermaid.registerIconPacks([
      { name: "logos", loader: () => fetch("https://unpkg.com/@iconify-json/logos@1/icons.json").then(res => res.json()) },
      { name: "hugeicons", loader: () => fetch("https://unpkg.com/@iconify-json/hugeicons@1/icons.json").then(res => res.json()) }
    ]);
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true });
    await initializeMermaidViewers(mermaid);
  } catch (error) {
    console.warn("Unable to load Mermaid; source remains available", error);
  }
}
</script>
