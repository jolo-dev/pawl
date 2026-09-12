---
editUrl: false
next: false
prev: false
title: "CodeCommitAutoReviewerConfig"
---

> **CodeCommitAutoReviewerConfig** = `object`

Defined in: [packages/cdk/src/codecommit-auto-reviewer.ts:150](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit-auto-reviewer.ts#L150)

Zod-validated configuration for the auto-reviewer.

`repositories` is a non-empty list of CodeCommit repository names; one
CodeBuild project and one CodeCommit event construct is created per entry,
sharing a single durable reviewer, router, and state table.

## Type Declaration

### botArnPatterns

> **botArnPatterns**: `string`

### codeBuildComputeSize

> **codeBuildComputeSize**: `"SMALL"` \| `"MEDIUM"` \| `"LARGE"`

### codeBuildNetworkPolicy

> **codeBuildNetworkPolicy**: \{ `availabilityZones`: `string`[]; `mode`: `"private"`; `packageAccess`: \{ `domain`: `string`; `domainOwner`: `string`; `endpointSecurityGroupIds`: `string`[]; `mode`: `"codeartifact"`; `prefixListIds`: `string`[]; `repository`: `string`; \}; `privateSubnetIds`: `string`[]; `vpcId`: `string`; \} \| \{ `mode`: `"public-test"`; `packageAccess`: \{ `endpoint`: `string`; `mode`: `"approved-registry"`; \}; \}

### repositories

> **repositories**: `string`[]

### reviewerAlias

> **reviewerAlias**: `string`

### reviewerExecutionTimeoutSeconds

> **reviewerExecutionTimeoutSeconds**: `number`

### reviewerMemorySize

> **reviewerMemorySize**: `number`

### reviewerModelId

> **reviewerModelId**: `string` = `BedrockModelIdSchema`

### reviewerRetentionDays

> **reviewerRetentionDays**: `number`

### reviewerTimeoutMinutes

> **reviewerTimeoutMinutes**: `number`
