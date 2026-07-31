import { describe, expect, test } from "bun:test";
import type { DurableContext } from "@aws/durable-execution-sdk-js";
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

function failureEnvelope(original: unknown): ReviewerWorkflowFailure {
	return new ReviewerWorkflowFailure(
		{
			request,
			generation: 3,
			sourceRevision: "authoritative-revision-b",
			cycle: 2,
		},
		original,
	);
}

describe("reviewer", () => {
	test("handler is a durable handler function with arity 2", () => {
		expect(typeof handler).toBe("function");
		expect(handler.length).toBe(2);
	});

	test("records authoritative execution-failure metadata and rethrows the exact original value", async () => {
		const store = new FakePipelineCoordinationStore();
		const reconcilerInvocations: Array<string | undefined> = [];
		const observer = new PipelineReviewCycleObserver({
			store,
			reconciler: {
				invoke: async (jobId) => reconcilerInvocations.push(jobId),
			},
		});
		const sensitiveOriginal = {
			message: "sensitive-message",
			stack: "sensitive-stack",
			secretModelOutput: "sensitive-custom-field",
		};
		const envelope = failureEnvelope(sensitiveOriginal);
		const workflow = {
			run: async (): Promise<void> => {
				throw envelope;
			},
		};
		const stepNames: string[] = [];

		await expect(
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
		).rejects.toBe(sensitiveOriginal);

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
		const serializedEnvelope = JSON.stringify(envelope);
		expect(serializedEnvelope).not.toContain(sensitiveOriginal.message);
		expect(serializedEnvelope).not.toContain(sensitiveOriginal.stack);
		expect(serializedEnvelope).not.toContain(
			sensitiveOriginal.secretModelOutput,
		);
		expect(Object.getOwnPropertyNames(envelope)).not.toContain("original");
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

		await expect(
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
		).rejects.toBe(rawFailure);

		expect(stepNames).toEqual([]);
		expect(recorded).toEqual([]);
	});

	test("recording failure is sanitized and cannot replace the exact original value", async () => {
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
				throw failureEnvelope(original);
			},
		};

		await expect(
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
		).rejects.toBe(original);

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

	test("logger failure cannot replace the exact original value", async () => {
		const original = { sensitive: "exact-original-object" };
		const workflow = {
			run: async (): Promise<void> => {
				throw failureEnvelope(original);
			},
		};

		await expect(
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
		).rejects.toBe(original);
	});
});
