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
	.stage("Checks", [
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
	])
	.stage("Approval", [
		{
			name: "ProductionApproval",
			type: "approval",
			description: "Approve production deployment",
		},
	])
	.stage([
		{
			name: "Deploy",
			type: "s3Deploy",
			bucket: deploymentBucket,
		},
	]);
```

## Non-goals

The first release does not:

- preserve constructor-level `source` or `stages` compatibility;
- implement GitHub or S3 sources;
- continuously synchronize a local directory after deployment;
- infer ordering between actions in the same stage;
- support sequential `runOrder` values within one stage; or
- replace Pawl constructs with raw `aws-cdk-lib` resources in consumer code.

GitHub can be added later as another `origin` member without changing the fluent method.

## Public API

### Constructor properties

`CodePipeline` remains the canonical public class. It creates an AWS CodePipeline V2 pipeline immediately and exposes `.source()` and `.stage()` methods that return the same instance.

The Pawl properties flatten ordinary AWS `PipelineProps` rather than nesting an escape hatch:

```ts
export interface CodePipelineProps
	extends Omit<PipelineProps, "pipelineType" | "variables"> {
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
- User variables are accepted and merged with Pawl variables.
- Names beginning with the reserved `PAWL_` prefix are rejected.
- `pipelineName`, `artifactBucket`, role, execution mode, restart behavior, and other compatible AWS properties pass through.
- A supplied artifact bucket is used directly.
- If no artifact bucket is supplied, Pawl creates a retained KMS-encrypted bucket.
- `artifactEncryptionKey` is valid only when Pawl creates the bucket.
- The old constructor-level `source` and `stages` properties are removed.
- The old `autoReview` property is renamed to `autoReviewer` as part of the same breaking change.

When an external artifact bucket is used, the public `artifactBucket` property is typed as `IBucket`. A Pawl-created encryption key is exposed only when Pawl owns it; consumers must not assume that every external bucket exposes a key.

### Fluent methods

```ts
source(source: CodeCommitPipelineSource): this;

stage(
	name: string,
	actions: readonly PipelineActionDefinition[],
): this;

stage(actions: readonly PipelineActionDefinition[]): this;
```

Method order is pipeline order. `.source()` must be called exactly once and before `.stage()`. Every `.stage()` call creates one AWS CodePipeline stage. Actions in the supplied array have the same run order and therefore run in parallel.

Sequential work uses separate stage calls. A manual approval and its protected deployment must not share a stage.

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

An explicit stage name is used as supplied after AWS-compatible validation.

When no name is supplied, Pawl:

1. reads each action's effective name;
2. joins names with `-`;
3. replaces unsupported characters with `-`;
4. collapses and trims separators;
5. appends a deterministic hash suffix when truncation is needed; and
6. validates uniqueness against all existing stage names.

An empty action list cannot produce a stage. Explicit and derived name collisions fail rather than receiving numeric suffixes.

### Action union

```ts
export type PipelineActionDefinition =
	| CodeBuildPipelineAction
	| ApprovalPipelineAction
	| LambdaPipelineAction
	| S3DeployPipelineAction
	| CloudFormationDeployPipelineAction
	| CustomPipelineAction;
```

Every built-in action has a required `name` and discriminating `type`:

- `codebuild`
- `approval`
- `lambda`
- `s3Deploy`
- `cloudFormationDeploy`
- `custom`

Built-in definitions expose the safe, relevant options from their AWS action type. Pawl owns `actionName`, artifact objects, and run order. Version one does not expose a built-in `runOrder`; all actions in one `.stage()` call remain parallel.

Pawl action definitions reference Pawl abstractions:

- CodeBuild actions accept `CodeBuildProject`.
- Lambda actions accept ordinary `LambdaFunction` and continue rejecting direct durable functions.
- S3 deploy actions accept `IBucket`.
- CloudFormation deploy actions accept stack/template configuration and least-privilege role options.

A custom definition accepts an existing `IAction`:

```ts
{
	name: "SecurityScan",
	type: "custom",
	action: securityAction,
}
```

The effective action name must agree with the custom action's declared action name. Custom actions with a non-default run order are rejected in version one. Pawl reads their declared input and output artifacts for registry validation.

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
- A CodeBuild action produces `<ActionName>Output` by default.
- CodeBuild outputs can be renamed, expanded to multiple named outputs, or disabled explicitly.
- Actions that do not naturally produce artifacts do not receive synthetic outputs.
- If a stage produces at least one output, those outputs become the next frontier.
- If a stage produces no outputs, the previous frontier carries through unchanged.

This makes approval stages transparent to artifact flow while making parallel build fan-out explicit at the next input-consuming stage.

### Ambiguity example

```ts
.stage("Builds", [
	{ name: "Web", type: "codebuild", project: webProject },
	{ name: "Api", type: "codebuild", project: apiProject },
])
.stage("DeployWeb", [
	{
		name: "DeployWeb",
		type: "s3Deploy",
		bucket: webBucket,
		input: "WebOutput",
	},
]);
```

Omitting `input` from `DeployWeb` is invalid because the frontier contains `WebOutput` and `ApiOutput`.

## Auto-review integration

Auto-review creation is deferred until `.source()` because it requires CodeCommit identity. Existing durable bridge behavior remains unchanged.

- `autoReviewer` is valid only for a CodeCommit source.
- `onPullRequest: true` preserves exact-revision PR-gated execution.
- Active PR-gated review declares the six protected `PAWL_*` variables.
- User variables are merged, and reserved-name collisions fail.
- The bridge, reconciler, DynamoDB coordination state, timeout, IAM grants, and EventBridge rules retain their current behavior.
- Preparation deployment phases create coordination resources without adding `AIReview`.
- In the active phase, `AIReview` is inserted into the first user stage as a parallel action and consumes `SourceOutput`.
- A pipeline with active coordination but no user stage fails synthesis.
- Auto-review source identity must be concrete before review resources are created.

The AIReview injection is planned before the first stage is mutated, so an invalid bridge configuration cannot leave a partially added first stage.

## Flattened AWS properties

Compatible AWS `PipelineProps` are forwarded directly when the underlying pipeline is created. Pawl reserves or normalizes only fields required for its invariants.

- `pipelineType` is always V2.
- `variables` are merged by variable name.
- `artifactBucket`, `pipelineName`, `role`, `executionMode`, `restartExecutionOnUpdate`, and compatible trigger settings remain user-controlled.
- Existing Pawl naming modes continue to own or derive `pipelineName` only when the user has not supplied an incompatible explicit AWS value.
- Conflicting naming modes and `pipelineName` fail validation.
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
	.stage("Build", [
		{
			name: "Build",
			type: "codebuild",
			project,
		},
	]);
```

All examples, tests, generated CLI templates, and documentation must migrate in the same release. No runtime compatibility parser or deprecated overload remains.

## Testing strategy

### Type and schema tests

- Every valid source ownership branch compiles and parses.
- Conflicting source fields fail at compile time where possible and through Zod at runtime.
- Each action discriminant exposes only its relevant properties.
- Raw durable Lambda handlers remain invalid pipeline Lambda actions.
- Flattened AWS properties retain their upstream types.

### Pure unit tests

- Artifact registration, frontier replacement, and frontier carry-through.
- Parallel actions read the same pre-stage frontier.
- Automatic input selection and multi-output ambiguity.
- Explicit inputs to earlier registered artifacts.
- Default, renamed, multiple, and disabled CodeBuild outputs.
- Stage-name derivation, sanitization, deterministic truncation, and collision errors.
- Stable error codes and paths.

### CDK synthesis tests

- Source creation, import by name, and supplied repository reuse.
- Seed asset path and replacement-safe identity.
- Every built-in action type.
- Custom action validation and artifact discovery.
- Parallel actions share one stage and sequential calls create distinct stages.
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
