---
editUrl: false
next: false
prev: false
title: "CodeBuildProjectConfig"
---

> **CodeBuildProjectConfig** = `object`

Defined in: [packages/cdk/src/codebuild-project.ts:140](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codebuild-project.ts#L140)

## Type Declaration

### computeSize

> **computeSize**: `"SMALL"` \| `"MEDIUM"` \| `"LARGE"`

### logRetentionDays

> **logRetentionDays**: `RetentionDays`

### networkPolicy

> **networkPolicy**: \{ `availabilityZones`: `string`[]; `mode`: `"private"`; `packageAccess`: \{ `domain`: `string`; `domainOwner`: `string`; `endpointSecurityGroupIds`: `string`[]; `mode`: `"codeartifact"`; `prefixListIds`: `string`[]; `repository`: `string`; \}; `privateSubnetIds`: `string`[]; `vpcId`: `string`; \} \| \{ `mode`: `"public-test"`; `packageAccess`: \{ `endpoint`: `string`; `mode`: `"approved-registry"`; \}; \} = `CodeBuildNetworkPolicySchema`

### timeoutMinutes

> **timeoutMinutes**: `number`
