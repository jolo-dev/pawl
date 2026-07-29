import {
	GetCommand,
	PutCommand,
	QueryCommand,
	UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { RequestKey } from "../domain/review-request";
import {
	buildActionableStateIndexKey,
	buildPipelineExecutionKey,
	buildPipelineJobKey,
	buildRequestScopedJobIndexKey,
	buildReviewOutcomeKey,
	type CallbackIntent,
	callbackIntentSchema,
	type JobState,
	type PipelineJobRecord,
	pipelineJobRecordSchema,
	type ReviewOutcome,
	reviewOutcomeSchema,
} from "../pipeline/pipeline-coordination-store";
import type {
	PipelineCoordinationStore,
	PipelineExecutionMapping,
	PipelineJobPage,
} from "../ports/pipeline-coordination-store";
import type { DynamoDbDocumentTransport } from "./dynamodb-state-store";

const ACTIONABLE_INDEX = "GSI1";
const REQUEST_INDEX = "GSI2";
const DEFAULT_TTL_SECONDS = 2_592_000;

type Item = Readonly<Record<string, unknown>>;

const asRecord = (value: unknown): Item | undefined =>
	typeof value === "object" && value !== null ? (value as Item) : undefined;

const asItems = (value: unknown): readonly Item[] => {
	const items = asRecord(value)?.Items;
	return Array.isArray(items)
		? items.filter((item): item is Item => asRecord(item) !== undefined)
		: [];
};

const isConditionalFailure = (error: unknown): boolean =>
	asRecord(error)?.name === "ConditionalCheckFailedException";

const optionalString = (item: Item, key: string): string | undefined =>
	typeof item[key] === "string" ? item[key] : undefined;

const optionalNumber = (item: Item, key: string): number | undefined =>
	typeof item[key] === "number" ? item[key] : undefined;

const jobFromItem = (item: Item): PipelineJobRecord =>
	pipelineJobRecordSchema.parse({
		jobId: item.jobId,
		state: item.state,
		pipelineExecutionId: optionalString(item, "pipelineExecutionId"),
		pipelineName: optionalString(item, "pipelineName"),
		stageName: optionalString(item, "stageName"),
		actionName: optionalString(item, "actionName"),
		request: item.request,
		generation: optionalNumber(item, "generation"),
		sourceRevision: optionalString(item, "sourceRevision"),
		destinationRevision: optionalString(item, "destinationRevision"),
		deadlineAt: optionalString(item, "deadlineAt"),
		nextActionAt: optionalString(item, "nextActionAt"),
		terminalIntent: item.terminalIntent,
		callbackCandidate: item.callbackCandidate,
		completionLeaseExpiresAt: optionalString(item, "completionLeaseExpiresAt"),
	});

const mappingFromItem = (item: Item): PipelineExecutionMapping => ({
	executionId: String(item.executionId),
	pipelineName: String(item.pipelineName),
	request: item.request as RequestKey,
	generation: Number(item.generation),
	sourceRevision: String(item.sourceRevision),
	destinationRevision: String(item.destinationRevision),
	createdAt: String(item.createdAt),
});

const outcomeFromItem = (item: Item): ReviewOutcome =>
	reviewOutcomeSchema.parse({
		request: item.request,
		generation: item.generation,
		sourceRevision: item.sourceRevision,
		cycle: item.cycle,
		status: item.status,
		checkStatus: item.checkStatus,
		summary: item.summary,
		createdAt: item.createdAt,
	});

const terminalState = (
	intent: CallbackIntent,
): Extract<JobState, "SUCCEEDED" | "FAILED"> =>
	intent.status === "success" ? "SUCCEEDED" : "FAILED";

export interface DynamoDbPipelineCoordinationStoreOptions {
	readonly transport: DynamoDbDocumentTransport;
	readonly tableName: string;
	readonly clock?: () => Date;
	readonly ttlSeconds?: number;
}

export class DynamoDbPipelineCoordinationStore
	implements PipelineCoordinationStore
{
	readonly #transport: DynamoDbDocumentTransport;
	readonly #tableName: string;
	readonly #clock: () => Date;
	readonly #ttlSeconds: number;

	constructor(options: DynamoDbPipelineCoordinationStoreOptions) {
		this.#transport = options.transport;
		this.#tableName = options.tableName;
		this.#clock = options.clock ?? (() => new Date());
		this.#ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
	}

	async registerJob(jobInput: PipelineJobRecord): Promise<PipelineJobRecord> {
		const job = pipelineJobRecordSchema.parse(jobInput);
		const key = buildPipelineJobKey(job.jobId);
		const actionable = buildActionableStateIndexKey({
			state: job.state === "COMPLETING" ? "COMPLETING" : "PENDING",
			nextActionAt: job.nextActionAt ?? this.#clock().toISOString(),
			jobId: job.jobId,
		});
		const requestIndex =
			job.request && job.generation !== undefined && job.sourceRevision
				? buildRequestScopedJobIndexKey({
						request: job.request,
						generation: job.generation,
						sourceRevision: job.sourceRevision,
						jobId: job.jobId,
					})
				: undefined;
		try {
			await this.#transport.send(
				new PutCommand({
					TableName: this.#tableName,
					Item: {
						...key,
						...job,
						gsi1pk: actionable.gsiPk,
						gsi1sk: actionable.gsiSk,
						...(requestIndex
							? { gsi2pk: requestIndex.gsiPk, gsi2sk: requestIndex.gsiSk }
							: {}),
						expiresAt:
							Math.floor(this.#clock().getTime() / 1_000) + this.#ttlSeconds,
					},
					ConditionExpression: "attribute_not_exists(pk)",
				}),
			);
			return job;
		} catch (error) {
			if (!isConditionalFailure(error)) throw error;
			const existing = await this.getJob(job.jobId);
			if (existing === undefined) throw error;
			return existing;
		}
	}

	async getJob(jobId: string): Promise<PipelineJobRecord | undefined> {
		const response = await this.#transport.send(
			new GetCommand({
				TableName: this.#tableName,
				Key: buildPipelineJobKey(jobId),
				ConsistentRead: true,
			}),
		);
		const item = asRecord(asRecord(response)?.Item);
		return item ? jobFromItem(item) : undefined;
	}

	async putExecutionMapping(mapping: PipelineExecutionMapping): Promise<void> {
		await this.#transport.send(
			new PutCommand({
				TableName: this.#tableName,
				Item: {
					...buildPipelineExecutionKey(mapping.executionId),
					...mapping,
					expiresAt:
						Math.floor(this.#clock().getTime() / 1_000) + this.#ttlSeconds,
				},
				ConditionExpression:
					"attribute_not_exists(pk) OR (sourceRevision = :sourceRevision AND generation = :generation)",
				ExpressionAttributeValues: {
					":sourceRevision": mapping.sourceRevision,
					":generation": mapping.generation,
				},
			}),
		);
	}

	async getExecutionMapping(
		executionId: string,
	): Promise<PipelineExecutionMapping | undefined> {
		const response = await this.#transport.send(
			new GetCommand({
				TableName: this.#tableName,
				Key: buildPipelineExecutionKey(executionId),
				ConsistentRead: true,
			}),
		);
		const item = asRecord(asRecord(response)?.Item);
		return item ? mappingFromItem(item) : undefined;
	}

	async recordOutcome(outcomeInput: ReviewOutcome): Promise<ReviewOutcome> {
		const outcome = reviewOutcomeSchema.parse(outcomeInput);
		const key = buildReviewOutcomeKey(outcome);
		try {
			await this.#transport.send(
				new PutCommand({
					TableName: this.#tableName,
					Item: {
						...key,
						...outcome,
						expiresAt:
							Math.floor(this.#clock().getTime() / 1_000) + this.#ttlSeconds,
					},
					ConditionExpression: "attribute_not_exists(pk)",
				}),
			);
			return outcome;
		} catch (error) {
			if (!isConditionalFailure(error)) throw error;
			const response = await this.#transport.send(
				new GetCommand({
					TableName: this.#tableName,
					Key: key,
					ConsistentRead: true,
				}),
			);
			const item = asRecord(asRecord(response)?.Item);
			if (item === undefined) throw error;
			return outcomeFromItem(item);
		}
	}

	async getOutcome(job: PipelineJobRecord): Promise<ReviewOutcome | undefined> {
		if (!job.request || job.generation === undefined || !job.sourceRevision) {
			return undefined;
		}
		const response = await this.#transport.send(
			new GetCommand({
				TableName: this.#tableName,
				Key: buildReviewOutcomeKey({
					request: job.request,
					generation: job.generation,
					sourceRevision: job.sourceRevision,
				}),
				ConsistentRead: true,
			}),
		);
		const item = asRecord(asRecord(response)?.Item);
		return item ? outcomeFromItem(item) : undefined;
	}

	async listDueJobs(
		state: Extract<JobState, "PENDING" | "COMPLETING">,
		now: string,
		cursor?: Readonly<Record<string, unknown>>,
	): Promise<PipelineJobPage> {
		const response = await this.#transport.send(
			new QueryCommand({
				TableName: this.#tableName,
				IndexName: ACTIONABLE_INDEX,
				KeyConditionExpression: "gsi1pk = :pk AND gsi1sk <= :now",
				ExpressionAttributeValues: {
					":pk": `PIPELINE_JOB_STATE#${state}`,
					":now": `${now}#\uffff`,
				},
				ExclusiveStartKey: cursor,
			}),
		);
		return {
			jobs: asItems(response).map(jobFromItem),
			cursor: asRecord(response)?.LastEvaluatedKey as
				| Readonly<Record<string, unknown>>
				| undefined,
		};
	}

	async listRequestJobs(
		request: RequestKey,
		generation: number,
		cursor?: Readonly<Record<string, unknown>>,
	): Promise<PipelineJobPage> {
		const index = buildRequestScopedJobIndexKey({
			request,
			generation,
			sourceRevision: "0000000",
			jobId: "prefix",
		});
		const response = await this.#transport.send(
			new QueryCommand({
				TableName: this.#tableName,
				IndexName: REQUEST_INDEX,
				KeyConditionExpression: "gsi2pk = :pk",
				ExpressionAttributeValues: { ":pk": index.gsiPk },
				ExclusiveStartKey: cursor,
			}),
		);
		return {
			jobs: asItems(response).map(jobFromItem),
			cursor: asRecord(response)?.LastEvaluatedKey as
				| Readonly<Record<string, unknown>>
				| undefined,
		};
	}

	async setCallbackCandidate(
		jobId: string,
		candidateInput: CallbackIntent,
	): Promise<void> {
		const candidate = callbackIntentSchema.parse(candidateInput);
		const now = this.#clock().toISOString();
		const actionable = buildActionableStateIndexKey({
			state: "PENDING",
			nextActionAt: now,
			jobId,
		});
		await this.#transport.send(
			new UpdateCommand({
				TableName: this.#tableName,
				Key: buildPipelineJobKey(jobId),
				UpdateExpression:
					"SET callbackCandidate = :candidate, nextActionAt = :now, gsi1sk = :gsi1sk",
				ConditionExpression:
					"#state = :pending AND attribute_not_exists(terminalIntent) AND attribute_not_exists(callbackCandidate)",
				ExpressionAttributeNames: { "#state": "state" },
				ExpressionAttributeValues: {
					":candidate": candidate,
					":now": now,
					":pending": "PENDING",
					":gsi1sk": actionable.gsiSk,
				},
			}),
		);
	}

	async claimCompletion(input: {
		readonly jobId: string;
		readonly intent: CallbackIntent;
		readonly leaseExpiresAt: string;
		readonly nextActionAt: string;
	}): Promise<PipelineJobRecord | undefined> {
		return this.#updateCompleting(input, false);
	}

	async reclaimCompletion(input: {
		readonly jobId: string;
		readonly intent: CallbackIntent;
		readonly now: string;
		readonly leaseExpiresAt: string;
		readonly nextActionAt: string;
	}): Promise<PipelineJobRecord | undefined> {
		return this.#updateCompleting(input, true);
	}

	async #updateCompleting(
		input: {
			readonly jobId: string;
			readonly intent: CallbackIntent;
			readonly now?: string;
			readonly leaseExpiresAt: string;
			readonly nextActionAt: string;
		},
		reclaim: boolean,
	): Promise<PipelineJobRecord | undefined> {
		const intent = callbackIntentSchema.parse(input.intent);
		const actionable = buildActionableStateIndexKey({
			state: "COMPLETING",
			nextActionAt: input.nextActionAt,
			jobId: input.jobId,
		});
		try {
			const response = await this.#transport.send(
				new UpdateCommand({
					TableName: this.#tableName,
					Key: buildPipelineJobKey(input.jobId),
					UpdateExpression:
						"SET #state = :completing, terminalIntent = :intent, completionLeaseExpiresAt = :lease, nextActionAt = :next, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk",
					ConditionExpression: reclaim
						? "#state = :completing AND terminalIntent = :intent AND completionLeaseExpiresAt <= :now"
						: "#state = :pending AND attribute_not_exists(terminalIntent)",
					ExpressionAttributeNames: { "#state": "state" },
					ExpressionAttributeValues: {
						":pending": "PENDING",
						":completing": "COMPLETING",
						":intent": intent,
						":lease": input.leaseExpiresAt,
						":next": input.nextActionAt,
						":gsi1pk": actionable.gsiPk,
						":gsi1sk": actionable.gsiSk,
						...(input.now ? { ":now": input.now } : {}),
					},
					ReturnValues: "ALL_NEW",
				}),
			);
			const attributes = asRecord(asRecord(response)?.Attributes);
			return attributes ? jobFromItem(attributes) : undefined;
		} catch (error) {
			if (isConditionalFailure(error)) return undefined;
			throw error;
		}
	}

	async finishCompletion(
		jobId: string,
		intentInput: CallbackIntent,
	): Promise<void> {
		const intent = callbackIntentSchema.parse(intentInput);
		await this.#transport.send(
			new UpdateCommand({
				TableName: this.#tableName,
				Key: buildPipelineJobKey(jobId),
				UpdateExpression:
					"SET #state = :terminal REMOVE gsi1pk, gsi1sk, gsi2pk, gsi2sk, completionLeaseExpiresAt, nextActionAt",
				ConditionExpression:
					"#state = :completing AND terminalIntent = :intent",
				ExpressionAttributeNames: { "#state": "state" },
				ExpressionAttributeValues: {
					":completing": "COMPLETING",
					":terminal": terminalState(intent),
					":intent": intent,
				},
			}),
		);
	}

	async reschedule(jobId: string, nextActionAt: string): Promise<void> {
		const index = buildActionableStateIndexKey({
			state: "PENDING",
			nextActionAt,
			jobId,
		});
		await this.#transport.send(
			new UpdateCommand({
				TableName: this.#tableName,
				Key: buildPipelineJobKey(jobId),
				UpdateExpression: "SET nextActionAt = :next, gsi1sk = :gsi1sk",
				ConditionExpression: "#state = :pending",
				ExpressionAttributeNames: { "#state": "state" },
				ExpressionAttributeValues: {
					":pending": "PENDING",
					":next": nextActionAt,
					":gsi1sk": index.gsiSk,
				},
			}),
		);
	}
}
