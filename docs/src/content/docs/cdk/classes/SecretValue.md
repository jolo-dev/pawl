---
editUrl: false
next: false
prev: false
title: "SecretValue"
---

Defined in: node\_modules/aws-cdk-lib/core/lib/secret-value.d.ts:35

Work with secret values in the CDK

Constructs that need secrets will declare parameters of type `SecretValue`.

The actual values of these secrets should not be committed to your
repository, or even end up in the synthesized CloudFormation template. Instead, you should
store them in an external system like AWS Secrets Manager or SSM Parameter
Store, and you can reference them by calling `SecretValue.secretsManager()` or
`SecretValue.ssmSecure()`.

You can use `SecretValue.unsafePlainText()` to construct a `SecretValue` from a
literal string, but doing so is highly discouraged.

To make sure secret values don't accidentally end up in readable parts
of your infrastructure definition (such as the environment variables
of an AWS Lambda Function, where everyone who can read the function
definition has access to the secret), using secret values directly is not
allowed. You must pass them to constructs that accept `SecretValue`
properties, which are guaranteed to use the value only in CloudFormation
properties that are write-only.

If you are sure that what you are doing is safe, you can call
`secretValue.unsafeUnwrap()` to access the protected string of the secret
value.

(If you are writing something like an AWS Lambda Function and need to access
a secret inside it, make the API call to `GetSecretValue` directly inside
your Lamba's code, instead of using environment variables.)

## Extends

- `Intrinsic`

## Constructors

### new SecretValue()

> **new SecretValue**(`protectedValue`, `options`?): [`SecretValue`](/cdk/classes/secretvalue/)

Defined in: node\_modules/aws-cdk-lib/core/lib/secret-value.d.ts:126

Construct a SecretValue (do not use!)

Do not use the constructor directly: use one of the factory functions on the class
instead.

#### Parameters

##### protectedValue

`any`

##### options?

`IntrinsicProps`

#### Returns

[`SecretValue`](/cdk/classes/secretvalue/)

#### Overrides

`Intrinsic.constructor`

## Properties

### creationStack

> `readonly` **creationStack**: `string`[]

Defined in: node\_modules/aws-cdk-lib/core/lib/private/intrinsic.d.ts:35

The captured stack trace which represents the location in which this token was created.

#### Inherited from

`Intrinsic.creationStack`

***

### typeHint?

> `readonly` `optional` **typeHint**: `ResolutionTypeHint`

Defined in: node\_modules/aws-cdk-lib/core/lib/private/intrinsic.d.ts:39

Type that the Intrinsic is expected to evaluate to.

#### Inherited from

`Intrinsic.typeHint`

## Methods

### resolve()

> **resolve**(`context`): `any`

Defined in: node\_modules/aws-cdk-lib/core/lib/secret-value.d.ts:150

Resolve the secret

If the feature flag is not set, resolve as normal. Otherwise, throw a descriptive
error that the usage guard is missing.

#### Parameters

##### context

`IResolveContext`

#### Returns

`any`

#### Overrides

`Intrinsic.resolve`

***

### toJSON()

> **toJSON**(): `any`

Defined in: node\_modules/aws-cdk-lib/core/lib/private/intrinsic.d.ts:64

Turn this Token into JSON

Called automatically when JSON.stringify() is called on a Token.

#### Returns

`any`

#### Inherited from

`Intrinsic.toJSON`

***

### toString()

> **toString**(): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/private/intrinsic.d.ts:50

Convert an instance of this Token to a string

This method will be called implicitly by language runtimes if the object
is embedded into a string. We treat it the same as an explicit
stringification.

#### Returns

`string`

#### Inherited from

`Intrinsic.toString`

***

### toStringList()

> **toStringList**(): `string`[]

Defined in: node\_modules/aws-cdk-lib/core/lib/private/intrinsic.d.ts:58

Convert an instance of this Token to a string list

This method will be called implicitly by language runtimes if the object
is embedded into a list. We treat it the same as an explicit
stringification.

#### Returns

`string`[]

#### Inherited from

`Intrinsic.toStringList`

***

### unsafeUnwrap()

> **unsafeUnwrap**(): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/secret-value.d.ts:143

Disable usage protection on this secret

Call this to indicate that you want to use the secret value held by this
object in an unchecked way. If you don't call this method, using the secret
value directly in a string context or as a property value somewhere will
produce an error.

This method has 'unsafe' in the name on purpose! Make sure that the
construct property you are using the returned value in is does not end up
in a place in your AWS infrastructure where it could be read by anyone
unexpected.

When in doubt, don't call this method and only pass the object to constructs that
accept `SecretValue` parameters.

#### Returns

`string`

***

### cfnDynamicReference()

> `static` **cfnDynamicReference**(`ref`): [`SecretValue`](/cdk/classes/secretvalue/)

Defined in: node\_modules/aws-cdk-lib/core/lib/secret-value.d.ts:105

Obtain the secret value through a CloudFormation dynamic reference.

If possible, use `SecretValue.ssmSecure` or `SecretValue.secretsManager` directly.

#### Parameters

##### ref

`CfnDynamicReference`

The dynamic reference to use.

#### Returns

[`SecretValue`](/cdk/classes/secretvalue/)

***

### cfnParameter()

> `static` **cfnParameter**(`param`): [`SecretValue`](/cdk/classes/secretvalue/)

Defined in: node\_modules/aws-cdk-lib/core/lib/secret-value.d.ts:114

Obtain the secret value through a CloudFormation parameter.

Generally, this is not a recommended approach. AWS Secrets Manager is the
recommended way to reference secrets.

#### Parameters

##### param

`CfnParameter`

The CloudFormation parameter to use.

#### Returns

[`SecretValue`](/cdk/classes/secretvalue/)

***

### isSecretValue()

> `static` **isSecretValue**(`x`): `x is SecretValue`

Defined in: node\_modules/aws-cdk-lib/core/lib/secret-value.d.ts:39

Test whether an object is a SecretValue

#### Parameters

##### x

`any`

#### Returns

`x is SecretValue`

***

### ~~plainText()~~

> `static` **plainText**(`secret`): [`SecretValue`](/cdk/classes/secretvalue/)

Defined in: node\_modules/aws-cdk-lib/core/lib/secret-value.d.ts:51

Construct a literal secret value for use with secret-aware constructs

Do not use this method for any secrets that you care about! The value
will be visible to anyone who has access to the CloudFormation template
(via the AWS Console, SDKs, or CLI).

The only reasonable use case for using this method is when you are testing.

:::caution[Deprecated]
Use `unsafePlainText()` instead.
:::

#### Parameters

##### secret

`string`

#### Returns

[`SecretValue`](/cdk/classes/secretvalue/)

***

### resourceAttribute()

> `static` **resourceAttribute**(`attr`): [`SecretValue`](/cdk/classes/secretvalue/)

Defined in: node\_modules/aws-cdk-lib/core/lib/secret-value.d.ts:118

Use a resource's output as secret value

#### Parameters

##### attr

`string`

#### Returns

[`SecretValue`](/cdk/classes/secretvalue/)

***

### secretsManager()

> `static` **secretsManager**(`secretId`, `options`?): [`SecretValue`](/cdk/classes/secretvalue/)

Defined in: node\_modules/aws-cdk-lib/core/lib/secret-value.d.ts:82

Creates a `SecretValue` with a value which is dynamically loaded from AWS Secrets Manager.

If you rotate the value in the Secret, you must also change at least one property
on the resource where you are using the secret, to force CloudFormation to re-read the secret.

#### Parameters

##### secretId

`string`

The ID or ARN of the secret

##### options?

`SecretsManagerSecretOptions`

Options

#### Returns

[`SecretValue`](/cdk/classes/secretvalue/)

***

### ssmSecure()

> `static` **ssmSecure**(`parameterName`, `version`?): [`SecretValue`](/cdk/classes/secretvalue/)

Defined in: node\_modules/aws-cdk-lib/core/lib/secret-value.d.ts:97

Use a secret value stored from a Systems Manager (SSM) parameter.

This secret source in only supported in a limited set of resources and
properties. [Click here for the list of supported
properties](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/dynamic-references.html#template-parameters-dynamic-patterns-resources).

#### Parameters

##### parameterName

`string`

The name of the parameter in the Systems Manager
Parameter Store. The parameter name is case-sensitive.

##### version?

`string`

An integer that specifies the version of the parameter to
use. If you don't specify the exact version, AWS CloudFormation uses the
latest version of the parameter.

#### Returns

[`SecretValue`](/cdk/classes/secretvalue/)

***

### unsafePlainText()

> `static` **unsafePlainText**(`secret`): [`SecretValue`](/cdk/classes/secretvalue/)

Defined in: node\_modules/aws-cdk-lib/core/lib/secret-value.d.ts:72

Construct a literal secret value for use with secret-aware constructs

Do not use this method for any secrets that you care about! The value
will be visible to anyone who has access to the CloudFormation template
(via the AWS Console, SDKs, or CLI).

The primary use case for using this method is when you are testing.

The other use case where this is appropriate is when constructing a JSON secret.
For example, a JSON secret might have multiple fields where only some are actual
secret values.

#### Parameters

##### secret

`string`

#### Returns

[`SecretValue`](/cdk/classes/secretvalue/)

#### Example

```ts
declare const secret: SecretValue;
const jsonSecret = {
  username: SecretValue.unsafePlainText('myUsername'),
  password: secret,
};
```
