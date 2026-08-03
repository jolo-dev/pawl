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
import { PipelineEventRouter } from "../router/pipeline-event-router";
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

function requiredEnvironment(name: string, value: string | undefined): string {
	if (value === undefined || value === "") {
		throw new Error(
			`buildEventRouter: ${name} environment variable is required`,
		);
	}
	return value;
}

function buildFromEnvironment(): EventRouter | PipelineEventRouter {
	const tableName = requiredEnvironment(
		"STATE_TABLE_NAME",
		process.env.STATE_TABLE_NAME,
	);
	const reviewerFunctionName = process.env.REVIEWER_FUNCTION_NAME;
	const reviewerArn = process.env.REVIEWER_FUNCTION_ARN;
	const reviewedMode =
		(reviewerFunctionName !== undefined && reviewerFunctionName !== "") ||
		(reviewerArn !== undefined && reviewerArn !== "");
	const botArnPatterns = parseBotArnPatterns(process.env.BOT_ARN_PATTERNS);
	const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
	const stateStore = new DynamoDbStateStore({
		transport: documentClient,
		tableName,
	});
	const provider = new CodeCommitProvider({ reviewerArn });
	const pipelineName = process.env.PIPELINE_NAME;
	const coordinationStore = new DynamoDbPipelineCoordinationStore({
		transport: documentClient,
		tableName,
	});

	if (!reviewedMode) {
		const requiredPipelineName = requiredEnvironment(
			"PIPELINE_NAME",
			pipelineName,
		);
		const sourceActionName = requiredEnvironment(
			"PIPELINE_SOURCE_ACTION_NAME",
			process.env.PIPELINE_SOURCE_ACTION_NAME,
		);
		return new PipelineEventRouter({
			stateStore,
			provider,
			pipelineDispatcher: new PipelineReviewDispatcher({
				pipelineName: requiredPipelineName,
				sourceActionName,
				transport: new AwsCodePipelineTransport(),
				store: coordinationStore,
				reconciler: { invoke: async () => undefined },
			}),
			botArnPatterns,
		});
	}

	const requiredReviewerFunctionName = requiredEnvironment(
		"REVIEWER_FUNCTION_NAME",
		reviewerFunctionName,
	);
	const requiredReviewerArn = requiredEnvironment(
		"REVIEWER_FUNCTION_ARN",
		reviewerArn,
	);
	const reconcilerFunctionName = process.env.RECONCILER_FUNCTION_NAME;
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
		lambda: new AwsLambdaTransport(),
		provider,
		reviewerFunctionName: requiredReviewerFunctionName,
		reviewerAlias: process.env.REVIEWER_FUNCTION_ALIAS || "live",
		reviewerArn: requiredReviewerArn,
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
export function buildEventRouter(): EventRouter | PipelineEventRouter;
export function buildEventRouter(
	options: BuildEventRouterOverrides,
): EventRouter;
export function buildEventRouter(
	options?: BuildEventRouterOverrides,
): EventRouter | PipelineEventRouter {
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

let cachedRouter: EventRouter | PipelineEventRouter | undefined;
let cachedPipelineConfig: PipelineDispatchConfig | undefined;

function getRouter(): EventRouter | PipelineEventRouter {
	if (cachedRouter === undefined) cachedRouter = buildEventRouter();
	return cachedRouter;
}

function getPipelineDispatchConfig(): PipelineDispatchConfig {
	if (cachedPipelineConfig === undefined) {
		const pipelineName = process.env.PIPELINE_NAME;
		const tableName = process.env.STATE_TABLE_NAME;
		if (tableName === undefined || tableName === "") {
			throw new Error(
				"getPipelineDispatchConfig: STATE_TABLE_NAME is required",
			);
		}
		const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
		const coordinationStore = new DynamoDbPipelineCoordinationStore({
			transport: documentClient,
			tableName,
		});
		const transport = new AwsCodePipelineTransport();
		const provider = new CodeCommitProvider();
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

	// CodeCommit event dispatch has exactly one append owner in either mode.
	const result =
		router instanceof PipelineEventRouter
			? await router.routePipelineOnly(event)
			: await router.routeCodeCommit(event);
	logger.info("routed", { ...result });
});
