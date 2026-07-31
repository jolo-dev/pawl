import { describe, expect, test } from "bun:test";
import {
	GetCommand,
	PutCommand,
	QueryCommand,
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

	test("claims and reclaims only the same immutable completion intent", async () => {
		const transport = new RecordingTransport();
		transport.responses.push({
			Attributes: {
				...job,
				state: "COMPLETING",
				terminalIntent: { status: "failure", category: "TimedOut" },
				completionLeaseExpiresAt: "2026-07-29T12:02:00.000Z",
				nextActionAt: "2026-07-29T12:02:00.000Z",
			},
		});
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

		await store.claimCompletion({
			jobId: "job-1",
			intent,
			leaseExpiresAt: "2026-07-29T12:02:00.000Z",
			nextActionAt: "2026-07-29T12:02:00.000Z",
		});
		await store.reclaimCompletion({
			jobId: "job-1",
			intent,
			now: "2026-07-29T12:03:00.000Z",
			leaseExpiresAt: "2026-07-29T12:04:00.000Z",
			nextActionAt: "2026-07-29T12:04:00.000Z",
		});

		const claim = transport.commands[0];
		const reclaim = transport.commands[1];
		expect(claim).toBeInstanceOf(UpdateCommand);
		expect(reclaim).toBeInstanceOf(UpdateCommand);
		if (
			!(claim instanceof UpdateCommand) ||
			!(reclaim instanceof UpdateCommand)
		)
			return;
		expect(claim.input.UpdateExpression).toContain("#state = :completing");
		expect(claim.input.UpdateExpression).toContain("terminalIntent = :intent");
		expect(claim.input.UpdateExpression).toContain(
			"completionLeaseExpiresAt = :lease",
		);
		expect(claim.input.ConditionExpression).toBe(
			"#state = :pending AND attribute_not_exists(terminalIntent)",
		);
		expect(claim.input.ExpressionAttributeValues).toMatchObject({
			":pending": "PENDING",
			":completing": "COMPLETING",
			":intent": intent,
			":lease": "2026-07-29T12:02:00.000Z",
			":next": "2026-07-29T12:02:00.000Z",
			":gsi1pk": "PIPELINE_JOB_STATE#COMPLETING",
		});
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
