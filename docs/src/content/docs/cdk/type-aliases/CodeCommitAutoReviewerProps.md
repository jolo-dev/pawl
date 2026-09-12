---
editUrl: false
next: false
prev: false
title: "CodeCommitAutoReviewerProps"
---

> **CodeCommitAutoReviewerProps** = `z.input`\<*typeof* [`CodeCommitAutoReviewerConfigSchema`](/cdk/variables/codecommitautoreviewerconfigschema/)\> & `object`

Defined in: [packages/cdk/src/codecommit-auto-reviewer.ts:163](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit-auto-reviewer.ts#L163)

## Type Declaration

### legacyResourceIdSuffixes?

> `readonly` `optional` **legacyResourceIdSuffixes?**: `ReadonlyMap`\<`string`, `string`\>

Migration-only construct-ID suffixes, keyed by configured repository name.

Omit this map for the collision-safe hashed defaults. Use an override only
to retain the logical IDs of resources already deployed by an earlier
version of the construct.

### ~~pipelineCoordination?~~

> `readonly` `optional` **pipelineCoordination?**: `object`

:::caution[Deprecated]
Use `reviewCoordinationDeployment: { phase: "active", reviewActionTimeoutMinutes }` instead.

Deprecated compatibility alias. When supplied without
`reviewCoordinationDeployment`, maps at runtime to `{ phase: "active",
reviewActionTimeoutMinutes }`. The timeout defaults to and cannot exceed
15 minutes because CodePipeline's 20-minute no-reply watchdog requires a
conservative callback margin. If both properties are set, the constructor
throws a conflict error.
:::

#### pipelineCoordination.reviewActionTimeoutMinutes?

> `readonly` `optional` **reviewActionTimeoutMinutes?**: `number`

### repositoryResources?

> `readonly` `optional` **repositoryResources?**: `ReadonlyMap`\<`string`, `Repository`\>

Concrete repositories to reuse, keyed by configured repository name.

### reviewCoordinationDeployment?

> `readonly` `optional` **reviewCoordinationDeployment?**: [`ReviewCoordinationDeployment`](/cdk/type-aliases/reviewcoordinationdeployment/)

Prepare or activate the ordinary CodePipeline review coordination path.

### stage?

> `readonly` `optional` **stage?**: `string`

Override the stage context value (defaults to CDK context `stage`).

### team?

> `readonly` `optional` **team?**: `string`

Override the team context value (defaults to CDK context `team`).
