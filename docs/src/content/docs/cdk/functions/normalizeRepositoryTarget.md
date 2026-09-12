---
editUrl: false
next: false
prev: false
title: "normalizeRepositoryTarget"
---

> **normalizeRepositoryTarget**(`scope`, `id`, `target`): `object`

Defined in: [packages/cdk/src/codecommit-repository.ts:132](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit-repository.ts#L132)

Resolves a CodeCommit repository target to both its `IRepository` and a validated name.

When a concrete `repository` is supplied, its `repositoryName` is validated
(unless it is an unresolved CDK token) and the resource identity is preserved.
When only a `repositoryName` is supplied, the repository is imported by name.

## Parameters

### scope

[`Construct`](/cdk/interfaces/construct/)

The construct scope for imported repositories.

### id

`string`

The construct id for the imported repository.

### target

[`RepositoryTarget`](/cdk/type-aliases/repositorytarget/)

The exact-one repository target.

## Returns

`object`

The resolved repository and its validated name.

### repository

> **repository**: `IRepository`

### repositoryName

> **repositoryName**: `string`

## Throws

when both or neither target variant is provided.
