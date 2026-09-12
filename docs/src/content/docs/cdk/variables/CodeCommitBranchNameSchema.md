---
editUrl: false
next: false
prev: false
title: "CodeCommitBranchNameSchema"
---

> `const` **CodeCommitBranchNameSchema**: `ZodString`

Defined in: [packages/cdk/src/codecommit-repository.ts:37](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit-repository.ts#L37)

Zod schema validating an AWS CodeCommit branch name that is safe to use as a Git ref.

- 1–256 characters
- Must satisfy CodeCommit's branch pattern and Git ref safety checks
- Cannot begin with `-`, contain `HEAD`, end in `.lock`, contain `..`,
  `@{`, control characters, spaces, `~`, `^`, `:`, `?`, `*`, `[`, `\`,
  repeated `/`, or begin/end with `/` or `.`
- Slash-delimited components must not begin with `.` or end with `.lock`

## See

[AWS CodeCommit BranchName](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-codecommit-repository-code.html#cfn-codecommit-repository-code-branchname)
