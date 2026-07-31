import type { DurableContext } from "@aws/durable-execution-sdk-js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { useDurableHandler } from "@pawl/lambda";
import {
	BedrockReviewModel,
	BedrockRuntimeTransport,
} from "../adapters/bedrock-review-model";
import {
	CodeBuildCheckRunner,
	CodeBuildRuntimeTransport,
	projectEnvVar,
} from "../adapters/codebuild-check-runner";
import { CodeCommitProvider } from "../adapters/codecommit-provider";
import { DynamoDbPipelineCoordinationStore } from "../adapters/dynamodb-pipeline-coordination-store";
import { DynamoDbStateStore } from "../adapters/dynamodb-state-store";
import { PipelineReviewCycleObserver } from "../adapters/pipeline-review-cycle-observer";
import type { CheckRunner } from "../ports/check-runner";
import type { ReviewCycleObserver } from "../ports/review-cycle-observer";
import type { ReviewModel } from "../ports/review-model";
import type { SourceControlProvider } from "../ports/source-control-provider";
import type { ReviewStateStore } from "../ports/state-store";
import {
	type FindingReconciler,
	IdempotentFindingReconciler,
	NoopFindingReconciler,
} from "../services/finding-reconciler";
import { NoopCheckRunner } from "../services/noop-check-runner";
import { NoopReviewModel } from "../services/noop-review-model";
import {
	NoopRepositoryConfigLoader,
	ProviderRepositoryConfigLoader,
} from "../services/repository-config-loader";
import { ReviewEngine } from "../services/review-engine";
import {
	type ReviewerEvent,
	type ReviewerLogger,
	ReviewerWorkflow,
	ReviewerWorkflowFailure,
} from "../workflows/reviewer-workflow";
import { LambdaReconcilerKick } from "./pipeline-bridge";

export type { ReviewerEvent } from "../workflows/reviewer-workflow";

export interface ReviewerWorkflowRunner {
	run(
		event: ReviewerEvent,
		context: DurableContext,
		logger: ReviewerLogger,
	): Promise<void>;
}

export interface ExecuteReviewerWorkflowDeps {
	readonly workflow: ReviewerWorkflowRunner;
	readonly cycleObserver?: ReviewCycleObserver;
	readonly clock: () => Date;
}

/**
 * Executes the deployed workflow. Only typed failures carrying authoritative
 * post-load snapshot identity are persisted; raw failures remain unattributed.
 * The exact original thrown value is always rethrown.
 */
export async function executeReviewerWorkflow(
	event: ReviewerEvent,
	context: DurableContext,
	logger: ReviewerLogger,
	deps: ExecuteReviewerWorkflowDeps,
): Promise<void> {
	try {
		await deps.workflow.run(event, context, logger);
	} catch (error) {
		if (!(error instanceof ReviewerWorkflowFailure)) throw error;

		const originalFailure = error.unwrap();
		const { request, generation, sourceRevision, cycle } = error.metadata;
		try {
			await context.step("record-cycle-failure", async () => {
				await deps.cycleObserver?.recordExecutionFailure({
					request,
					generation,
					sourceRevision,
					cycle,
					occurredAt: deps.clock().toISOString(),
				});
			});
		} catch {
			try {
				logger.info("failed to record reviewer failure outcome", {
					request,
					generation,
					sourceRevision,
					cycle,
				});
			} catch {
				// Reporting must not replace the original workflow failure.
			}
		}
		throw originalFailure;
	}
}

export interface ReviewerWorkflowOverrides {
	readonly stateStore?: ReviewStateStore;
	readonly provider?: SourceControlProvider;
	readonly checkRunner?: CheckRunner;
	readonly reviewModel?: ReviewModel;
	readonly reconciler?: FindingReconciler;
	readonly cycleObserver?: ReviewCycleObserver;
	readonly clock?: () => Date;
}

/**
 * Composition seam for the reviewer durable workflow.
 *
 * - With no arguments, constructs a `ReviewerWorkflow` from `process.env`
 *   (`STATE_TABLE_NAME`, `REVIEWER_FUNCTION_ARN`,
 *   `REVIEWER_MODEL_ID`) backed by AWS SDK transports, the Bedrock review
 *   model, and the noop stub check runner / reconciler. This is the env-only
 *   path used by the deployed `handler`.
 * - With `options`, accepts injected dependencies for deterministic tests.
 */
/**
 * Derives a human-readable model display name from a Bedrock model ID or
 * inference-profile ID (e.g. "eu.anthropic.claude-sonnet-4-6" -> "Claude Sonnet 4.6").
 */
function modelDisplayName(modelId: string | undefined): string {
	if (modelId === undefined || modelId === "") return "AI Reviewer";
	// Strip any regional/system prefix (e.g. "eu.", "global.") and the
	// "anthropic." provider prefix, then tidy the version suffix.
	const base = modelId
		.replace(/^(eu|global|us|ap)\./, "")
		.replace(/^anthropic\./, "");
	return base
		.replace(/-(\d+)-(\d+)/g, " $1.$2") // version: "4-6" -> " 4.6"
		.replace(/-(\d+)$/g, " $1") // trailing version: "-5" -> " 5"
		.replace(/-/g, " ")
		.replace(/\bclaude\b/i, "Claude")
		.replace(/\bsonnet\b/i, "Sonnet")
		.replace(/\bopus\b/i, "Opus")
		.replace(/\bhaiku\b/i, "Haiku")
		.replace(/\bfable\b/i, "Fable")
		.replace(/\s+v(\d)/i, " v$1")
		.replace(/\s+/g, " ")
		.trim();
}

export function buildReviewerWorkflow(
	options?: ReviewerWorkflowOverrides,
): ReviewerWorkflow {
	if (options !== undefined && options.stateStore !== undefined) {
		const reviewModel = options.reviewModel ?? new NoopReviewModel();
		return new ReviewerWorkflow({
			store: options.stateStore,
			provider: options.provider ?? defaultProvider(),
			checkRunner: options.checkRunner ?? new NoopCheckRunner(),
			reviewEngine: new ReviewEngine({ model: reviewModel }),
			reconciler: options.reconciler ?? new NoopFindingReconciler(),
			configLoader: new NoopRepositoryConfigLoader(),
			reviewerDisplayName: modelDisplayName(process.env.REVIEWER_MODEL_ID),
			cycleObserver: options.cycleObserver,
			clock: options.clock ?? (() => new Date()),
		});
	}
	return buildFromEnvironment().workflow;
}

function defaultProvider(): SourceControlProvider {
	return new CodeCommitProvider({
		reviewerArn: process.env.REVIEWER_FUNCTION_ARN,
		reviewerDisplayName: modelDisplayName(process.env.REVIEWER_MODEL_ID),
	});
}

/**
 * Builds the repository→CodeBuild-project map from the Lambda environment.
 * `CODEBUILD_REPOSITORIES` is a comma-separated repository list (set by the
 * stack); each repo's project name lives in `CODEBUILD_PROJECT_<SAFE>`. Using
 * the explicit list avoids lossy reverse-engineering of repo names from env
 * var suffixes (e.g. `my.repo` and `my_repo` would collide).
 */
function codeBuildProjectsFromEnv(): Record<string, string> {
	const repos = (process.env.CODEBUILD_REPOSITORIES ?? "")
		.split(",")
		.map((r) => r.trim())
		.filter((r) => r !== "");
	const map: Record<string, string> = {};
	for (const repo of repos) {
		const name = process.env[projectEnvVar(repo)];
		if (name !== undefined && name !== "") map[repo] = name;
	}
	return map;
}

interface ReviewerComposition extends ExecuteReviewerWorkflowDeps {
	readonly workflow: ReviewerWorkflow;
}

function buildFromEnvironment(): ReviewerComposition {
	const tableName = process.env.STATE_TABLE_NAME;
	if (tableName === undefined || tableName === "") {
		throw new Error(
			"buildReviewerWorkflow: STATE_TABLE_NAME environment variable is required",
		);
	}
	const reviewerArn = process.env.REVIEWER_FUNCTION_ARN;
	if (reviewerArn === undefined || reviewerArn === "") {
		throw new Error(
			"buildReviewerWorkflow: REVIEWER_FUNCTION_ARN environment variable is required",
		);
	}
	const modelId = process.env.REVIEWER_MODEL_ID;
	if (modelId === undefined || modelId === "") {
		throw new Error(
			"buildReviewerWorkflow: REVIEWER_MODEL_ID environment variable is required",
		);
	}
	const projectNames = codeBuildProjectsFromEnv();
	if (Object.keys(projectNames).length === 0) {
		throw new Error(
			"buildReviewerWorkflow: no CODEBUILD_PROJECT_* environment variables found (set CODEBUILD_REPOSITORIES + CODEBUILD_PROJECT_<SAFE> per repository)",
		);
	}
	const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
	const stateStore = new DynamoDbStateStore({
		transport: documentClient,
		tableName,
	});
	const reconcilerFunctionName = process.env.RECONCILER_FUNCTION_NAME;
	const cycleObserver = reconcilerFunctionName
		? new PipelineReviewCycleObserver({
				store: new DynamoDbPipelineCoordinationStore({
					transport: documentClient,
					tableName,
				}),
				reconciler: new LambdaReconcilerKick(reconcilerFunctionName),
			})
		: undefined;
	const provider = new CodeCommitProvider({
		reviewerArn,
		reviewerDisplayName: modelDisplayName(modelId),
	});
	const clock = (): Date => new Date();
	const reviewModel = new BedrockReviewModel({
		transport: new BedrockRuntimeTransport(),
		modelId,
	});
	const workflow = new ReviewerWorkflow({
		store: stateStore,
		provider,
		checkRunner: new CodeBuildCheckRunner({
			transport: new CodeBuildRuntimeTransport(),
			projectNames,
		}),
		reviewEngine: new ReviewEngine({ model: reviewModel }),
		reconciler: new IdempotentFindingReconciler({
			store: stateStore,
			provider,
			clock,
		}),
		configLoader: new ProviderRepositoryConfigLoader({ provider }),
		reviewerDisplayName: modelDisplayName(modelId),
		cycleObserver,
		clock,
	});
	return { workflow, cycleObserver, clock };
}

let cachedComposition: ReviewerComposition | undefined;

function getComposition(): ReviewerComposition {
	if (cachedComposition === undefined) {
		cachedComposition = buildFromEnvironment();
	}
	return cachedComposition;
}

export const handler = useDurableHandler<ReviewerEvent, void>(
	"durable-reviewer",
	async (event, context, { logger }) => {
		await executeReviewerWorkflow(
			event,
			context,
			logger as unknown as ReviewerLogger,
			getComposition(),
		);
	},
);
