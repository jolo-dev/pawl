---
editUrl: false
next: false
prev: false
title: "AutoReviewConfig"
---

> **AutoReviewConfig** = `object`

Defined in: [packages/cdk/src/codecommit.ts:81](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit.ts#L81)

## Type Declaration

### botArnPatterns?

> `optional` **botArnPatterns?**: `string`

### codeBuildComputeSize?

> `optional` **codeBuildComputeSize?**: `"SMALL"` \| `"MEDIUM"` \| `"LARGE"`

### codeBuildNetworkPolicy?

> `optional` **codeBuildNetworkPolicy?**: \{ `availabilityZones`: `string`[]; `mode`: `"private"`; `packageAccess`: \{ `domain`: `string`; `domainOwner`: `string`; `endpointSecurityGroupIds`: `string`[]; `mode`: `"codeartifact"`; `prefixListIds`: `string`[]; `repository`: `string`; \}; `privateSubnetIds`: `string`[]; `vpcId`: `string`; \} \| \{ `mode`: `"public-test"`; `packageAccess`: \{ `endpoint`: `string`; `mode`: `"approved-registry"`; \}; \}

### legacyResourceIdSuffix?

> `optional` **legacyResourceIdSuffix?**: `string`

Migration-only suffix retaining pre-hash per-repository logical IDs.

### modelId

> **modelId**: `string` = `AnthropicModelIdSchema`

### reviewerAlias?

> `optional` **reviewerAlias?**: `string`

### reviewerExecutionTimeoutSeconds?

> `optional` **reviewerExecutionTimeoutSeconds?**: `number`

### reviewerMemorySize?

> `optional` **reviewerMemorySize?**: `number`

### reviewerRetentionDays?

> `optional` **reviewerRetentionDays?**: `number`

### reviewerTimeoutMinutes?

> `optional` **reviewerTimeoutMinutes?**: `number`
