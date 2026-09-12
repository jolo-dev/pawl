---
editUrl: false
next: false
prev: false
title: "CodeCommitPipelineSourceSchema"
---

> `const` **CodeCommitPipelineSourceSchema**: `ZodUnion`\<readonly \[`ZodObject`\<\{ `branchName`: `ZodOptional`\<`ZodString`\>; `create`: `ZodLiteral`\<`true`\>; `description`: `ZodOptional`\<`ZodString`\>; `origin`: `ZodLiteral`\<`"codecommit"`\>; `repositoryName`: `ZodString`; `sync`: `ZodOptional`\<`ZodString`\>; \}, `$strict`\>, `ZodObject`\<\{ `branchName`: `ZodOptional`\<`ZodString`\>; `create`: `ZodLiteral`\<`false`\>; `origin`: `ZodLiteral`\<`"codecommit"`\>; `repositoryName`: `ZodString`; \}, `$strict`\>, `ZodObject`\<\{ `branchName`: `ZodOptional`\<`ZodString`\>; `origin`: `ZodLiteral`\<`"codecommit"`\>; `repository`: `ZodCustom`\<`IRepository`, `IRepository`\>; `repositoryName`: `ZodOptional`\<`ZodString`\>; \}, `$strict`\>\]\>

Defined in: [packages/cdk/src/pipeline/source.ts:68](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/source.ts#L68)

Strict runtime schema for the three CodeCommit pipeline source ownership forms.
Unknown fields are rejected so JavaScript and cast callers cannot combine forms.
