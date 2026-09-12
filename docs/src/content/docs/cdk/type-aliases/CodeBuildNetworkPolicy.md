---
editUrl: false
next: false
prev: false
title: "CodeBuildNetworkPolicy"
---

> **CodeBuildNetworkPolicy** = \{ `availabilityZones`: `string`[]; `mode`: `"private"`; `packageAccess`: \{ `domain`: `string`; `domainOwner`: `string`; `endpointSecurityGroupIds`: `string`[]; `mode`: `"codeartifact"`; `prefixListIds`: `string`[]; `repository`: `string`; \}; `privateSubnetIds`: `string`[]; `vpcId`: `string`; \} \| \{ `mode`: `"public-test"`; `packageAccess`: \{ `endpoint`: `string`; `mode`: `"approved-registry"`; \}; \}

Defined in: [packages/cdk/src/codebuild-project.ts:128](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codebuild-project.ts#L128)
