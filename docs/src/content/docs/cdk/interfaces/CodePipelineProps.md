---
editUrl: false
next: false
prev: false
title: "CodePipelineProps"
---

Defined in: [packages/cdk/src/codepipeline.ts:163](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L163)

Pipeline-level props; source and stages are configured fluently.

Pinned `PipelineProps` behavior:

| Key | Pawl behavior |
| --- | --- |
| `artifactBucket` | Pass through in external-storage mode; conflicts with cross-region buckets. |
| `role`, `restartExecutionOnUpdate` | Pass through. |
| `pipelineName` | Pass through after applying the `pipelineNaming` matrix. |
| `crossRegionReplicationBuckets` | Pass through without creating a Pawl primary bucket. |
| `stages`, `triggers` | Omit from the type and reject at runtime. |
| `crossAccountKeys` | Pass through. |
| `enableKeyRotation` | Pass through; `true` requires `crossAccountKeys: true`. |
| `reuseCrossRegionSupportStacks` | Pass through. |
| `pipelineType` | Omit/reject and force V2. |
| `variables` | Merge by name while reserving `PAWL_*`. |
| `executionMode`, `usePipelineRoleForActions` | Pass through. |

When no external storage is supplied, Pawl creates a retained, rotating
KMS key and artifact bucket. `artifactEncryptionKey` applies only to that
Pawl-managed storage and conflicts with external or cross-region storage.

## Extends

- `Omit`\<`PipelineProps`, `"pipelineType"` \| `"stages"` \| `"triggers"` \| `"variables"`\>

## Properties

### artifactBucket?

> `readonly` `optional` **artifactBucket?**: `IBucket`

Defined in: node\_modules/aws-cdk-lib/aws-codepipeline/lib/pipeline.d.ts:217

The S3 bucket used by this Pipeline to store artifacts.

#### Default

```ts
- A new S3 bucket will be created.
```

#### Inherited from

`Omit.artifactBucket`

***

### artifactEncryptionKey?

> `readonly` `optional` **artifactEncryptionKey?**: `IKey`

Defined in: [packages/cdk/src/codepipeline.ts:171](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L171)

***

### autoReviewer?

> `readonly` `optional` **autoReviewer?**: `object`

Defined in: [packages/cdk/src/codepipeline.ts:169](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L169)

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

### crossAccountKeys?

> `readonly` `optional` **crossAccountKeys?**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-codepipeline/lib/pipeline.d.ts:271

Create KMS keys for cross-account deployments.

This controls whether the pipeline is enabled for cross-account deployments.

By default cross-account deployments are enabled, but this feature requires
that KMS Customer Master Keys are created which have a cost of $1/month.

If you do not need cross-account deployments, you can set this to `false` to
not create those keys and save on that cost (the artifact bucket will be
encrypted with an AWS-managed key). However, cross-account deployments will
no longer be possible.

#### Default

false - false if the feature flag `CODEPIPELINE_CROSS_ACCOUNT_KEYS_DEFAULT_VALUE_TO_FALSE`
is true, true otherwise

#### Inherited from

`Omit.crossAccountKeys`

***

### crossRegionReplicationBuckets?

> `readonly` `optional` **crossRegionReplicationBuckets?**: `object`

Defined in: node\_modules/aws-cdk-lib/aws-codepipeline/lib/pipeline.d.ts:244

A map of region to S3 bucket name used for cross-region CodePipeline.
For every Action that you specify targeting a different region than the Pipeline itself,
if you don't provide an explicit Bucket for that region using this property,
the construct will automatically create a Stack containing an S3 Bucket in that region.

#### Index Signature

\[`region`: `string`\]: `IBucket`

#### Default

```ts
- None.
```

#### Inherited from

`Omit.crossRegionReplicationBuckets`

***

### enableKeyRotation?

> `readonly` `optional` **enableKeyRotation?**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-codepipeline/lib/pipeline.d.ts:280

Enable KMS key rotation for the generated KMS keys.

By default KMS key rotation is disabled, but will add an additional $1/month
for each year the key exists when enabled.

#### Default

```ts
- false (key rotation is disabled)
```

#### Inherited from

`Omit.enableKeyRotation`

***

### executionMode?

> `readonly` `optional` **executionMode?**: `ExecutionMode`

Defined in: node\_modules/aws-cdk-lib/aws-codepipeline/lib/pipeline.d.ts:323

The method that the pipeline will use to handle multiple executions.

#### Default

```ts
- ExecutionMode.SUPERSEDED
```

#### Inherited from

`Omit.executionMode`

***

### onPullRequest?

> `readonly` `optional` **onPullRequest?**: `boolean`

Defined in: [packages/cdk/src/codepipeline.ts:170](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L170)

***

### pipelineName?

> `readonly` `optional` **pipelineName?**: `string`

Defined in: node\_modules/aws-cdk-lib/aws-codepipeline/lib/pipeline.d.ts:235

Name of the pipeline.

#### Default

```ts
- AWS CloudFormation generates an ID and uses that for the pipeline name.
```

#### Inherited from

`Omit.pipelineName`

***

### pipelineNaming?

> `readonly` `optional` **pipelineNaming?**: [`CodePipelineNaming`](/cdk/type-aliases/codepipelinenaming/)

Defined in: [packages/cdk/src/codepipeline.ts:172](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L172)

***

### restartExecutionOnUpdate?

> `readonly` `optional` **restartExecutionOnUpdate?**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-codepipeline/lib/pipeline.d.ts:229

Indicates whether to rerun the AWS CodePipeline pipeline after you update it.

#### Default

```ts
false
```

#### Inherited from

`Omit.restartExecutionOnUpdate`

***

### reuseCrossRegionSupportStacks?

> `readonly` `optional` **reuseCrossRegionSupportStacks?**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-codepipeline/lib/pipeline.d.ts:286

Reuse the same cross region support stack for all pipelines in the App.

#### Default

```ts
- true (Use the same support stack for all pipelines in App)
```

#### Inherited from

`Omit.reuseCrossRegionSupportStacks`

***

### reviewActionTimeoutMinutes?

> `readonly` `optional` **reviewActionTimeoutMinutes?**: `number`

Defined in: [packages/cdk/src/codepipeline.ts:174](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L174)

***

### reviewCoordinationDeploymentPhase?

> `readonly` `optional` **reviewCoordinationDeploymentPhase?**: `"prepareGsi1"` \| `"prepareGsi2"` \| `"active"`

Defined in: [packages/cdk/src/codepipeline.ts:173](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L173)

***

### role?

> `readonly` `optional` **role?**: `IRole`

Defined in: node\_modules/aws-cdk-lib/aws-codepipeline/lib/pipeline.d.ts:223

The IAM role to be assumed by this Pipeline.

#### Default

```ts
a new IAM role will be created.
```

#### Inherited from

`Omit.role`

***

### usePipelineRoleForActions?

> `readonly` `optional` **usePipelineRoleForActions?**: `boolean`

Defined in: node\_modules/aws-cdk-lib/aws-codepipeline/lib/pipeline.d.ts:329

Use pipeline service role for actions if no action role configured

#### Default

```ts
- false
```

#### Inherited from

`Omit.usePipelineRoleForActions`

***

### variables?

> `readonly` `optional` **variables?**: readonly `Variable`[]

Defined in: [packages/cdk/src/codepipeline.ts:168](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L168)
