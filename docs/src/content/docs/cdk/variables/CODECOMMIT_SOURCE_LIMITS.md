---
editUrl: false
next: false
prev: false
title: "CODECOMMIT_SOURCE_LIMITS"
---

> `const` **CODECOMMIT\_SOURCE\_LIMITS**: `object`

Defined in: [packages/cdk/src/codecommit-source.ts:34](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit-source.ts#L34)

AWS CodeCommit initial-import limits enforced during source analysis.

These are the decimal-byte thresholds for the CloudFormation
`AWS::CodeCommit::Repository.Code` S3 ZIP:
- `archiveBytes`: 4 MB maximum compressed ZIP
- `totalBytes`: 20 MB maximum uncompressed content
- `fileBytes`: 6 MB maximum per individual file
- `files`: 100 maximum included files
- `pathCharacters`: 4,096 maximum repository-relative file path length

## Type Declaration

### archiveBytes

> `readonly` **archiveBytes**: `4000000` = `4_000_000`

### fileBytes

> `readonly` **fileBytes**: `6000000` = `6_000_000`

### files

> `readonly` **files**: `100` = `100`

### pathCharacters

> `readonly` **pathCharacters**: `4096` = `4_096`

### totalBytes

> `readonly` **totalBytes**: `20000000` = `20_000_000`

## See

 - [CloudFormation Code property](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-codecommit-repository-code.html)
 - [CodeCommit quotas](https://docs.aws.amazon.com/codecommit/latest/userguide/limits.html)
