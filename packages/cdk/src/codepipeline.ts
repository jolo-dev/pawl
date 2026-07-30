import { CfnCapabilities, Fn, RemovalPolicy } from "aws-cdk-lib";
import type { IRepository } from "aws-cdk-lib/aws-codecommit";
import type { IAction } from "aws-cdk-lib/aws-codepipeline";
import {
	Artifact,
	Pipeline,
	type PipelineProps,
	PipelineType,
	Variable,
} from "aws-cdk-lib/aws-codepipeline";
import {
	CloudFormationCreateUpdateStackAction,
	CodeBuildAction,
	CodeCommitSourceAction,
	CodeCommitTrigger,
	LambdaInvokeAction,
	ManualApprovalAction,
	S3DeployAction,
} from "aws-cdk-lib/aws-codepipeline-actions";
import { Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction as LambdaEventTarget } from "aws-cdk-lib/aws-events-targets";
import {
	Effect,
	PolicyStatement as IamPolicyStatement,
} from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import type { IBucket } from "aws-cdk-lib/aws-s3";
import { Bucket } from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { z } from "zod";
import {
	BasicConstruct,
	type PolicyStatement as BasicPolicyStatement,
} from "./basic-construct";
import type { CodeBuildProject } from "./codebuild-project";
import { CodeCommitAutoReviewer } from "./codecommit-auto-reviewer";
import type { LambdaFunction } from "./lambda-function";
import type { Stack } from "./stack";

/**
 * Source configuration for a CodePipeline pipeline.
 *
 * CodeCommit is the primary use case. S3 and GitHub are supported but less
 * opinionated — the construct creates the source action but does not manage
 * the bucket or connection.
 */
export type PipelineSource =
	| {
			readonly type: "codecommit";
			readonly repository: IRepository;
			readonly branchName?: string;
			/**
			 * Literal repository name. Required when `autoReview` is set, because
			 * `IRepository.repositoryName` returns a CDK intrinsic token that Zod
			 * validation (used internally by the auto-reviewer) cannot parse.
			 */
			readonly repositoryName?: string;
	  }
	| {
			readonly type: "s3";
			readonly bucket: IBucket;
			readonly objectKey: string;
	  }
	| {
			readonly type: "github";
			readonly repository: string;
			readonly branch: string;
			readonly connectionArn: string;
	  };

/**
 * A single stage in a pipeline with a name and ordered actions.
 */
export interface PipelineStage {
	readonly name: string;
	readonly actions: PipelineAction[];
}

/**
 * Pawl-validated pipeline action types.
 *
 * Each action explicitly models artifact dependencies. The construct creates
 * the underlying CDK action with correct artifact wiring.
 */
export type PipelineAction =
	| {
			readonly type: "codebuild";
			readonly name?: string;
			readonly project: CodeBuildProject;
			readonly inputArtifact?: Artifact;
			readonly outputArtifacts?: readonly Artifact[];
	  }
	| {
			readonly type: "manualApproval";
			readonly name?: string;
			readonly description?: string;
	  }
	| {
			readonly type: "lambda";
			readonly name?: string;
			readonly handler: LambdaFunction;
			readonly inputs?: Record<string, string>;
			readonly userParameters?: Record<string, string>;
	  }
	| {
			readonly type: "s3Deploy";
			readonly name?: string;
			readonly bucket: IBucket;
			readonly inputArtifact: Artifact;
			readonly objectKey: string;
	  }
	| {
			readonly type: "cloudFormationDeploy";
			readonly name?: string;
			readonly stackName: string;
			readonly templatePath: string;
			readonly inputArtifact: Artifact;
			readonly actionMode?: "CREATE_UPDATE" | "REPLACE_ON_FAILURE";
			readonly capabilities?: readonly (
				| "CAPABILITY_IAM"
				| "CAPABILITY_NAMED_IAM"
				| "CAPABILITY_AUTO_EXPAND"
			)[];
	  };

/**
 * Props for the {@link CodePipeline} construct.
 */
export interface CodePipelineProps {
	/** Source configuration — CodeCommit, S3, or GitHub. */
	readonly source: PipelineSource;
	/** Ordered stage definitions. Defaults to Source → Build → ManualApproval. */
	readonly stages?: PipelineStage[];
	/** Cross-account artifact bucket KMS key (auto-created by default). */
	readonly artifactEncryptionKey?: Key;
	/** When true, pipeline only triggers on PR events (router starts executions). Default: false (push-triggered). */
	readonly onPullRequest?: boolean;
	/** Physical-name ownership and reviewer coordination configuration. */
	readonly pipelineNaming?: CodePipelineNaming;
	/** When set, deploys the durable auto-reviewer and wires it to the pipeline. */
	readonly autoReview?: import("./codecommit").AutoReviewConfig;
	/** Team/stage overrides (required when autoReview is set). */
	readonly team?: string;
	readonly stage?: string;
	/** Deadline for the PR-gated AIReview action. Default: 60 minutes. */
	readonly reviewActionTimeoutMinutes?: number;
}

/**
 * CI/CD pipeline construct with optional durable auto-review.
 *
 * Supports four combinations:
 * - **Push, no review:** Standard CodePipeline triggering on branch pushes.
 * - **Push + review:** Pipeline on push, reviewer on PR events — independent.
 * - **PR-gated, no review:** Pipeline only starts on PR events via the router.
 * - **PR-gated + review:** Router starts pipeline and invokes AI reviewer in
 *   parallel on PR events via `Promise.allSettled`.
 *
 * @example Push-triggered with auto-review:
 * ```ts
 * new CodePipeline(this, "Pipeline", {
 *   source: { type: "codecommit", repository, branchName: "main" },
 *   autoReview: { modelId: "eu.anthropic.claude-sonnet-4-6" },
 * });
 * ```
 *
 * @example PR-gated with auto-review:
 * ```ts
 * new CodePipeline(this, "Pipeline", {
 *   source: { type: "codecommit", repository, branchName: "main" },
 *   onPullRequest: true,
 *   autoReview: { modelId: "eu.anthropic.claude-sonnet-4-6" },
 * });
 * ```
 */
const reviewActionTimeoutSchema = z.number().int().min(5).max(1_380);

/** Zod schema validating an AWS CodePipeline pipeline name. */
export const CodePipelineNameSchema = z
	.string()
	.min(1)
	.max(100)
	.regex(/^[A-Za-z0-9.@_-]+$/);

/**
 * Physical-name ownership for a CodePipeline.
 *
 * Pawl and explicit modes emit a concrete CloudFormation `Name`. CloudFormation
 * mode leaves physical naming to CloudFormation; `coordinationName` is a
 * concrete existing name used only by the in-pipeline review bridge, where a
 * reference to the pipeline itself would create a cycle.
 */
export const CodePipelineNamingSchema = z.discriminatedUnion("mode", [
	z.object({ mode: z.literal("pawl") }).strict(),
	z
		.object({
			mode: z.literal("explicit"),
			name: CodePipelineNameSchema,
		})
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

const PAWL_PIPELINE_VARIABLE_NAMES = [
	"PAWL_PROVIDER",
	"PAWL_REPOSITORY",
	"PAWL_REQUEST_ID",
	"PAWL_GENERATION",
	"PAWL_SOURCE_REVISION",
	"PAWL_DESTINATION_REVISION",
] as const;

export class CodePipeline extends BasicConstruct {
	readonly pipeline: Pipeline;
	readonly artifactBucket: Bucket;
	readonly artifactEncryptionKey: Key;

	constructor(scope: Stack, id: string, props: CodePipelineProps) {
		super(scope, id);
		const pipelineCoordination =
			props.onPullRequest === true && props.autoReview !== undefined;
		const pipelineNaming = CodePipelineNamingSchema.parse(
			props.pipelineNaming ?? { mode: "pawl" },
		);
		const pipelinePhysicalName =
			pipelineNaming.mode === "cloudFormation"
				? undefined
				: CodePipelineNameSchema.parse(
						pipelineNaming.mode === "explicit"
							? pipelineNaming.name
							: `${this.prefix}${id}-pipeline`,
					);
		const pipelineCoordinationName =
			pipelineNaming.mode === "cloudFormation"
				? pipelineNaming.coordinationName
				: pipelinePhysicalName;
		if (pipelineCoordination && pipelineCoordinationName === undefined) {
			throw new Error(
				"CloudFormation pipeline naming requires coordinationName for PR-gated auto-review",
			);
		}
		if (
			props.reviewActionTimeoutMinutes !== undefined &&
			!pipelineCoordination
		) {
			throw new Error(
				"reviewActionTimeoutMinutes requires PR-gated auto-review",
			);
		}
		const reviewActionTimeoutMinutes = pipelineCoordination
			? reviewActionTimeoutSchema.parse(props.reviewActionTimeoutMinutes ?? 60)
			: undefined;
		const reviewVariables = pipelineCoordination
			? new Map(
					PAWL_PIPELINE_VARIABLE_NAMES.map((name) => [
						name,
						new Variable({ variableName: name, defaultValue: "UNSET" }),
					]),
				)
			: undefined;

		// 1. Artifact bucket with KMS encryption
		this.artifactEncryptionKey =
			props.artifactEncryptionKey ??
			new Key(this, "ArtifactKey", {
				enableKeyRotation: true,
				removalPolicy: RemovalPolicy.RETAIN,
			});
		this.artifactBucket = new Bucket(this, "ArtifactBucket", {
			encryptionKey: this.artifactEncryptionKey,
			removalPolicy: RemovalPolicy.RETAIN,
		});

		// 2. Create pipeline
		const pipelineProps: PipelineProps = {
			artifactBucket: this.artifactBucket,
			crossAccountKeys: false,
		};
		this.pipeline = new Pipeline(this, "Pipeline", {
			...pipelineProps,
			...(pipelinePhysicalName === undefined
				? {}
				: { pipelineName: pipelinePhysicalName }),
			pipelineType: PipelineType.V2,
			variables: reviewVariables ? [...reviewVariables.values()] : undefined,
		});

		// 3. Source stage
		const sourceArtifact = this.addSourceStage(props);

		// 4. Auto-review infrastructure (if enabled) — created BEFORE stages so
		//    the reviewer Lambda can be injected as a parallel pipeline action.
		let autoReviewer: CodeCommitAutoReviewer | undefined;
		if (props.autoReview !== undefined) {
			if (props.source.type !== "codecommit") {
				throw new Error("Auto-review is only supported with CodeCommit source");
			}

			const { modelId, ...otherAutoReviewProps } = props.autoReview;
			const repositoryName =
				props.source.type === "codecommit"
					? (props.source.repositoryName ??
						(() => {
							throw new Error(
								"CodePipeline auto-review requires repositoryName in source config",
							);
						})())
					: (() => {
							throw new Error(
								"Auto-review is only supported with CodeCommit source",
							);
						})();

			autoReviewer = new CodeCommitAutoReviewer(scope, `${id}AutoReview`, {
				...otherAutoReviewProps,
				repositories: [repositoryName],
				reviewerModelId: modelId,
				team: props.team,
				stage: props.stage,
				pipelineCoordination:
					reviewActionTimeoutMinutes === undefined
						? undefined
						: { reviewActionTimeoutMinutes },
			});

			// Wire the pipeline name to the router so it starts pipeline
			// execution when a PR event arrives.
			autoReviewer.router.lambda.addEnvironment(
				"PIPELINE_NAME",
				this.pipeline.pipelineName,
			);
			autoReviewer.router.lambda.addEnvironment(
				"PIPELINE_SOURCE_ACTION_NAME",
				"Source",
			);

			// Grant the router IAM permissions to start and monitor the pipeline.
			autoReviewer.router.lambda.addToRolePolicy(
				new IamPolicyStatement({
					effect: Effect.ALLOW,
					actions: [
						"codepipeline:StartPipelineExecution",
						"codepipeline:GetPipelineExecution",
						"codepipeline:ListPipelineExecutions",
						"codepipeline:ListActionExecutions",
					],
					resources: [this.pipeline.pipelineArn],
				}),
			);

			// EventBridge rule: pipeline execution state changes → router.
			// The router posts CI result summaries as PR comments.
			new Rule(scope, `${id}PipelineExecutionRule`, {
				eventPattern: {
					source: ["aws.codepipeline"],
					detailType: ["CodePipeline Pipeline Execution State Change"],
					detail: {
						pipeline: [this.pipeline.pipelineName],
					},
				},
				targets: [new LambdaEventTarget(autoReviewer.router.lambda)],
			});
		}

		// 5. User stages or default Build + ManualApproval.
		//    PR-gated auto-review injects an ordinary bridge Lambda action. The
		//    bridge leaves the job pending until the durable reviewer outcome is
		//    reconciled through PutJobSuccessResult/PutJobFailureResult.
		if (props.stages !== undefined) {
			const stageActions = props.stages.map((stage) => ({
				...stage,
				actions: [...stage.actions],
			}));
			if (
				autoReviewer?.pipelineBridge !== undefined &&
				reviewVariables !== undefined &&
				stageActions.length > 0
			) {
				const variable = (
					name: (typeof PAWL_PIPELINE_VARIABLE_NAMES)[number],
				) => {
					const value = reviewVariables.get(name);
					if (value === undefined)
						throw new Error(`Missing pipeline variable ${name}`);
					return value.reference();
				};
				const firstStage = stageActions[0];
				firstStage.actions.push({
					type: "lambda",
					name: "AIReview",
					handler: autoReviewer.pipelineBridge,
					inputs: { source: sourceArtifact.artifactName ?? "SourceOutput" },
					userParameters: {
						pipelineExecutionId: "#{codepipeline.PipelineExecutionId}",
						pipelineName:
							pipelineCoordinationName ??
							(() => {
								throw new Error("Missing pipeline coordination name");
							})(),
						stageName: firstStage.name,
						actionName: "AIReview",
						provider: variable("PAWL_PROVIDER"),
						repository: variable("PAWL_REPOSITORY"),
						requestId: variable("PAWL_REQUEST_ID"),
						generation: variable("PAWL_GENERATION"),
						sourceRevision: variable("PAWL_SOURCE_REVISION"),
						destinationRevision: variable("PAWL_DESTINATION_REVISION"),
					},
				});
			}
			for (const stage of stageActions) {
				this.addStage(stage, sourceArtifact);
			}
		} else {
			// Default stages — no auto-review injection for default mode.
			this.addDefaultStages();
		}
	}

	private addSourceStage(props: CodePipelineProps): Artifact {
		const sourceAction = this.createSourceAction(props);
		this.pipeline.addStage({
			stageName: "Source",
			actions: [sourceAction],
		});
		return (
			sourceAction.actionProperties.outputs?.[0] ?? new Artifact("SourceOutput")
		);
	}

	private createSourceAction(props: CodePipelineProps): CodeCommitSourceAction {
		if (props.source.type === "codecommit") {
			// Build the repository ARN via Fn::Sub so LocalStack (and any provider
			// that does not support Fn::GetAtt on CodeCommit) can resolve it.
			const repoName =
				props.source.repositoryName ?? props.source.repository.repositoryName;
			const repoArn = Fn.sub(
				// biome-ignore lint/suspicious/noTemplateCurlyInString: Fn.sub CloudFormation syntax
				"arn:${AWS::Partition}:codecommit:${AWS::Region}:${AWS::AccountId}:${repoName}",
				{ repoName },
			);
			// Create a proxy that preserves the full IRepository interface but
			// overrides repositoryArn with the Fn::Sub-based ARN.
			const repository: IRepository = new Proxy(props.source.repository, {
				get(target, prop, receiver) {
					if (prop === "repositoryArn") return repoArn;
					const value = Reflect.get(target, prop, receiver);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
			return new CodeCommitSourceAction({
				actionName: "Source",
				repository,
				branch: props.source.branchName ?? "main",
				trigger:
					props.onPullRequest === true ? CodeCommitTrigger.NONE : undefined,
				output: new Artifact("SourceOutput"),
			});
		}
		// S3 and GitHub sources — placeholder for future implementation
		throw new Error(
			`Source type "${props.source.type}" is not yet implemented`,
		);
	}

	private addStage(stage: PipelineStage, sourceArtifact: Artifact): void {
		const actions = stage.actions.map((action) =>
			this.createAction(action, sourceArtifact),
		);
		this.pipeline.addStage({
			stageName: stage.name,
			actions,
		});
	}

	private addAction(action: PipelineAction, sourceArtifact: Artifact): IAction {
		switch (action.type) {
			case "codebuild":
				return new CodeBuildAction({
					actionName: action.name ?? "Build",
					project: action.project.project,
					input: action.inputArtifact ?? sourceArtifact,
					outputs: action.outputArtifacts
						? [...action.outputArtifacts]
						: undefined,
				});
			case "manualApproval":
				return new ManualApprovalAction({
					actionName: action.name ?? "Approve",
					additionalInformation: action.description,
				});
			case "lambda": {
				if ("durableFunctionArn" in action.handler) {
					throw new Error(
						"CodePipeline Lambda actions cannot invoke durable functions directly; use an ordinary bridge Lambda",
					);
				}
				return new LambdaInvokeAction({
					actionName: action.name ?? "Invoke",
					lambda: action.handler.lambda,
					inputs: action.inputs
						? Object.values(action.inputs).map((v) => new Artifact(v))
						: undefined,
					userParameters: action.userParameters,
				});
			}
			case "s3Deploy":
				return new S3DeployAction({
					actionName: action.name ?? "Deploy",
					bucket: action.bucket,
					input: action.inputArtifact,
					objectKey: action.objectKey,
				});
			case "cloudFormationDeploy":
				return new CloudFormationCreateUpdateStackAction({
					actionName: action.name ?? "Deploy",
					stackName: action.stackName,
					templatePath: action.inputArtifact.atPath(action.templatePath),
					replaceOnFailure: action.actionMode === "REPLACE_ON_FAILURE",
					adminPermissions: false,
					cfnCapabilities: action.capabilities?.map(
						(c) => CfnCapabilities[c as keyof typeof CfnCapabilities],
					),
				});
			default:
				throw new Error(
					`Unknown action type: ${(action as { type: string }).type}`,
				);
		}
	}

	private createAction(
		action: PipelineAction,
		sourceArtifact: Artifact,
	): IAction {
		return this.addAction(action, sourceArtifact);
	}

	private addDefaultStages(): void {
		// Build stage — placeholder, user creates their own CodeBuildProject
		// For now, just add a manual approval stage
		this.pipeline.addStage({
			stageName: "Approve",
			actions: [
				new ManualApprovalAction({
					actionName: "Approve",
				}),
			],
		});
	}
	protected applyPermissionPolicy(
		_construct: Construct,
		_policyStatement: BasicPolicyStatement,
	): void {
		// CodePipeline does not expose grant methods for custom permission
		// policies in the same way Lambda or CodeBuild constructs do. Pipeline
		// access is managed through the pipeline's service role and per-action
		// permissions. This method is a no-op for CodePipeline.
	}

	createAlarm(scope: Stack): void {
		// Monitor pipeline execution failures via the monitoring facade.
		// The cdk-monitoring-constructs library does not have a direct
		// pipeline monitor, so we monitor the artifact bucket S3 bucket
		// access instead as a baseline.
		scope.monitoring.monitorS3Bucket({ bucket: this.artifactBucket });
	}
}
