---
editUrl: false
next: false
prev: false
title: "Template"
---

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:7

Suite of assertions that can be run on a CDK stack.
Typically used, as part of unit tests, to validate that the rendered
CloudFormation template has expected resources and properties.

## Methods

### allResources()

> **allResources**(`type`, `props`): `void`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:103

Assert that all resources of the given type contain the given definition in the
CloudFormation template.
By default, performs partial matching on the resource, via the `Match.objectLike()`.
To configure different behavior, use other matchers in the `Match` class.

#### Parameters

##### type

`string`

the resource type; ex: `AWS::S3::Bucket`

##### props

`any`

the entire definition of the resources as they should be expected in the template.

#### Returns

`void`

***

### allResourcesProperties()

> **allResourcesProperties**(`type`, `props`): `void`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:112

Assert that all resources of the given type contain the given properties
CloudFormation template.
By default, performs partial matching on the `Properties` key of the resource, via the
`Match.objectLike()`. To configure different behavior, use other matchers in the `Match` class.

#### Parameters

##### type

`string`

the resource type; ex: `AWS::S3::Bucket`

##### props

`any`

the 'Properties' section of the resource as should be expected in the template.

#### Returns

`void`

***

### findConditions()

> **findConditions**(`logicalId`, `props?`): `object`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:188

Get the set of matching Conditions that match the given properties in the CloudFormation template.

#### Parameters

##### logicalId

`string`

the name of the condition, provide `'*'` to match all conditions in the template.

##### props?

`any`

by default, matches all Conditions in the template.
When a literal object is provided, performs a partial match via `Match.objectLike()`.
Use the `Match` APIs to configure a different behaviour.

#### Returns

`object`

***

### findMappings()

> **findMappings**(`logicalId`, `props?`): `object`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:168

Get the set of matching Mappings that match the given properties in the CloudFormation template.

#### Parameters

##### logicalId

`string`

the name of the mapping, provide `'*'` to match all mappings in the template.

##### props?

`any`

by default, matches all Mappings in the template.
When a literal object is provided, performs a partial match via `Match.objectLike()`.
Use the `Match` APIs to configure a different behaviour.

#### Returns

`object`

***

### findOutputs()

> **findOutputs**(`logicalId`, `props?`): `object`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:148

Get the set of matching Outputs that match the given properties in the CloudFormation template.

#### Parameters

##### logicalId

`string`

the name of the output, provide `'*'` to match all outputs in the template.

##### props?

`any`

by default, matches all Outputs in the template.
When a literal object is provided, performs a partial match via `Match.objectLike()`.
Use the `Match` APIs to configure a different behaviour.

#### Returns

`object`

***

### findParameters()

> **findParameters**(`logicalId`, `props?`): `object`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:128

Get the set of matching Parameters that match the given properties in the CloudFormation template.

#### Parameters

##### logicalId

`string`

the name of the parameter, provide `'*'` to match all parameters in the template.

##### props?

`any`

by default, matches all Parameters in the template.
When a literal object is provided, performs a partial match via `Match.objectLike()`.
Use the `Match` APIs to configure a different behaviour.

#### Returns

`object`

***

### findResources()

> **findResources**(`type`, `props?`): `object`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:81

Get the set of matching resources of a given type and properties in the CloudFormation template.

#### Parameters

##### type

`string`

the type to match in the CloudFormation template

##### props?

`any`

by default, matches all resources with the given type.
When a literal is provided, performs a partial match via `Match.objectLike()`.
Use the `Match` APIs to configure a different behaviour.

#### Returns

`object`

***

### getResourceId()

> **getResourceId**(`type`, `props?`): `string`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:94

Get the Resource ID of a matching resource, expects only to find one match.
Throws AssertionError if none or multiple resources were found.

#### Parameters

##### type

`string`

the resource type; ex: `AWS::S3::Bucket`

##### props?

`any`

by default, matches all resources with the given type.

#### Returns

`string`

The resource id of the matched resource.
Performs a partial match via `Match.objectLike()`.

***

### hasCondition()

> **hasCondition**(`logicalId`, `props`): `void`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:180

Assert that a Condition with the given properties exists in the CloudFormation template.
By default, performs partial matching on the resource, via the `Match.objectLike()`.
To configure different behavior, use other matchers in the `Match` class.

#### Parameters

##### logicalId

`string`

the name of the mapping, provide `'*'` to match all conditions in the template.

##### props

`any`

the output as should be expected in the template.

#### Returns

`void`

***

### hasMapping()

> **hasMapping**(`logicalId`, `props`): `void`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:160

Assert that a Mapping with the given properties exists in the CloudFormation template.
By default, performs partial matching on the resource, via the `Match.objectLike()`.
To configure different behavior, use other matchers in the `Match` class.

#### Parameters

##### logicalId

`string`

the name of the mapping, provide `'*'` to match all mappings in the template.

##### props

`any`

the output as should be expected in the template.

#### Returns

`void`

***

### hasOutput()

> **hasOutput**(`logicalId`, `props`): `void`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:140

Assert that an Output with the given properties exists in the CloudFormation template.
By default, performs partial matching on the resource, via the `Match.objectLike()`.
To configure different behavior, use other matchers in the `Match` class.

#### Parameters

##### logicalId

`string`

the name of the output, provide `'*'` to match all outputs in the template.

##### props

`any`

the output as should be expected in the template.

#### Returns

`void`

***

### hasParameter()

> **hasParameter**(`logicalId`, `props`): `void`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:120

Assert that a Parameter with the given properties exists in the CloudFormation template.
By default, performs partial matching on the parameter, via the `Match.objectLike()`.
To configure different behavior, use other matchers in the `Match` class.

#### Parameters

##### logicalId

`string`

the name of the parameter, provide `'*'` to match all parameters in the template.

##### props

`any`

the parameter as should be expected in the template.

#### Returns

`void`

***

### hasResource()

> **hasResource**(`type`, `props`): `void`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:73

Assert that a resource of the given type and given definition exists in the
CloudFormation template.
By default, performs partial matching on the resource, via the `Match.objectLike()`.
To configure different behavior, use other matchers in the `Match` class.

#### Parameters

##### type

`string`

the resource type; ex: `AWS::S3::Bucket`

##### props

`any`

the entire definition of the resource as should be expected in the template.

#### Returns

`void`

***

### hasResourceProperties()

> **hasResourceProperties**(`type`, `props`): `void`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:64

Assert that a resource of the given type and properties exists in the
CloudFormation template.
By default, performs partial matching on the `Properties` key of the resource, via the
`Match.objectLike()`. To configure different behavior, use other matchers in the `Match` class.

#### Parameters

##### type

`string`

the resource type; ex: `AWS::S3::Bucket`

##### props

`any`

the 'Properties' section of the resource as should be expected in the template.

#### Returns

`void`

***

### resourceCountIs()

> **resourceCountIs**(`type`, `count`): `void`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:47

Assert that the given number of resources of the given type exist in the
template.

#### Parameters

##### type

`string`

the resource type; ex: `AWS::S3::Bucket`

##### count

`number`

number of expected instances

#### Returns

`void`

***

### resourcePropertiesCountIs()

> **resourcePropertiesCountIs**(`type`, `props`, `count`): `void`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:55

Assert that the given number of resources of the given type and properties exists in the
CloudFormation template.

#### Parameters

##### type

`string`

the resource type; ex: `AWS::S3::Bucket`

##### props

`any`

the 'Properties' section of the resource as should be expected in the template.

##### count

`number`

number of expected instances

#### Returns

`void`

***

### templateMatches()

> **templateMatches**(`expected`): `void`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:197

Assert that the CloudFormation template matches the given value

#### Parameters

##### expected

`any`

the expected CloudFormation template as key-value pairs.

#### Returns

`void`

***

### toJSON()

> **toJSON**(): `object`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:38

The CloudFormation template deserialized into an object.

#### Returns

`object`

***

### fromJSON()

> `static` **fromJSON**(`template`, `templateParsingOptions?`): `Template`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:22

Base your assertions from an existing CloudFormation template formatted as an in-memory
JSON object.

#### Parameters

##### template

the CloudFormation template formatted as a nested set of records

##### templateParsingOptions?

`TemplateParsingOptions`

Optional param to configure template parsing behavior, such as disregarding circular
dependencies.

#### Returns

`Template`

***

### fromStack()

> `static` **fromStack**(`stack`, `templateParsingOptions?`): `Template`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:14

Base your assertions on the CloudFormation template synthesized by a CDK `Stack`.

#### Parameters

##### stack

`Stack`

the CDK Stack to run assertions on

##### templateParsingOptions?

`TemplateParsingOptions`

Optional param to configure template parsing behavior, such as disregarding circular
dependencies.

#### Returns

`Template`

***

### fromString()

> `static` **fromString**(`template`, `templateParsingOptions?`): `Template`

Defined in: node\_modules/aws-cdk-lib/assertions/lib/template.d.ts:32

Base your assertions from an existing CloudFormation template formatted as a
JSON string.

#### Parameters

##### template

`string`

the CloudFormation template in

##### templateParsingOptions?

`TemplateParsingOptions`

Optional param to configure template parsing behavior, such as disregarding circular
dependencies.

#### Returns

`Template`
