---
editUrl: false
next: false
prev: false
title: "RepositoryTarget"
---

> **RepositoryTarget** = \{ `repository?`: `never`; `repositoryName`: `string`; \} \| \{ `repository`: `IRepository`; `repositoryName?`: `never`; \}

Defined in: [packages/cdk/src/codecommit-repository.ts:109](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit-repository.ts#L109)

Selects an existing CodeCommit repository by exactly one form of identity.

Provide either a `repositoryName` string (imported by name) or a concrete
`repository` resource (preserves identity and cross-stack references).
Providing both or neither is a runtime error.
