import { describe, expect, test } from "bun:test";
import { PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDbPipelineCoordinationStore } from "../src/reviewer/adapters/dynamodb-pipeline-coordination-store";
import type { DynamoDbDocumentTransport } from "../src/reviewer/adapters/dynamodb-state-store";

class RecordingTransport implements DynamoDbDocumentTransport {
	readonly commands: object[] = [];
	readonly responses: unknown[] = [];
	async send(command: object): Promise<unknown> {
		this.commands.push(command);
		return this.responses.shift() ?? {};
	}
}

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
	test("registers approved job metadata with actionable and request indexes", async () => {
		const transport = new RecordingTransport();
		const store = createStore(transport);
		await expect(store.registerJob(job)).resolves.toEqual(job);

		const command = transport.commands[0];
		expect(command).toBeInstanceOf(PutCommand);
		if (!(command instanceof PutCommand)) return;
		expect(command.input.ConditionExpression).toBe("attribute_not_exists(pk)");
		expect(command.input.Item).toMatchObject({
			pk: "PIPELINE_JOB#job-1",
			sk: "META",
			jobId: "job-1",
			gsi1pk: "PIPELINE_JOB_STATE#PENDING",
			gsi2pk: "REQUEST#codecommit#orders#42#GEN#3",
		});
		expect(JSON.stringify(command.input.Item)).not.toContain(
			"artifactCredentials",
		);
	});

	test("records an immutable generation-scoped outcome", async () => {
		const transport = new RecordingTransport();
		const store = createStore(transport);
		await store.recordOutcome({
			request,
			generation: 3,
			sourceRevision: "a".repeat(40),
			cycle: 1,
			status: "reviewed",
			checkStatus: "completed",
			createdAt: now,
		});

		const command = transport.commands[0];
		expect(command).toBeInstanceOf(PutCommand);
		if (!(command instanceof PutCommand)) return;
		expect(command.input.Item?.pk).toBe(
			"REVIEW_OUTCOME#codecommit#orders#42#GEN#3",
		);
		expect(command.input.ConditionExpression).toBe("attribute_not_exists(pk)");
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
		expect(claim.input.ConditionExpression).toContain(
			"attribute_not_exists(terminalIntent)",
		);
		expect(claim.input.ExpressionAttributeValues?.[":gsi1pk"]).toBe(
			"PIPELINE_JOB_STATE#COMPLETING",
		);
		expect(reclaim.input.ConditionExpression).toContain(
			"terminalIntent = :intent",
		);
		expect(reclaim.input.ConditionExpression).toContain(
			"completionLeaseExpiresAt <= :now",
		);
	});

	test("queries due jobs and request jobs through separate indexes with pagination", async () => {
		const transport = new RecordingTransport();
		transport.responses.push({ Items: [], LastEvaluatedKey: { pk: "next" } });
		transport.responses.push({ Items: [] });
		const store = createStore(transport);

		const due = await store.listDueJobs("PENDING", now);
		await store.listRequestJobs(request, 3, due.cursor);

		const dueCommand = transport.commands[0];
		const requestCommand = transport.commands[1];
		expect(dueCommand).toBeInstanceOf(QueryCommand);
		expect(requestCommand).toBeInstanceOf(QueryCommand);
		if (
			!(dueCommand instanceof QueryCommand) ||
			!(requestCommand instanceof QueryCommand)
		)
			return;
		expect(dueCommand.input.IndexName).toBe("GSI1");
		expect(requestCommand.input.IndexName).toBe("GSI2");
		expect(requestCommand.input.ExclusiveStartKey).toEqual({ pk: "next" });
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
