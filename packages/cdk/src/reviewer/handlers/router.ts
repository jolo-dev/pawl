import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { useEventbridgeHandler } from "@pawl/lambda";
import { CodeCommitProvider } from "../adapters/codecommit-provider";
import { DynamoDbStateStore } from "../adapters/dynamodb-state-store";
import type { SourceControlProvider } from "../ports/source-control-provider";
import type { ReviewStateStore } from "../ports/state-store";
import { AwsLambdaTransport, type LambdaTransport } from "../router/lambda-transport";
import { EventRouter, type EventRouterOptions } from "../router/event-router";
import {
  handlePipelineExecutionEvent,
  type PipelineDispatchConfig,
} from "../pipeline-review-common";

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
    throw new Error("buildEventRouter: STATE_TABLE_NAME environment variable is required");
  }
  if (reviewerFunctionName === undefined || reviewerFunctionName === "") {
    throw new Error("buildEventRouter: REVIEWER_FUNCTION_NAME environment variable is required");
  }
  if (reviewerArn === undefined || reviewerArn === "") {
    throw new Error("buildEventRouter: REVIEWER_FUNCTION_ARN environment variable is required");
  }
  const reviewerAlias = process.env.REVIEWER_FUNCTION_ALIAS || "live";
  const botArnPatterns = parseBotArnPatterns(process.env.BOT_ARN_PATTERNS);
  const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const stateStore = new DynamoDbStateStore({ transport: documentClient, tableName });
  const lambda = new AwsLambdaTransport();
  const provider = new CodeCommitProvider({ reviewerArn });
  return new EventRouter({
    stateStore,
    lambda,
    provider,
    reviewerFunctionName,
    reviewerAlias,
    reviewerArn,
    botArnPatterns,
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
export function buildEventRouter(options?: BuildEventRouterOverrides): EventRouter {
  if (options === undefined) return buildFromEnvironment();
  const stateStore = options.stateStore;
  const lambda = options.lambda;
  if (stateStore === undefined || lambda === undefined || options.provider === undefined) {
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
    if (tableName === undefined || tableName === "") {
      throw new Error("getPipelineDispatchConfig: STATE_TABLE_NAME is required");
    }
    // Pipeline transport is only constructed when PIPELINE_NAME is set.
    // The actual CodePipelineClient wrapper will be created in Task 4/5
    // when CodePipeline construct sets the env var. For now, undefined means
    // startPipelineForPr and handlePipelineExecutionEvent are no-ops for
    // pipeline start, but handlePipelineExecutionEvent can still resolve
    // mappings if they exist.
    cachedPipelineConfig = {
      pipelineTransport: pipelineName !== undefined ? undefined : undefined,
      pipelineName: pipelineName,
      mappingStore: createMappingStore(tableName),
      commentPoster: createCommentPoster(),
    };
  }
  return cachedPipelineConfig;
}

function createMappingStore(_tableName: string): PipelineDispatchConfig["mappingStore"] {
  // Placeholder — the actual DynamoDB mapping store will use the document client.
  // For now, return a no-op store that always returns undefined.
  return {
    putMapping: async () => {},
    getMapping: async () => undefined,
  };
}

function createCommentPoster(): PipelineDispatchConfig["commentPoster"] {
  // Placeholder — the actual CodeCommit comment poster will use the CodeCommit client.
  return {
    postComment: async () => {},
  };
}

export const handler = useEventbridgeHandler<string, Record<string, unknown>, unknown>(
  "durable-reviewer-router",
  async (event, logger) => {
    const router = getRouter();

    // Check if this is a CodePipeline Execution State Change event
    const source = (event as { source?: string }).source;
    if (source === "aws.codepipeline") {
      const detail = (event as { detail?: { "pipeline-execution-id"?: string; pipeline?: string } }).detail;
      const executionId = detail?.["pipeline-execution-id"];
      const pipelineName = detail?.pipeline;
      if (executionId !== undefined && pipelineName !== undefined) {
        const pipelineConfig = getPipelineDispatchConfig();
        await handlePipelineExecutionEvent({ executionId, pipelineName }, pipelineConfig);
        logger.info("pipeline-event-handled", { executionId });
      }
      return { statusCode: 200, detail: "pipeline event processed" } as Record<string, unknown>;
    }

    // Existing CodeCommit event dispatch
    const result = await router.routeCodeCommit(event);
    logger.info("routed", { ...result });
  },
);
