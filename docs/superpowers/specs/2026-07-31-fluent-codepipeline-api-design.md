# Fluent CodePipeline API Design

## Status

Approved in collaborative design review on 2026-07-31. This specification defines a breaking replacement for constructor-level pipeline source and stage definitions.

## Goal

Make `@pawl/cdk` pipelines readable as an ordered fluent definition while preserving Pawl's secure defaults, exact artifact wiring, durable pull-request review integration, and access to ordinary AWS CDK pipeline options.

A consumer should be able to read the source and execution order from top to bottom:

```ts
new CodePipeline(this, "Pipeline", {
	autoReviewer: {
		modelId: "eu.anthropic.claude-sonnet-4-6",
	},
	onPullRequest: true,
	pipelineName: "orders-pipeline",
	executionMode: ExecutionMode.SUPERSEDED,
	restartExecutionOnUpdate: true,
})
	.source({
		origin: "codecommit",
		create: true,
		repositoryName: "orders-service",
		description: "Orders service",
		branchName: "main",
		sync: "../orders-service",
	})
	.stage({
		name: "Checks",
		actions: [
			{
				name: "Test",
				type: "codebuild",
				project: testProject,
			},
			{
				name: "Lint",
				type: "codebuild",
				project: lintProject,
			},
		],
	})
	.stage([
		{
			name: "Approval",
			actions: [
				{
					name: "ProductionApproval",
					type: "approval",
					description: "Approve production deployment",
				},
			],
		},
		{
			actions: [
				{
					name: "Deploy",
					type: "s3Deploy",
					bucket: deploymentBucket,
				},
			],
		},
	]);
```

## Non-goals

The first release does not:

- preserve constructor-level `source` or `stages` compatibility;
- implement GitHub or S3 sources;
- continuously synchronize a local directory after deployment;
- infer ordering between actions in the same stage;
- support sequential `runOrder` values within one stage;
- define a CLI serialization format for arbitrary pipeline actions; or
- replace Pawl constructs with raw `aws-cdk-lib` resources in consumer code.

GitHub can be added later as another `origin` member without changing the fluent method.

## Public API

### Constructor properties

`CodePipeline` remains the canonical public class. It creates an AWS CodePipeline V2 pipeline immediately and exposes `.source()` and `.stage()` methods that return the same instance.

The Pawl properties flatten ordinary AWS `PipelineProps` rather than nesting an escape hatch:

```ts
export interface CodePipelineProps
	extends Omit<
		PipelineProps,
		"pipelineType" | "stages" | "triggers" | "variables"
	> {
	readonly variables?: readonly Variable[];
	readonly autoReviewer?: AutoReviewConfig;
	readonly onPullRequest?: boolean;
	readonly artifactEncryptionKey?: IKey;
	readonly pipelineNaming?: CodePipelineNaming;
	readonly reviewCoordinationDeploymentPhase?: ReviewCoordinationDeploymentPhase;
	readonly reviewActionTimeoutMinutes?: number;
}
```

The precise implementation may need to omit and reintroduce additional AWS properties whose types conflict with Pawl ownership, but the public behavior is fixed:

- `pipelineType` is always V2 and cannot be supplied.
- Raw AWS `triggers` are omitted in the CodeCommit-only release; `onPullRequest` owns CodeCommit trigger behavior.
- User variables are accepted and merged with Pawl variables.
- Names beginning with the reserved `PAWL_` prefix are rejected.
- `pipelineName`, `artifactBucket`, role, execution mode, restart behavior, and other compatible AWS properties pass through.
- A supplied artifact bucket is used directly.
- If no artifact bucket is supplied, Pawl creates a retained KMS-encrypted bucket.
- `artifactEncryptionKey` is valid only when Pawl creates the bucket.
- `team` and deployment `stage` are not `CodePipelineProps`; `BasicConstruct` owns context lookup and tag injection for those values.
- The old constructor-level `source` and `stages` properties are removed.
- The old `autoReview` property is renamed to `autoReviewer` as part of the same breaking change.

When an external artifact bucket is used, the public `artifactBucket` property is typed as `IBucket`. A Pawl-created encryption key is exposed only when Pawl owns it; consumers must not assume that every external bucket exposes a key.

### Fluent methods

```ts
export interface PipelineStageDefinition {
	readonly name?: string;
	readonly actions: readonly [
		PipelineActionDefinition,
		...PipelineActionDefinition[],
	];
}

source(source: CodeCommitPipelineSource): this;

stage(stage: PipelineStageDefinition): this;

stage(
	stages: readonly [PipelineStageDefinition, ...PipelineStageDefinition[]],
): this;
```

Method order is pipeline order. `.source()` must be called exactly once and before `.stage()`. A single stage object adds one AWS stage. An outer non-empty array adds its stage objects sequentially in list order. Each stage object's non-empty `actions` array has one run order and therefore runs in parallel.

Sequential work uses separate stage objects, whether passed through separate calls or one outer array. A manual approval and its protected deployment must not share a stage object. Before mutating the construct tree, `.stage([...])` validates and plans the complete batch, including cross-stage artifact flow; one invalid definition prevents every stage in that call from being added.

## Construction lifecycle

`CodePipeline` has three conceptual states:

1. **Constructed** — the V2 pipeline and artifact storage exist.
2. **Sourced** — `.source()` has added the Source stage and `SourceOutput`.
3. **Staged** — at least one user stage has been added.

The constructor registers CDK synthesis validation. Synthesis fails when the fluent definition has no source or no user stage. Errors that can be known during a method call fail immediately.

Each fluent method validates its complete input and plans artifact mutations before adding anything to the CDK construct tree. A rejected source or stage must not leave partially created actions, artifacts, or repositories.

## CodeCommit source

### Source union

The initial source union contains only CodeCommit:

```ts
export type CodeCommitPipelineSource =
	| {
			readonly origin: "codecommit";
			readonly create: true;
			readonly repositoryName: string;
			readonly description?: string;
			readonly branchName?: string;
			readonly sync?: string;
	  }
	| {
			readonly origin: "codecommit";
			readonly create: false;
			readonly repositoryName: string;
			readonly branchName?: string;
	  }
	| {
			readonly origin: "codecommit";
			readonly repository: IRepository;
			readonly repositoryName?: string;
			readonly branchName?: string;
	  };
```

Zod schemas enforce exact ownership combinations at runtime.

### Ownership rules

- `create: true` creates and owns a Pawl CodeCommit repository.
- `sync`, `description`, and repository seeding are valid only with `create: true`.
- `create: false` imports an existing repository by literal name.
- `repository` reuses an existing `IRepository` construct.
- `repository` cannot be combined with `create` or `sync`.
- When both `repository` and the optional literal `repositoryName` fallback are supplied, a concretely resolved `repository.repositoryName` must equal the fallback. Because the base pipeline is created eagerly in the constructor, a mismatch fails during `.source()` before any source stage, source action, or review resources are created. Tokenized construct names cannot be compared and therefore use the explicit fallback as the review/event identity.
- `branchName` defaults to `main`.
- The source action is named `Source`.
- The source artifact is named `SourceOutput`.

When auto-review is active, Pawl must have a concrete repository name for event and durable-review configuration. A supplied repository whose name is unresolved must also provide the literal `repositoryName` fallback.

### Seed synchronization

`sync` is a CDK seed asset, not a live watcher. Pawl resolves the path relative to the consuming CDK application, packages the directory, and passes the asset through the existing CodeCommit repository abstraction.

Validation rejects:

- a missing path;
- a path that is not a directory;
- unsafe or unsupported paths;
- `sync` on imported or supplied repositories; and
- conflicting repository ownership fields.

Content changes produce a new seed asset identity during deployment. Existing replacement-safe asset identity behavior remains intact.

## Stage and action model

### Stage names

Each stage is represented by a `PipelineStageDefinition` object. Its `actions` tuple is non-empty at the TypeScript boundary and through Zod runtime validation. An explicit `name` is used as supplied after AWS-compatible validation.

When `name` is omitted, Pawl:

1. reads each action's effective name;
2. joins names with `-`;
3. replaces unsupported characters with `-`;
4. collapses and trims separators;
5. when the result exceeds AWS's 100-character limit, keeps the first 91 characters and appends `-` plus the first eight lowercase hexadecimal characters of the SHA-256 digest of the complete sanitized name; and
6. validates uniqueness against all existing stage names.

Hash input, algorithm, suffix length, and truncation boundary are part of the compatibility contract so synthesized names do not drift between implementations. An empty action list cannot produce a stage. Explicit and derived name collisions fail rather than receiving numeric suffixes.

### Action union

The built-in contract is fixed rather than described as a passthrough:

```ts
interface PipelineActionBase {
	readonly name: string;
	readonly role?: IRole;
	readonly region?: string;
	readonly variablesNamespace?: string;
}

type LambdaUserParameters =
	| {
			readonly userParameters?: Readonly<Record<string, unknown>>;
			readonly userParametersString?: never;
	  }
	| {
			readonly userParameters?: never;
			readonly userParametersString: string;
	  };

type CloudFormationPermissions =
	| {
			readonly adminPermissions: true;
			readonly deploymentRole?: never;
	  }
	| {
			readonly adminPermissions?: false;
			readonly deploymentRole: IRole;
	  };

export type PipelineActionDefinition =
	| (PipelineActionBase & {
			readonly type: "codebuild";
			readonly project: CodeBuildProject;
			readonly input?: string;
			readonly extraInputs?: readonly string[];
			readonly outputs?: readonly string[] | false;
			readonly actionType?: CodeBuildActionType;
			readonly environmentVariables?: Readonly<
				Record<string, BuildEnvironmentVariable>
			>;
			readonly checkSecretsInPlainTextEnvVariables?: boolean;
			readonly executeBatchBuild?: boolean;
			readonly combineBatchBuildArtifacts?: boolean;
	  })
	| (PipelineActionBase & {
			readonly type: "approval";
			readonly description?: string;
			readonly notificationTopic?: ITopic;
			readonly notifyEmails?: readonly string[];
			readonly externalEntityLink?: string;
			readonly timeout?: Duration;
	  })
	| (PipelineActionBase &
			LambdaUserParameters & {
				readonly type: "lambda";
				readonly handler: LambdaFunction;
				readonly inputs?: readonly string[] | false;
				readonly outputs?: readonly string[];
			})
	| (PipelineActionBase & {
			readonly type: "s3Deploy";
			readonly bucket: IBucket;
			readonly input?: string;
			readonly extract?: boolean;
			readonly objectKey?: string;
			readonly accessControl?: BucketAccessControl;
			readonly cacheControl?: readonly CacheControl[];
			readonly encryptionKey?: IKey;
	  })
	| (PipelineActionBase &
			CloudFormationPermissions & {
				readonly type: "cloudFormationDeploy";
				readonly stackName: string;
				readonly input?: string;
				readonly templatePath: string;
				readonly templateConfiguration?: {
					readonly input?: string;
					readonly path: string;
				};
				readonly extraInputs?: readonly string[];
				readonly capabilities?: readonly CfnCapabilities[];
				readonly parameterOverrides?: Readonly<Record<string, unknown>>;
				readonly replaceOnFailure?: boolean;
				readonly output?: {
					readonly name?: string;
					readonly fileName: string;
				};
				readonly account?: string;
			})
	| {
			readonly type: "custom";
			readonly name: string;
			readonly action: IAction;
	  };
```

Pawl owns `actionName`, raw `Artifact` objects, and run order. Version one does not expose `runOrder`; all actions in one stage definition remain parallel. Where an AWS action does not support a common field, its adapter rejects the field rather than silently dropping it.

Action-specific behavior is:

- CodeBuild accepts `CodeBuildProject`; `actionType` avoids colliding with the `type` discriminant.
- Lambda accepts ordinary `LambdaFunction` and continues rejecting direct durable functions. It consumes the unambiguous frontier input by default; `inputs: false` explicitly requests no input. It has no default output, and a handler requesting outputs is responsible for uploading them.
- `userParameters` and `userParametersString` are mutually exclusive.
- S3 deploy requires one input, selected automatically only when unambiguous.
- CloudFormation deploy requires one input artifact and `templatePath`. When `input` is omitted, Pawl selects the sole frontier artifact; omission is an ambiguity error when the frontier has multiple artifacts. `templateConfiguration.input` and `extraInputs` are artifact names that Pawl converts to AWS `ArtifactPath` and `Artifact` values.
- CloudFormation permissions are an XOR: `adminPermissions: true` lets AWS CDK create its administrative role, while the default/non-admin path requires an explicit `deploymentRole` that the consumer has already granted. Pawl never creates an unusable zero-permission deployment role.
- CloudFormation creates an output only when `output.fileName` is present; `output.name` defaults through the artifact naming rule.
- A custom action's effective name must agree with `action.actionProperties.actionName`. Custom actions with a non-default run order are rejected. Every declared custom input and output must already have a concrete, AWS-valid `artifactName`; unnamed custom artifacts are rejected before stage mutation because CDK names them too late for deterministic planning.

## Artifact planning

Artifact resolution is isolated in a pure planner. The construct maintains:

- a global map from artifact name to `Artifact`; and
- a current artifact frontier representing outputs available from the most recent output-producing stage.

### Rules

- Source registers `SourceOutput` and sets it as the initial frontier.
- Every action in a stage reads the same pre-stage frontier.
- Outputs from one parallel action are not inputs to another action in that stage.
- An input-consuming action with one frontier artifact receives it automatically.
- An input-consuming action with multiple frontier artifacts must name its input.
- Explicit inputs may reference any previously registered artifact.
- Unknown inputs fail before stage mutation.
- Artifact names are globally unique.
- A CodeBuild action produces `<SanitizedActionName>Output` by default.
- Default artifact names replace characters outside `[A-Za-z0-9_-]` with `-`, collapse and trim separators, and use the same fixed SHA-256 suffix rule when the result would exceed 100 characters. For example, `Build.App` produces `Build-AppOutput`.
- Explicit artifact names must already satisfy AWS artifact-name constraints; Pawl does not rewrite them.
- CodeBuild outputs can be renamed, expanded to multiple named outputs, or disabled explicitly. `outputs: []` is invalid; use `outputs: false` to disable output creation.
- Lambda `inputs: []` is invalid; use `inputs: false` for no input. Lambda `outputs: []` is also invalid; omit `outputs` for no output. Lambda enforces AWS's maximum of five inputs and five outputs.
- Actions that do not naturally produce artifacts do not receive synthetic outputs.
- If a stage produces at least one output, those outputs become the next frontier.
- If a stage produces no outputs, the previous frontier carries through unchanged.

This makes approval stages transparent to artifact flow while making parallel build fan-out explicit at the next input-consuming stage.

### Ambiguity example

```ts
.stage({
	name: "Builds",
	actions: [
		{ name: "Web", type: "codebuild", project: webProject },
		{ name: "Api", type: "codebuild", project: apiProject },
	],
})
.stage({
	name: "DeployWeb",
	actions: [
		{
			name: "DeployWeb",
			type: "s3Deploy",
			bucket: webBucket,
			input: "WebOutput",
		},
	],
});
```

Omitting `input` from `DeployWeb` is invalid because the frontier contains `WebOutput` and `ApiOutput`.

## Pull-request execution and auto-review

`onPullRequest` and `autoReviewer` are independent options. Source and reviewer creation are deferred until `.source()` because both need CodeCommit identity.

| `onPullRequest` | `autoReviewer` | Behavior |
|---|---|---|
| false or absent | absent | Native CodeCommit default-branch pipeline trigger |
| true | absent | PR execution router starts exact-revision pipeline runs; no AI reviewer is deployed |
| false or absent | present | Native default-branch pipeline plus standalone AI reviewer |
| true | present | PR execution router plus durable AI-review bridge inside the pipeline |

The PR execution router is therefore not owned by or conditional on AutoReviewer. Refactoring must separate reusable exact-revision PR execution routing from AI review resources while preserving current deterministic execution-token and revision behavior.

Additional rules:

- `autoReviewer` is valid only for a CodeCommit source.
- `onPullRequest: true` disables the native source trigger and always provisions the PR execution router.
- Every PR-routed pipeline declares and receives the same six protected `PAWL_*` variables: provider, repository, request ID, generation, source revision, and destination revision.
- The router without AutoReviewer uses the same exact-revision transport and metadata contract, including deterministic client tokens; the variables remain execution metadata even when no bridge consumes them.
- User variables are merged, and reserved-name collisions fail.
- `team` and deployment `stage` are resolved from the same CDK context used by `BasicConstruct` tagging. `CodePipeline` neither accepts nor forwards duplicate overrides.
- The bridge, reconciler, DynamoDB coordination state, timeout, IAM grants, and EventBridge rules retain their current behavior.
- Preparation deployment phases create coordination resources without adding `AIReview`.
- In the active phase, `AIReview` is inserted into the first user stage as a parallel action and consumes `SourceOutput`.
- A pipeline with active coordination but no user stage fails synthesis.
- Auto-review source identity must be concrete before review resources are created.

The AIReview injection is planned before the first stage is mutated, so an invalid bridge configuration cannot leave a partially added first stage.

## Flattened AWS properties

Compatible AWS `PipelineProps` are forwarded directly when the underlying pipeline is created. Pawl reserves or normalizes only fields required for its invariants.

- `pipelineType` is always V2.
- `stages` is omitted and rejected; fluent `.stage()` is the only user-stage API.
- `triggers` is omitted and rejected in the CodeCommit-only release because the pinned AWS property supports only CodeStar Connections. `onPullRequest` is the sole CodeCommit trigger-mode property.
- `variables` are merged by variable name.
- `artifactBucket`, `pipelineName`, `role`, `executionMode`, and `restartExecutionOnUpdate` remain user-controlled.
- With neither property, `pipelineNaming` defaults to Pawl naming.
- `pipelineName` alone is accepted as the explicit AWS name.
- `pipelineNaming.mode: "cloudFormation"` cannot be combined with `pipelineName`.
- `pipelineNaming.mode: "pawl"` cannot be combined with `pipelineName` because both own the physical name.
- `pipelineNaming.mode: "explicit"` may be combined with `pipelineName` only when the two names are exactly equal; mismatches fail validation.
- Existing coordination-name requirements for CloudFormation-owned names remain unchanged.
- Existing cross-account and encryption constraints are validated rather than silently overridden.

The implementation plan must inventory the exact `PipelineProps` version in the pinned `aws-cdk-lib` and document every omitted or normalized key.

## Validation and errors

A public `PipelineDefinitionError` provides:

```ts
export class PipelineDefinitionError extends Error {
	readonly code: PipelineDefinitionErrorCode;
	readonly path?: string;
}
```

Representative codes include:

- `SOURCE_REQUIRED`
- `SOURCE_ALREADY_DEFINED`
- `SOURCE_AFTER_STAGE`
- `STAGE_REQUIRED`
- `STAGE_EMPTY`
- `STAGE_NAME_CONFLICT`
- `ACTION_NAME_CONFLICT`
- `ARTIFACT_NAME_CONFLICT`
- `ARTIFACT_NOT_FOUND`
- `ARTIFACT_INPUT_AMBIGUOUS`
- `SOURCE_OWNERSHIP_CONFLICT`
- `AUTO_REVIEW_SOURCE_UNSUPPORTED`
- `RESERVED_VARIABLE_CONFLICT`
- `PIPELINE_PROP_CONFLICT`

Paths identify the fluent definition location without requiring consumers to parse messages:

```text
stages[Checks].actions[Deploy].input
```

Immediate validation handles duplicate source/stage/action/artifact definitions, ordering, ownership, unsupported types, and artifact ambiguity. CDK synthesis validation handles missing source, missing user stages, and incomplete deferred auto-review configuration.

## Internal boundaries

The implementation should split the current large pipeline module into focused units:

- `codepipeline.ts` — construct lifecycle and orchestration
- `pipeline/source.ts` — source schemas, ownership, and source action creation
- `pipeline/actions.ts` — action unions and AWS action adapters
- `pipeline/artifacts.ts` — pure registry/frontier planning
- `pipeline/naming.ts` — AWS-compatible naming and collision rules
- `pipeline/errors.ts` — stable typed errors

Public definitions describe Pawl concepts. AWS SDK/CDK action-specific details remain inside adapters so artifact and validation logic can be tested without synthesizing a stack.

## Migration

This is a deliberate breaking change.

Old:

```ts
new CodePipeline(this, "Pipeline", {
	source: {
		type: "codecommit",
		repository,
		branchName: "main",
	},
	stages: [
		{
			name: "Build",
			actions: [{ type: "codebuild", project }],
		},
	],
});
```

New:

```ts
new CodePipeline(this, "Pipeline", props)
	.source({
		origin: "codecommit",
		repository,
		branchName: "main",
	})
	.stage({
		name: "Build",
		actions: [
			{
				name: "Build",
				type: "codebuild",
				project,
			},
		],
	});
```

All examples, tests, generated CLI templates, and documentation must migrate in the same release. No runtime compatibility parser or deprecated overload remains.

The migration mapping also includes:

- `autoReview` becomes `autoReviewer` with the same reviewer configuration semantics;
- `team` and deployment `stage` are removed from `CodePipelineProps`; consuming apps keep them in CDK context for `BasicConstruct` tags and reviewer identity;
- `onPullRequest` remains top-level but now provisions PR execution independently of AutoReviewer and always uses the complete six-variable PR execution contract;
- raw `PipelineProps.stages` and `PipelineProps.triggers` are unavailable; stages are fluent, and triggers remain unavailable until a compatible non-CodeCommit source is designed; and
- old action `manualApproval` becomes `approval`, while CloudFormation `actionMode: "REPLACE_ON_FAILURE"` becomes `replaceOnFailure: true`.

## CLI integration

`packages/cli` is part of the breaking migration, not a follow-up. The existing `pawl init codepipeline` generator currently emits constructor-level `source`, uses the old `autoReview` property, relies on the implicit default stage, and parses a `--pipeline-stage` value that it never consumes.

The generator must instead emit:

```ts
new CodePipeline(this, "Pipeline", {
	onPullRequest: true,
	autoReviewer: { modelId },
})
	.source({
		origin: "codecommit",
		create: false,
		repositoryName,
		branchName,
	})
	.stage({
		name: "Approval",
		actions: [
			{
				name: "Approve",
				type: "approval",
				description: "Approve pipeline execution",
			},
		],
	});
```

The actual generated properties remain conditional on the selected CLI options. In particular, `onPullRequest` and `autoReviewer` are omitted when disabled.

CLI requirements:

- The CLI accepts only `--source codecommit` in this release. Presence alone is insufficient: any other value fails before layout creation or file generation.
- Generated CodeCommit sources import by name through `create: false`; the generated stack no longer imports raw `Repository` solely to construct the source.
- Every generated pipeline contains one editable Approval stage so it satisfies synthesis completeness without inventing a deployment target or CodeBuild project.
- Generated `cdk.json` retains `team` and deployment `stage` context for `BasicConstruct` tags and reviewer identity; those values are not emitted into `CodePipelineProps`.
- The unused `--pipeline-stage` flag is removed from `CodePipelineInitFlags`, argument parsing, help, `packages/cli/README.md`, and tests. Arbitrary CLI stage serialization is a separate future design.
- `runCodePipelineInit` no longer accepts and silently drops parsed pipeline-stage values; no arbitrary stage field is added to `CodePipelineGeneratorConfig`.
- Generator tests assert the fluent source and Approval stage shape, conditional PR/reviewer properties, and absence of the old constructor source and `autoReview`.
- A host-side integration test executes synthesis against generated output with local package resolution; emitting an unexecuted test file is not synthesis evidence.
- CLI command tests assert that non-CodeCommit source values and the removed stage flag are rejected and that context values remain in generated `cdk.json`.
- The separate `pawl init codecommit` command retains `autoReview`; that property belongs to the `CodeCommit` construct and is outside this rename.

## Testing strategy

### Type and schema tests

- Every valid source ownership branch compiles and parses.
- Conflicting source fields fail at compile time where possible and through Zod at runtime.
- Supplied repository and fallback names must agree when the construct name is concrete; tokenized names use the fallback. A mismatch leaves the already-created base pipeline intact but creates no source-stage or review children.
- Each action discriminant exposes only its specified properties, including compile-time checks for CodeBuild outputs, Lambda no-input mode, CloudFormation artifact references, and the CloudFormation permissions XOR.
- `userParameters` and `userParametersString` are mutually exclusive in both TypeScript and Zod validation.
- Non-admin CloudFormation deployment without a role and custom actions with unnamed artifacts are rejected.
- Raw durable Lambda handlers remain invalid pipeline Lambda actions.
- Flattened AWS properties retain their upstream types, while `pipelineType`, `stages`, and `triggers` are compile-time errors.

### Pure unit tests

- Artifact registration, frontier replacement, and frontier carry-through.
- Parallel actions read the same pre-stage frontier.
- Automatic input selection and multi-output ambiguity.
- Explicit inputs to earlier registered artifacts.
- Default, renamed, multiple, and disabled CodeBuild outputs.
- Single-stage objects and non-empty stage lists produce identical definitions where equivalent.
- Stage-list order, complete-batch validation, and artifact-frontier progression across multiple stage objects.
- Stage and default-artifact naming sanitization, the fixed SHA-256 truncation suffix, and collision errors.
- Stable error codes and paths.
- All four `onPullRequest`/`autoReviewer` combinations and their selected trigger/router behavior.
- The no-review PR router declares and sends the complete six-variable metadata contract with an exact source revision and deterministic client token.

### CDK synthesis tests

- Source creation, import by name, and supplied repository reuse.
- Seed asset path and replacement-safe identity.
- Every built-in action type.
- Custom action validation and artifact discovery, including rejection of unnamed artifacts and non-default run order.
- CloudFormation administrative mode and explicit least-privilege deployment-role mode.
- Parallel actions share one stage object, while separate objects in one list or separate calls create sequential stages.
- Empty stage lists and empty `actions` arrays are rejected through types and runtime validation.
- Flattened pipeline name, bucket, role, execution, and restart properties.
- Forced V2 and variable merging.
- Secure default artifact bucket behavior.
- No resources are partially created after validation failure.
- cdk-nag remains clean with only documented suppressions.

### Auto-review regression tests

Existing durable-review tests must migrate without weakening assertions for:

- exact source revisions and deterministic execution tokens;
- protected Pawl variables;
- bridge action placement and sanitized parameters;
- timeout bounds;
- immutable callback precedence;
- terminal and authoritative revision markers;
- phased GSI deployment;
- IAM grants and suppressions; and
- durable-history privacy.

### Integration tests

Testcontainers/LocalStack coverage verifies:

- a managed CodeCommit source;
- source artifact naming;
- stage/action structure;
- parallel action placement;
- automatic artifact wiring where LocalStack exposes it; and
- existing bridge action configuration.

The LocalStack token remains environment-injected only into the container and excluded from CDK child-process environments.

### Final gates

- focused pipeline and durable-review suites;
- broader `packages/lambda` and reviewer suites;
- `@pawl/lambda` and `@pawl/cdk` builds;
- scoped Biome with zero errors; and
- repository-wide failures reported separately when unrelated legacy debt remains.

## Risks and mitigations

### Fluent configuration can be incomplete

Mitigation: synthesis validation requires one source and one user stage. Immediate ordering checks catch most mistakes earlier.

### Eager mutation can leave partial resources

Mitigation: schemas, names, actions, and artifact plans are validated before creating CDK children.

### Automatic artifacts can hide ambiguity

Mitigation: inference is allowed only with exactly one valid frontier artifact. Fan-out requires explicit downstream selection.

### Flattened AWS props can conflict with Pawl invariants

Mitigation: reserve V2 and protected variables, inventory upstream props, and reject conflicts rather than overriding silently.

### Breaking migration is broad

Mitigation: migrate packages, examples, CLI templates, tests, and docs atomically with a release-note mapping from every old shape to the fluent equivalent.

### Future source providers may need different concepts

Mitigation: keep `origin` discriminated and source adapters isolated. Do not add placeholder GitHub fields before GitHub behavior is designed.
