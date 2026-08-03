import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Duration, Token } from "aws-cdk-lib";
import { CfnRepository, type Repository } from "aws-cdk-lib/aws-codecommit";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction as LambdaEventTarget } from "aws-cdk-lib/aws-events-targets";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { NagSuppressions } from "cdk-nag";
import { z } from "zod";
import { CodeBuildProject } from "./codebuild-project";
import { CodeCommitReviewEvents } from "./codecommit-review-events";
import { DurableLambdaFunction } from "./durable-lambda-function";
import { DynamoDbTable } from "./dynamodb-table";
import { LambdaFunction } from "./lambda-function";
import {
	type ReviewCoordinationDeployment,
	ReviewCoordinationDeploymentSchema,
} from "./review-coordination-deployment";
import { projectEnvVar } from "./reviewer/adapters/codebuild-check-runner";
import type { Stack } from "./stack";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** The Pawl workspace root (parent of packages/cdk). The reviewer handler
 * entry files live under packages/cdk/src/reviewer/ and must be bundled with
 * this as the esbuild project root so NodejsFunction's path validation passes. */
const PAWL_ROOT = path.resolve(__dirname, "../../..");
const PAWL_LOCKFILE = path.join(PAWL_ROOT, "bun.lock");

const nonEmptyString = z.string().trim().min(1);
const systemInferenceProfilePrefix = /^(?:apac|eu|global|us)\./;
const directFoundationModelIdPattern =
	/^(?!(?:apac|eu|global|us)\.)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?::[0-9]+)?$/;
const systemInferenceProfileIdPattern =
	/^(?:apac|eu|global|us)\.(?!(?:apac|eu|global|us)\.)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::[0-9]+)?$/;

/**
 * Direct Bedrock foundation-model ID without a routing prefix.
 *
 * Provider and model segments remain provider-agnostic. The exact grammar
 * prevents unsafe fragments from being interpolated into Bedrock IAM ARNs.
 */
export const DirectFoundationModelIdSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(
		directFoundationModelIdPattern,
		"must be a direct Bedrock foundation-model ID",
	);

/**
 * AWS system-defined cross-region inference profile ID.
 *
 * The routing prefix is restricted to AWS-supported scopes, while provider and
 * model segments remain provider-agnostic. The exact grammar prevents unsafe
 * fragments from being interpolated into Bedrock IAM resource ARNs.
 */
export const SystemDefinedCrossRegionInferenceProfileIdSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(
		systemInferenceProfileIdPattern,
		"must be an AWS system-defined cross-region inference profile ID",
	);

/**
 * Safe model identifier accepted by Bedrock Converse: either a direct
 * foundation-model ID or an AWS system-defined cross-region inference profile
 * ID.
 */
export const BedrockModelIdSchema = z.union([
	DirectFoundationModelIdSchema,
	SystemDefinedCrossRegionInferenceProfileIdSchema,
]);

type ParsedBedrockModelId =
	| {
			readonly kind: "direct-foundation-model";
			readonly foundationModelId: string;
	  }
	| {
			readonly kind: "system-inference-profile";
			readonly foundationModelId: string;
			readonly inferenceProfileId: string;
	  };

function parseBedrockModelId(modelId: string): ParsedBedrockModelId {
	if (
		SystemDefinedCrossRegionInferenceProfileIdSchema.safeParse(modelId).success
	) {
		return {
			kind: "system-inference-profile",
			foundationModelId: modelId.replace(systemInferenceProfilePrefix, ""),
			inferenceProfileId: modelId,
		};
	}
	return { kind: "direct-foundation-model", foundationModelId: modelId };
}

const repositoryNameSchema = nonEmptyString.regex(
	/^[A-Za-z0-9._-]+$/,
	"repository names may contain letters, digits, . _ -",
);

/**
 * Zod-validated configuration for the auto-reviewer.
 *
 * `repositories` is a non-empty list of CodeCommit repository names; one
 * CodeBuild project and one CodeCommit event construct is created per entry,
 * sharing a single durable reviewer, router, and state table.
 */
export const CodeCommitAutoReviewerConfigSchema = z.object({
	repositories: z
		.array(repositoryNameSchema)
		.min(1)
		.refine(
			(repositories) => new Set(repositories).size === repositories.length,
			"duplicate repository names are not allowed",
		),
	reviewerModelId: BedrockModelIdSchema,
	reviewerAlias: z.string().trim().min(1).default("live"),
	reviewerExecutionTimeoutSeconds: z
		.number()
		.int()
		.min(1)
		.max(31_622_400)
		.default(2_592_000),
	reviewerRetentionDays: z.number().int().min(1).max(90).default(14),
	reviewerTimeoutMinutes: z.number().int().min(1).max(15).default(15),
	reviewerMemorySize: z.number().int().min(128).max(10_240).default(512),
	codeBuildComputeSize: z.enum(["SMALL", "MEDIUM", "LARGE"]).default("SMALL"),
	codeBuildNetworkPolicy: z
		.object({
			mode: z.literal("public-test"),
			packageAccess: z.object({
				mode: z.literal("approved-registry"),
				endpoint: z
					.string()
					.trim()
					.url()
					.refine((v) => v.startsWith("https://"), "must be HTTPS"),
			}),
		})
		.default({
			mode: "public-test",
			packageAccess: {
				mode: "approved-registry",
				endpoint: "https://registry.npmjs.org",
			},
		}),
	botArnPatterns: z.string().default(""),
});

export type CodeCommitAutoReviewerConfig = z.infer<
	typeof CodeCommitAutoReviewerConfigSchema
>;

export type CodeCommitAutoReviewerProps = z.input<
	typeof CodeCommitAutoReviewerConfigSchema
> & {
	/** Concrete repositories to reuse, keyed by configured repository name. */
	readonly repositoryResources?: ReadonlyMap<string, Repository>;
	/** Override the team context value (defaults to CDK context `team`). */
	readonly team?: string;
	/** Override the stage context value (defaults to CDK context `stage`). */
	readonly stage?: string;
	/** Prepare or activate the ordinary CodePipeline review coordination path. */
	readonly reviewCoordinationDeployment?: ReviewCoordinationDeployment;
	/**
	 * @deprecated Use `reviewCoordinationDeployment: { phase: "active", reviewActionTimeoutMinutes }` instead.
	 *
	 * Deprecated compatibility alias. When supplied without
	 * `reviewCoordinationDeployment`, maps at runtime to `{ phase: "active",
	 * reviewActionTimeoutMinutes }`. The timeout defaults to and cannot exceed
	 * 15 minutes because CodePipeline's 20-minute no-reply watchdog requires a
	 * conservative callback margin. If both properties are set, the constructor
	 * throws a conflict error.
	 */
	readonly pipelineCoordination?: {
		readonly reviewActionTimeoutMinutes?: number;
	};
};

function configuredRepositoryName(repository: Repository): string {
	const resource = repository.node.defaultChild;
	const repositoryName =
		resource instanceof CfnRepository
			? resource.repositoryName
			: repository.repositoryName;
	if (repositoryName === undefined || Token.isUnresolved(repositoryName)) {
		throw new Error(
			"CodeCommitAutoReviewer: repository resources must have a resolved repository name",
		);
	}
	return repositoryName;
}

interface ValidatedCodeCommitAutoReviewerProps {
	readonly config: CodeCommitAutoReviewerConfig;
	readonly repositoryResources?: ReadonlyMap<string, Repository>;
	readonly reviewCoordinationDeployment?: ReviewCoordinationDeployment;
	readonly team: string;
	readonly stage: string;
}

function resolveCodeCommitAutoReviewerProps(
	scope: Stack,
	props: CodeCommitAutoReviewerProps,
): ValidatedCodeCommitAutoReviewerProps {
	const {
		repositoryResources,
		team: teamOverride,
		stage: stageOverride,
		reviewCoordinationDeployment: reviewCoordinationDeploymentInput,
		pipelineCoordination: pipelineCoordinationInput,
		...configInput
	} = props;
	const config = CodeCommitAutoReviewerConfigSchema.parse(configInput);
	if (
		pipelineCoordinationInput !== undefined &&
		reviewCoordinationDeploymentInput !== undefined
	) {
		throw new Error(
			"CodeCommitAutoReviewer: pipelineCoordination is deprecated; use reviewCoordinationDeployment instead. Do not specify both.",
		);
	}
	const resolvedNewDeploymentInput =
		pipelineCoordinationInput !== undefined
			? {
					phase: "active" as const,
					reviewActionTimeoutMinutes:
						pipelineCoordinationInput.reviewActionTimeoutMinutes,
				}
			: reviewCoordinationDeploymentInput;
	const reviewCoordinationDeployment =
		resolvedNewDeploymentInput === undefined
			? undefined
			: ReviewCoordinationDeploymentSchema.parse(resolvedNewDeploymentInput);
	const configuredRepositories = new Set(config.repositories);
	for (const [repositoryName, repository] of repositoryResources ?? []) {
		if (!configuredRepositories.has(repositoryName)) {
			throw new Error(
				`CodeCommitAutoReviewer: unknown repository resource key ${repositoryName}`,
			);
		}
		if (configuredRepositoryName(repository) !== repositoryName) {
			throw new Error(
				`CodeCommitAutoReviewer: repository resource name must match map key ${repositoryName}`,
			);
		}
	}
	const team = teamOverride ?? scope.node.tryGetContext("team");
	const stage = stageOverride ?? scope.node.tryGetContext("stage");
	if (!team || !stage) {
		throw new Error(
			"CodeCommitAutoReviewer: team and stage are required (set via CDK context or props)",
		);
	}
	return {
		config,
		repositoryResources,
		reviewCoordinationDeployment,
		team,
		stage,
	};
}

/** Validate reviewer configuration and context without creating construct children. */
export function validateCodeCommitAutoReviewerProps(
	scope: Stack,
	props: CodeCommitAutoReviewerProps,
): void {
	resolveCodeCommitAutoReviewerProps(scope, props);
}

/**
 * Deploys the full durable CodeCommit PR auto-reviewer infrastructure.
 *
 * Creates: DynamoDB state table, per-repo CodeBuild projects, durable reviewer
 * Lambda, event-router Lambda, Bedrock IAM, and per-repo CodeCommit event
 * routing — all wired with least-privilege grants.
 *
 * The reviewer Lambda physical name is `${team}-${stage}-Reviewer-lambda`
 * (derived from CDK context) so the router invoke target, IAM scope, and
 * bot-filter ARN stay aligned.
 *
 * For single-repo opt-in, use the higher-level `CodeCommit` construct with
 * `autoReview: { ... }` instead.
 */
export class CodeCommitAutoReviewer {
	readonly reviewer: DurableLambdaFunction;
	readonly router: LambdaFunction;
	readonly stateTable: DynamoDbTable;
	readonly pipelineBridge?: LambdaFunction;
	readonly pipelineReconciler?: LambdaFunction;
	readonly codeBuildProjects: ReadonlyMap<string, CodeBuildProject>;
	readonly eventConstructs: ReadonlyMap<string, CodeCommitReviewEvents>;

	constructor(scope: Stack, id: string, props: CodeCommitAutoReviewerProps) {
		const {
			config,
			repositoryResources,
			reviewCoordinationDeployment,
			team,
			stage,
		} = resolveCodeCommitAutoReviewerProps(scope, props);
		const reviewerFunctionName = `${team}-${stage}-${id}Reviewer-lambda`;
		const reviewerArn = `arn:aws:lambda:${scope.region}:${scope.account}:function:${reviewerFunctionName}:${config.reviewerAlias}`;
		const botArnPatterns =
			config.botArnPatterns !== ""
				? config.botArnPatterns
				: reviewerFunctionName;

		// 1. State table
		const stateTable = new DynamoDbTable(scope, `${id}State`, {
			partitionKey: { name: "pk", type: "STRING" },
			sortKey: { name: "sk", type: "STRING" },
			timeToLiveAttribute: "expiresAt",
			pointInTimeRecovery: true,
			retain: true,
			globalSecondaryIndexes:
				reviewCoordinationDeployment === undefined
					? undefined
					: [
							{
								indexName: "GSI1",
								partitionKey: { name: "gsi1pk", type: "STRING" },
								sortKey: { name: "gsi1sk", type: "STRING" },
							},
							...(reviewCoordinationDeployment.phase === "prepareGsi1"
								? []
								: [
										{
											indexName: "GSI2",
											partitionKey: {
												name: "gsi2pk",
												type: "STRING" as const,
											},
											sortKey: {
												name: "gsi2sk",
												type: "STRING" as const,
											},
										},
									]),
						],
		});

		// 2. Per-repo CodeBuild projects (created first so project-name tokens
		//    can source the reviewer's env vars).
		const codeBuildProjects = new Map<string, CodeBuildProject>();
		const reviewerEnvironment: Record<string, string> = {
			STATE_TABLE_NAME: stateTable.tableName,
			BOT_ARN_PATTERNS: botArnPatterns,
			REVIEWER_FUNCTION_ARN: reviewerArn,
			REVIEWER_MODEL_ID: config.reviewerModelId,
			CODEBUILD_REPOSITORIES: config.repositories.join(","),
		};
		for (const repo of config.repositories) {
			const repositoryResource = repositoryResources?.get(repo);
			const repositoryTarget = repositoryResource
				? { repository: repositoryResource }
				: { repositoryName: repo };
			const codeBuild = new CodeBuildProject(scope, `${id}Checks-${repo}`, {
				...repositoryTarget,
				computeSize: config.codeBuildComputeSize,
				networkPolicy: config.codeBuildNetworkPolicy,
			});
			codeBuildProjects.set(repo, codeBuild);
			reviewerEnvironment[projectEnvVar(repo)] = codeBuild.projectName;
		}

		// 3. Durable reviewer Lambda
		const reviewer = new DurableLambdaFunction(scope, `${id}Reviewer`, {
			entry: path.resolve(__dirname, "reviewer/handlers/reviewer.ts"),
			projectRoot: PAWL_ROOT,
			depsLockFilePath: PAWL_LOCKFILE,
			executionTimeoutSeconds: config.reviewerExecutionTimeoutSeconds,
			retentionDays: config.reviewerRetentionDays,
			aliasName: config.reviewerAlias,
			timeout: Duration.minutes(config.reviewerTimeoutMinutes),
			memorySize: config.reviewerMemorySize,
			environment: reviewerEnvironment,
		});

		stateTable.grantReadWrite(reviewer);

		// 4. Bedrock InvokeModel IAM. Direct models stay scoped to this region;
		//    system profiles additionally need their exact profile plus the exact
		//    routed foundation model across regions, conditioned on that profile.
		const parsedModelId = parseBedrockModelId(config.reviewerModelId);
		if (parsedModelId.kind === "direct-foundation-model") {
			const foundationModelResource = `arn:aws:bedrock:${scope.region}::foundation-model/${parsedModelId.foundationModelId}`;
			reviewer.lambda.addToRolePolicy(
				new PolicyStatement({
					effect: Effect.ALLOW,
					actions: ["bedrock:InvokeModel"],
					resources: [foundationModelResource],
				}),
			);
		} else {
			const inferenceProfileResource = `arn:aws:bedrock:${scope.region}:${scope.account}:inference-profile/${parsedModelId.inferenceProfileId}`;
			const foundationModelResource = `arn:aws:bedrock:*::foundation-model/${parsedModelId.foundationModelId}`;
			reviewer.lambda.addToRolePolicy(
				new PolicyStatement({
					effect: Effect.ALLOW,
					actions: ["bedrock:InvokeModel"],
					resources: [inferenceProfileResource],
				}),
			);
			reviewer.lambda.addToRolePolicy(
				new PolicyStatement({
					effect: Effect.ALLOW,
					actions: ["bedrock:InvokeModel"],
					resources: [foundationModelResource],
					conditions: {
						ArnEquals: {
							"bedrock:InferenceProfileArn": inferenceProfileResource,
						},
					},
				}),
			);
			NagSuppressions.addResourceSuppressions(
				reviewer.lambda,
				[
					{
						id: "AwsSolutions-IAM5",
						reason:
							"The configured system-defined inference profile can route to the exact foundation model in multiple regions, so only the ARN region is wildcarded and bedrock:InferenceProfileArn restricts invocation to that profile.",
						appliesTo: [`Resource::${foundationModelResource}`],
					},
				],
				true,
			);
		}

		// 5. Router Lambda
		const router = new LambdaFunction(scope, `${id}Router`, {
			entry: path.resolve(__dirname, "reviewer/handlers/router.ts"),
			projectRoot: PAWL_ROOT,
			depsLockFilePath: PAWL_LOCKFILE,
			environment: {
				STATE_TABLE_NAME: stateTable.tableName,
				REVIEWER_FUNCTION_NAME: reviewer.lambda.functionName,
				REVIEWER_FUNCTION_ALIAS: config.reviewerAlias,
				REVIEWER_FUNCTION_ARN: reviewer.durableFunctionArn,
				BOT_ARN_PATTERNS: botArnPatterns,
			},
		});

		stateTable.grantReadWrite(router);

		let pipelineBridge: LambdaFunction | undefined;
		let pipelineReconciler: LambdaFunction | undefined;
		if (reviewCoordinationDeployment?.phase === "active") {
			pipelineReconciler = new LambdaFunction(scope, `${id}Reconciler`, {
				entry: path.resolve(
					__dirname,
					"reviewer/handlers/pipeline-reconciler.ts",
				),
				projectRoot: PAWL_ROOT,
				depsLockFilePath: PAWL_LOCKFILE,
				environment: {
					STATE_TABLE_NAME: stateTable.tableName,
				},
			});
			pipelineBridge = new LambdaFunction(scope, `${id}Bridge`, {
				entry: path.resolve(__dirname, "reviewer/handlers/pipeline-bridge.ts"),
				projectRoot: PAWL_ROOT,
				depsLockFilePath: PAWL_LOCKFILE,
				environment: {
					STATE_TABLE_NAME: stateTable.tableName,
					RECONCILER_FUNCTION_NAME: pipelineReconciler.lambda.functionName,
					REVIEW_ACTION_TIMEOUT_MINUTES: String(
						reviewCoordinationDeployment.reviewActionTimeoutMinutes,
					),
				},
			});
			reviewer.lambda.addEnvironment(
				"RECONCILER_FUNCTION_NAME",
				pipelineReconciler.lambda.functionName,
			);
			router.lambda.addEnvironment(
				"RECONCILER_FUNCTION_NAME",
				pipelineReconciler.lambda.functionName,
			);
			stateTable.grantReadWrite(pipelineBridge);
			stateTable.grantReadWrite(pipelineReconciler);
			pipelineReconciler.lambda.grantInvoke(pipelineBridge.lambda);
			pipelineReconciler.lambda.grantInvoke(reviewer.lambda);
			pipelineReconciler.lambda.grantInvoke(router.lambda);
			pipelineReconciler.lambda.addToRolePolicy(
				new PolicyStatement({
					effect: Effect.ALLOW,
					actions: [
						"codepipeline:PutJobSuccessResult",
						"codepipeline:PutJobFailureResult",
					],
					resources: ["*"],
				}),
			);
			NagSuppressions.addResourceSuppressions(
				pipelineReconciler.lambda,
				[
					{
						id: "AwsSolutions-IAM5",
						reason:
							"CodePipeline job-result APIs accept an opaque job ID and do not support resource-level IAM permissions.",
						appliesTo: ["Resource::*"],
					},
				],
				true,
			);
			new Rule(scope, `${id}ReconcileSchedule`, {
				schedule: Schedule.rate(Duration.minutes(1)),
				targets: [new LambdaEventTarget(pipelineReconciler.lambda)],
			});
		}

		// 6. Per-repo CodeBuild grants + CodeCommit event routing
		const eventConstructs = new Map<string, CodeCommitReviewEvents>();
		for (const repo of config.repositories) {
			const codeBuild = codeBuildProjects.get(repo);
			if (codeBuild === undefined) continue;
			codeBuild.grantRunAndRead(reviewer);

			const repositoryResource = repositoryResources?.get(repo);
			const repositoryTarget = repositoryResource
				? { repository: repositoryResource }
				: { repositoryName: repo };
			const events = new CodeCommitReviewEvents(scope, `${id}Events-${repo}`, {
				...repositoryTarget,
				router,
			});
			events.grantRead(router);
			events.grantConfigRead(router);
			events.grantRead(reviewer);
			events.grantConfigRead(reviewer);
			events.grantComment(reviewer);
			eventConstructs.set(repo, events);
		}

		// 7. Durable execution IAM (router → reviewer)
		reviewer.grantInvokeDurable(router);
		reviewer.grantReadDurableExecutions(router);
		reviewer.grantSendDurableExecutionCallbacks(router);

		this.reviewer = reviewer;
		this.router = router;
		this.stateTable = stateTable;
		this.pipelineBridge = pipelineBridge;
		this.pipelineReconciler = pipelineReconciler;
		this.codeBuildProjects = codeBuildProjects;
		this.eventConstructs = eventConstructs;
	}
}
