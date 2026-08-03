import { Fn, RemovalPolicy } from "aws-cdk-lib";
import type { IRepository } from "aws-cdk-lib/aws-codecommit";
import {
	Artifact,
	Pipeline,
	type PipelineProps,
	PipelineType,
	Variable,
} from "aws-cdk-lib/aws-codepipeline";
import {
	CodeCommitSourceAction,
	CodeCommitTrigger,
} from "aws-cdk-lib/aws-codepipeline-actions";
import { Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction as LambdaEventTarget } from "aws-cdk-lib/aws-events-targets";
import {
	Effect,
	PolicyStatement as IamPolicyStatement,
} from "aws-cdk-lib/aws-iam";
import type { IKey } from "aws-cdk-lib/aws-kms";
import { Key } from "aws-cdk-lib/aws-kms";
import type { IBucket } from "aws-cdk-lib/aws-s3";
import { Bucket } from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { z } from "zod";
import {
	BasicConstruct,
	type PolicyStatement as BasicPolicyStatement,
} from "./basic-construct";
import type { AutoReviewConfig } from "./codecommit";
import {
	CodeCommitAutoReviewer,
	type CodeCommitAutoReviewerProps,
	validateCodeCommitAutoReviewerProps,
} from "./codecommit-auto-reviewer";
import {
	type PipelineActionDefinition,
	type PlannedActionAdapter,
	planPipelineAction,
} from "./pipeline/actions";
import {
	type ArtifactPlanState,
	createArtifactPlan,
	planStageBatch,
} from "./pipeline/artifacts";
import { PipelineDefinitionError } from "./pipeline/errors";
import { deriveStageName, validateStageName } from "./pipeline/naming";
import { PullRequestRouter } from "./pipeline/pull-request-router";
import {
	type CodeCommitPipelineSource,
	type MaterializedPipelineSource,
	planCodeCommitSource,
} from "./pipeline/source";
import {
	type ReviewCoordinationDeploymentPhase,
	ReviewCoordinationDeploymentPhaseSchema,
} from "./review-coordination-deployment";
import type { Stack } from "./stack";

export {
	type ApprovalActionDefinition,
	type CloudFormationDeployActionDefinition,
	type CodeBuildActionDefinition,
	CodeBuildActionType,
	type CustomActionDefinition,
	type LambdaActionDefinition,
	type PipelineActionBase,
	type PipelineActionDefinition,
	PipelineActionDefinitionSchema,
	type S3DeployActionDefinition,
} from "./pipeline/actions";
export {
	PipelineDefinitionError,
	type PipelineDefinitionErrorCode,
} from "./pipeline/errors";
export {
	type CodeCommitPipelineSource,
	CodeCommitPipelineSourceSchema,
} from "./pipeline/source";
export {
	type ReviewCoordinationDeploymentPhase,
	ReviewCoordinationDeploymentPhaseSchema,
} from "./review-coordination-deployment";

const reviewActionTimeoutSchema = z.number().int().min(5).max(15);

/** Zod schema validating an AWS CodePipeline pipeline name. */
export const CodePipelineNameSchema = z
	.string()
	.min(1)
	.max(100)
	.regex(/^[A-Za-z0-9.@_-]+$/);

/** Physical-name ownership for a CodePipeline. */
export const CodePipelineNamingSchema = z.discriminatedUnion("mode", [
	z.object({ mode: z.literal("pawl") }).strict(),
	z
		.object({ mode: z.literal("explicit"), name: CodePipelineNameSchema })
		.strict(),
	z
		.object({
			mode: z.literal("cloudFormation"),
			coordinationName: CodePipelineNameSchema.optional(),
		})
		.strict(),
]);

export type CodePipelineNaming = Readonly<
	z.infer<typeof CodePipelineNamingSchema>
>;

export interface PipelineStageDefinition {
	readonly name?: string;
	readonly actions: readonly [
		PipelineActionDefinition,
		...PipelineActionDefinition[],
	];
}

export type PipelineStageDefinitionList = readonly [
	PipelineStageDefinition,
	...PipelineStageDefinition[],
];

/** Pipeline-level props; source and stages are configured fluently. */
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

const PAWL_PIPELINE_VARIABLE_NAMES = [
	"PAWL_PROVIDER",
	"PAWL_REPOSITORY",
	"PAWL_REQUEST_ID",
	"PAWL_GENERATION",
	"PAWL_SOURCE_REVISION",
	"PAWL_DESTINATION_REVISION",
] as const;

type PawlVariableName = (typeof PAWL_PIPELINE_VARIABLE_NAMES)[number];

interface PlannedStage {
	readonly name: string;
	readonly adapters: readonly PlannedActionAdapter[];
}

function propertyConflict(message: string, path: string): never {
	throw new PipelineDefinitionError("PIPELINE_PROP_CONFLICT", message, path);
}

function hasOwn(value: object, property: string): boolean {
	return Object.hasOwn(value, property);
}

function normalizeStages(
	definition: PipelineStageDefinition | PipelineStageDefinitionList,
): readonly PipelineStageDefinition[] {
	const stages = Array.isArray(definition) ? definition : [definition];
	if (stages.length === 0) {
		throw new PipelineDefinitionError(
			"STAGE_EMPTY",
			"A fluent stage batch requires at least one stage",
			"stages",
		);
	}
	return stages as readonly PipelineStageDefinition[];
}

export class CodePipeline extends BasicConstruct {
	readonly pipeline: Pipeline;
	readonly artifactBucket: IBucket;
	readonly artifactEncryptionKey?: IKey;

	private readonly props: CodePipelineProps;
	private readonly pipelineCoordinationName?: string;
	private readonly reviewVariables: ReadonlyMap<string, Variable>;
	private readonly reviewCoordinationDeploymentPhase?: ReviewCoordinationDeploymentPhase;
	private readonly reviewActionTimeoutMinutes?: number;
	private sourceDefined = false;
	private userStageCount = 0;
	private artifactState?: ArtifactPlanState;
	private readonly artifacts = new Map<string, Artifact>();
	private readonly stageNames = new Set<string>(["Source"]);
	private autoReviewer?: CodeCommitAutoReviewer;

	constructor(scope: Stack, id: string, props: CodePipelineProps = {}) {
		super(scope, id);
		this.props = props;
		for (const forbidden of [
			"source",
			"stages",
			"pipelineType",
			"triggers",
			"autoReview",
			"team",
			"stage",
		] as const) {
			if (hasOwn(props, forbidden)) {
				propertyConflict(
					`CodePipeline prop '${forbidden}' is not supported by the fluent API`,
					forbidden,
				);
			}
		}
		if (
			props.artifactBucket !== undefined &&
			props.crossRegionReplicationBuckets !== undefined
		) {
			propertyConflict(
				"artifactBucket and crossRegionReplicationBuckets cannot be supplied together",
				"artifactBucket",
			);
		}
		if (
			props.artifactEncryptionKey !== undefined &&
			(props.artifactBucket !== undefined ||
				props.crossRegionReplicationBuckets !== undefined)
		) {
			propertyConflict(
				"artifactEncryptionKey cannot be combined with external artifact storage",
				"artifactEncryptionKey",
			);
		}
		if (props.enableKeyRotation === true && props.crossAccountKeys !== true) {
			propertyConflict(
				"enableKeyRotation requires crossAccountKeys to be true",
				"enableKeyRotation",
			);
		}

		const prGatedAutoReview =
			props.onPullRequest === true && props.autoReviewer !== undefined;
		if (
			props.reviewCoordinationDeploymentPhase !== undefined &&
			!prGatedAutoReview
		) {
			propertyConflict(
				"reviewCoordinationDeploymentPhase requires PR-gated auto-review",
				"reviewCoordinationDeploymentPhase",
			);
		}
		this.reviewCoordinationDeploymentPhase = prGatedAutoReview
			? ReviewCoordinationDeploymentPhaseSchema.parse(
					props.reviewCoordinationDeploymentPhase ?? "active",
				)
			: undefined;
		const reviewCoordinationActive =
			this.reviewCoordinationDeploymentPhase === "active";
		if (
			props.reviewActionTimeoutMinutes !== undefined &&
			!reviewCoordinationActive
		) {
			propertyConflict(
				"reviewActionTimeoutMinutes requires active PR-gated auto-review coordination",
				"reviewActionTimeoutMinutes",
			);
		}
		this.reviewActionTimeoutMinutes = reviewCoordinationActive
			? reviewActionTimeoutSchema.parse(props.reviewActionTimeoutMinutes ?? 15)
			: undefined;

		const naming =
			props.pipelineNaming === undefined
				? props.pipelineName === undefined
					? ({ mode: "pawl" } as const)
					: ({ mode: "explicit", name: props.pipelineName } as const)
				: CodePipelineNamingSchema.parse(props.pipelineNaming);
		if (
			props.pipelineNaming !== undefined &&
			props.pipelineName !== undefined &&
			(naming.mode !== "explicit" || naming.name !== props.pipelineName)
		) {
			propertyConflict(
				"pipelineNaming and pipelineName must select the same explicit name",
				"pipelineName",
			);
		}
		const pipelinePhysicalName =
			naming.mode === "cloudFormation"
				? undefined
				: CodePipelineNameSchema.parse(
						naming.mode === "explicit"
							? naming.name
							: `${this.prefix}${id}-pipeline`,
					);
		this.pipelineCoordinationName =
			naming.mode === "cloudFormation"
				? naming.coordinationName
				: pipelinePhysicalName;
		if (
			reviewCoordinationActive &&
			this.pipelineCoordinationName === undefined
		) {
			propertyConflict(
				"CloudFormation pipeline naming requires coordinationName for PR-gated auto-review",
				"pipelineNaming.coordinationName",
			);
		}

		const variables = new Map<string, Variable>();
		for (const [index, variable] of (props.variables ?? []).entries()) {
			if (variable.variableName.startsWith("PAWL_")) {
				throw new PipelineDefinitionError(
					"RESERVED_VARIABLE_CONFLICT",
					`Pipeline variable '${variable.variableName}' uses the reserved PAWL_ prefix`,
					`variables[${index}]`,
				);
			}
			if (variables.has(variable.variableName)) {
				propertyConflict(
					`Pipeline variable '${variable.variableName}' is duplicated`,
					`variables[${index}]`,
				);
			}
			variables.set(variable.variableName, variable);
		}
		if (props.onPullRequest === true) {
			for (const name of PAWL_PIPELINE_VARIABLE_NAMES) {
				variables.set(
					name,
					new Variable({ variableName: name, defaultValue: "UNSET" }),
				);
			}
		}
		this.reviewVariables = variables;

		let pipelineArtifactBucket: IBucket | undefined;
		if (
			props.artifactBucket === undefined &&
			props.crossRegionReplicationBuckets === undefined
		) {
			this.artifactEncryptionKey =
				props.artifactEncryptionKey ??
				new Key(this, "ArtifactKey", {
					enableKeyRotation: true,
					removalPolicy: RemovalPolicy.RETAIN,
				});
			pipelineArtifactBucket = new Bucket(this, "ArtifactBucket", {
				encryptionKey: this.artifactEncryptionKey,
				removalPolicy: RemovalPolicy.RETAIN,
			});
		} else {
			this.artifactEncryptionKey = undefined;
			pipelineArtifactBucket = props.artifactBucket;
		}

		this.pipeline = new Pipeline(this, "Pipeline", {
			artifactBucket: pipelineArtifactBucket,
			role: props.role,
			restartExecutionOnUpdate: props.restartExecutionOnUpdate,
			...(pipelinePhysicalName === undefined
				? {}
				: { pipelineName: pipelinePhysicalName }),
			crossRegionReplicationBuckets: props.crossRegionReplicationBuckets,
			crossAccountKeys: props.crossAccountKeys,
			enableKeyRotation: props.enableKeyRotation,
			reuseCrossRegionSupportStacks: props.reuseCrossRegionSupportStacks,
			pipelineType: PipelineType.V2,
			variables: variables.size === 0 ? undefined : [...variables.values()],
			executionMode: props.executionMode,
			usePipelineRoleForActions: props.usePipelineRoleForActions,
		});
		this.artifactBucket = this.pipeline.artifactBucket;

		this.node.addValidation({
			validate: () => {
				const errors: string[] = [];
				if (!this.sourceDefined) {
					errors.push("CodePipeline: a source is required; call source() once");
				}
				if (this.userStageCount === 0) {
					errors.push(
						"CodePipeline: at least one user stage is required; call stage()",
					);
				}
				return errors;
			},
		});
	}

	source(source: CodeCommitPipelineSource): this {
		if (this.userStageCount > 0) {
			throw new PipelineDefinitionError(
				"SOURCE_AFTER_STAGE",
				"CodePipeline source must be defined before stages",
				"source",
			);
		}
		if (this.sourceDefined) {
			throw new PipelineDefinitionError(
				"SOURCE_ALREADY_DEFINED",
				"CodePipeline source is already defined",
				"source",
			);
		}

		const sourcePlan = planCodeCommitSource(source, {
			requiresConcreteName: this.props.autoReviewer !== undefined,
		});
		const reviewerProps = this.reviewerProps(sourcePlan.repositoryName);
		if (reviewerProps !== undefined) {
			validateCodeCommitAutoReviewerProps(this.stack, reviewerProps);
		}
		const details = sourcePlan.materialize(this.stack, `${this.node.id}Source`);
		const sourceArtifact = new Artifact("SourceOutput");
		const repository = this.sourceRepository(
			details.repository,
			details.repositoryName,
		);
		this.pipeline.addStage({
			stageName: "Source",
			actions: [
				new CodeCommitSourceAction({
					actionName: "Source",
					repository,
					branch: details.branchName,
					trigger:
						this.props.onPullRequest === true
							? CodeCommitTrigger.NONE
							: undefined,
					output: sourceArtifact,
				}),
			],
		});
		this.sourceDefined = true;
		this.artifactState = createArtifactPlan("SourceOutput");
		this.artifacts.set("SourceOutput", sourceArtifact);
		this.createReviewInfrastructure(details);
		return this;
	}

	stage(stage: PipelineStageDefinition): this;
	stage(stages: PipelineStageDefinitionList): this;
	stage(
		definition: PipelineStageDefinition | PipelineStageDefinitionList,
	): this {
		if (!this.sourceDefined || this.artifactState === undefined) {
			throw new PipelineDefinitionError(
				"SOURCE_REQUIRED",
				"CodePipeline source must be defined before stages",
				"stages",
			);
		}
		const definitions = normalizeStages(definition);
		const plannedStages = this.planStages(definitions);
		const artifactBatch = planStageBatch(
			this.artifactState,
			plannedStages.map((stage) => ({
				name: stage.name,
				actions: stage.adapters.map((adapter) => adapter.artifactPlan),
			})),
		);

		const materializedArtifacts = new Map(this.artifacts);
		for (const stage of plannedStages) {
			for (const adapter of stage.adapters) {
				for (const [name, existing] of adapter.existingArtifacts ?? []) {
					if (!materializedArtifacts.has(name)) {
						materializedArtifacts.set(name, existing);
					}
				}
			}
		}
		for (const name of artifactBatch.state.registered) {
			if (!materializedArtifacts.has(name)) {
				materializedArtifacts.set(name, new Artifact(name));
			}
		}

		const materializedStages = plannedStages.map((stage, stageIndex) => {
			const artifactStage = artifactBatch.stages[stageIndex];
			if (artifactStage === undefined) {
				propertyConflict(
					"Missing planned artifact stage",
					`stages[${stageIndex}]`,
				);
			}
			const actions = stage.adapters.map((adapter, actionIndex) => {
				const artifactAction = artifactStage.actions[actionIndex];
				if (artifactAction === undefined) {
					propertyConflict(
						"Missing planned artifact action",
						`stages[${stageIndex}].actions[${actionIndex}]`,
					);
				}
				return adapter.materialize({
					inputs: artifactAction.inputs.map((name) =>
						this.requireArtifact(materializedArtifacts, name),
					),
					outputs: artifactAction.outputs.map((name) =>
						this.requireArtifact(materializedArtifacts, name),
					),
				});
			});
			return { name: stage.name, actions };
		});
		for (const stage of materializedStages) {
			this.pipeline.addStage({ stageName: stage.name, actions: stage.actions });
		}

		this.artifactState = artifactBatch.state;
		this.artifacts.clear();
		for (const [name, artifact] of materializedArtifacts) {
			this.artifacts.set(name, artifact);
		}
		for (const stage of plannedStages) this.stageNames.add(stage.name);
		this.userStageCount += plannedStages.length;
		return this;
	}

	private planStages(
		definitions: readonly PipelineStageDefinition[],
	): readonly PlannedStage[] {
		const names = new Set(this.stageNames);
		const planned: PlannedStage[] = [];
		for (const [stageIndex, definition] of definitions.entries()) {
			const stagePath = `stages[${stageIndex}]`;
			if (
				typeof definition !== "object" ||
				definition === null ||
				!Array.isArray(definition.actions) ||
				definition.actions.length === 0
			) {
				throw new PipelineDefinitionError(
					"STAGE_EMPTY",
					"A pipeline stage requires at least one action",
					`${stagePath}.actions`,
				);
			}
			const adapters = definition.actions.map((action, actionIndex) =>
				planPipelineAction(action, `${stagePath}.actions[${actionIndex}]`),
			);
			const actionNames = adapters.map(({ artifactPlan }) => artifactPlan.name);
			const seenActions = new Set<string>();
			for (const [actionIndex, actionName] of actionNames.entries()) {
				if (seenActions.has(actionName)) {
					throw new PipelineDefinitionError(
						"ACTION_NAME_CONFLICT",
						`Action name '${actionName}' is duplicated in the stage`,
						`${stagePath}.actions[${actionIndex}].name`,
					);
				}
				seenActions.add(actionName);
			}
			const name =
				definition.name === undefined
					? deriveStageName(actionNames, stagePath)
					: validateStageName(definition.name, `${stagePath}.name`);
			if (names.has(name)) {
				throw new PipelineDefinitionError(
					"STAGE_NAME_CONFLICT",
					`Stage name '${name}' is already in use`,
					`${stagePath}.name`,
				);
			}
			names.add(name);
			planned.push({ name, adapters });
		}

		if (
			this.reviewCoordinationDeploymentPhase === "active" &&
			this.userStageCount === 0
		) {
			const first = planned[0];
			if (first !== undefined) {
				if (
					first.adapters.some(
						({ artifactPlan }) => artifactPlan.name === "AIReview",
					)
				) {
					throw new PipelineDefinitionError(
						"ACTION_NAME_CONFLICT",
						"Action name 'AIReview' is reserved for review coordination",
						"stages[0].actions",
					);
				}
				const aiReview = planPipelineAction(
					this.aiReviewDefinition(first.name),
					`stages[${first.name}].actions[AIReview]`,
				);
				planned[0] = {
					name: first.name,
					adapters: [...first.adapters, aiReview],
				};
			}
		}
		return planned;
	}

	private aiReviewDefinition(stageName: string): PipelineActionDefinition {
		const bridge = this.autoReviewer?.pipelineBridge;
		if (bridge === undefined) {
			propertyConflict(
				"Active review coordination requires a pipeline bridge",
				"autoReviewer",
			);
		}
		const variable = (name: PawlVariableName): string => {
			const value = this.reviewVariables.get(name);
			if (value === undefined) {
				throw new PipelineDefinitionError(
					"RESERVED_VARIABLE_CONFLICT",
					`Missing pipeline variable '${name}'`,
					"variables",
				);
			}
			return value.reference();
		};
		return {
			type: "lambda",
			name: "AIReview",
			handler: bridge,
			inputs: ["SourceOutput"],
			userParameters: {
				pipelineExecutionId: "#{codepipeline.PipelineExecutionId}",
				pipelineName:
					this.pipelineCoordinationName ??
					propertyConflict(
						"Missing pipeline coordination name",
						"pipelineNaming",
					),
				stageName,
				actionName: "AIReview",
				provider: variable("PAWL_PROVIDER"),
				repository: variable("PAWL_REPOSITORY"),
				requestId: variable("PAWL_REQUEST_ID"),
				generation: variable("PAWL_GENERATION"),
				sourceRevision: variable("PAWL_SOURCE_REVISION"),
				destinationRevision: variable("PAWL_DESTINATION_REVISION"),
			},
		};
	}

	private reviewerProps(
		repositoryName: string,
	): CodeCommitAutoReviewerProps | undefined {
		if (this.props.autoReviewer === undefined) return undefined;
		const { modelId, ...autoReviewerProps } = this.props.autoReviewer;
		return {
			...autoReviewerProps,
			repositories: [repositoryName],
			reviewerModelId: modelId,
			reviewCoordinationDeployment:
				this.reviewCoordinationDeploymentPhase === undefined
					? undefined
					: this.reviewCoordinationDeploymentPhase === "active"
						? {
								phase: "active",
								reviewActionTimeoutMinutes:
									this.reviewActionTimeoutMinutes ?? 15,
							}
						: { phase: this.reviewCoordinationDeploymentPhase },
		};
	}

	private createReviewInfrastructure(
		details: MaterializedPipelineSource,
	): void {
		const reviewerProps = this.reviewerProps(details.repositoryName);
		if (reviewerProps === undefined) {
			if (this.props.onPullRequest === true) {
				new PullRequestRouter(this.stack, `${this.node.id}PullRequest`, {
					repository: details.repository,
					pipeline: this.pipeline,
					sourceActionName: "Source",
				});
			}
			return;
		}

		this.autoReviewer = new CodeCommitAutoReviewer(
			this.stack,
			`${this.node.id}AutoReview`,
			reviewerProps,
		);
		this.autoReviewer.router.lambda.addEnvironment(
			"PIPELINE_NAME",
			this.pipeline.pipelineName,
		);
		this.autoReviewer.router.lambda.addEnvironment(
			"PIPELINE_SOURCE_ACTION_NAME",
			"Source",
		);
		this.autoReviewer.router.lambda.addToRolePolicy(
			new IamPolicyStatement({
				effect: Effect.ALLOW,
				actions: [
					"codepipeline:StartPipelineExecution",
					"codepipeline:GetPipelineExecution",
					"codepipeline:ListActionExecutions",
				],
				resources: [this.pipeline.pipelineArn],
			}),
		);
		new Rule(this.stack, `${this.node.id}PipelineExecutionRule`, {
			eventPattern: {
				source: ["aws.codepipeline"],
				detailType: ["CodePipeline Pipeline Execution State Change"],
				detail: { pipeline: [this.pipeline.pipelineName] },
			},
			targets: [new LambdaEventTarget(this.autoReviewer.router.lambda)],
		});
	}

	private sourceRepository(
		repository: IRepository,
		repositoryName: string,
	): IRepository {
		const repositoryArn = Fn.sub(
			// biome-ignore lint/suspicious/noTemplateCurlyInString: Fn.sub CloudFormation syntax
			"arn:${AWS::Partition}:codecommit:${AWS::Region}:${AWS::AccountId}:${repositoryName}",
			{ repositoryName },
		);
		return new Proxy(repository, {
			get(target, property, receiver) {
				if (property === "repositoryArn") return repositoryArn;
				const value = Reflect.get(target, property, receiver);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
	}

	private requireArtifact(
		artifacts: ReadonlyMap<string, Artifact>,
		name: string,
	): Artifact {
		const artifact = artifacts.get(name);
		if (artifact === undefined) {
			throw new PipelineDefinitionError(
				"ARTIFACT_NOT_FOUND",
				`Artifact '${name}' was not materialized`,
				"artifacts",
			);
		}
		return artifact;
	}

	protected applyPermissionPolicy(
		_construct: Construct,
		_policyStatement: BasicPolicyStatement,
	): void {
		// Pipeline access is managed through its service role and action grants.
	}

	createAlarm(scope: Stack): void {
		scope.monitoring.monitorS3Bucket({ bucket: this.artifactBucket });
	}
}
