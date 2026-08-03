import { createHash } from "node:crypto";
import {
	GetCommand,
	QueryCommand,
	TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { FindingFingerprint } from "../domain/finding";
import type { ReviewEvent } from "../domain/review-event";
import type { RequestKey, ReviewCycleSnapshot } from "../domain/review-request";
import type {
	AppendEventResult,
	CallbackGeneration,
	CallbackRegistration,
	CallbackRegistrationResult,
	CallbackWake,
	ClaimedEvents,
	CompletePipelineDispatchIntentResult,
	CompletionReason,
	FailAndRequeueClaimInput,
	FailAndRequeueClaimResult,
	FindingWrite,
	FindingWriteResult,
	HeartbeatInput,
	HeartbeatResult,
	LeaseRecoveryInput,
	LeaseRecoveryResult,
	PersistedFinding,
	PipelineClaimRecoveryInput,
	PipelineClaimRecoveryResult,
	PipelineDispatchIntent,
	PipelineDispatchOwnership,
	ReviewLifecycleState,
	ReviewStateStore,
	WriteReservation,
} from "../ports/state-store";
import { sanitizedPipelineRoutingFailure } from "../ports/state-store";

export interface DynamoDbDocumentTransport {
	send(command: object): Promise<unknown>;
}

export interface StateStoreTtlPolicy {
	readonly metaSeconds: number;
	readonly eventSeconds: number;
	readonly findingSeconds: number;
}

export interface DynamoDbStateStoreOptions {
	readonly transport: DynamoDbDocumentTransport;
	readonly tableName: string;
	readonly clock?: () => Date;
	readonly ttlPolicy?: StateStoreTtlPolicy;
	readonly leaseDurationSeconds?: number;
}

type Item = Readonly<Record<string, unknown>>;

interface GetOutput {
	readonly Item?: Item;
}

interface QueryOutput {
	readonly Items?: readonly Item[];
	readonly LastEvaluatedKey?: Readonly<Record<string, unknown>>;
}

const DEFAULT_TTL: StateStoreTtlPolicy = {
	metaSeconds: 2_592_000,
	eventSeconds: 2_592_000,
	findingSeconds: 7_776_000,
};

export const EVENT_CLAIM_PAGE_LIMIT = 100;
export const EVENT_CLAIM_PAGE_BUDGET = 4;

export class PendingWorkError extends Error {
	readonly code = "PENDING_WORK" as const;

	constructor(message = "pending work prevents state transition") {
		super(message);
		this.name = "PendingWorkError";
	}
}

export class StaleStateError extends Error {
	readonly code = "STATE_CHANGED" as const;

	constructor(message = "review state changed before the transition") {
		super(message);
		this.name = "StaleStateError";
	}
}

type UnclaimedEventsPage = {
	readonly items: Item[];
	readonly continuationSk?: string;
};

const TERMINAL_STATES = new Set<ReviewLifecycleState>([
	"COMPLETED",
	"TIMED_OUT",
	"FAILED",
]);

function asRecord(value: unknown): Item | undefined {
	return typeof value === "object" && value !== null
		? (value as Item)
		: undefined;
}

function stringValue(item: Item, key: string): string | undefined {
	const value = item[key];
	return typeof value === "string" ? value : undefined;
}

function numberValue(item: Item, key: string): number | undefined {
	const value = item[key];
	return typeof value === "number" ? value : undefined;
}

function lifecycleValue(item: Item): ReviewLifecycleState {
	const value = stringValue(item, "lifecycleState");
	if (
		value === "STARTING" ||
		value === "RUNNING" ||
		value === "WAITING" ||
		value === "BLOCKED_LIMIT" ||
		value === "COMPLETED" ||
		value === "TIMED_OUT" ||
		value === "FAILED"
	) {
		return value;
	}
	throw new Error("persisted review state has an invalid lifecycle");
}

function failureOwnershipMatches(
	current: Item | undefined,
	ownership: Extract<CompletionReason, { type: "failed" }>["ownership"],
): boolean {
	if (
		current === undefined ||
		numberValue(current, "leaseVersion") !== ownership.leaseVersion
	) {
		return false;
	}
	if (ownership.kind === "callback") {
		return (
			stringValue(current, "callbackId") === ownership.callbackId &&
			numberValue(current, "callbackGeneration") ===
				ownership.callbackGeneration
		);
	}
	return (
		ownership.lifecycleState === undefined ||
		lifecycleValue(current) === ownership.lifecycleState
	);
}

function isConditionalFailure(error: unknown): boolean {
	const record = asRecord(error);
	if (
		!record ||
		stringValue(record, "name") !== "TransactionCanceledException"
	) {
		return false;
	}
	const reasons = record.CancellationReasons;
	if (!Array.isArray(reasons) || reasons.length === 0) return false;

	let hasConditionalFailure = false;
	for (const reason of reasons) {
		const code = stringValue(asRecord(reason) ?? {}, "Code");
		if (code === "ConditionalCheckFailed") {
			hasConditionalFailure = true;
		} else if (code !== "None") {
			return false;
		}
	}
	return hasConditionalFailure;
}

function canonicalTimestamp(timestamp: string): string {
	return new Date(timestamp).toISOString();
}

function eventWatermark(event: ReviewEvent): string {
	return `${canonicalTimestamp(event.occurredAt)}#${event.id}`;
}

export function encodeStateKeyComponent(component: string): string {
	const digest = createHash("sha256")
		.update(component, "utf8")
		.digest("base64url");
	return `v1~${digest}`;
}

function eventSortKey(event: ReviewEvent): string {
	return `EVENT#${canonicalTimestamp(event.occurredAt)}#${encodeStateKeyComponent(event.id)}`;
}

function transactionClientRequestToken(
	operation: string,
	identity: Readonly<Record<string, unknown>>,
): string {
	return createHash("sha256")
		.update(JSON.stringify({ operation, ...identity }), "utf8")
		.digest("base64url")
		.slice(0, 36);
}

function requeueClientRequestToken(input: FailAndRequeueClaimInput): string {
	return transactionClientRequestToken("pipeline-claim-requeue", {
		request: input.request,
		generation: input.generation,
		leaseVersion: input.leaseVersion,
		events: input.events
			.map((event) => ({
				id: event.id,
				occurredAt: canonicalTimestamp(event.occurredAt),
			}))
			.sort((left, right) =>
				left.occurredAt === right.occurredAt
					? left.id.localeCompare(right.id)
					: left.occurredAt.localeCompare(right.occurredAt),
			),
	});
}

function dispatchCompletionClientRequestToken(
	intent: PipelineDispatchIntent,
): string {
	return transactionClientRequestToken("pipeline-dispatch-complete", {
		request: intent.request,
		generation: intent.generation,
		dispatchIdentity: intent.dispatchIdentity,
	});
}

function decodePipelineDispatchIntent(
	item: Item,
	request: RequestKey,
): PipelineDispatchIntent {
	const generation = numberValue(item, "generation");
	const dispatchIdentity = stringValue(item, "dispatchIdentity");
	const status = stringValue(item, "status");
	const sourceRevision = stringValue(item, "sourceRevision");
	const destinationRevision = stringValue(item, "destinationRevision");
	const observedAt = stringValue(item, "observedAt");
	const eventId = stringValue(item, "eventId");
	const executionId = stringValue(item, "executionId");
	const mappingIdentity = stringValue(item, "mappingIdentity");
	if (
		generation === undefined ||
		dispatchIdentity === undefined ||
		(status !== "PENDING" && status !== "COMPLETED") ||
		sourceRevision === undefined ||
		destinationRevision === undefined ||
		observedAt === undefined ||
		eventId === undefined
	) {
		throw new Error("persisted pipeline dispatch intent is incomplete");
	}
	return {
		request,
		generation,
		dispatchIdentity,
		status,
		sourceRevision,
		destinationRevision,
		observedAt,
		eventId,
		...(executionId === undefined ? {} : { executionId }),
		...(mappingIdentity === undefined ? {} : { mappingIdentity }),
	};
}

function samePipelineDispatchIntent(
	left: PipelineDispatchIntent,
	right: PipelineDispatchIntent,
): boolean {
	return (
		left.generation === right.generation &&
		left.dispatchIdentity === right.dispatchIdentity &&
		left.sourceRevision === right.sourceRevision &&
		left.destinationRevision === right.destinationRevision &&
		left.observedAt === canonicalTimestamp(right.observedAt) &&
		left.eventId === right.eventId &&
		left.executionId === right.executionId &&
		left.mappingIdentity === right.mappingIdentity
	);
}

function decodeEvent(item: Item, request: RequestKey): ReviewEvent {
	const type = stringValue(item, "eventType");
	const id = stringValue(item, "eventId");
	const occurredAt = stringValue(item, "occurredAt");
	if (!id || !occurredAt) throw new Error("persisted event is incomplete");
	const common = { id, request, occurredAt };
	if (type === "request-opened") return { ...common, type };
	if (type === "request-merged") return { ...common, type };
	if (type === "request-closed") return { ...common, type };
	if (type === "revision-updated") {
		const revision = stringValue(item, "revision");
		if (!revision) throw new Error("persisted revision event is incomplete");
		return { ...common, type, revision };
	}
	if (type === "human-comment") {
		const commentId = stringValue(item, "commentId");
		if (!commentId) throw new Error("persisted comment event is incomplete");
		const inReplyTo = stringValue(item, "inReplyTo");
		return {
			...common,
			type,
			commentId,
			...(inReplyTo === undefined ? {} : { inReplyTo }),
		};
	}
	throw new Error("persisted event has an invalid type");
}

export class DynamoDbStateStore implements ReviewStateStore {
	readonly #transport: DynamoDbDocumentTransport;
	readonly #tableName: string;
	readonly #clock: () => Date;
	readonly #ttl: StateStoreTtlPolicy;
	readonly #leaseDurationSeconds: number;

	constructor(options: DynamoDbStateStoreOptions) {
		if (options.tableName.trim().length === 0) {
			throw new RangeError("tableName must not be empty");
		}
		this.#transport = options.transport;
		this.#tableName = options.tableName;
		this.#clock = options.clock ?? (() => new Date());
		this.#ttl = options.ttlPolicy ?? DEFAULT_TTL;
		this.#leaseDurationSeconds = options.leaseDurationSeconds ?? 300;
		for (const [name, value] of Object.entries(this.#ttl)) {
			if (!Number.isInteger(value) || value <= 0) {
				throw new RangeError(`${name} must be a positive integer`);
			}
		}
		if (
			!Number.isInteger(this.#leaseDurationSeconds) ||
			this.#leaseDurationSeconds <= 0
		) {
			throw new RangeError("leaseDurationSeconds must be a positive integer");
		}
	}

	async appendEvent(event: ReviewEvent): Promise<AppendEventResult> {
		const pk = this.#pk(event.request);
		for (let attempt = 0; attempt < 6; attempt += 1) {
			const meta = await this.#get(pk, "META");
			const existingEvent = await this.#get(pk, this.#eventSk(event));
			if (existingEvent) {
				return this.#duplicateResult(
					await this.#get(pk, "META"),
					event.request,
					this.#clock().toISOString(),
				);
			}

			const now = this.#clock().toISOString();
			const eventItem = this.#eventItem(pk, event);
			let generation = 1;
			let leaseVersion = 1;
			let lifecycleState: ReviewLifecycleState = "STARTING";
			let shouldStart = true;
			const transactItems: Record<string, unknown>[] = [
				{
					Put: {
						TableName: this.#tableName,
						Item: eventItem,
						ConditionExpression:
							"attribute_not_exists(pk) AND attribute_not_exists(sk)",
					},
				},
			];

			if (!meta) {
				transactItems.push({
					Put: {
						TableName: this.#tableName,
						Item: {
							pk,
							sk: "META",
							provider: event.request.provider,
							repository: event.request.repository,
							requestId: event.request.requestId,
							lifecycleState,
							generation,
							pendingEventCount: 1,
							leaseHeartbeatAt: now,
							leaseExpiresAt: this.#leaseExpiry(now),
							leaseVersion: 1,
							deadlineAt: new Date(
								Date.parse(now) + this.#ttl.metaSeconds * 1_000,
							).toISOString(),
							expiresAt: this.#ttlAt(this.#ttl.metaSeconds),
						},
						ConditionExpression:
							"attribute_not_exists(pk) AND attribute_not_exists(sk)",
					},
				});
			} else {
				generation = numberValue(meta, "generation") ?? 0;
				leaseVersion = numberValue(meta, "leaseVersion") ?? 0;
				lifecycleState = lifecycleValue(meta);
				shouldStart = false;
				const terminal = TERMINAL_STATES.has(lifecycleState);
				if (terminal) {
					generation += 1;
					leaseVersion += 1;
					lifecycleState = "STARTING";
					shouldStart = true;
				}
				const values: Record<string, unknown> = {
					":generation": numberValue(meta, "generation"),
					":state": lifecycleValue(meta),
					":one": 1,
					":ttl": this.#ttlAt(this.#ttl.metaSeconds),
				};
				let updateExpression =
					"SET expiresAt = :ttl REMOVE claimCursor ADD pendingEventCount :one";
				if (terminal) {
					values[":nextGeneration"] = generation;
					values[":starting"] = "STARTING";
					values[":heartbeat"] = now;
					values[":leaseExpiry"] = this.#leaseExpiry(now);
					updateExpression =
						"SET generation = :nextGeneration, #state = :starting, leaseHeartbeatAt = :heartbeat, leaseExpiresAt = :leaseExpiry, expiresAt = :ttl REMOVE executionArn, executionName, callbackId, callbackGeneration, lastCallbackGeneration, blockedLimit, claimCursor, #cycle, sourceRevision, destinationRevision, configVersion, eventWatermark, cycleStartedAt, completionType, retryExhaustion, lastPipelineRoutingFailure ADD leaseVersion :one, pendingEventCount :one";
				}
				const observedCallbackGeneration = numberValue(
					meta,
					"callbackGeneration",
				);
				let conditionExpression =
					"generation = :generation AND #state = :state AND attribute_not_exists(callbackGeneration)";
				if (observedCallbackGeneration !== undefined) {
					values[":observedCallbackGeneration"] = observedCallbackGeneration;
					conditionExpression =
						"generation = :generation AND #state = :state AND callbackGeneration = :observedCallbackGeneration";
				}
				const observedLeaseVersion = numberValue(meta, "leaseVersion");
				if (observedLeaseVersion === undefined) {
					conditionExpression += " AND attribute_not_exists(leaseVersion)";
				} else {
					values[":observedLeaseVersion"] = observedLeaseVersion;
					conditionExpression += " AND leaseVersion = :observedLeaseVersion";
				}
				transactItems.push({
					Update: {
						TableName: this.#tableName,
						Key: { pk, sk: "META" },
						UpdateExpression: updateExpression,
						ConditionExpression: conditionExpression,
						ExpressionAttributeNames: {
							"#state": "lifecycleState",
							...(terminal ? { "#cycle": "cycle" } : {}),
						},
						ExpressionAttributeValues: values,
					},
				});
			}

			try {
				await this.#send(
					new TransactWriteCommand({ TransactItems: transactItems }),
				);
				const callbackId = meta && stringValue(meta, "callbackId");
				const callbackGeneration =
					meta && numberValue(meta, "callbackGeneration");
				const leaseExpiresAt = meta && stringValue(meta, "leaseExpiresAt");
				return {
					appended: true,
					generation,
					leaseVersion,
					lifecycleState,
					shouldStart,
					recoveryEligible:
						!shouldStart &&
						callbackId === undefined &&
						callbackGeneration === undefined &&
						!TERMINAL_STATES.has(lifecycleState) &&
						leaseExpiresAt !== undefined &&
						leaseExpiresAt <= now,
					callback:
						!shouldStart && callbackId && callbackGeneration !== undefined
							? {
									request: event.request,
									generation,
									callbackId,
									callbackGeneration,
									leaseVersion,
								}
							: undefined,
				};
			} catch (error) {
				if (!isConditionalFailure(error)) throw error;
			}
		}
		throw new Error("append event contention did not converge");
	}

	async claimEvents(
		request: RequestKey,
		generation: number,
	): Promise<ClaimedEvents> {
		const pk = this.#pk(request);
		for (let attempt = 0; attempt < 6; attempt += 1) {
			const meta = await this.#get(pk, "META");
			if (!meta || numberValue(meta, "generation") !== generation) {
				throw new Error("stale generation");
			}
			const observedLifecycle = lifecycleValue(meta);
			const observedPendingCount = numberValue(meta, "pendingEventCount") ?? 0;
			const observedCursor = stringValue(meta, "claimCursor");
			const cursorCondition =
				observedCursor === undefined
					? "attribute_not_exists(claimCursor)"
					: "claimCursor = :observedCursor";
			const cursorValues =
				observedCursor === undefined
					? {}
					: { ":observedCursor": observedCursor };
			if (TERMINAL_STATES.has(observedLifecycle)) {
				throw new Error("cannot claim events from a completed generation");
			}
			const page = await this.#queryUnclaimedEvents(
				pk,
				stringValue(meta, "claimCursor"),
			);
			const items = page.items;
			if (items.length === 0) {
				if (page.continuationSk || observedCursor !== undefined) {
					try {
						await this.#conditionalUpdate({
							request,
							updateExpression: page.continuationSk
								? "SET claimCursor = :cursor"
								: "REMOVE claimCursor",
							conditionExpression: `generation = :generation AND #state = :state AND pendingEventCount = :observedPendingCount AND ${cursorCondition}`,
							names: { "#state": "lifecycleState" },
							values: {
								...(page.continuationSk
									? { ":cursor": page.continuationSk }
									: {}),
								":generation": generation,
								":state": observedLifecycle,
								":observedPendingCount": observedPendingCount,
								...cursorValues,
							},
						});
					} catch (error) {
						if (!isConditionalFailure(error)) throw error;
						continue;
					}
				}
				return { events: [] };
			}
			const newestItem = items.at(-1);
			if (newestItem === undefined) {
				throw new Error("Expected claimed events to include a newest item");
			}
			const newest = stringValue(newestItem, "watermark");
			if (newest === undefined) {
				throw new Error("Expected claimed event to include a watermark");
			}
			const existing = stringValue(meta, "eventWatermark");
			const throughWatermark =
				existing !== undefined && existing > newest ? existing : newest;
			const values = {
				":generation": generation,
				":count": items.length,
				":observedPendingCount": observedPendingCount,
				":negativeCount": -items.length,
				":running": "RUNNING",
				":observedLifecycle": observedLifecycle,
				":watermark": throughWatermark,
				":heartbeat": this.#clock().toISOString(),
				":leaseExpiry": this.#leaseExpiry(this.#clock().toISOString()),
				":ttl": this.#ttlAt(this.#ttl.metaSeconds),
				...(page.continuationSk ? { ":claimCursor": page.continuationSk } : {}),
			};
			const transactItems: Record<string, unknown>[] = [
				{
					Update: {
						TableName: this.#tableName,
						Key: { pk, sk: "META" },
						UpdateExpression: page.continuationSk
							? "SET #state = :running, eventWatermark = :watermark, leaseHeartbeatAt = :heartbeat, leaseExpiresAt = :leaseExpiry, expiresAt = :ttl, claimCursor = :claimCursor REMOVE callbackId, callbackGeneration, blockedLimit ADD pendingEventCount :negativeCount"
							: "SET #state = :running, eventWatermark = :watermark, leaseHeartbeatAt = :heartbeat, leaseExpiresAt = :leaseExpiry, expiresAt = :ttl REMOVE claimCursor, callbackId, callbackGeneration, blockedLimit ADD pendingEventCount :negativeCount",
						ConditionExpression: `generation = :generation AND #state = :observedLifecycle AND pendingEventCount = :observedPendingCount AND pendingEventCount >= :count AND ${cursorCondition}`,
						ExpressionAttributeNames: { "#state": "lifecycleState" },
						ExpressionAttributeValues: { ...values, ...cursorValues },
					},
				},
				...items.map((item) => ({
					Update: {
						TableName: this.#tableName,
						Key: { pk, sk: stringValue(item, "sk") },
						UpdateExpression: "SET claimedGeneration = :generation",
						ConditionExpression: "attribute_not_exists(claimedGeneration)",
						ExpressionAttributeValues: { ":generation": generation },
					},
				})),
			];
			try {
				await this.#send(
					new TransactWriteCommand({ TransactItems: transactItems }),
				);
				return {
					events: items.map((item) => decodeEvent(item, request)),
					throughWatermark,
				};
			} catch (error) {
				if (!isConditionalFailure(error)) throw error;
			}
		}
		throw new Error("event claim contention did not converge");
	}

	async failAndRequeueClaim(
		input: FailAndRequeueClaimInput,
	): Promise<FailAndRequeueClaimResult> {
		if (input.events.length < 1 || input.events.length > 99) {
			throw new RangeError("claimed event requeue must contain 1 to 99 events");
		}
		const failedAt = canonicalTimestamp(input.failedAt);
		const pk = this.#pk(input.request);
		const failure = sanitizedPipelineRoutingFailure(input.failure.attempts);
		const transactItems: Record<string, unknown>[] = [
			{
				Update: {
					TableName: this.#tableName,
					Key: { pk, sk: "META" },
					UpdateExpression:
						"SET #state = :starting, leaseHeartbeatAt = :failedAt, leaseExpiresAt = :failedAt, lastPipelineRoutingFailure = :failure, expiresAt = :ttl REMOVE executionArn, executionName, callbackId, callbackGeneration, lastCallbackGeneration, blockedLimit, claimCursor, completionType, retryExhaustion ADD pendingEventCount :claimedCount, leaseVersion :one",
					ConditionExpression:
						"generation = :generation AND leaseVersion = :leaseVersion AND #state = :running",
					ExpressionAttributeNames: { "#state": "lifecycleState" },
					ExpressionAttributeValues: {
						":generation": input.generation,
						":leaseVersion": input.leaseVersion,
						":running": "RUNNING",
						":starting": "STARTING",
						":failedAt": failedAt,
						":failure": failure,
						":ttl": this.#ttlAt(this.#ttl.metaSeconds),
						":claimedCount": input.events.length,
						":one": 1,
					},
				},
			},
			...input.events.map((event) => ({
				Update: {
					TableName: this.#tableName,
					Key: { pk, sk: this.#eventSk(event) },
					UpdateExpression: "REMOVE claimedGeneration",
					ConditionExpression: "claimedGeneration = :generation",
					ExpressionAttributeValues: { ":generation": input.generation },
				},
			})),
		];
		try {
			await this.#send(
				new TransactWriteCommand({
					ClientRequestToken: requeueClientRequestToken(input),
					TransactItems: transactItems,
				}),
			);
			return { requeued: true, leaseVersion: input.leaseVersion + 1 };
		} catch (error) {
			if (await this.#observedRequeuedClaim(input, failedAt)) {
				return { requeued: true, leaseVersion: input.leaseVersion + 1 };
			}
			if (isConditionalFailure(error)) {
				return { requeued: false, reason: "changed" };
			}
			throw error;
		}
	}

	async recoverOrphanedPipelineClaim(
		input: PipelineClaimRecoveryInput,
	): Promise<PipelineClaimRecoveryResult> {
		const pk = this.#pk(input.request);
		const recoveredAt = canonicalTimestamp(input.recoveredAt);
		const meta = await this.#get(pk, "META");
		if (
			meta === undefined ||
			numberValue(meta, "generation") !== input.generation ||
			numberValue(meta, "leaseVersion") !== input.leaseVersion
		) {
			return { recovered: false, reason: "changed" };
		}
		if ((stringValue(meta, "leaseExpiresAt") ?? "") > recoveredAt) {
			return { recovered: false, reason: "active" };
		}
		if (lifecycleValue(meta) !== "RUNNING") {
			return { recovered: false, reason: "changed" };
		}
		const claimed = await this.#queryClaimedEvents(pk, input.generation);
		if (claimed.length === 0) {
			return { recovered: false, reason: "no-claimed-events" };
		}
		const transactItems: Record<string, unknown>[] = [
			{
				Update: {
					TableName: this.#tableName,
					Key: { pk, sk: "META" },
					UpdateExpression:
						"SET #state = :starting, leaseHeartbeatAt = :recoveredAt, leaseExpiresAt = :recoveredAt, expiresAt = :ttl REMOVE executionArn, executionName, callbackId, callbackGeneration, lastCallbackGeneration, blockedLimit, claimCursor, completionType, retryExhaustion ADD pendingEventCount :claimedCount, leaseVersion :one",
					ConditionExpression:
						"generation = :generation AND leaseVersion = :leaseVersion AND #state = :observedState AND leaseExpiresAt <= :recoveredAt",
					ExpressionAttributeNames: { "#state": "lifecycleState" },
					ExpressionAttributeValues: {
						":generation": input.generation,
						":leaseVersion": input.leaseVersion,
						":observedState": "RUNNING",
						":starting": "STARTING",
						":recoveredAt": recoveredAt,
						":ttl": this.#ttlAt(this.#ttl.metaSeconds),
						":claimedCount": claimed.length,
						":one": 1,
					},
				},
			},
			...claimed.map((item) => ({
				Update: {
					TableName: this.#tableName,
					Key: { pk, sk: stringValue(item, "sk") },
					UpdateExpression: "REMOVE claimedGeneration",
					ConditionExpression: "claimedGeneration = :generation",
					ExpressionAttributeValues: { ":generation": input.generation },
				},
			})),
		];
		try {
			await this.#send(
				new TransactWriteCommand({ TransactItems: transactItems }),
			);
			return {
				recovered: true,
				generation: input.generation,
				leaseVersion: input.leaseVersion + 1,
			};
		} catch (error) {
			if (isConditionalFailure(error)) {
				return { recovered: false, reason: "changed" };
			}
			throw error;
		}
	}

	async getPipelineDispatchIntent(
		request: RequestKey,
		generation: number,
		dispatchIdentity: string,
	): Promise<PipelineDispatchIntent | undefined> {
		const item = await this.#get(
			this.#pk(request),
			this.#pipelineDispatchIntentSk(generation, dispatchIdentity),
		);
		return item === undefined
			? undefined
			: decodePipelineDispatchIntent(item, request);
	}

	async getOrCreatePipelineDispatchIntent(
		intent: PipelineDispatchIntent,
		ownership: PipelineDispatchOwnership,
	): Promise<PipelineDispatchIntent> {
		const existing = await this.getPipelineDispatchIntent(
			intent.request,
			intent.generation,
			intent.dispatchIdentity,
		);
		if (existing !== undefined) return existing;
		const pk = this.#pk(intent.request);
		const canonical: PipelineDispatchIntent = {
			...intent,
			status: "PENDING",
			observedAt: canonicalTimestamp(intent.observedAt),
		};
		const pipelineOnly = ownership.kind === "pipeline-only";
		try {
			await this.#send(
				new TransactWriteCommand({
					TransactItems: [
						{
							ConditionCheck: {
								TableName: this.#tableName,
								Key: { pk, sk: "META" },
								ConditionExpression: pipelineOnly
									? "generation = :generation AND leaseVersion = :leaseVersion AND #state = :running"
									: "generation = :generation",
								...(pipelineOnly
									? { ExpressionAttributeNames: { "#state": "lifecycleState" } }
									: {}),
								ExpressionAttributeValues: {
									":generation": intent.generation,
									...(pipelineOnly
										? {
												":leaseVersion": ownership.leaseVersion,
												":running": "RUNNING",
											}
										: {}),
								},
							},
						},
						{
							Put: {
								TableName: this.#tableName,
								Item: {
									pk,
									sk: this.#pipelineDispatchIntentSk(
										intent.generation,
										intent.dispatchIdentity,
									),
									generation: canonical.generation,
									dispatchIdentity: canonical.dispatchIdentity,
									status: canonical.status,
									sourceRevision: canonical.sourceRevision,
									destinationRevision: canonical.destinationRevision,
									observedAt: canonical.observedAt,
									eventId: canonical.eventId,
									...(canonical.executionId === undefined
										? {}
										: { executionId: canonical.executionId }),
									...(canonical.mappingIdentity === undefined
										? {}
										: { mappingIdentity: canonical.mappingIdentity }),
									provider: intent.request.provider,
									repository: intent.request.repository,
									requestId: intent.request.requestId,
									expiresAt: this.#ttlAt(this.#ttl.eventSeconds),
								},
								ConditionExpression:
									"attribute_not_exists(pk) AND attribute_not_exists(sk)",
							},
						},
					],
				}),
			);
			return canonical;
		} catch (error) {
			const winner = await this.getPipelineDispatchIntent(
				intent.request,
				intent.generation,
				intent.dispatchIdentity,
			).catch(() => undefined);
			if (winner !== undefined) return winner;
			if (isConditionalFailure(error)) throw new StaleStateError();
			throw error;
		}
	}

	async completePipelineDispatchIntent(
		intent: PipelineDispatchIntent,
		ownership: PipelineDispatchOwnership,
	): Promise<CompletePipelineDispatchIntentResult> {
		const pk = this.#pk(intent.request);
		const existing = await this.getPipelineDispatchIntent(
			intent.request,
			intent.generation,
			intent.dispatchIdentity,
		);
		if (existing?.status === "COMPLETED") {
			return samePipelineDispatchIntent(existing, intent)
				? { completed: true }
				: { completed: false, reason: "changed" };
		}
		const pipelineOnly = ownership.kind === "pipeline-only";
		const completionAssignments = [
			"#dispatchStatus = :completed",
			"expiresAt = :ttl",
			...(intent.executionId === undefined
				? []
				: ["executionId = :executionId"]),
			...(intent.mappingIdentity === undefined
				? []
				: ["mappingIdentity = :mappingIdentity"]),
		];
		try {
			await this.#send(
				new TransactWriteCommand({
					ClientRequestToken: dispatchCompletionClientRequestToken(intent),
					TransactItems: [
						{
							ConditionCheck: {
								TableName: this.#tableName,
								Key: { pk, sk: "META" },
								ConditionExpression: pipelineOnly
									? "generation = :generation AND leaseVersion = :leaseVersion AND #state = :running"
									: "generation = :generation",
								...(pipelineOnly
									? { ExpressionAttributeNames: { "#state": "lifecycleState" } }
									: {}),
								ExpressionAttributeValues: {
									":generation": intent.generation,
									...(pipelineOnly
										? {
												":leaseVersion": ownership.leaseVersion,
												":running": "RUNNING",
											}
										: {}),
								},
							},
						},
						{
							Update: {
								TableName: this.#tableName,
								Key: {
									pk,
									sk: this.#pipelineDispatchIntentSk(
										intent.generation,
										intent.dispatchIdentity,
									),
								},
								UpdateExpression: `SET ${completionAssignments.join(", ")}`,
								ConditionExpression:
									"generation = :generation AND dispatchIdentity = :dispatchIdentity AND #dispatchStatus = :pending AND sourceRevision = :sourceRevision AND destinationRevision = :destinationRevision AND observedAt = :observedAt AND eventId = :eventId",
								ExpressionAttributeNames: { "#dispatchStatus": "status" },
								ExpressionAttributeValues: {
									":generation": intent.generation,
									":dispatchIdentity": intent.dispatchIdentity,
									":pending": "PENDING",
									":completed": "COMPLETED",
									":sourceRevision": intent.sourceRevision,
									":destinationRevision": intent.destinationRevision,
									":observedAt": canonicalTimestamp(intent.observedAt),
									":eventId": intent.eventId,
									":ttl": this.#ttlAt(this.#ttl.eventSeconds),
									...(intent.executionId === undefined
										? {}
										: { ":executionId": intent.executionId }),
									...(intent.mappingIdentity === undefined
										? {}
										: { ":mappingIdentity": intent.mappingIdentity }),
								},
							},
						},
					],
				}),
			);
			return { completed: true };
		} catch (error) {
			const completed = await this.getPipelineDispatchIntent(
				intent.request,
				intent.generation,
				intent.dispatchIdentity,
			).catch(() => undefined);
			if (
				completed?.status === "COMPLETED" &&
				samePipelineDispatchIntent(completed, intent)
			) {
				return { completed: true };
			}
			if (isConditionalFailure(error)) {
				return { completed: false, reason: "changed" };
			}
			throw error;
		}
	}

	async recordExecution(
		request: RequestKey,
		generation: number,
		arn: string,
	): Promise<void> {
		const now = this.#clock().toISOString();
		await this.#conditionalUpdate({
			request,
			updateExpression:
				"SET executionArn = :arn, executionName = :name, #state = :running, leaseHeartbeatAt = :heartbeat, leaseExpiresAt = :leaseExpiry, expiresAt = :ttl",
			conditionExpression:
				"generation = :generation AND #state = :starting AND attribute_not_exists(executionArn)",
			values: {
				":generation": generation,
				":starting": "STARTING",
				":running": "RUNNING",
				":arn": arn,
				":name": arn.split(":").at(-1) ?? arn,
				":heartbeat": now,
				":leaseExpiry": this.#leaseExpiry(now),
				":ttl": this.#ttlAt(this.#ttl.metaSeconds),
			},
		});
	}

	async recoverLease(input: LeaseRecoveryInput): Promise<LeaseRecoveryResult> {
		const pk = this.#pk(input.request);
		const recoveredAt = new Date(input.recoveredAt).toISOString();
		const meta = await this.#get(pk, "META");
		if (
			!meta ||
			numberValue(meta, "generation") !== input.generation ||
			numberValue(meta, "leaseVersion") !== input.leaseVersion
		) {
			return this.#changedRecoveryResult(meta);
		}
		if ((numberValue(meta, "pendingEventCount") ?? 0) < 1) {
			return { recovered: false, reason: "no-pending-events" };
		}

		const state = lifecycleValue(meta);
		const terminal = TERMINAL_STATES.has(state);
		if (!terminal) {
			if ((stringValue(meta, "leaseExpiresAt") ?? "") > recoveredAt) {
				return { recovered: false, reason: "active" };
			}
			if (input.remoteStatus === undefined) {
				return { recovered: false, reason: "remote-status-required" };
			}
			if (input.remoteStatus === "RUNNING") {
				return { recovered: false, reason: "active" };
			}
		}

		const isStarting = state === "STARTING";
		if (
			(isStarting &&
				(stringValue(meta, "executionArn") !== undefined ||
					input.remoteStatus !== "NOT_FOUND")) ||
			(!isStarting &&
				!terminal &&
				state !== "RUNNING" &&
				state !== "WAITING" &&
				state !== "BLOCKED_LIMIT")
		) {
			return this.#changedRecoveryResult(meta);
		}
		const nextGeneration = isStarting ? input.generation : input.generation + 1;
		const generationReset = isStarting
			? ""
			: ", #cycle, sourceRevision, destinationRevision, configVersion, eventWatermark, cycleStartedAt, completionType, retryExhaustion, lastPipelineRoutingFailure";
		const expiryCondition = terminal
			? ""
			: " AND leaseExpiresAt <= :recoveredAt";
		try {
			await this.#send(
				new TransactWriteCommand({
					TransactItems: [
						{
							Update: {
								TableName: this.#tableName,
								Key: { pk, sk: "META" },
								UpdateExpression: `SET generation = :nextGeneration, #state = :starting, leaseHeartbeatAt = :recoveredAt, leaseExpiresAt = :leaseExpiry, expiresAt = :ttl REMOVE executionArn, executionName, callbackId, callbackGeneration, lastCallbackGeneration, blockedLimit, claimCursor${generationReset} ADD leaseVersion :one`,
								ConditionExpression: `generation = :generation AND leaseVersion = :leaseVersion AND #state = :observedState${expiryCondition} AND pendingEventCount > :zero`,
								ExpressionAttributeNames: {
									"#state": "lifecycleState",
									...(!isStarting ? { "#cycle": "cycle" } : {}),
								},
								ExpressionAttributeValues: {
									":generation": input.generation,
									":nextGeneration": nextGeneration,
									":leaseVersion": input.leaseVersion,
									":observedState": state,
									":starting": "STARTING",
									":recoveredAt": recoveredAt,
									":leaseExpiry": this.#leaseExpiry(recoveredAt),
									":ttl": this.#ttlAt(this.#ttl.metaSeconds),
									":one": 1,
									":zero": 0,
								},
							},
						},
					],
				}),
			);
			return {
				recovered: true,
				generation: nextGeneration,
				leaseVersion: input.leaseVersion + 1,
				shouldStart: true,
			};
		} catch (error) {
			if (isConditionalFailure(error)) {
				return this.#changedRecoveryResult(await this.#get(pk, "META"));
			}
			throw error;
		}
	}

	async heartbeat(input: HeartbeatInput): Promise<HeartbeatResult> {
		const heartbeatAt = canonicalTimestamp(input.heartbeatAt);
		try {
			await this.#conditionalUpdate({
				request: input.request,
				updateExpression:
					"SET leaseHeartbeatAt = :heartbeat, leaseExpiresAt = :leaseExpiry ADD leaseVersion :one",
				conditionExpression:
					"generation = :generation AND leaseVersion = :leaseVersion AND leaseExpiresAt > :heartbeat AND (attribute_not_exists(leaseHeartbeatAt) OR leaseHeartbeatAt < :heartbeat) AND (#state = :running OR #state = :waiting OR #state = :blocked)",
				names: { "#state": "lifecycleState" },
				values: {
					":generation": input.generation,
					":leaseVersion": input.leaseVersion,
					":heartbeat": heartbeatAt,
					":leaseExpiry": this.#leaseExpiry(heartbeatAt),
					":one": 1,
					":running": "RUNNING",
					":waiting": "WAITING",
					":blocked": "BLOCKED_LIMIT",
				},
			});
			return { renewed: true, leaseVersion: input.leaseVersion + 1 };
		} catch (error) {
			if (isConditionalFailure(error))
				return { renewed: false, reason: "stale" };
			throw error;
		}
	}

	async validateCallback(input: CallbackWake): Promise<boolean> {
		const meta = await this.#get(this.#pk(input.request), "META");
		return (
			meta !== undefined &&
			numberValue(meta, "generation") === input.generation &&
			stringValue(meta, "callbackId") === input.callbackId &&
			numberValue(meta, "callbackGeneration") === input.callbackGeneration &&
			numberValue(meta, "leaseVersion") === input.leaseVersion &&
			["RUNNING", "WAITING", "BLOCKED_LIMIT"].includes(lifecycleValue(meta)) &&
			(stringValue(meta, "leaseExpiresAt") ?? "") > this.#clock().toISOString()
		);
	}

	async registerCallback(
		input: CallbackRegistration,
	): Promise<CallbackRegistrationResult> {
		const registeredAt = canonicalTimestamp(input.registeredAt);
		const pk = this.#pk(input.request);
		// A WAITING/BLOCKED_LIMIT execution is intentionally parked at a callback
		// and may not be woken for days; its lease must match the execution
		// deadline, not the short RUNNING-lease used to detect stuck cycles.
		const parkedLeaseExpiry = new Date(
			Date.parse(registeredAt) + this.#ttl.metaSeconds * 1_000,
		).toISOString();
		const values: Record<string, unknown> = {
			":generation": input.generation,
			":leaseVersion": input.leaseVersion,
			":callbackGeneration": input.callbackGeneration,
			":callbackId": input.callbackId,
			":state": input.lifecycleState,
			":running": "RUNNING",
			":waiting": "WAITING",
			":blocked": "BLOCKED_LIMIT",
			":heartbeat": registeredAt,
			":leaseExpiry": parkedLeaseExpiry,
			":ttl": this.#ttlAt(this.#ttl.metaSeconds),
		};
		let updateExpression =
			"SET callbackId = :callbackId, callbackGeneration = :callbackGeneration, lastCallbackGeneration = :callbackGeneration, #state = :state, leaseHeartbeatAt = :heartbeat, leaseExpiresAt = :leaseExpiry, expiresAt = :ttl REMOVE blockedLimit";
		if (input.lifecycleState === "BLOCKED_LIMIT") {
			values[":blockedLimit"] = input.blockedLimit;
			updateExpression =
				"SET callbackId = :callbackId, callbackGeneration = :callbackGeneration, lastCallbackGeneration = :callbackGeneration, #state = :state, blockedLimit = :blockedLimit, leaseHeartbeatAt = :heartbeat, leaseExpiresAt = :leaseExpiry, expiresAt = :ttl";
		}
		try {
			await this.#send(
				new TransactWriteCommand({
					TransactItems: [
						{
							Update: {
								TableName: this.#tableName,
								Key: { pk, sk: "META" },
								UpdateExpression: updateExpression,
								ConditionExpression:
									"generation = :generation AND leaseVersion = :leaseVersion AND (#state = :running OR #state = :waiting OR #state = :blocked) AND (attribute_not_exists(lastCallbackGeneration) OR lastCallbackGeneration <= :callbackGeneration)",
								ExpressionAttributeNames: { "#state": "lifecycleState" },
								ExpressionAttributeValues: values,
							},
						},
					],
				}),
			);
		} catch (error) {
			if (!isConditionalFailure(error)) throw error;
			const current = await this.#get(pk, "META");
			return !current || numberValue(current, "generation") !== input.generation
				? { registered: false, reason: "stale-generation" }
				: { registered: false, reason: "state-changed" };
		}

		// Deliberately read after the registration transaction: an append that
		// wins this race increments pendingEventCount before the workflow waits.
		const finalMeta = await this.#get(pk, "META");
		return {
			registered: true,
			hasPendingEvents:
				(numberValue(finalMeta ?? {}, "pendingEventCount") ?? 0) > 0,
		};
	}

	async clearCallback(input: CallbackGeneration): Promise<void> {
		await this.#conditionalUpdate({
			request: input.request,
			updateExpression: "REMOVE callbackId, callbackGeneration, blockedLimit",
			conditionExpression:
				"generation = :generation AND callbackGeneration = :callbackGeneration",
			values: {
				":generation": input.generation,
				":callbackGeneration": input.callbackGeneration,
			},
		});
	}

	async beginCycle(snapshot: ReviewCycleSnapshot): Promise<void> {
		await this.#conditionalUpdate({
			request: snapshot.request,
			updateExpression:
				"SET sourceRevision = :source, destinationRevision = :destination, #cycle = :cycle, configVersion = :configVersion, cycleStartedAt = :startedAt, #state = :running, leaseHeartbeatAt = :startedAt, leaseExpiresAt = :leaseExpiry, expiresAt = :ttl",
			conditionExpression:
				"generation = :generation AND (#state = :running OR #state = :waiting) AND (attribute_not_exists(#cycle) OR #cycle < :cycle)",
			names: { "#cycle": "cycle", "#state": "lifecycleState" },
			values: {
				":generation": snapshot.generation,
				":source": snapshot.sourceRevision,
				":destination": snapshot.destinationRevision,
				":cycle": snapshot.cycle,
				":configVersion": snapshot.configVersion,
				":startedAt": snapshot.startedAt,
				":running": "RUNNING",
				":waiting": "WAITING",
				":leaseExpiry": this.#leaseExpiry(snapshot.startedAt),
				":ttl": this.#ttlAt(this.#ttl.metaSeconds),
			},
		});
	}

	async listFindings(request: RequestKey): Promise<PersistedFinding[]> {
		return (await this.#queryPrefix(this.#pk(request), "FINDING#")).map(
			(item) => {
				const finding = item.finding;
				if (!finding || typeof finding !== "object") {
					throw new Error("persisted finding is incomplete");
				}
				return {
					fingerprint: stringValue(item, "fingerprint") as FindingFingerprint,
					category: stringValue(
						item,
						"category",
					) as PersistedFinding["category"],
					path: stringValue(item, "path") ?? "",
					issueIdentity: stringValue(item, "issueIdentity") ?? "",
					finding: finding as PersistedFinding["finding"],
					status: stringValue(item, "status") as PersistedFinding["status"],
					providerCommentId: stringValue(item, "providerCommentId"),
					providerContentHash: stringValue(item, "providerContentHash"),
					revision: stringValue(item, "revision") ?? "unknown",
					updatedAt: stringValue(item, "updatedAt") ?? "",
				};
			},
		);
	}

	async reserveFindingWrite(write: FindingWrite): Promise<WriteReservation> {
		const pk = this.#pk(write.request);
		const sk = this.#findingSk(write.fingerprint);
		const meta = await this.#get(pk, "META");
		if (!meta || numberValue(meta, "generation") !== write.generation) {
			return { reserved: false, reason: "stale-generation" };
		}
		const existing = await this.#get(pk, sk);
		const existingReservationGeneration = numberValue(
			existing ?? {},
			"reservationGeneration",
		);
		const existingReservationId = stringValue(existing ?? {}, "reservationId");
		const existingToken = stringValue(existing ?? {}, "idempotencyToken");
		if (
			existingReservationId &&
			existingReservationGeneration === write.generation
		) {
			return existingToken === write.idempotencyToken
				? { reserved: true, reservationId: existingReservationId }
				: { reserved: false, reason: "already-reserved" };
		}
		const existingStatus = stringValue(existing ?? {}, "status");
		if (
			existing &&
			((write.operation === "post" && existingStatus !== "pending") ||
				(write.operation === "resolve" && existingStatus !== "open"))
		) {
			return {
				reserved: false,
				reason: "already-confirmed",
				existingProviderCommentId: stringValue(existing, "providerCommentId"),
			};
		}
		if (write.operation === "resolve" && !existing) {
			return { reserved: false, reason: "already-confirmed" };
		}

		const reservationId = `${write.generation}:${write.idempotencyToken}`;
		const reservationFields = {
			reservationId,
			reservationGeneration: write.generation,
			reservationOperation: write.operation,
			idempotencyToken: write.idempotencyToken,
			...(write.operation === "resolve"
				? {
						resolution: write.resolution,
						triggeringHumanCommentId: write.triggeringHumanCommentId,
					}
				: {}),
			expiresAt: this.#ttlAt(this.#ttl.findingSeconds),
		};
		const pendingFindingItem =
			write.operation === "post"
				? {
						pk,
						sk,
						fingerprint: write.fingerprint,
						category: write.finding.category,
						path: write.finding.path,
						issueIdentity: write.finding.issueIdentity,
						finding: write.finding,
						status: "pending",
						revision: stringValue(meta, "sourceRevision") ?? "unknown",
						updatedAt: this.#clock().toISOString(),
						...reservationFields,
					}
				: undefined;
		const findingMutation: Record<string, unknown> =
			write.operation === "post"
				? existing
					? {
							Update: {
								TableName: this.#tableName,
								Key: { pk, sk },
								UpdateExpression:
									"SET fingerprint = :fingerprint, category = :category, #path = :path, issueIdentity = :identity, finding = :finding, #status = :pending, revision = :revision, updatedAt = :updatedAt, reservationId = :reservationId, reservationGeneration = :generation, reservationOperation = :operation, idempotencyToken = :token, expiresAt = :ttl",
								ConditionExpression:
									"#status = :pending AND (attribute_not_exists(reservationGeneration) OR reservationGeneration < :generation)",
								ExpressionAttributeNames: {
									"#path": "path",
									"#status": "status",
								},
								ExpressionAttributeValues: {
									":fingerprint": write.fingerprint,
									":category": write.finding.category,
									":path": write.finding.path,
									":identity": write.finding.issueIdentity,
									":finding": write.finding,
									":pending": "pending",
									":revision": stringValue(meta, "sourceRevision") ?? "unknown",
									":updatedAt": this.#clock().toISOString(),
									":reservationId": reservationId,
									":generation": write.generation,
									":operation": write.operation,
									":token": write.idempotencyToken,
									":ttl": this.#ttlAt(this.#ttl.findingSeconds),
								},
							},
						}
					: {
							Put: {
								TableName: this.#tableName,
								Item: pendingFindingItem,
								ConditionExpression:
									"attribute_not_exists(pk) AND attribute_not_exists(sk)",
							},
						}
				: {
						Update: {
							TableName: this.#tableName,
							Key: { pk, sk },
							UpdateExpression:
								"SET reservationId = :reservationId, reservationGeneration = :generation, reservationOperation = :operation, idempotencyToken = :token, resolution = :resolution, triggeringHumanCommentId = :commentId, expiresAt = :ttl",
							ConditionExpression:
								"attribute_exists(pk) AND (attribute_not_exists(reservationId) OR reservationGeneration < :generation) AND #status = :open",
							ExpressionAttributeNames: { "#status": "status" },
							ExpressionAttributeValues: {
								":reservationId": reservationId,
								":generation": write.generation,
								":operation": write.operation,
								":token": write.idempotencyToken,
								":resolution": write.resolution,
								":commentId": write.triggeringHumanCommentId ?? "",
								":ttl": this.#ttlAt(this.#ttl.findingSeconds),
								":open": "open",
							},
						},
					};
		try {
			await this.#send(
				new TransactWriteCommand({
					TransactItems: [
						{
							ConditionCheck: {
								TableName: this.#tableName,
								Key: { pk, sk: "META" },
								ConditionExpression: "generation = :generation",
								ExpressionAttributeValues: { ":generation": write.generation },
							},
						},
						findingMutation,
					],
				}),
			);
			return { reserved: true, reservationId };
		} catch (error) {
			if (!isConditionalFailure(error)) throw error;
			const currentMeta = await this.#get(pk, "META");
			if (numberValue(currentMeta ?? {}, "generation") !== write.generation) {
				return { reserved: false, reason: "stale-generation" };
			}
			const current = await this.#get(pk, sk);
			return stringValue(current ?? {}, "reservationId")
				? { reserved: false, reason: "already-reserved" }
				: {
						reserved: false,
						reason: "already-confirmed",
						existingProviderCommentId: stringValue(
							current ?? {},
							"providerCommentId",
						),
					};
		}
	}

	async confirmFindingWrite(result: FindingWriteResult): Promise<void> {
		const pk = this.#pk(result.request);
		const sk = this.#findingSk(result.fingerprint);
		const finding = await this.#get(pk, sk);
		if (!finding) throw new Error("finding reservation does not exist");
		const operation = stringValue(finding, "reservationOperation");
		const status =
			operation === "resolve"
				? stringValue(finding, "resolution") === "fixed"
					? "resolved"
					: "dismissed"
				: "open";
		await this.#send(
			new TransactWriteCommand({
				TransactItems: [
					{
						ConditionCheck: {
							TableName: this.#tableName,
							Key: { pk, sk: "META" },
							ConditionExpression: "generation = :generation",
							ExpressionAttributeValues: { ":generation": result.generation },
						},
					},
					{
						Update: {
							TableName: this.#tableName,
							Key: { pk, sk },
							UpdateExpression:
								"SET #status = :status, providerCommentId = :commentId, providerContentHash = :contentHash, updatedAt = :completedAt, expiresAt = :ttl REMOVE reservationId, reservationGeneration, reservationOperation, idempotencyToken, resolution, triggeringHumanCommentId",
							ConditionExpression:
								"reservationId = :reservationId AND reservationGeneration = :generation",
							ExpressionAttributeNames: { "#status": "status" },
							ExpressionAttributeValues: {
								":status": status,
								":commentId": result.providerCommentId,
								":contentHash": result.providerContentHash,
								":completedAt": result.completedAt,
								":ttl": this.#ttlAt(this.#ttl.findingSeconds),
								":reservationId": result.reservationId,
								":generation": result.generation,
							},
						},
					},
				],
			}),
		);
	}

	async complete(
		request: RequestKey,
		generation: number,
		reason: CompletionReason,
	): Promise<void> {
		const state: ReviewLifecycleState =
			reason.type === "timed-out"
				? "TIMED_OUT"
				: reason.type === "failed"
					? "FAILED"
					: "COMPLETED";
		const values: Record<string, unknown> = {
			":generation": generation,
			":state": state,
			":completionType": reason.type,
			":ttl": this.#ttlAt(this.#ttl.metaSeconds),
			":running": "RUNNING",
			":waiting": "WAITING",
			":blocked": "BLOCKED_LIMIT",
			":starting": "STARTING",
		};
		let updateExpression =
			"SET #state = :state, completionType = :completionType, expiresAt = :ttl REMOVE executionArn, executionName, callbackId, callbackGeneration, blockedLimit, lastPipelineRoutingFailure";
		const pendingCondition =
			reason.type === "failed" ? "" : " AND pendingEventCount = :zero";
		if (pendingCondition !== "") values[":zero"] = 0;
		let stateCondition =
			reason.type === "failed"
				? "(#currentState = :running OR #currentState = :waiting OR #currentState = :blocked OR #currentState = :starting)"
				: "(#currentState = :running OR #currentState = :waiting OR #currentState = :blocked)";
		let ownershipCondition = "";
		if (reason.type === "failed") {
			values[":retryFailure"] = reason.failure;
			values[":leaseVersion"] = reason.ownership.leaseVersion;
			ownershipCondition = " AND leaseVersion = :leaseVersion";
			if (reason.ownership.kind === "callback") {
				values[":callbackId"] = reason.ownership.callbackId;
				values[":callbackGeneration"] = reason.ownership.callbackGeneration;
				ownershipCondition +=
					" AND callbackId = :callbackId AND callbackGeneration = :callbackGeneration";
			} else if (reason.ownership.lifecycleState !== undefined) {
				values[":ownedState"] = reason.ownership.lifecycleState;
				stateCondition = "#currentState = :ownedState";
			}
			updateExpression =
				"SET #state = :state, completionType = :completionType, retryExhaustion = :retryFailure, expiresAt = :ttl REMOVE executionArn, executionName, callbackId, callbackGeneration, blockedLimit, lastPipelineRoutingFailure";
		}
		try {
			await this.#conditionalUpdate({
				request,
				updateExpression,
				conditionExpression: `generation = :generation${pendingCondition} AND ${stateCondition}${ownershipCondition}`,
				names: { "#currentState": "lifecycleState" },
				values,
			});
		} catch (error) {
			if (!isConditionalFailure(error)) throw error;
			const current = await this.#get(this.#pk(request), "META");
			const currentState = current && lifecycleValue(current);
			const generationMatches =
				current !== undefined &&
				numberValue(current, "generation") === generation;
			const stateMatches =
				currentState !== undefined &&
				(reason.type === "failed"
					? ["RUNNING", "WAITING", "BLOCKED_LIMIT", "STARTING"].includes(
							currentState,
						)
					: ["RUNNING", "WAITING", "BLOCKED_LIMIT"].includes(currentState));
			if (
				reason.type === "failed" &&
				(!generationMatches ||
					!stateMatches ||
					!failureOwnershipMatches(current, reason.ownership))
			) {
				throw new StaleStateError();
			}
			if (
				generationMatches &&
				stateMatches &&
				(numberValue(current, "pendingEventCount") ?? 0) > 0
			) {
				throw new PendingWorkError();
			}
			throw new StaleStateError();
		}
	}

	async #conditionalUpdate(input: {
		readonly request: RequestKey;
		readonly updateExpression: string;
		readonly conditionExpression: string;
		readonly names?: Readonly<Record<string, string>>;
		readonly values: Readonly<Record<string, unknown>>;
	}): Promise<void> {
		const names = {
			...input.names,
			...(input.updateExpression.includes("#state") ||
			input.conditionExpression.includes("#state")
				? { "#state": "lifecycleState" }
				: {}),
		};
		await this.#send(
			new TransactWriteCommand({
				TransactItems: [
					{
						Update: {
							TableName: this.#tableName,
							Key: { pk: this.#pk(input.request), sk: "META" },
							UpdateExpression: input.updateExpression,
							ConditionExpression: input.conditionExpression,
							...(Object.keys(names).length > 0
								? { ExpressionAttributeNames: names }
								: {}),
							ExpressionAttributeValues: input.values,
						},
					},
				],
			}),
		);
	}

	async #observedRequeuedClaim(
		input: FailAndRequeueClaimInput,
		failedAt: string,
	): Promise<boolean> {
		try {
			const pk = this.#pk(input.request);
			const meta = await this.#get(pk, "META");
			if (
				meta === undefined ||
				numberValue(meta, "generation") !== input.generation ||
				numberValue(meta, "leaseVersion") !== input.leaseVersion + 1 ||
				lifecycleValue(meta) !== "STARTING" ||
				(stringValue(meta, "leaseExpiresAt") ?? "") > failedAt ||
				(numberValue(meta, "pendingEventCount") ?? 0) < input.events.length
			) {
				return false;
			}
			const events = await Promise.all(
				input.events.map((event) => this.#get(pk, this.#eventSk(event))),
			);
			return events.every(
				(item) =>
					item !== undefined &&
					numberValue(item, "claimedGeneration") === undefined,
			);
		} catch {
			return false;
		}
	}

	async #get(pk: string, sk: string): Promise<Item | undefined> {
		const output = await this.#send<GetOutput>(
			new GetCommand({
				TableName: this.#tableName,
				Key: { pk, sk },
				ConsistentRead: true,
			}),
		);
		return output.Item;
	}

	async #queryClaimedEvents(pk: string, generation: number): Promise<Item[]> {
		const items: Item[] = [];
		let exclusiveStartKey: Readonly<Record<string, unknown>> | undefined;
		do {
			const output = await this.#send<QueryOutput>(
				new QueryCommand({
					TableName: this.#tableName,
					KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
					FilterExpression: "claimedGeneration = :generation",
					ExpressionAttributeValues: {
						":pk": pk,
						":prefix": "EVENT#",
						":generation": generation,
					},
					ConsistentRead: true,
					ScanIndexForward: false,
					Limit: EVENT_CLAIM_PAGE_LIMIT,
					ExclusiveStartKey: exclusiveStartKey,
				}),
			);
			for (const item of output.Items ?? []) {
				if (numberValue(item, "claimedGeneration") === generation) {
					items.push(item);
					if (items.length === 99) return items;
				}
			}
			exclusiveStartKey = output.LastEvaluatedKey;
		} while (exclusiveStartKey !== undefined);
		return items;
	}

	async #queryUnclaimedEvents(
		pk: string,
		cursorSk?: string,
	): Promise<UnclaimedEventsPage> {
		const items: Item[] = [];
		let exclusiveStartKey: Readonly<Record<string, unknown>> | undefined =
			cursorSk ? { pk, sk: cursorSk } : undefined;
		for (let page = 0; page < EVENT_CLAIM_PAGE_BUDGET; page += 1) {
			const output = await this.#send<QueryOutput>(
				new QueryCommand({
					TableName: this.#tableName,
					KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
					ExpressionAttributeValues: { ":pk": pk, ":prefix": "EVENT#" },
					ConsistentRead: true,
					Limit: EVENT_CLAIM_PAGE_LIMIT,
					ExclusiveStartKey: exclusiveStartKey,
				}),
			);
			for (const item of output.Items ?? []) {
				if (numberValue(item, "claimedGeneration") === undefined) {
					items.push(item);
					if (items.length === 99) {
						const scannedBoundarySk = stringValue(item, "sk");
						return {
							items: this.#sortEvents(items),
							continuationSk: output.LastEvaluatedKey
								? scannedBoundarySk
								: undefined,
						};
					}
				}
			}
			exclusiveStartKey = output.LastEvaluatedKey;
			if (!exclusiveStartKey) return { items: this.#sortEvents(items) };
		}
		return {
			items: this.#sortEvents(items),
			continuationSk: exclusiveStartKey
				? stringValue(exclusiveStartKey, "sk")
				: undefined,
		};
	}

	#sortEvents(items: Item[]): Item[] {
		return items.sort((left, right) => {
			const instant = (stringValue(left, "occurredAt") ?? "").localeCompare(
				stringValue(right, "occurredAt") ?? "",
			);
			return instant === 0
				? (stringValue(left, "eventId") ?? "").localeCompare(
						stringValue(right, "eventId") ?? "",
					)
				: instant;
		});
	}

	async #queryPrefix(pk: string, prefix: string): Promise<Item[]> {
		const items: Item[] = [];
		let exclusiveStartKey: Readonly<Record<string, unknown>> | undefined;
		do {
			const output = await this.#send<QueryOutput>(
				new QueryCommand({
					TableName: this.#tableName,
					KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
					ExpressionAttributeValues: { ":pk": pk, ":prefix": prefix },
					ConsistentRead: true,
					ExclusiveStartKey: exclusiveStartKey,
				}),
			);
			items.push(...(output.Items ?? []));
			exclusiveStartKey = output.LastEvaluatedKey;
		} while (exclusiveStartKey);
		return items;
	}

	async #send<T = unknown>(command: object): Promise<T> {
		return (await this.#transport.send(command)) as T;
	}

	#changedRecoveryResult(meta: Item | undefined): LeaseRecoveryResult {
		const generation = meta && numberValue(meta, "generation");
		const leaseVersion = meta && numberValue(meta, "leaseVersion");
		return {
			recovered: false,
			reason: "changed",
			...(generation === undefined ? {} : { generation }),
			...(leaseVersion === undefined ? {} : { leaseVersion }),
		};
	}

	#duplicateResult(
		meta: Item | undefined,
		request: RequestKey,
		appendAt: string,
	): AppendEventResult {
		if (!meta) throw new Error("event exists without request metadata");
		const callbackGeneration = numberValue(meta, "callbackGeneration");
		const callbackId = stringValue(meta, "callbackId");
		const generation = numberValue(meta, "generation") ?? 0;
		const leaseExpiresAt = stringValue(meta, "leaseExpiresAt");
		const lifecycleState = lifecycleValue(meta);
		const pending = (numberValue(meta, "pendingEventCount") ?? 0) > 0;
		return {
			appended: false,
			generation,
			leaseVersion: numberValue(meta, "leaseVersion") ?? 0,
			lifecycleState,
			shouldStart: false,
			recoveryEligible:
				pending &&
				(TERMINAL_STATES.has(lifecycleState) ||
					(callbackId === undefined &&
						callbackGeneration === undefined &&
						leaseExpiresAt !== undefined &&
						leaseExpiresAt <= appendAt)),
			callback:
				callbackId && callbackGeneration !== undefined
					? {
							request,
							generation,
							callbackId,
							callbackGeneration,
							leaseVersion: numberValue(meta, "leaseVersion") ?? 0,
						}
					: undefined,
		};
	}

	#pk(request: RequestKey): string {
		return `REQUEST#${encodeStateKeyComponent(request.provider)}#${encodeStateKeyComponent(request.repository)}#${encodeStateKeyComponent(request.requestId)}`;
	}

	#eventSk(event: ReviewEvent): string {
		return eventSortKey(event);
	}

	#findingSk(fingerprint: FindingFingerprint): string {
		return `FINDING#${fingerprint}`;
	}

	#pipelineDispatchIntentSk(
		generation: number,
		dispatchIdentity: string,
	): string {
		return `PIPELINE_DISPATCH_INTENT#${generation}#${encodeStateKeyComponent(dispatchIdentity)}`;
	}

	#eventItem(pk: string, event: ReviewEvent): Record<string, unknown> {
		return {
			pk,
			sk: this.#eventSk(event),
			eventType: event.type,
			eventId: event.id,
			occurredAt: canonicalTimestamp(event.occurredAt),
			watermark: eventWatermark(event),
			...(event.type === "revision-updated"
				? { revision: event.revision }
				: event.type === "human-comment"
					? {
							commentId: event.commentId,
							...(event.inReplyTo === undefined
								? {}
								: { inReplyTo: event.inReplyTo }),
						}
					: {}),
			expiresAt: this.#ttlAt(this.#ttl.eventSeconds),
		};
	}

	#ttlAt(seconds: number): number {
		return Math.floor(this.#clock().getTime() / 1_000) + seconds;
	}

	#leaseExpiry(from: string): string {
		return new Date(
			Date.parse(from) + this.#leaseDurationSeconds * 1_000,
		).toISOString();
	}
}
