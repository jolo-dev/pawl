---
editUrl: false
next: false
prev: false
title: "createCodeCommitSourceArchive"
---

> **createCodeCommitSourceArchive**(`options`): `object`

Defined in: [packages/cdk/src/codecommit-source.ts:519](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit-source.ts#L519)

Create the exact deterministic ZIP that CDK uploads to S3 for CodeCommit
initial seeding.

Reads each analyzed file with TOCTOU defenses (canonical containment,
device/inode/size identity) and never dereferences symlinks. The ZIP is
written using Node built-ins (`deflateRawSync`, CRC32, UTF-8 local/central
headers) with a fixed DOS timestamp for deterministic output. The filename
is derived from a SHA-256 of paths and content.

## Parameters

### options

The source analysis and output directory.

#### analysis

[`CodeCommitSourceAnalysis`](/cdk/interfaces/codecommitsourceanalysis/)

#### outputDirectory

`string`

## Returns

`object`

The archive path and compressed byte count.

### archivePath

> `readonly` **archivePath**: `string`

### bytes

> `readonly` **bytes**: `number`

## Throws

when the ZIP exceeds 4 MB or any file limit.
