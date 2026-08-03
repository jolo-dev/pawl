import { createHash } from "node:crypto";
import {
	CodePipelineClient,
	GetPipelineExecutionCommand,
	ListActionExecutionsCommand,
	PutJobFailureResultCommand,
	PutJobSuccessResultCommand,
	StartPipelineExecutionCommand,
} from "@aws-sdk/client-codepipeline";
import type { RequestKey } from "../domain/review-request";

export const PAWL_PIPELINE_VARIABLES = {
	provider: "PAWL_PROVIDER",
	repository: "PAWL_REPOSITORY",
	requestId: "PAWL_REQUEST_ID",
	generation: "PAWL_GENERATION",
	sourceRevision: "PAWL_SOURCE_REVISION",
	destinationRevision: "PAWL_DESTINATION_REVISION",
} as const;

export interface StartReviewPipelineExecution {
	readonly pipelineName: string;
	readonly sourceActionName: string;
	readonly sourceRevision: string;
	readonly destinationRevision: string;
	readonly request: RequestKey;
	readonly generation: number;
	readonly dispatchIdentity?: string;
}

export interface PipelineExecutionResult {
	readonly executionId: string;
}

export interface PipelineExecutionDetails {
	readonly status: string;
	readonly stageSummaries: ReadonlyArray<{
		readonly stageName: string;
		readonly actionStates: ReadonlyArray<{
			readonly actionName: string;
			readonly status: string;
		}>;
	}>;
}

export type CodePipelineCommand =
	| StartPipelineExecutionCommand
	| GetPipelineExecutionCommand
	| ListActionExecutionsCommand
	| PutJobSuccessResultCommand
	| PutJobFailureResultCommand;

export interface CodePipelineCommandSender {
	send(command: CodePipelineCommand): Promise<unknown>;
}

const requireText = (value: unknown, name: string): string => {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${name} is required`);
	}
	return value;
};

export const pipelineClientRequestToken = (
	input: StartReviewPipelineExecution,
): string =>
	createHash("sha256")
		.update(
			JSON.stringify({
				request: input.request,
				generation: input.generation,
				sourceRevision: input.sourceRevision,
				destinationRevision: input.destinationRevision,
				dispatchIdentity: input.dispatchIdentity,
			}),
			"utf8",
		)
		.digest("hex");

const pipelineVariables = (input: StartReviewPipelineExecution) => [
	{ name: PAWL_PIPELINE_VARIABLES.provider, value: input.request.provider },
	{ name: PAWL_PIPELINE_VARIABLES.repository, value: input.request.repository },
	{ name: PAWL_PIPELINE_VARIABLES.requestId, value: input.request.requestId },
	{ name: PAWL_PIPELINE_VARIABLES.generation, value: String(input.generation) },
	{ name: PAWL_PIPELINE_VARIABLES.sourceRevision, value: input.sourceRevision },
	{
		name: PAWL_PIPELINE_VARIABLES.destinationRevision,
		value: input.destinationRevision,
	},
];

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;

const boundedMessage = (message: string): string => message.slice(0, 1_000);

export class AwsCodePipelineTransport {
	readonly #sender: CodePipelineCommandSender;

	constructor(sender: CodePipelineCommandSender = new CodePipelineClient({})) {
		this.#sender = sender;
	}

	async startExecution(
		input: StartReviewPipelineExecution,
	): Promise<PipelineExecutionResult> {
		const response = await this.#sender.send(
			new StartPipelineExecutionCommand({
				name: requireText(input.pipelineName, "pipelineName"),
				clientRequestToken: pipelineClientRequestToken(input),
				sourceRevisions: [
					{
						actionName: requireText(input.sourceActionName, "sourceActionName"),
						revisionType: "COMMIT_ID",
						revisionValue: requireText(input.sourceRevision, "sourceRevision"),
					},
				],
				variables: pipelineVariables(input),
			}),
		);
		const executionId = requireText(
			asRecord(response)?.pipelineExecutionId,
			"pipelineExecutionId",
		);
		return { executionId };
	}

	async getExecution(input: {
		readonly pipelineName: string;
		readonly executionId: string;
	}): Promise<PipelineExecutionDetails> {
		const [executionResponse, actionsResponse] = await Promise.all([
			this.#sender.send(
				new GetPipelineExecutionCommand({
					pipelineName: input.pipelineName,
					pipelineExecutionId: input.executionId,
				}),
			),
			this.#sender.send(
				new ListActionExecutionsCommand({
					pipelineName: input.pipelineName,
					filter: { pipelineExecutionId: input.executionId },
				}),
			),
		]);
		const status = requireText(
			asRecord(asRecord(executionResponse)?.pipelineExecution)?.status,
			"pipeline execution status",
		);
		const actionDetails = asRecord(actionsResponse)?.actionExecutionDetails;
		const byStage = new Map<
			string,
			Array<{ readonly actionName: string; readonly status: string }>
		>();
		if (Array.isArray(actionDetails)) {
			for (const detail of actionDetails) {
				const record = asRecord(detail);
				const stageName = requireText(record?.stageName, "stageName");
				const actionName = requireText(record?.actionName, "actionName");
				const actionStatus = requireText(record?.status, "action status");
				const actions = byStage.get(stageName) ?? [];
				actions.push({ actionName, status: actionStatus });
				byStage.set(stageName, actions);
			}
		}
		return {
			status,
			stageSummaries: [...byStage].map(([stageName, actionStates]) => ({
				stageName,
				actionStates,
			})),
		};
	}

	async putJobSuccess(jobId: string): Promise<void> {
		await this.#sender.send(
			new PutJobSuccessResultCommand({ jobId: requireText(jobId, "jobId") }),
		);
	}

	async putJobFailure(input: {
		readonly jobId: string;
		readonly category: string;
		readonly message: string;
	}): Promise<void> {
		await this.#sender.send(
			new PutJobFailureResultCommand({
				jobId: requireText(input.jobId, "jobId"),
				failureDetails: {
					type: "JobFailed",
					externalExecutionId: requireText(input.category, "category"),
					message: boundedMessage(requireText(input.message, "message")),
				},
			}),
		);
	}
}
