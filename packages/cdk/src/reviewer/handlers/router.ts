import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { useEventbridgeHandler } from "@pawl/lambda";
import { CodeCommitProvider } from "../adapters/codecommit-provider";
import { AwsCodePipelineTransport } from "../adapters/codepipeline-transport";
import { DynamoDbPipelineCoordinationStore } from "../adapters/dynamodb-pipeline-coordination-store";
import { DynamoDbStateStore } from "../adapters/dynamodb-state-store";
import {
	handlePipelineExecutionEvent,
	type PipelineDispatchConfig,
	PipelineReviewDispatcher,
} from "../pipeline-review-common";
import type { SourceControlProvider } from "../ports/source-control-provider";
import type { ReviewStateStore } from "../ports/state-store";
import { EventRouter, type EventRouterOptions } from "../router/event-router";
import {
	AwsLambdaTransport,
	type LambdaTransport,
} from "../router/lambda-transport";
import { LambdaReconcilerKick } from "./pipeline-bridge";

export type { EventRouterOptions } from "../router/event-router";

interface BuildEventRouterOverrides {
	readonly stateStore?: ReviewStateStore;
	readonly lambda?: LambdaTransport;
	readonly provider?: SourceControlProvider;
	readonly reviewerFunctionName: string;
	readonly reviewerAlias?: string;
	readonly reviewerArn: string;
	readonly botArnPatterns?: readonly (string | RegExp)[];
	readonly retryPolicy?: EventRouterOptions["retryPolicy"];
	readonly repositoryHash?: EventRouterOptions["repositoryHash"];
	readonly pipelineDispatcher?: EventRouterOptions["pipelineDispatcher"];
}

function parseBotArnPatterns(value: string | undefined): readonly string[] {
	if (value === undefined || value.trim() === "") return [];
	return value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
}

function buildFromEnvironment(): EventRouter {
	const tableName = process.env.STATE_TABLE_NAME;
	const reviewerFunctionName = process.env.REVIEWER_FUNCTION_NAME;
	const reviewerArn = process.env.REVIEWER_FUNCTION_ARN;
	if (tableName === undefined || tableName === "") {
		throw new Error(
			"buildEventRouter: STATE_TABLE_NAME environment variable is required",
		);
	}
	if (reviewerFunctionName === undefined || reviewerFunctionName === "") {
		throw new Error(
			"buildEventRouter: REVIEWER_FUNCTION_NAME environment variable is required",
		);
	}
	if (reviewerArn === undefined || reviewerArn === "") {
		throw new Error(
			"buildEventRouter: REVIEWER_FUNCTION_ARN environment variable is required",
		);
	}
	const reviewerAlias = process.env.REVIEWER_FUNCTION_ALIAS || "live";
	const botArnPatterns = parseBotArnPatterns(process.env.BOT_ARN_PATTERNS);
	const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
	const stateStore = new DynamoDbStateStore({
		transport: documentClient,
		tableName,
	});
	const lambda = new AwsLambdaTransport();
	const provider = new CodeCommitProvider({ reviewerArn });
	const pipelineName = process.env.PIPELINE_NAME;
	const reconcilerFunctionName = process.env.RECONCILER_FUNCTION_NAME;
	const coordinationStore = new DynamoDbPipelineCoordinationStore({
		transport: documentClient,
		tableName,
	});
	const pipelineDispatcher =
		pipelineName && reconcilerFunctionName
			? new PipelineReviewDispatcher({
					pipelineName,
					sourceActionName: process.env.PIPELINE_SOURCE_ACTION_NAME ?? "Source",
					transport: new AwsCodePipelineTransport(),
					store: coordinationStore,
					reconciler: new LambdaReconcilerKick(reconcilerFunctionName),
				})
			: undefined;
	return new EventRouter({
		stateStore,
		lambda,
		provider,
		reviewerFunctionName,
		reviewerAlias,
		reviewerArn,
		botArnPatterns,
		pipelineDispatcher,
	});
}

/**
 * Composition root for the router Lambda.
 *
 * - With no arguments, constructs an `EventRouter` from `process.env`
 *   (`STATE_TABLE_NAME`, `REVIEWER_FUNCTION_NAME`, `REVIEWER_FUNCTION_ALIAS`,
 *   `REVIEWER_FUNCTION_ARN`, `BOT_ARN_PATTERNS`) backed by the
 *   AWS SDK transports. This is the env-only path used by the deployed `handler`.
 * - With `options`, accepts injected transports/state for deterministic tests.
 */
export function buildEventRouter(
	options?: BuildEventRouterOverrides,
): EventRouter {
	if (options === undefined) return buildFromEnvironment();
	const stateStore = options.stateStore;
	const lambda = options.lambda;
	if (
		stateStore === undefined ||
		lambda === undefined ||
		options.provider === undefined
	) {
		throw new Error(
			"buildEventRouter: stateStore, lambda, and provider are required when constructing explicitly",
		);
	}
	return new EventRouter({
		stateStore,
		lambda,
		provider: options.provider,
		reviewerFunctionName: options.reviewerFunctionName,
		reviewerAlias: options.reviewerAlias ?? "live",
		reviewerArn: options.reviewerArn,
		botArnPatterns: options.botArnPatterns,
		retryPolicy: options.retryPolicy,
		repositoryHash: options.repositoryHash,
		pipelineDispatcher: options.pipelineDispatcher,
	});
}

let cachedRouter: EventRouter | undefined;
let cachedPipelineConfig: PipelineDispatchConfig | undefined;

function getRouter(): EventRouter {
	if (cachedRouter === undefined) cachedRouter = buildEventRouter();
	return cachedRouter;
}

function getPipelineDispatchConfig(): PipelineDispatchConfig {
	if (cachedPipelineConfig === undefined) {
		const pipelineName = process.env.PIPELINE_NAME;
		const tableName = process.env.STATE_TABLE_NAME;
		const reviewerArn = process.env.REVIEWER_FUNCTION_ARN;
		if (tableName === undefined || tableName === "") {
			throw new Error(
				"getPipelineDispatchConfig: STATE_TABLE_NAME is required",
			);
		}
		if (reviewerArn === undefined || reviewerArn === "") {
			throw new Error(
				"getPipelineDispatchConfig: REVIEWER_FUNCTION_ARN is required",
			);
		}
		const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
		const coordinationStore = new DynamoDbPipelineCoordinationStore({
			transport: documentClient,
			tableName,
		});
		const transport = new AwsCodePipelineTransport();
		const provider = new CodeCommitProvider({ reviewerArn });
		cachedPipelineConfig = {
			pipelineTransport: pipelineName
				? {
						startExecution: async () => {
							throw new Error("legacy pipeline start path is disabled");
						},
						getExecution: (input) => transport.getExecution(input),
					}
				: undefined,
			pipelineName,
			mappingStore: {
				putMapping: async () => {
					throw new Error("legacy pipeline mapping path is disabled");
				},
				getMapping: async (executionId) => {
					const mapping =
						await coordinationStore.getExecutionMapping(executionId);
					return mapping
						? {
								pullRequestId: mapping.request.requestId,
								repositoryName: mapping.request.repository,
								sourceCommitId: mapping.sourceRevision,
								destinationCommitId: mapping.destinationRevision,
							}
						: undefined;
				},
			},
			commentPoster: {
				postComment: async (input) => {
					await provider.postStatusComment(
						{
							provider: "codecommit",
							repository: input.repositoryName,
							requestId: input.pullRequestId,
						},
						input.content,
						input.idempotencyToken ?? `pipeline-${input.pullRequestId}`,
					);
				},
			},
		};
	}
	return cachedPipelineConfig;
}

export const handler = useEventbridgeHandler<
	string,
	Record<string, unknown>,
	unknown
>("durable-reviewer-router", async (event, logger) => {
	const router = getRouter();

	// Check if this is a CodePipeline Execution State Change event
	const source = (event as { source?: string }).source;
	if (source === "aws.codepipeline") {
		const detail = (
			event as {
				detail?: { "pipeline-execution-id"?: string; pipeline?: string };
			}
		).detail;
		const executionId = detail?.["pipeline-execution-id"];
		const pipelineName = detail?.pipeline;
		if (executionId !== undefined && pipelineName !== undefined) {
			const pipelineConfig = getPipelineDispatchConfig();
			await handlePipelineExecutionEvent(
				{ executionId, pipelineName },
				pipelineConfig,
			);
			logger.info("pipeline-event-handled", { executionId });
		}
		return { statusCode: 200, detail: "pipeline event processed" } as Record<
			string,
			unknown
		>;
	}

	// Existing CodeCommit event dispatch
	const result = await router.routeCodeCommit(event);
	logger.info("routed", { ...result });
});
