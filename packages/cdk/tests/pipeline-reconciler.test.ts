import { describe, expect, test } from "bun:test";
import {
	GetCommand,
	PutCommand,
	QueryCommand,
	TransactWriteCommand,
	UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { DynamoDbPipelineCoordinationStore } from "../src/reviewer/adapters/dynamodb-pipeline-coordination-store";
import type { DynamoDbDocumentTransport } from "../src/reviewer/adapters/dynamodb-state-store";

class RecordingTransport implements DynamoDbDocumentTransport {
	readonly commands: object[] = [];
	readonly responses: unknown[] = [];
	nextError: unknown | undefined;

	async send(command: object): Promise<unknown> {
		this.commands.push(command);
		if (this.nextError !== undefined) {
			const error = this.nextError;
			this.nextError = undefined;
			throw error;
		}
		return this.responses.shift() ?? {};
	}
}

const conditionalFailure = (): Error =>
	Object.assign(new Error("conditional conflict"), {
		name: "ConditionalCheckFailedException",
	});

const transactionCanceled = (
	cancellationReasons?: readonly Readonly<Record<string, unknown>>[],
): Error =>
	Object.assign(new Error("transaction canceled"), {
		name: "TransactionCanceledException",
		...(cancellationReasons
			? { CancellationReasons: cancellationReasons }
			: {}),
	});

const request = {
	provider: "codecommit",
	repository: "orders",
	requestId: "42",
} as const;
const now = "2026-07-29T12:00:00.000Z";
const job = {
	jobId: "job-1",
	state: "PENDING",
	pipelineExecutionId: "exec-1",
	pipelineName: "pipeline",
	stageName: "Build",
	actionName: "AIReview",
	request,
	generation: 3,
	sourceRevision: "a".repeat(40),
	destinationRevision: "b".repeat(40),
	deadlineAt: "2026-07-29T13:00:00.000Z",
	nextActionAt: now,
} as const;

const createStore = (transport: RecordingTransport) =>
	new DynamoDbPipelineCoordinationStore({
		transport,
		tableName: "state",
		clock: () => new Date(now),
	});

describe("DynamoDbPipelineCoordinationStore", () => {
	test("registers only approved job metadata with actionable and request indexes", async () => {
		const transport = new RecordingTransport();
		const store = createStore(transport);
		await expect(store.registerJob(job)).resolves.toEqual(job);

		const command = transport.commands[0];
		expect(command).toBeInstanceOf(PutCommand);
		if (!(command instanceof PutCommand)) return;
		expect(command.input.ConditionExpression).toBe("attribute_not_exists(pk)");
		expect(command.input.Item).toEqual({
			pk: "PIPELINE_JOB#job-1",
			sk: "META",
			...job,
			gsi1pk: "PIPELINE_JOB_STATE#PENDING",
			gsi1sk: `${now}#job-1`,
			gsi2pk: "REQUEST#codecommit#orders#42#GEN#3",
			gsi2sk: `REVISION#${job.sourceRevision}#JOB#job-1`,
			expiresAt: Math.floor(new Date(now).getTime() / 1_000) + 2_592_000,
		});
	});

	test("returns the existing job when duplicate registration loses its conditional write", async () => {
		const transport = new RecordingTransport();
		transport.nextError = conditionalFailure();
		transport.responses.push({ Item: job });
		const store = createStore(transport);

		await expect(store.registerJob(job)).resolves.toEqual(job);

		expect(transport.commands).toHaveLength(2);
		expect(transport.commands[0]).toBeInstanceOf(PutCommand);
		const get = transport.commands[1];
		expect(get).toBeInstanceOf(GetCommand);
		if (!(get instanceof GetCommand)) return;
		expect(get.input).toMatchObject({
			Key: { pk: "PIPELINE_JOB#job-1", sk: "META" },
			ConsistentRead: true,
		});
	});

	test("conditionally records the authoritative revision with a 30-day TTL and consistently reads the winner", async () => {
		const candidate = {
			request,
			generation: 3,
			sourceRevision: "b".repeat(40),
			observedAt: "2026-07-29T14:00:00+02:00",
			eventId: "revision-b",
		} as const;
		const winner = {
			...candidate,
			sourceRevision: "c".repeat(40),
			observedAt: now,
			eventId: "revision-c",
		};
		const transport = new RecordingTransport();
		transport.nextError = conditionalFailure();
		transport.responses.push({ Item: winner });
		const store = createStore(transport);

		await expect(store.recordAuthoritativeRevision(candidate)).resolves.toEqual(
			winner,
		);

		const put = transport.commands[0];
		const get = transport.commands[1];
		expect(put).toBeInstanceOf(PutCommand);
		expect(get).toBeInstanceOf(GetCommand);
		if (!(put instanceof PutCommand) || !(get instanceof GetCommand)) return;
		const key = {
			pk: "AUTHORITATIVE_REVISION#codecommit#orders#42#GEN#3",
			sk: "META",
		};
		expect(put.input.Item).toEqual({
			...key,
			...candidate,
			observedAt: now,
			expiresAt: Math.floor(new Date(now).getTime() / 1_000) + 2_592_000,
		});
		expect(put.input.ConditionExpression).toBe(
			"attribute_not_exists(pk) OR observedAt < :observedAt",
		);
		expect(put.input.ExpressionAttributeValues).toEqual({
			":observedAt": now,
		});
		expect(get.input).toMatchObject({ Key: key, ConsistentRead: true });
	});

	test("keeps terminal request markers immutable and returns the first write on conflict", async () => {
		const existing = {
			request,
			generation: 3,
			status: "merged",
			occurredAt: now,
		} as const;
		const transport = new RecordingTransport();
		transport.nextError = conditionalFailure();
		transport.responses.push({ Item: existing });
		const store = createStore(transport);

		await expect(
			store.recordTerminalRequestState({
				...existing,
				status: "closed",
			}),
		).resolves.toEqual(existing);

		const put = transport.commands[0];
		const get = transport.commands[1];
		expect(put).toBeInstanceOf(PutCommand);
		expect(get).toBeInstanceOf(GetCommand);
		if (!(put instanceof PutCommand) || !(get instanceof GetCommand)) return;
		const expectedKey = {
			pk: "TERMINAL_REQUEST#codecommit#orders#42#GEN#3",
			sk: "META",
		};
		expect(put.input.Item).toEqual({
			...expectedKey,
			...existing,
			status: "closed",
			expiresAt: Math.floor(new Date(now).getTime() / 1_000) + 2_592_000,
		});
		expect(put.input.ConditionExpression).toBe("attribute_not_exists(pk)");
		expect(get.input).toMatchObject({
			Key: expectedKey,
			ConsistentRead: true,
		});
	});

	test("gets terminal request markers consistently", async () => {
		const marker = {
			request,
			generation: 3,
			status: "closed",
			occurredAt: now,
		} as const;
		const transport = new RecordingTransport();
		transport.responses.push({ Item: marker });
		const store = createStore(transport);

		await expect(store.getTerminalRequestState(request, 3)).resolves.toEqual(
			marker,
		);

		const get = transport.commands[0];
		expect(get).toBeInstanceOf(GetCommand);
		if (!(get instanceof GetCommand)) return;
		expect(get.input).toMatchObject({
			Key: {
				pk: "TERMINAL_REQUEST#codecommit#orders#42#GEN#3",
				sk: "META",
			},
			ConsistentRead: true,
		});
	});

	test("keeps outcomes immutable by request, generation, and revision", async () => {
		const existing = {
			request,
			generation: 3,
			sourceRevision: "a".repeat(40),
			cycle: 1,
			status: "reviewed",
			checkStatus: "completed",
			createdAt: now,
		} as const;
		const transport = new RecordingTransport();
		transport.nextError = conditionalFailure();
		transport.responses.push({ Item: existing });
		const store = createStore(transport);

		await expect(
			store.recordOutcome({
				...existing,
				status: "failed",
				checkStatus: "failed",
			}),
		).resolves.toEqual(existing);

		const put = transport.commands[0];
		const get = transport.commands[1];
		expect(put).toBeInstanceOf(PutCommand);
		expect(get).toBeInstanceOf(GetCommand);
		if (!(put instanceof PutCommand) || !(get instanceof GetCommand)) return;
		const expectedKey = {
			pk: "REVIEW_OUTCOME#codecommit#orders#42#GEN#3",
			sk: `REVISION#${existing.sourceRevision}`,
		};
		expect(put.input.Item).toMatchObject(expectedKey);
		expect(put.input.ConditionExpression).toBe("attribute_not_exists(pk)");
		expect(get.input).toMatchObject({
			Key: expectedKey,
			ConsistentRead: true,
		});
	});

	test("writes callback candidates only onto genuinely pending jobs", async () => {
		const transport = new RecordingTransport();
		const store = createStore(transport);
		const candidate = { status: "failure", category: "Superseded" } as const;

		await store.setCallbackCandidate("job-1", candidate);

		const command = transport.commands[0];
		expect(command).toBeInstanceOf(UpdateCommand);
		if (!(command instanceof UpdateCommand)) return;
		expect(command.input.UpdateExpression).toContain(
			"callbackCandidate = :candidate",
		);
		expect(command.input.ConditionExpression).toBe(
			"#state = :pending AND attribute_not_exists(terminalIntent) AND attribute_not_exists(callbackCandidate)",
		);
		expect(command.input.ExpressionAttributeValues).toMatchObject({
			":pending": "PENDING",
			":candidate": candidate,
		});
	});

	test.each([
		[undefined, "attribute_not_exists(callbackCandidate)"],
		[
			{ status: "failure", category: "Superseded" } as const,
			"callbackCandidate = :callbackCandidate",
		],
	] as const)("atomically claims a fully identified snapshot with candidate %s", async (callbackCandidate, candidateCondition) => {
		const transport = new RecordingTransport();
		const store = createStore(transport);
		const observedJob = { ...job, callbackCandidate };
		const intent =
			callbackCandidate ??
			({ status: "failure", category: "TimedOut" } as const);

		await expect(
			store.claimCompletion({
				observedJob,
				outcomeObservation: { status: "absent" },
				terminalRequestObservation: { status: "absent" },
				authoritativeRevisionObservation: { status: "absent" },
				intent,
				leaseExpiresAt: "2026-07-29T12:02:00.000Z",
				nextActionAt: "2026-07-29T12:02:00.000Z",
			}),
		).resolves.toEqual({
			...observedJob,
			state: "COMPLETING",
			terminalIntent: intent,
			completionLeaseExpiresAt: "2026-07-29T12:02:00.000Z",
			nextActionAt: "2026-07-29T12:02:00.000Z",
		});

		const command = transport.commands[0];
		expect(command).toBeInstanceOf(TransactWriteCommand);
		if (!(command instanceof TransactWriteCommand)) return;
		expect(command.input.TransactItems).toHaveLength(4);
		const [update, outcomeCheck, terminalCheck, markerCheck] =
			command.input.TransactItems ?? [];
		expect(update?.Update?.Key).toEqual({
			pk: "PIPELINE_JOB#job-1",
			sk: "META",
		});
		expect(update?.Update?.ConditionExpression).toContain(
			"#state = :pending AND attribute_not_exists(terminalIntent)",
		);
		expect(update?.Update?.ConditionExpression).toContain(candidateCondition);
		expect(update?.Update?.ExpressionAttributeValues).toMatchObject({
			":pending": "PENDING",
			":completing": "COMPLETING",
			":intent": intent,
			...(callbackCandidate ? { ":callbackCandidate": callbackCandidate } : {}),
		});
		expect(outcomeCheck?.ConditionCheck).toEqual({
			TableName: "state",
			Key: {
				pk: "REVIEW_OUTCOME#codecommit#orders#42#GEN#3",
				sk: `REVISION#${job.sourceRevision}`,
			},
			ConditionExpression: "attribute_not_exists(pk)",
		});
		expect(terminalCheck?.ConditionCheck).toEqual({
			TableName: "state",
			Key: {
				pk: "TERMINAL_REQUEST#codecommit#orders#42#GEN#3",
				sk: "META",
			},
			ConditionExpression: "attribute_not_exists(pk)",
		});
		expect(markerCheck?.ConditionCheck).toEqual({
			TableName: "state",
			Key: {
				pk: "AUTHORITATIVE_REVISION#codecommit#orders#42#GEN#3",
				sk: "META",
			},
			ConditionExpression: "attribute_not_exists(pk)",
		});
	});

	test("checks observed present immutable signals by exact keys", async () => {
		const transport = new RecordingTransport();
		const store = createStore(transport);
		const outcome = {
			request,
			generation: 3,
			sourceRevision: job.sourceRevision,
			status: "reviewed",
			checkStatus: "completed",
		} as const;
		const terminal = {
			request,
			generation: 3,
			status: "closed",
			occurredAt: now,
		} as const;

		await store.claimCompletion({
			observedJob: job,
			outcomeObservation: { status: "present", value: outcome },
			terminalRequestObservation: { status: "present", value: terminal },
			authoritativeRevisionObservation: {
				status: "present",
				value: {
					request,
					generation: 3,
					sourceRevision: job.sourceRevision,
					observedAt: "2026-07-29T12:00:00Z",
					eventId: "revision-event",
				},
			},
			intent: { status: "success", category: "ReviewSucceeded" },
			leaseExpiresAt: "2026-07-29T12:02:00.000Z",
			nextActionAt: "2026-07-29T12:02:00.000Z",
		});

		const command = transport.commands[0];
		expect(command).toBeInstanceOf(TransactWriteCommand);
		if (!(command instanceof TransactWriteCommand)) return;
		for (const item of command.input.TransactItems?.slice(1, 3) ?? []) {
			expect(item.ConditionCheck?.ConditionExpression).toBe(
				"attribute_exists(pk)",
			);
		}
		const markerCheck = command.input.TransactItems?.[3]?.ConditionCheck;
		expect(markerCheck?.ConditionExpression).toBe(
			"sourceRevision = :sourceRevision AND observedAt = :observedAt AND eventId = :eventId",
		);
		expect(markerCheck?.ExpressionAttributeValues).toEqual({
			":sourceRevision": job.sourceRevision,
			":observedAt": now,
			":eventId": "revision-event",
		});
		expect(markerCheck?.ExpressionAttributeValues).not.toHaveProperty(
			":expiresAt",
		);
	});

	test.each([
		[
			"present outcome and absent terminal request",
			true,
			false,
			"attribute_exists(pk)",
			"attribute_not_exists(pk)",
		],
		[
			"absent outcome and present terminal request",
			false,
			true,
			"attribute_not_exists(pk)",
			"attribute_exists(pk)",
		],
	] as const)("builds independent transaction checks for %s", async (_description, outcomePresent, terminalPresent, outcomeCondition, terminalCondition) => {
		const transport = new RecordingTransport();
		const store = createStore(transport);
		const outcome = {
			request,
			generation: 3,
			sourceRevision: job.sourceRevision,
			status: "reviewed",
			checkStatus: "completed",
		} as const;
		const terminal = {
			request,
			generation: 3,
			status: "closed",
			occurredAt: now,
		} as const;

		await store.claimCompletion({
			observedJob: job,
			outcomeObservation: outcomePresent
				? { status: "present", value: outcome }
				: { status: "absent" },
			terminalRequestObservation: terminalPresent
				? { status: "present", value: terminal }
				: { status: "absent" },
			authoritativeRevisionObservation: { status: "absent" },
			intent: { status: "success", category: "ReviewSucceeded" },
			leaseExpiresAt: "2026-07-29T12:02:00.000Z",
			nextActionAt: "2026-07-29T12:02:00.000Z",
		});

		const command = transport.commands[0];
		expect(command).toBeInstanceOf(TransactWriteCommand);
		if (!(command instanceof TransactWriteCommand)) return;
		expect(
			command.input.TransactItems?.[1]?.ConditionCheck?.ConditionExpression,
		).toBe(outcomeCondition);
		expect(
			command.input.TransactItems?.[2]?.ConditionCheck?.ConditionExpression,
		).toBe(terminalCondition);
	});

	test("uses a candidate-CAS update only for explicit unidentified configuration errors", async () => {
		const transport = new RecordingTransport();
		transport.responses.push({
			Attributes: {
				jobId: "bad-job",
				state: "COMPLETING",
				terminalIntent: {
					status: "failure",
					category: "ConfigurationError",
				},
				callbackCandidate: {
					status: "failure",
					category: "ConfigurationError",
				},
				completionLeaseExpiresAt: "2026-07-29T12:02:00.000Z",
				nextActionAt: "2026-07-29T12:02:00.000Z",
			},
		});
		const store = createStore(transport);
		const candidate = {
			status: "failure",
			category: "ConfigurationError",
		} as const;

		await store.claimCompletion({
			observedJob: {
				jobId: "bad-job",
				state: "PENDING",
				callbackCandidate: candidate,
			},
			outcomeObservation: { status: "not-applicable" },
			terminalRequestObservation: { status: "not-applicable" },
			authoritativeRevisionObservation: { status: "not-applicable" },
			intent: candidate,
			leaseExpiresAt: "2026-07-29T12:02:00.000Z",
			nextActionAt: "2026-07-29T12:02:00.000Z",
		});

		const command = transport.commands[0];
		expect(command).toBeInstanceOf(UpdateCommand);
		if (!(command instanceof UpdateCommand)) return;
		expect(command.input.ConditionExpression).toContain(
			"callbackCandidate = :callbackCandidate",
		);
		expect(
			command.input.ExpressionAttributeValues?.[":callbackCandidate"],
		).toEqual(candidate);
	});

	test("rejects partial identity without writing or guessing callback context", async () => {
		const transport = new RecordingTransport();
		const store = createStore(transport);

		await expect(
			store.claimCompletion({
				observedJob: {
					jobId: "partial",
					state: "PENDING",
					request,
					callbackCandidate: {
						status: "failure",
						category: "ConfigurationError",
					},
				},
				outcomeObservation: { status: "not-applicable" },
				terminalRequestObservation: { status: "not-applicable" },
				authoritativeRevisionObservation: { status: "not-applicable" },
				intent: { status: "failure", category: "ConfigurationError" },
				leaseExpiresAt: "2026-07-29T12:02:00.000Z",
				nextActionAt: "2026-07-29T12:02:00.000Z",
			}),
		).rejects.toThrow("partial pipeline job identity");
		expect(transport.commands).toEqual([]);
	});

	test("returns contention only for pure conditional transaction cancellation", async () => {
		const pure = new RecordingTransport();
		pure.nextError = transactionCanceled([
			{ Code: "None" },
			{ Code: "ConditionalCheckFailed" },
			{ Code: "None" },
		]);
		const store = createStore(pure);
		const input = {
			observedJob: job,
			outcomeObservation: { status: "absent" } as const,
			terminalRequestObservation: { status: "absent" } as const,
			authoritativeRevisionObservation: { status: "absent" } as const,
			intent: { status: "failure", category: "TimedOut" } as const,
			leaseExpiresAt: "2026-07-29T12:02:00.000Z",
			nextActionAt: "2026-07-29T12:02:00.000Z",
		};
		await expect(store.claimCompletion(input)).resolves.toBeUndefined();

		for (const error of [
			transactionCanceled(),
			transactionCanceled([{ Code: "None" }, { Code: "None" }]),
			transactionCanceled([
				{ Code: "ConditionalCheckFailed" },
				{ Code: "TransactionConflict" },
			]),
			transactionCanceled([{ Code: "ThrottlingError" }]),
			transactionCanceled([{ Code: "ValidationError" }]),
			transactionCanceled([{ Code: "Unknown" }]),
		]) {
			const transport = new RecordingTransport();
			transport.nextError = error;
			await expect(createStore(transport).claimCompletion(input)).rejects.toBe(
				error,
			);
		}
	});

	test("reclaims only the same immutable completion intent", async () => {
		const transport = new RecordingTransport();
		transport.responses.push({
			Attributes: {
				...job,
				state: "COMPLETING",
				terminalIntent: { status: "failure", category: "TimedOut" },
				completionLeaseExpiresAt: "2026-07-29T12:04:00.000Z",
				nextActionAt: "2026-07-29T12:04:00.000Z",
			},
		});
		const store = createStore(transport);
		const intent = { status: "failure", category: "TimedOut" } as const;

		await store.reclaimCompletion({
			jobId: "job-1",
			intent,
			now: "2026-07-29T12:03:00.000Z",
			leaseExpiresAt: "2026-07-29T12:04:00.000Z",
			nextActionAt: "2026-07-29T12:04:00.000Z",
		});

		const reclaim = transport.commands[0];
		expect(reclaim).toBeInstanceOf(UpdateCommand);
		if (!(reclaim instanceof UpdateCommand)) return;
		expect(reclaim.input.ConditionExpression).toBe(
			"#state = :completing AND terminalIntent = :intent AND completionLeaseExpiresAt <= :now",
		);
		expect(reclaim.input.ExpressionAttributeValues).toMatchObject({
			":completing": "COMPLETING",
			":intent": intent,
			":now": "2026-07-29T12:03:00.000Z",
			":lease": "2026-07-29T12:04:00.000Z",
			":next": "2026-07-29T12:04:00.000Z",
		});
	});

	test("queries due jobs and paginates request-scoped jobs", async () => {
		const cursor = { pk: "PIPELINE_JOB#job-1", sk: "META" };
		const nextJob = {
			...job,
			jobId: "job-2",
			sourceRevision: "c".repeat(40),
		};
		const transport = new RecordingTransport();
		transport.responses.push({ Items: [] });
		transport.responses.push({ Items: [job], LastEvaluatedKey: cursor });
		transport.responses.push({ Items: [nextJob] });
		const store = createStore(transport);

		await store.listDueJobs("PENDING", now);
		const first = await store.listRequestJobs(request, 3);
		const second = await store.listRequestJobs(request, 3, first.cursor);

		expect(first).toEqual({ jobs: [job], cursor });
		expect(second).toEqual({ jobs: [nextJob], cursor: undefined });
		const dueQuery = transport.commands[0];
		const firstQuery = transport.commands[1];
		const secondQuery = transport.commands[2];
		expect(dueQuery).toBeInstanceOf(QueryCommand);
		expect(firstQuery).toBeInstanceOf(QueryCommand);
		expect(secondQuery).toBeInstanceOf(QueryCommand);
		if (
			!(dueQuery instanceof QueryCommand) ||
			!(firstQuery instanceof QueryCommand) ||
			!(secondQuery instanceof QueryCommand)
		)
			return;
		expect(dueQuery.input.IndexName).toBe("GSI1");
		expect(firstQuery.input).toMatchObject({
			IndexName: "GSI2",
			KeyConditionExpression: "gsi2pk = :pk",
			ExpressionAttributeValues: {
				":pk": "REQUEST#codecommit#orders#42#GEN#3",
			},
		});
		expect(firstQuery.input.ExclusiveStartKey).toBeUndefined();
		expect(secondQuery.input.ExclusiveStartKey).toEqual(cursor);
	});

	test("terminal completion removes both indexes", async () => {
		const transport = new RecordingTransport();
		const store = createStore(transport);
		await store.finishCompletion("job-1", {
			status: "success",
			category: "ReviewSucceeded",
		});

		const command = transport.commands[0];
		expect(command).toBeInstanceOf(UpdateCommand);
		if (!(command instanceof UpdateCommand)) return;
		expect(command.input.UpdateExpression).toContain(
			"REMOVE gsi1pk, gsi1sk, gsi2pk, gsi2sk",
		);
		expect(command.input.ExpressionAttributeValues?.[":terminal"]).toBe(
			"SUCCEEDED",
		);
	});
});
