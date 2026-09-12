---
editUrl: false
next: false
prev: false
title: "CodeCommitPipelineSource"
---

> **CodeCommitPipelineSource** = `StrictUnion`\<\{ `branchName?`: `string`; `create`: `true`; `description?`: `string`; `origin`: `"codecommit"`; `repositoryName`: `string`; `sync?`: `string`; \} \| \{ `branchName?`: `string`; `create`: `false`; `origin`: `"codecommit"`; `repositoryName`: `string`; \} \| \{ `branchName?`: `string`; `origin`: `"codecommit"`; `repository`: `IRepository`; `repositoryName?`: `string`; \}\>

Defined in: [packages/cdk/src/pipeline/source.ts:23](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/pipeline/source.ts#L23)

Exact ownership forms supported by a fluent CodeCommit pipeline source.
