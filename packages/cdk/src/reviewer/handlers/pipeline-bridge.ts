import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { useCodePipelineHandler } from "@pawl/lambda";
import { DynamoDbPipelineCoordinationStore } from "../adapters/dynamodb-pipeline-coordination-store";
import {
	codePipelineJobEventSchema,
	parseSanitizedActionUserParameters,
} from "../pipeline/codepipeline-job-event";
import type { PipelineJobRecord } from "../pipeline/pipeline-coordination-store";
import type { PipelineCoordinationStore } from "../ports/pipeline-coordination-store";

export interface PipelineReconcilerKick {
	invoke(jobId?: string): Promise<void>;
}

export interface PipelineBridgeOptions {
	readonly store: PipelineCoordinationStore;
	readonly reconciler: PipelineReconcilerKick;
	readonly timeoutMinutes: number;
	readonly clock?: () => Date;
}

const safeJobId = (event: unknown): string | undefined => {
	if (typeof event !== "object" || event === null) return undefined;
	const job = (event as Record<string, unknown>)["CodePipeline.job"];
	if (typeof job !== "object" || job === null) return undefined;
	const id = (job as Record<string, unknown>).id;
	return typeof id === "string" && id.trim() !== "" ? id : undefined;
};

const addMinutes = (date: Date, minutes: number): string =>
	new Date(date.getTime() + minutes * 60_000).toISOString();

export const buildPipelineBridge =
	(options: PipelineBridgeOptions) =>
	async (event: unknown): Promise<void> => {
		const now = (options.clock ?? (() => new Date()))();
		const nextActionAt = now.toISOString();
		const deadlineAt = addMinutes(now, options.timeoutMinutes);
		const fallbackJobId = safeJobId(event);
		let job: PipelineJobRecord;
		try {
			const envelope = codePipelineJobEventSchema.parse(event);
			const params = parseSanitizedActionUserParameters(
				envelope.userParameters,
			);
			job = {
				jobId: envelope.jobId,
				state: "PENDING",
				pipelineExecutionId: params.pipelineExecutionId,
				pipelineName: params.pipelineName,
				stageName: params.stageName,
				actionName: params.actionName,
				request: {
					provider: params.provider,
					repository: params.repository,
					requestId: params.requestId,
				},
				generation: params.generation,
				sourceRevision: params.sourceRevision,
				destinationRevision: params.destinationRevision,
				deadlineAt,
				nextActionAt,
			};
		} catch (error) {
			if (fallbackJobId === undefined) throw error;
			job = {
				jobId: fallbackJobId,
				state: "PENDING",
				deadlineAt,
				nextActionAt,
				callbackCandidate: {
					status: "failure",
					category: "ConfigurationError",
					message: "Invalid CodePipeline review action configuration",
				},
			};
		}
		const registered = await options.store.registerJob(job);
		await options.reconciler.invoke(registered.jobId);
	};

export class LambdaReconcilerKick implements PipelineReconcilerKick {
	readonly #client = new LambdaClient({});
	readonly #functionName: string;

	constructor(functionName: string) {
		this.#functionName = functionName;
	}

	async invoke(jobId?: string): Promise<void> {
		const detail = jobId === undefined ? {} : { jobId };
		await this.#client.send(
			new InvokeCommand({
				FunctionName: this.#functionName,
				InvocationType: "Event",
				Payload: new TextEncoder().encode(
					JSON.stringify({
						version: "0",
						id: randomUUID(),
						"detail-type": "Pipeline Review Reconcile",
						source: "pawl.pipeline-review",
						account: "",
						time: new Date().toISOString(),
						region: process.env.AWS_REGION ?? "",
						resources: [],
						detail,
					}),
				),
			}),
		);
	}
}

export const parsePipelineBridgeTimeout = (value: string | undefined): number => {
	const timeout = Number(value ?? "15");
	if (!Number.isInteger(timeout) || timeout < 5 || timeout > 15) {
		throw new Error("pipeline bridge timeout must be an integer from 5 to 15");
	}
	return timeout;
};

const buildFromEnvironment = (): PipelineBridgeOptions => {
	const tableName = process.env.STATE_TABLE_NAME;
	const reconcilerFunctionName = process.env.RECONCILER_FUNCTION_NAME;
	const timeout = parsePipelineBridgeTimeout(
		process.env.REVIEW_ACTION_TIMEOUT_MINUTES,
	);
	if (!tableName) throw new Error("pipeline bridge requires STATE_TABLE_NAME");
	if (!reconcilerFunctionName) {
		throw new Error("pipeline bridge requires RECONCILER_FUNCTION_NAME");
	}
	return {
		store: new DynamoDbPipelineCoordinationStore({
			transport: DynamoDBDocumentClient.from(new DynamoDBClient({})),
			tableName,
		}),
		reconciler: new LambdaReconcilerKick(reconcilerFunctionName),
		timeoutMinutes: timeout,
	};
};

let cachedBridge: ReturnType<typeof buildPipelineBridge> | undefined;

export const handler = useCodePipelineHandler(
	"pipeline-review-bridge",
	async (event) => {
		cachedBridge ??= buildPipelineBridge(buildFromEnvironment());
		await cachedBridge(event);
	},
);
