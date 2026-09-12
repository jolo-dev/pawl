---
editUrl: false
next: false
prev: false
title: "CodeCommitAutoReviewerConfigSchema"
---

> `const` **CodeCommitAutoReviewerConfigSchema**: `ZodObject`\<[`CodeCommitAutoReviewerConfig`](/cdk/type-aliases/codecommitautoreviewerconfig/)\>

Defined in: [packages/cdk/src/codecommit-auto-reviewer.ts:120](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit-auto-reviewer.ts#L120)

Zod-validated configuration for the auto-reviewer.

`repositories` is a non-empty list of CodeCommit repository names; one
CodeBuild project and one CodeCommit event construct is created per entry,
sharing a single durable reviewer, router, and state table.
