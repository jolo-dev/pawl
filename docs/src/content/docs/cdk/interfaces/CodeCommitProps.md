---
editUrl: false
next: false
prev: false
title: "CodeCommitProps"
---

Defined in: [packages/cdk/src/codecommit.ts:175](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit.ts#L175)

Props for the high-level [CodeCommit](/cdk/classes/codecommit/) construct.

## Properties

### autoReview?

> `readonly` `optional` **autoReview?**: `object`

Defined in: [packages/cdk/src/codecommit.ts:187](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit.ts#L187)

Deploys the full durable auto-reviewer (reviewer Lambda, router, state
table, CodeBuild, Bedrock IAM) for this repository. Mutually exclusive
with `router`.

#### botArnPatterns?

> `optional` **botArnPatterns?**: `string`

#### codeBuildComputeSize?

> `optional` **codeBuildComputeSize?**: `"SMALL"` \| `"MEDIUM"` \| `"LARGE"`

#### codeBuildNetworkPolicy?

> `optional` **codeBuildNetworkPolicy?**: \{ `availabilityZones`: `string`[]; `mode`: `"private"`; `packageAccess`: \{ `domain`: `string`; `domainOwner`: `string`; `endpointSecurityGroupIds`: `string`[]; `mode`: `"codeartifact"`; `prefixListIds`: `string`[]; `repository`: `string`; \}; `privateSubnetIds`: `string`[]; `vpcId`: `string`; \} \| \{ `mode`: `"public-test"`; `packageAccess`: \{ `endpoint`: `string`; `mode`: `"approved-registry"`; \}; \}

#### legacyResourceIdSuffix?

> `optional` **legacyResourceIdSuffix?**: `string`

Migration-only suffix retaining pre-hash per-repository logical IDs.

#### modelId

> **modelId**: `string` = `AnthropicModelIdSchema`

#### reviewerAlias?

> `optional` **reviewerAlias?**: `string`

#### reviewerExecutionTimeoutSeconds?

> `optional` **reviewerExecutionTimeoutSeconds?**: `number`

#### reviewerMemorySize?

> `optional` **reviewerMemorySize?**: `number`

#### reviewerRetentionDays?

> `optional` **reviewerRetentionDays?**: `number`

#### reviewerTimeoutMinutes?

> `optional` **reviewerTimeoutMinutes?**: `number`

***

### create?

> `readonly` `optional` **create?**: [`CodeCommitCreateProps`](/cdk/interfaces/codecommitcreateprops/)

Defined in: [packages/cdk/src/codecommit.ts:179](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit.ts#L179)

When present, creates the repository instead of importing it by name.

***

### repositoryName

> `readonly` **repositoryName**: `string`

Defined in: [packages/cdk/src/codecommit.ts:177](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit.ts#L177)

CodeCommit repository name (1–100 chars, letters/digits/`.\_\-`, no `.git` suffix).

***

### router?

> `readonly` `optional` **router?**: [`LambdaFunction`](/cdk/classes/lambdafunction/)

Defined in: [packages/cdk/src/codecommit.ts:181](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codecommit.ts#L181)

Pawl Lambda that receives EventBridge events. Mutually exclusive with `autoReview`.
