---
editUrl: false
next: false
prev: false
title: "S3DeployActionDefinition"
---

Defined in: [packages/cdk/src/pipeline/actions.ts:99](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L99)

## Extends

- `AwsActionBase`

## Properties

### accessControl?

> `readonly` `optional` **accessControl?**: `BucketAccessControl`

Defined in: [packages/cdk/src/pipeline/actions.ts:105](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L105)

***

### bucket

> `readonly` **bucket**: `IBucket`

Defined in: [packages/cdk/src/pipeline/actions.ts:101](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L101)

***

### cacheControl?

> `readonly` `optional` **cacheControl?**: readonly `CacheControl`[]

Defined in: [packages/cdk/src/pipeline/actions.ts:106](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L106)

***

### encryptionKey?

> `readonly` `optional` **encryptionKey?**: `IKey`

Defined in: [packages/cdk/src/pipeline/actions.ts:107](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L107)

***

### extract?

> `readonly` `optional` **extract?**: `boolean`

Defined in: [packages/cdk/src/pipeline/actions.ts:103](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L103)

***

### input?

> `readonly` `optional` **input?**: `string`

Defined in: [packages/cdk/src/pipeline/actions.ts:102](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L102)

***

### name

> `readonly` **name**: `string`

Defined in: [packages/cdk/src/pipeline/actions.ts:35](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L35)

#### Inherited from

`AwsActionBase.name`

***

### objectKey?

> `readonly` `optional` **objectKey?**: `string`

Defined in: [packages/cdk/src/pipeline/actions.ts:104](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L104)

***

### role?

> `readonly` `optional` **role?**: `IRole`

Defined in: [packages/cdk/src/pipeline/actions.ts:36](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L36)

#### Inherited from

`AwsActionBase.role`

***

### type

> `readonly` **type**: `"s3Deploy"`

Defined in: [packages/cdk/src/pipeline/actions.ts:100](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L100)

***

### variablesNamespace?

> `readonly` `optional` **variablesNamespace?**: `string`

Defined in: [packages/cdk/src/pipeline/actions.ts:37](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/actions.ts#L37)

#### Inherited from

`AwsActionBase.variablesNamespace`
