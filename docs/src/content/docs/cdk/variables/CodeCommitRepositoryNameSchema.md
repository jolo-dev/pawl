---
editUrl: false
next: false
prev: false
title: "CodeCommitRepositoryNameSchema"
---

> `const` **CodeCommitRepositoryNameSchema**: `ZodString`

Defined in: [packages/cdk/src/codecommit-repository.ts:15](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit-repository.ts#L15)

Zod schema validating an AWS CodeCommit repository name.

- 1–100 characters
- Letters, digits, `.`, `_`, and `-` only
- Must not end in `.git`

## See

[AWS CodeCommit RepositoryName](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-codecommit-repository.html#cfn-codecommit-repository-repositoryname)
