import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DurableContext } from "@aws/durable-execution-sdk-js";
import {
	LocalDurableTestRunner,
	type TestResult,
} from "@aws/durable-execution-sdk-js-testing";
import { PipelineReviewCycleObserver } from "../../../../src/reviewer/adapters/pipeline-review-cycle-observer";
import {
	executeReviewerWorkflow,
	handler,
} from "../../../../src/reviewer/handlers/reviewer";
import type { ReviewExecutionFailure } from "../../../../src/reviewer/ports/review-cycle-observer";
import {
	type ReviewerEvent,
	type ReviewerLogger,
	ReviewerWorkflowFailure,
} from "../../../../src/reviewer/workflows/reviewer-workflow";
import { FakePipelineCoordinationStore } from "../../../pipeline-coordination-fakes";

const request = {
	provider: "codecommit",
	repository: "repo",
	requestId: "7",
} as const;

const reviewerEvent: ReviewerEvent = {
	request,
	generation: 3,
	leaseVersion: 5,
	reviewerArn: "arn:aws:lambda:us-east-1:123456789012:function:reviewer:live",
	snapshot: {
		key: request,
		title: "Test PR",
		status: "open",
		sourceBranch: "refs/heads/feature",
		destinationBranch: "refs/heads/main",
		sourceRevision: "event-revision-a",
		destinationRevision: "destination-revision",
	},
};

function recordingContext(stepNames: string[]): DurableContext {
	return {
		step: async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
			stepNames.push(name);
			return operation();
		},
	} as unknown as DurableContext;
}

const logger: ReviewerLogger = { info: () => {} };
const fixedClock = (): Date => new Date("2026-01-01T00:00:00.000Z");
const terminalFailureName = "ReviewerWorkflowTerminalError";
const terminalFailureMessage = "Reviewer workflow failed";

function failureEnvelope(): ReviewerWorkflowFailure {
	return new ReviewerWorkflowFailure({
		request,
		generation: 3,
		sourceRevision: "authoritative-revision-b",
		cycle: 2,
	});
}

function inspectDurableSurfaces(execution: TestResult<void>): {
	readonly error: ReturnType<TestResult<void>["getError"]>;
	readonly serialized: string;
} {
	const error = execution.getError();
	const invocations = execution.getInvocations();
	const history = execution.getHistoryEvents();
	const operations = execution.getOperations().map((operation) => ({
		name: operation.getName(),
		details:
			operation.isWaitForCallback() || operation.isCallback()
				? operation.getCallbackDetails()
				: operation.getStepDetails(),
		data: operation.getOperationData(),
		events: operation.getEvents(),
	}));
	return {
		error,
		serialized: JSON.stringify({ error, invocations, history, operations }),
	};
}

async function expectSanitizedTerminalFailure(
	operation: Promise<void>,
): Promise<Error> {
	try {
		await operation;
		expect.unreachable("reviewer workflow should fail");
	} catch (failure) {
		expect(failure).toBeInstanceOf(Error);
		if (!(failure instanceof Error)) throw failure;
		expect(failure.name).toBe(terminalFailureName);
		expect(failure.message).toBe(terminalFailureMessage);
		for (const forbiddenField of [
			"cause",
			"event",
			"snapshot",
			"prompt",
			"diff",
			"comment",
			"modelOutput",
		]) {
			expect(Object.hasOwn(failure, forbiddenField)).toBe(false);
		}
		return failure;
	}
}

describe("reviewer", () => {
	beforeAll(async () => {
		await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
	});

	afterAll(async () => {
		await LocalDurableTestRunner.teardownTestEnvironment();
	});

	test("handler is a durable handler function with arity 2", () => {
		expect(typeof handler).toBe("function");
		expect(handler.length).toBe(2);
	});

	test("deployed handler sanitizes composition failures across all durable surfaces", async () => {
		const sensitiveRepository = "SENSITIVE_INVALID_REPOSITORY_ENV_VALUE_7c21";
		const environmentKeys = [
			"STATE_TABLE_NAME",
			"REVIEWER_FUNCTION_ARN",
			"REVIEWER_MODEL_ID",
			"CODEBUILD_REPOSITORIES",
			"CODEBUILD_PROJECT_REPO",
			`CODEBUILD_PROJECT_${sensitiveRepository}`,
		] as const;
		const originalEnvironment = new Map(
			environmentKeys.map((key) => [key, process.env[key]]),
		);
		const cases: ReadonlyArray<{
			readonly environment: Readonly<Record<string, string | undefined>>;
			readonly forbidden: readonly string[];
		}> = [
			{
				environment: {
					STATE_TABLE_NAME: undefined,
					REVIEWER_FUNCTION_ARN:
						"arn:aws:lambda:us-east-1:123456789012:function:reviewer:live",
					REVIEWER_MODEL_ID: "anthropic.claude-sonnet-4-6",
					CODEBUILD_REPOSITORIES: "repo",
					CODEBUILD_PROJECT_REPO: "review-project",
					[`CODEBUILD_PROJECT_${sensitiveRepository}`]: undefined,
				},
				forbidden: [
					"buildReviewerWorkflow: STATE_TABLE_NAME environment variable is required",
					"STATE_TABLE_NAME",
				],
			},
			{
				environment: {
					STATE_TABLE_NAME: "review-state",
					REVIEWER_FUNCTION_ARN:
						"arn:aws:lambda:us-east-1:123456789012:function:reviewer:live",
					REVIEWER_MODEL_ID: "anthropic.claude-sonnet-4-6",
					CODEBUILD_REPOSITORIES: sensitiveRepository,
					CODEBUILD_PROJECT_REPO: undefined,
					[`CODEBUILD_PROJECT_${sensitiveRepository}`]: undefined,
				},
				forbidden: [
					"buildReviewerWorkflow: no CODEBUILD_PROJECT_* environment variables found (set CODEBUILD_REPOSITORIES + CODEBUILD_PROJECT_<SAFE> per repository)",
					"CODEBUILD_REPOSITORIES",
					sensitiveRepository,
				],
			},
		];

		try {
			for (const compositionFailure of cases) {
				for (const [key, value] of Object.entries(
					compositionFailure.environment,
				)) {
					if (value === undefined) delete process.env[key];
					else process.env[key] = value;
				}

				const runner = new LocalDurableTestRunner<void>({
					handlerFunction: handler,
				});
				const execution = await runner.run({ payload: reviewerEvent });
				const surfaces = inspectDurableSurfaces(execution);

				expect(execution.getStatus()).toBe("FAILED");
				expect(surfaces.error.errorType).toBe(terminalFailureName);
				expect(surfaces.error.errorMessage).toBe(terminalFailureMessage);
				expect(surfaces.error.errorData).toBeUndefined();
				expect(surfaces.error.stackTrace).toBeUndefined();
				expect(surfaces.serialized).toContain(terminalFailureName);
				expect(surfaces.serialized).toContain(terminalFailureMessage);
				for (const forbidden of compositionFailure.forbidden) {
					expect(surfaces.serialized).not.toContain(forbidden);
				}
			}
		} finally {
			for (const [key, value] of originalEnvironment) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});

	test("records authoritative execution-failure metadata before throwing a sanitized terminal error", async () => {
		const store = new FakePipelineCoordinationStore();
		const reconcilerInvocations: Array<string | undefined> = [];
		const observer = new PipelineReviewCycleObserver({
			store,
			reconciler: {
				invoke: async (jobId) => reconcilerInvocations.push(jobId),
			},
		});
		const envelope = failureEnvelope();
		const workflow = {
			run: async (): Promise<void> => {
				throw envelope;
			},
		};
		const stepNames: string[] = [];

		await expectSanitizedTerminalFailure(
			executeReviewerWorkflow(
				reviewerEvent,
				recordingContext(stepNames),
				logger,
				{
					workflow,
					cycleObserver: observer,
					clock: fixedClock,
				},
			),
		);

		expect(stepNames).toEqual(["record-cycle-failure"]);
		expect([...store.outcomes.values()]).toEqual([
			{
				request,
				generation: 3,
				sourceRevision: "authoritative-revision-b",
				cycle: 2,
				status: "failed",
				checkStatus: "failed",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		expect(reconcilerInvocations).toEqual([undefined]);
		expect(JSON.stringify(envelope)).toBe(
			JSON.stringify({
				metadata: {
					request,
					generation: 3,
					sourceRevision: "authoritative-revision-b",
					cycle: 2,
				},
			}),
		);
		expect(Object.getOwnPropertyNames(envelope)).toEqual(["metadata"]);
	});

	test("normal cycle recording persists only reviewed or blocked outcomes while execution failures persist failed/failed", async () => {
		const store = new FakePipelineCoordinationStore();
		const observer = new PipelineReviewCycleObserver({
			store,
			reconciler: { invoke: async () => {} },
		});

		await observer.recordCycle({
			request,
			generation: 3,
			sourceRevision: "reviewed-revision",
			cycle: 1,
			reviewStatus: "reviewed",
			checkStatus: "failed",
			occurredAt: "2026-01-01T00:00:00.000Z",
		});
		await observer.recordCycle({
			request,
			generation: 3,
			sourceRevision: "blocked-revision",
			cycle: 2,
			reviewStatus: "blocked",
			checkStatus: "blocked",
			occurredAt: "2026-01-01T00:00:01.000Z",
		});
		await observer.recordExecutionFailure({
			request,
			generation: 3,
			sourceRevision: "failed-revision",
			cycle: 3,
			occurredAt: "2026-01-01T00:00:02.000Z",
		});

		expect([...store.outcomes.values()]).toEqual([
			{
				request,
				generation: 3,
				sourceRevision: "reviewed-revision",
				cycle: 1,
				status: "reviewed",
				checkStatus: "failed",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
			{
				request,
				generation: 3,
				sourceRevision: "blocked-revision",
				cycle: 2,
				status: "blocked",
				checkStatus: "blocked",
				createdAt: "2026-01-01T00:00:01.000Z",
			},
			{
				request,
				generation: 3,
				sourceRevision: "failed-revision",
				cycle: 3,
				status: "failed",
				checkStatus: "failed",
				createdAt: "2026-01-01T00:00:02.000Z",
			},
		]);
	});

	test("execution failure persistence keeps the observer store's immutable first write", async () => {
		const store = new FakePipelineCoordinationStore();
		const observer = new PipelineReviewCycleObserver({
			store,
			reconciler: { invoke: async () => {} },
		});
		await observer.recordCycle({
			request,
			generation: 3,
			sourceRevision: "authoritative-revision-b",
			cycle: 1,
			reviewStatus: "reviewed",
			checkStatus: "completed",
			occurredAt: "2026-01-01T00:00:00.000Z",
		});

		await observer.recordExecutionFailure({
			request,
			generation: 3,
			sourceRevision: "authoritative-revision-b",
			cycle: 2,
			occurredAt: "2026-01-01T00:00:01.000Z",
		});

		expect([...store.outcomes.values()]).toEqual([
			{
				request,
				generation: 3,
				sourceRevision: "authoritative-revision-b",
				cycle: 1,
				status: "reviewed",
				checkStatus: "completed",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		]);
	});

	test("a raw context-unavailable failure records nothing and never falls back to the event snapshot", async () => {
		const rawFailure = new Error("sensitive-load-snapshot-failure");
		const recorded: ReviewExecutionFailure[] = [];
		const stepNames: string[] = [];
		const workflow = {
			run: async (): Promise<void> => {
				throw rawFailure;
			},
		};

		const terminalFailure = await expectSanitizedTerminalFailure(
			executeReviewerWorkflow(
				reviewerEvent,
				recordingContext(stepNames),
				logger,
				{
					workflow,
					cycleObserver: {
						recordCycle: async () => {},
						recordExecutionFailure: async (failure) => recorded.push(failure),
						recordTerminalRequest: async () => {},
					},
					clock: fixedClock,
				},
			),
		);

		expect(terminalFailure).not.toBe(rawFailure);
		expect(terminalFailure.stack).not.toContain(rawFailure.message);

		expect(stepNames).toEqual([]);
		expect(recorded).toEqual([]);
	});

	test("recording failure cannot alter the sanitized terminal error", async () => {
		const original = new Error("sensitive-original-workflow-error");
		Object.assign(original, { sensitivePrompt: "private-prompt" });
		const recordingError = new Error("sensitive-recording-error");
		const logEntries: Array<{
			message: string;
			data?: Record<string, unknown>;
		}> = [];
		const recordingFailureLogger: ReviewerLogger = {
			info: (message, data) => logEntries.push({ message, data }),
		};
		const workflow = {
			run: async (): Promise<void> => {
				throw failureEnvelope();
			},
		};

		const terminalFailure = await expectSanitizedTerminalFailure(
			executeReviewerWorkflow(
				reviewerEvent,
				recordingContext([]),
				recordingFailureLogger,
				{
					workflow,
					cycleObserver: {
						recordCycle: async () => {},
						recordExecutionFailure: async () => {
							throw recordingError;
						},
						recordTerminalRequest: async () => {},
					},
					clock: fixedClock,
				},
			),
		);
		expect(terminalFailure).not.toBe(original);

		expect(logEntries).toEqual([
			{
				message: "failed to record reviewer failure outcome",
				data: {
					request,
					generation: 3,
					sourceRevision: "authoritative-revision-b",
					cycle: 2,
				},
			},
		]);
		const serializedLogs = JSON.stringify(logEntries);
		expect(serializedLogs).not.toContain(original.message);
		expect(serializedLogs).not.toContain(recordingError.message);
		expect(serializedLogs).not.toContain("private-prompt");
		expect(serializedLogs).not.toContain("stack");
		expect(serializedLogs).not.toContain("event-revision-a");
	});

	test("logger failure cannot alter the sanitized terminal error", async () => {
		const original = { sensitive: "exact-original-object" };
		const workflow = {
			run: async (): Promise<void> => {
				throw failureEnvelope();
			},
		};

		const terminalFailure = await expectSanitizedTerminalFailure(
			executeReviewerWorkflow(
				reviewerEvent,
				recordingContext([]),
				{
					info: () => {
						throw new Error("logger-failed");
					},
				},
				{
					workflow,
					cycleObserver: {
						recordCycle: async () => {},
						recordExecutionFailure: async () => {
							throw new Error("observer-failed");
						},
						recordTerminalRequest: async () => {},
					},
					clock: fixedClock,
				},
			),
		);
		expect(terminalFailure).not.toBe(original);
	});
});
