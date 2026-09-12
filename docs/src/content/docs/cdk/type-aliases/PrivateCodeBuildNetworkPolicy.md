---
editUrl: false
next: false
prev: false
title: "PrivateCodeBuildNetworkPolicy"
---

> **PrivateCodeBuildNetworkPolicy** = `object`

Defined in: [packages/cdk/src/codebuild-project.ts:99](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codebuild-project.ts#L99)

## Type Declaration

### availabilityZones

> **availabilityZones**: `string`[]

### mode

> **mode**: `"private"`

### packageAccess

> **packageAccess**: `object` = `CodeArtifactPackageAccessSchema`

#### packageAccess.domain

> **domain**: `string`

#### packageAccess.domainOwner

> **domainOwner**: `string`

#### packageAccess.endpointSecurityGroupIds

> **endpointSecurityGroupIds**: `string`[]

#### packageAccess.mode

> **mode**: `"codeartifact"`

#### packageAccess.prefixListIds

> **prefixListIds**: `string`[]

#### packageAccess.repository

> **repository**: `string`

### privateSubnetIds

> **privateSubnetIds**: `string`[]

### vpcId

> **vpcId**: `string` = `vpcIdSchema`
