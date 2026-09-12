---
editUrl: false
next: false
prev: false
title: "CodeBuildRepositoryTarget"
---

> **CodeBuildRepositoryTarget** = \{ `repository?`: `never`; `repositoryName`: `string`; \} \| \{ `repository`: `Repository`; `repositoryName?`: `never`; \}

Defined in: [packages/cdk/src/codebuild-project.ts:152](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codebuild-project.ts#L152)

Selects a CodeCommit source for a CodeBuild project by name or by a
concrete repository resource.

Provide either a `repositoryName` string (imported by name) or a concrete
`repository` resource (preserves identity and source ARN). Providing both
or neither is a runtime error.
