---
editUrl: false
next: false
prev: false
title: "CodeCommitCreateProps"
---

Defined in: [packages/cdk/src/codecommit.ts:146](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit.ts#L146)

Props for creating a new CodeCommit repository.

When `sourcePath` is supplied, the directory is analyzed, packaged into a
deterministic ZIP, and used to seed the repository's initial commit via
CloudFormation's `Code` property. `branchName`, `forceIncludePath`, and
`sourceAssetHash` are only valid when `sourcePath` is set.

## Properties

### branchName?

> `readonly` `optional` **branchName?**: `string`

Defined in: [packages/cdk/src/codecommit.ts:150](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit.ts#L150)

Initial branch name. Defaults to `main`. Only valid with `sourcePath`.

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [packages/cdk/src/codecommit.ts:152](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit.ts#L152)

Repository description (max 1,000 characters).

***

### forceIncludePath?

> `readonly` `optional` **forceIncludePath?**: `string`

Defined in: [packages/cdk/src/codecommit.ts:158](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit.ts#L158)

One safe direct-child directory name to force-include despite root
`.gitignore` exclusion. Used to ensure generated infrastructure is seeded.
Only valid with `sourcePath`.

***

### sourceAssetHash?

> `readonly` `optional` **sourceAssetHash?**: `string`

Defined in: [packages/cdk/src/codecommit.ts:169](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit.ts#L169)

Advanced migration override for reusing an existing immutable seed ZIP
asset identity. Must be its exact 64-character lowercase hex CDK asset hash
and is only valid with `sourcePath`.

This does not change source filtering or archive contents. The caller must
ensure the asset already exists and matches the intended repository creation
seed; CDK will publish the locally generated ZIP under this identity if a
deployment attempts asset publication.

***

### sourcePath?

> `readonly` `optional` **sourcePath?**: `string`

Defined in: [packages/cdk/src/codecommit.ts:148](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit.ts#L148)

Local directory path to analyze and seed as the repository's initial commit.
