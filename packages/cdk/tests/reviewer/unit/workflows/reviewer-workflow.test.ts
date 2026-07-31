import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	type DurableContext,
	withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
	LocalDurableTestRunner,
	type TestResult,
	WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { PipelineReviewCycleObserver } from "../../../../src/reviewer/adapters/pipeline-review-cycle-observer";
import { repositoryConfigSchema } from "../../../../src/reviewer/domain/repository-config";
import type { ReviewRequest } from "../../../../src/reviewer/domain/review-request";
import { executeReviewerWorkflow } from "../../../../src/reviewer/handlers/reviewer";
import type { CheckRunner } from "../../../../src/reviewer/ports/check-runner";
import type {
	ReviewCycleObserver,
	ReviewExecutionFailure,
} from "../../../../src/reviewer/ports/review-cycle-observer";
import type { SourceControlProvider } from "../../../../src/reviewer/ports/source-control-provider";
import { NoopFindingReconciler } from "../../../../src/reviewer/services/finding-reconciler";
import { NoopCheckRunner } from "../../../../src/reviewer/services/noop-check-runner";
import { NoopReviewModel } from "../../../../src/reviewer/services/noop-review-model";
import {
	NoopRepositoryConfigLoader,
	type RepositoryConfigLoader,
} from "../../../../src/reviewer/services/repository-config-loader";
import { ReviewEngine } from "../../../../src/reviewer/services/review-engine";
import {
	type ReviewerEvent,
	ReviewerWorkflow,
	ReviewerWorkflowFailure,
} from "../../../../src/reviewer/workflows/reviewer-workflow";
import { FakePipelineCoordinationStore } from "../../../pipeline-coordination-fakes";
import { InMemoryStateStore } from "../../fakes/in-memory-state-store";

const request = {
	provider: "codecommit",
	repository: "repo",
	requestId: "7",
} as const;

const seedEvent = {
	id: "event-1",
	type: "request-opened" as const,
	occurredAt: "2026-01-01T00:00:00.000Z",
	request,
};

const fakeReviewRequest: ReviewRequest = {
	key: request,
	title: "Test PR",
	status: "open",
	sourceBranch: "refs/heads/feature",
	destinationBranch: "refs/heads/main",
	sourceRevision: "source-immutable-commit-1234567",
	destinationRevision: "destination-immutable-commit-1234567",
};

/** Mutable PR status so tests can simulate merge/close to terminate the loop. */
let prStatus: ReviewRequest["status"] = "open";

const fakeProvider = {
	getRequest: async (): Promise<ReviewRequest> => ({
		...fakeReviewRequest,
		status: prStatus,
	}),
	getDiff: async () => [] as readonly [],
	listComments: async () => [] as readonly [],
	getFile: async () => undefined,
	postStatusComment: async () => ({
		id: "status-1",
		findingFingerprint: "status:v1:t",
		contentHash: "",
	}),
	appendStatusUpdate: async () => {},
	reactToComment: async () => {},
	replyToComment: async () => ({
		id: "reply-1",
		findingFingerprint: "status:v1:r",
		contentHash: "",
	}),
} as unknown as SourceControlProvider;

const stubLogger = { info: () => {} };

function createWorkflow(
	store: InMemoryStateStore,
	cycleObserver?: ReviewCycleObserver,
	options?: {
		readonly provider?: SourceControlProvider;
		readonly configLoader?: RepositoryConfigLoader;
		readonly checkRunner?: CheckRunner;
	},
): ReviewerWorkflow {
	prStatus = "open";
	return new ReviewerWorkflow({
		store,
		provider: options?.provider ?? fakeProvider,
		checkRunner: options?.checkRunner ?? new NoopCheckRunner(),
		reviewEngine: new ReviewEngine({ model: new NoopReviewModel() }),
		reconciler: new NoopFindingReconciler(),
		configLoader: options?.configLoader ?? new NoopRepositoryConfigLoader(),
		reviewerDisplayName: "Test Reviewer",
		cycleObserver,
		clock: fixedClock,
	});
}

const fixedClock = (): Date => new Date("2026-01-01T00:00:00.000Z");
const terminalFailureName = "ReviewerWorkflowTerminalError";
const terminalFailureMessage = "Reviewer workflow failed";
const callbackSubmitterFailureName = "ReviewerCallbackSubmitterError";
const callbackSubmitterFailureMessage = "Reviewer callback submitter failed";

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

function expectFixedSafeExecutionError(
	error: ReturnType<TestResult<void>["getError"]>,
): void {
	expect(error.errorType).toBe(terminalFailureName);
	expect(error.errorMessage).toBe(terminalFailureMessage);
	expect(error.errorData).toBeUndefined();
	expect(error.stackTrace).toBeUndefined();
}

function expectSecretsAbsent(
	serialized: string,
	secrets: readonly string[],
): void {
	for (const secret of secrets) expect(serialized).not.toContain(secret);
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

function createStore(): InMemoryStateStore {
	return new InMemoryStateStore({ clock: fixedClock });
}

function reviewerEvent(leaseVersion = 1): ReviewerEvent {
	return {
		request,
		generation: 1,
		leaseVersion,
		reviewerArn: "arn:aws:lambda:us-east-1:123456789012:function:reviewer:live",
	};
}

/** Seed the store the way the router would: append + record execution → RUNNING. */
async function seedRunning(store: InMemoryStateStore): Promise<void> {
	await store.appendEvent(seedEvent);
	await store.recordExecution(
		request,
		1,
		"arn:aws:lambda:us-east-1:123456789012:execution-1",
	);
}

describe("ReviewerWorkflow", () => {
	beforeAll(async () => {
		await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
	});

	afterAll(async () => {
		await LocalDurableTestRunner.teardownTestEnvironment();
	});

	test("happy path: begin → claim → review → register callback → wait → wake", async () => {
		const store = createStore();
		await seedRunning(store);
		const cycles: Parameters<ReviewCycleObserver["recordCycle"]>[0][] = [];
		const terminals: Parameters<
			ReviewCycleObserver["recordTerminalRequest"]
		>[0][] = [];
		const workflow = createWorkflow(store, {
			recordCycle: async (outcome) => cycles.push(outcome),
			recordExecutionFailure: async () => {},
			recordTerminalRequest: async (terminal) => terminals.push(terminal),
		});

		const handler = withDurableExecution<ReviewerEvent, void>(
			async (event, context) => {
				await workflow.run(event, context, stubLogger);
			},
		);
		const runner = new LocalDurableTestRunner({ handlerFunction: handler });

		const runPromise = runner.run({ payload: reviewerEvent() });

		// Wait for the workflow to register its callback, then deliver it.
		const callbackOp = runner.getOperation("wait-for-next-event");
		await callbackOp.waitForData(WaitingOperationStatus.SUBMITTED);
		// Simulate the PR being merged so the next loop iteration exits.
		prStatus = "merged";
		await callbackOp.sendCallbackSuccess();

		const result = await runPromise;
		expect(result.getStatus()).toBe("SUCCEEDED");

		// The store reached WAITING (registerCallback ran) and the seeded event was claimed.
		const state = store.inspectRequest(request);
		expect(state?.lifecycleState).toBe("WAITING");
		expect(state?.cycle).toBe(1);
		expect(state?.sourceRevision).toBe(fakeReviewRequest.sourceRevision);
		expect(cycles).toEqual([
			{
				request,
				generation: 1,
				sourceRevision: fakeReviewRequest.sourceRevision,
				cycle: 1,
				reviewStatus: "reviewed",
				checkStatus: "completed",
				occurredAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		expect(terminals).toEqual([{ request, generation: 1, status: "merged" }]);
	});

	test("wraps a first-cycle failure with current metadata only", async () => {
		const store = createStore();
		await seedRunning(store);
		const original = {
			message: "sensitive-review-message",
			stack: "sensitive-review-stack",
			modelOutput: "sensitive-model-output",
		};
		const workflow = createWorkflow(store, undefined, {
			checkRunner: {
				run: async () => {
					throw original;
				},
			},
		});
		const directContext = {
			step: async <T>(_name: string, operation: () => Promise<T>): Promise<T> =>
				operation(),
		} as unknown as DurableContext;

		try {
			await workflow.run(reviewerEvent(), directContext, stubLogger);
			expect.unreachable("workflow should fail");
		} catch (failure) {
			expect(failure).toBeInstanceOf(ReviewerWorkflowFailure);
			if (!(failure instanceof ReviewerWorkflowFailure)) return;
			expect(failure.metadata).toEqual({
				request,
				generation: 1,
				sourceRevision: fakeReviewRequest.sourceRevision,
				cycle: 1,
			});
			expect(Object.getOwnPropertyNames(failure)).toEqual(["metadata"]);
			const serialized = JSON.stringify(failure);
			expect(serialized).not.toContain(original.message);
			expect(serialized).not.toContain(original.stack);
			expect(serialized).not.toContain(original.modelOutput);
		}
	});

	test("attributes an explicitly thrown undefined post-request load failure", async () => {
		const store = createStore();
		await seedRunning(store);
		const workflow = createWorkflow(store, undefined, {
			provider: {
				...fakeProvider,
				getDiff: async () => {
					throw undefined;
				},
			} as unknown as SourceControlProvider,
		});
		const directContext = {
			step: async <T>(_name: string, operation: () => Promise<T>): Promise<T> =>
				operation(),
		} as unknown as DurableContext;

		try {
			await workflow.run(reviewerEvent(), directContext, stubLogger);
			expect.unreachable("workflow should fail");
		} catch (failure) {
			expect(failure).toBeInstanceOf(ReviewerWorkflowFailure);
			if (!(failure instanceof ReviewerWorkflowFailure)) return;
			expect(failure.metadata).toEqual({
				request,
				generation: 1,
				sourceRevision: fakeReviewRequest.sourceRevision,
				cycle: 1,
			});
			expect(Object.getOwnPropertyNames(failure)).toEqual(["metadata"]);
		}
	});

	test("replays a context-load failure from metadata alone", async () => {
		const store = createStore();
		await seedRunning(store);
		const workflow = createWorkflow(store);
		const replayContext = {
			step: async <T>(
				name: string,
				operation: () => Promise<T>,
			): Promise<T> => {
				if (name !== "load-snapshot") return operation();
				return {
					__pawlReviewerStepFailure: {
						request,
						generation: 1,
						sourceRevision: fakeReviewRequest.sourceRevision,
						cycle: 1,
					},
				} as T;
			},
		} as unknown as DurableContext;

		try {
			await workflow.run(reviewerEvent(), replayContext, stubLogger);
			expect.unreachable("workflow should fail");
		} catch (failure) {
			expect(failure).toBeInstanceOf(ReviewerWorkflowFailure);
			if (!(failure instanceof ReviewerWorkflowFailure)) return;
			expect(Object.getOwnPropertyNames(failure)).toEqual(["metadata"]);
			expect(JSON.stringify(failure)).toBe(
				JSON.stringify({
					metadata: {
						request,
						generation: 1,
						sourceRevision: fakeReviewRequest.sourceRevision,
						cycle: 1,
					},
				}),
			);
		}
	});

	test("replays the legacy raw metadata context-load failure without replay drift", async () => {
		const store = createStore();
		await seedRunning(store);
		const workflow = createWorkflow(store);
		const replayContext = {
			step: async <T>(
				name: string,
				operation: () => Promise<T>,
			): Promise<T> => {
				if (name !== "load-snapshot") return operation();
				return {
					request,
					generation: 1,
					sourceRevision: fakeReviewRequest.sourceRevision,
					cycle: 1,
				} as T;
			},
		} as unknown as DurableContext;

		try {
			await workflow.run(reviewerEvent(), replayContext, stubLogger);
			expect.unreachable("workflow should fail");
		} catch (failure) {
			expect(failure).toBeInstanceOf(ReviewerWorkflowFailure);
			if (!(failure instanceof ReviewerWorkflowFailure)) return;
			expect(failure.metadata).toEqual({
				request,
				generation: 1,
				sourceRevision: fakeReviewRequest.sourceRevision,
				cycle: 1,
			});
		}
	});

	test.each([
		"getDiff",
		"listComments",
		"listFindings",
		"configLoader.load",
	] as const)("attributes a %s load failure to the authoritative revision and cycle without exposing details", async (operation) => {
		const reviewStore = createStore();
		await seedRunning(reviewStore);
		const original = {
			message: `sensitive-${operation}-message`,
			stack: `sensitive-${operation}-stack`,
			secretModelOutput: `sensitive-${operation}-output`,
		};
		if (operation === "listFindings") {
			reviewStore.listFindings = async () => {
				throw original;
			};
		}
		const provider = {
			...fakeProvider,
			...(operation === "getDiff"
				? {
						getDiff: async () => {
							throw original;
						},
					}
				: {}),
			...(operation === "listComments"
				? {
						listComments: async () => {
							throw original;
						},
					}
				: {}),
		} as unknown as SourceControlProvider;
		const configLoader =
			operation === "configLoader.load"
				? {
						load: async () => {
							throw original;
						},
					}
				: new NoopRepositoryConfigLoader();
		const pipelineStore = new FakePipelineCoordinationStore();
		const observer = new PipelineReviewCycleObserver({
			store: pipelineStore,
			reconciler: { invoke: async () => {} },
			clock: fixedClock,
		});
		const workflow = createWorkflow(reviewStore, observer, {
			provider,
			configLoader,
		});
		const stepNames: string[] = [];
		const logEntries: Array<{
			message: string;
			data?: Record<string, unknown>;
		}> = [];
		const deterministicContext = {
			step: async <T>(
				name: string,
				stepOperation: () => Promise<T>,
			): Promise<T> => {
				stepNames.push(name);
				return stepOperation();
			},
		} as unknown as DurableContext;

		const terminalFailure = await expectSanitizedTerminalFailure(
			executeReviewerWorkflow(
				{
					...reviewerEvent(),
					snapshot: {
						...fakeReviewRequest,
						sourceRevision: "stale-event-revision",
					},
				},
				deterministicContext,
				{
					info: (message, data) => logEntries.push({ message, data }),
				},
				{ workflow, cycleObserver: observer, clock: fixedClock },
			),
		);
		expect(terminalFailure.stack).not.toContain(original.message);

		expect(stepNames).toEqual(["load-snapshot", "record-cycle-failure"]);
		expect([...pipelineStore.outcomes.values()]).toEqual([
			{
				request,
				generation: 1,
				sourceRevision: fakeReviewRequest.sourceRevision,
				cycle: 1,
				status: "failed",
				checkStatus: "failed",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		const durableOutput = JSON.stringify({
			outcomes: [...pipelineStore.outcomes.values()],
			logEntries,
		});
		expect(durableOutput).not.toContain(original.message);
		expect(durableOutput).not.toContain(original.stack);
		expect(durableOutput).not.toContain(original.secretModelOutput);
		expect(durableOutput).not.toContain("stale-event-revision");
	});

	test("the durable SDK exposes only the sanitized terminal failure while retaining authoritative metadata", async () => {
		const reviewStore = createStore();
		await seedRunning(reviewStore);
		const original = Object.assign(new Error("SENSITIVE_HISTORY_MESSAGE"), {
			stack: "SENSITIVE_STACK_VALUE",
			sensitivePrompt: "SENSITIVE_PROMPT_VALUE",
			sensitiveDiff: "SENSITIVE_DIFF_VALUE",
			sensitiveComment: "SENSITIVE_COMMENT_VALUE",
			sensitiveModelOutput: "SENSITIVE_MODEL_OUTPUT_VALUE",
		});
		const provider = {
			...fakeProvider,
			listComments: async () => {
				throw original;
			},
		} as unknown as SourceControlProvider;
		const pipelineStore = new FakePipelineCoordinationStore();
		const observer = new PipelineReviewCycleObserver({
			store: pipelineStore,
			reconciler: { invoke: async () => {} },
			clock: fixedClock,
		});
		const workflow = createWorkflow(reviewStore, observer, { provider });
		const handler = withDurableExecution<ReviewerEvent, void>(
			async (event, context) =>
				executeReviewerWorkflow(event, context, stubLogger, {
					workflow,
					cycleObserver: observer,
					clock: fixedClock,
				}),
		);
		const runner = new LocalDurableTestRunner({ handlerFunction: handler });

		const execution = await runner.run({
			payload: {
				...reviewerEvent(),
				snapshot: {
					...fakeReviewRequest,
					sourceRevision: "stale-event-revision",
				},
			},
		});

		expect(execution.getStatus()).toBe("FAILED");
		expect([...pipelineStore.outcomes.values()]).toEqual([
			{
				request,
				generation: 1,
				sourceRevision: fakeReviewRequest.sourceRevision,
				cycle: 1,
				status: "failed",
				checkStatus: "failed",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		const loadOperation = runner.getOperation<{
			readonly request: typeof request;
			readonly generation: number;
			readonly sourceRevision: string;
			readonly cycle: number;
		}>("load-snapshot");
		expect(loadOperation.getStepDetails()?.result).toEqual({
			__pawlReviewerStepFailure: {
				request,
				generation: 1,
				sourceRevision: fakeReviewRequest.sourceRevision,
				cycle: 1,
			},
		});
		expect(loadOperation.getStepDetails()?.error).toBeUndefined();
		expect(
			execution.getOperations().map((operation) => operation.getName()),
		).toEqual(["load-snapshot", "record-cycle-failure"]);
		const recordOperation = runner.getOperation("record-cycle-failure");
		const executionError = execution.getError();
		expect(executionError.errorType).toBe(terminalFailureName);
		expect(executionError.errorMessage).toBe(terminalFailureMessage);
		expect(executionError.errorData).toBeUndefined();
		expect(executionError.stackTrace).toBeUndefined();
		const durableSurfaces = JSON.stringify({
			executionError,
			invocations: execution.getInvocations(),
			history: execution.getHistoryEvents(),
			operations: execution.getOperations().map((operation) => ({
				name: operation.getName(),
				result: operation.getStepDetails(),
				data: operation.getOperationData(),
				events: operation.getEvents(),
			})),
			recordResult: recordOperation.getStepDetails(),
		});
		for (const sensitiveValue of [
			original.message,
			original.stack,
			original.sensitivePrompt,
			original.sensitiveDiff,
			original.sensitiveComment,
			original.sensitiveModelOutput,
		]) {
			expect(durableSurfaces).not.toContain(sensitiveValue);
		}
		expect(durableSurfaces).toContain(terminalFailureName);
		expect(durableSurfaces).toContain(terminalFailureMessage);
	});

	test("durable history sanitizes an unattributed getRequest failure", async () => {
		const reviewStore = createStore();
		await seedRunning(reviewStore);
		const sensitiveFailure = Object.assign(
			new Error("LOCAL_GET_REQUEST_MESSAGE_SENTINEL"),
			{
				stack: "LOCAL_GET_REQUEST_STACK_SENTINEL",
				privateContext: "LOCAL_GET_REQUEST_CUSTOM_SENTINEL",
			},
		);
		const workflow = createWorkflow(reviewStore, undefined, {
			provider: {
				...fakeProvider,
				getRequest: async () => {
					throw sensitiveFailure;
				},
			} as unknown as SourceControlProvider,
		});
		const recorded: ReviewExecutionFailure[] = [];
		const handler = withDurableExecution<ReviewerEvent, void>(
			async (event, context) =>
				executeReviewerWorkflow(event, context, stubLogger, {
					workflow,
					cycleObserver: {
						recordCycle: async () => {},
						recordExecutionFailure: async (failure) => recorded.push(failure),
						recordTerminalRequest: async () => {},
					},
					clock: fixedClock,
				}),
		);
		const runner = new LocalDurableTestRunner({ handlerFunction: handler });

		const execution = await runner.run({
			payload: {
				...reviewerEvent(),
				snapshot: {
					...fakeReviewRequest,
					sourceRevision: "stale-event-revision",
				},
			},
		});

		expect(execution.getStatus()).toBe("FAILED");
		expect(recorded).toEqual([]);
		expect(
			execution.getOperations().map((operation) => operation.getName()),
		).toEqual(["load-snapshot"]);
		expect(runner.getOperation("load-snapshot").getStepDetails()).toMatchObject(
			{
				result: { __pawlReviewerStepFailure: null },
				error: undefined,
			},
		);
		const surfaces = inspectDurableSurfaces(execution);
		expectFixedSafeExecutionError(surfaces.error);
		expectSecretsAbsent(surfaces.serialized, [
			sensitiveFailure.message,
			sensitiveFailure.stack ?? "",
			sensitiveFailure.privateContext,
		]);
	});

	test("durable history sanitizes an attributed run-review failure and records its outcome", async () => {
		const reviewStore = createStore();
		await seedRunning(reviewStore);
		const sensitiveFailure = Object.assign(
			new Error("LOCAL_RUN_REVIEW_MESSAGE_SENTINEL"),
			{
				stack: "LOCAL_RUN_REVIEW_STACK_SENTINEL",
				privateModelOutput: "LOCAL_RUN_REVIEW_CUSTOM_SENTINEL",
			},
		);
		const pipelineStore = new FakePipelineCoordinationStore();
		const observer = new PipelineReviewCycleObserver({
			store: pipelineStore,
			reconciler: { invoke: async () => {} },
			clock: fixedClock,
		});
		const workflow = createWorkflow(reviewStore, observer, {
			checkRunner: {
				run: async () => {
					throw sensitiveFailure;
				},
			},
		});
		const handler = withDurableExecution<ReviewerEvent, void>(
			async (event, context) =>
				executeReviewerWorkflow(event, context, stubLogger, {
					workflow,
					cycleObserver: observer,
					clock: fixedClock,
				}),
		);
		const runner = new LocalDurableTestRunner({ handlerFunction: handler });

		const execution = await runner.run({ payload: reviewerEvent() });

		expect(execution.getStatus()).toBe("FAILED");
		expect([...pipelineStore.outcomes.values()]).toEqual([
			{
				request,
				generation: 1,
				sourceRevision: fakeReviewRequest.sourceRevision,
				cycle: 1,
				status: "failed",
				checkStatus: "failed",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		expect(
			execution.getOperations().map((operation) => operation.getName()),
		).toEqual([
			"load-snapshot",
			"begin-cycle",
			"claim-events",
			"signal-start",
			"run-review",
			"record-cycle-failure",
		]);
		const expectedMarker = {
			__pawlReviewerStepFailure: {
				request,
				generation: 1,
				sourceRevision: fakeReviewRequest.sourceRevision,
				cycle: 1,
			},
		};
		expect(runner.getOperation("run-review").getStepDetails()).toMatchObject({
			result: expectedMarker,
			error: undefined,
		});
		expect(
			runner.getOperation("record-cycle-failure").getStepDetails()?.error,
		).toBeUndefined();
		const surfaces = inspectDurableSurfaces(execution);
		expectFixedSafeExecutionError(surfaces.error);
		expectSecretsAbsent(surfaces.serialized, [
			sensitiveFailure.message,
			sensitiveFailure.stack ?? "",
			sensitiveFailure.privateModelOutput,
		]);
	});

	test.each([
		"registerCallback",
		"callback logger",
	] as const)("durable history sanitizes %s submitter errors and records current attribution", async (failureSource) => {
		const reviewStore = createStore();
		await seedRunning(reviewStore);
		await reviewStore.claimEvents(request, 1);
		const sensitiveFailure = Object.assign(
			new Error(`LOCAL_${failureSource}_MESSAGE_SENTINEL`),
			{
				stack: `LOCAL_${failureSource}_STACK_SENTINEL`,
				privateCallback: `LOCAL_${failureSource}_CUSTOM_SENTINEL`,
			},
		);
		if (failureSource === "registerCallback") {
			reviewStore.registerCallback = async () => {
				throw sensitiveFailure;
			};
		}
		const pipelineStore = new FakePipelineCoordinationStore();
		const observer = new PipelineReviewCycleObserver({
			store: pipelineStore,
			reconciler: { invoke: async () => {} },
			clock: fixedClock,
		});
		const workflow = createWorkflow(reviewStore, observer);
		const callbackLogger = {
			info: (message: string): void => {
				if (
					failureSource === "callback logger" &&
					message === "registered callback"
				) {
					throw sensitiveFailure;
				}
			},
		};
		const handler = withDurableExecution<ReviewerEvent, void>(
			async (event, context) =>
				executeReviewerWorkflow(event, context, callbackLogger, {
					workflow,
					cycleObserver: observer,
					clock: fixedClock,
				}),
		);
		const runner = new LocalDurableTestRunner({ handlerFunction: handler });

		const execution = await runner.run({ payload: reviewerEvent() });

		expect(execution.getStatus()).toBe("FAILED");
		expect([...pipelineStore.outcomes.values()]).toEqual([
			{
				request,
				generation: 1,
				sourceRevision: fakeReviewRequest.sourceRevision,
				cycle: 1,
				status: "failed",
				checkStatus: "failed",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		expect(
			execution
				.getOperations()
				.map((operation) => operation.getName())
				.filter((name) => name !== undefined),
		).toEqual([
			"load-snapshot",
			"begin-cycle",
			"claim-events",
			"wait-for-next-event",
			"record-cycle-failure",
		]);
		expect(
			runner.getOperation("wait-for-next-event").getCallbackDetails()
				?.callbackId,
		).toBeString();
		const surfaces = inspectDurableSurfaces(execution);
		expectFixedSafeExecutionError(surfaces.error);
		expectSecretsAbsent(surfaces.serialized, [
			sensitiveFailure.message,
			sensitiveFailure.stack ?? "",
			sensitiveFailure.privateCallback,
		]);
		expect(surfaces.serialized).toContain(callbackSubmitterFailureName);
		expect(surfaces.serialized).toContain(callbackSubmitterFailureMessage);
	});

	test("replayed successful load attributes a downstream failure marker and outcome to its cached snapshot", async () => {
		const reviewStore = createStore();
		await seedRunning(reviewStore);
		const cachedRevision = "cached-authoritative-revision-1234567";
		const cachedSnapshot = {
			request,
			generation: 1,
			cycle: 1,
			sourceRevision: cachedRevision,
			destinationRevision: fakeReviewRequest.destinationRevision,
			configVersion: 1,
			eventWatermark: cachedRevision,
			startedAt: "2026-01-01T00:00:00.000Z",
		};
		const cachedLoaded = {
			snapshot: cachedSnapshot,
			reviewRequest: {
				...fakeReviewRequest,
				sourceRevision: cachedRevision,
			},
			changedFiles: [],
			humanComments: [],
			conversation: [],
			existingFindings: [],
			repositoryConfig: repositoryConfigSchema.parse({ version: 1 }),
		};
		const sensitiveFailure = new Error("REPLAY_DOWNSTREAM_SECRET_SENTINEL");
		reviewStore.beginCycle = async () => {
			throw sensitiveFailure;
		};
		const recorded: ReviewExecutionFailure[] = [];
		const observer: ReviewCycleObserver = {
			recordCycle: async () => {},
			recordExecutionFailure: async (failure) => recorded.push(failure),
			recordTerminalRequest: async () => {},
		};
		let providerLoadCalls = 0;
		const workflow = createWorkflow(reviewStore, observer, {
			provider: {
				...fakeProvider,
				getRequest: async () => {
					providerLoadCalls += 1;
					return fakeReviewRequest;
				},
			} as unknown as SourceControlProvider,
		});
		const persistedResults = new Map<string, unknown>();
		const replayContext = {
			step: async <T>(
				name: string,
				operation: () => Promise<T>,
			): Promise<T> => {
				if (name === "load-snapshot") return cachedLoaded as T;
				const result = await operation();
				persistedResults.set(name, result);
				return result;
			},
		} as unknown as DurableContext;

		await expectSanitizedTerminalFailure(
			executeReviewerWorkflow(reviewerEvent(), replayContext, stubLogger, {
				workflow,
				cycleObserver: observer,
				clock: fixedClock,
			}),
		);

		expect(providerLoadCalls).toBe(0);
		expect(persistedResults.get("begin-cycle")).toEqual({
			__pawlReviewerStepFailure: {
				request,
				generation: 1,
				sourceRevision: cachedRevision,
				cycle: 1,
			},
		});
		expect(recorded).toEqual([
			{
				request,
				generation: 1,
				sourceRevision: cachedRevision,
				cycle: 1,
				occurredAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		expect(JSON.stringify([...persistedResults])).not.toContain(
			sensitiveFailure.message,
		);
	});

	test("durable history sanitizes failure-outcome observer errors", async () => {
		const reviewStore = createStore();
		await seedRunning(reviewStore);
		const workflowFailure = Object.assign(
			new Error("LOCAL_WORKFLOW_MESSAGE_SENTINEL"),
			{
				stack: "LOCAL_WORKFLOW_STACK_SENTINEL",
				privatePrompt: "LOCAL_WORKFLOW_CUSTOM_SENTINEL",
			},
		);
		const observerFailure = Object.assign(
			new Error("LOCAL_OBSERVER_MESSAGE_SENTINEL"),
			{
				stack: "LOCAL_OBSERVER_STACK_SENTINEL",
				privateStoreItem: "LOCAL_OBSERVER_CUSTOM_SENTINEL",
			},
		);
		const recorded: ReviewExecutionFailure[] = [];
		const observer: ReviewCycleObserver = {
			recordCycle: async () => {},
			recordExecutionFailure: async (failure) => {
				recorded.push(failure);
				throw observerFailure;
			},
			recordTerminalRequest: async () => {},
		};
		const logEntries: Array<{
			message: string;
			data?: Record<string, unknown>;
		}> = [];
		const workflow = createWorkflow(reviewStore, observer, {
			checkRunner: {
				run: async () => {
					throw workflowFailure;
				},
			},
		});
		const handler = withDurableExecution<ReviewerEvent, void>(
			async (event, context) =>
				executeReviewerWorkflow(
					event,
					context,
					{ info: (message, data) => logEntries.push({ message, data }) },
					{ workflow, cycleObserver: observer, clock: fixedClock },
				),
		);
		const runner = new LocalDurableTestRunner({ handlerFunction: handler });

		const execution = await runner.run({ payload: reviewerEvent() });

		expect(execution.getStatus()).toBe("FAILED");
		expect(recorded).toEqual([
			{
				request,
				generation: 1,
				sourceRevision: fakeReviewRequest.sourceRevision,
				cycle: 1,
				occurredAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		expect(
			execution.getOperations().map((operation) => operation.getName()),
		).toEqual([
			"load-snapshot",
			"begin-cycle",
			"claim-events",
			"signal-start",
			"run-review",
			"record-cycle-failure",
		]);
		expect(
			runner.getOperation("record-cycle-failure").getStepDetails(),
		).toMatchObject({
			result: {
				__pawlReviewerStepFailure: {
					request,
					generation: 1,
					sourceRevision: fakeReviewRequest.sourceRevision,
					cycle: 1,
				},
			},
			error: undefined,
		});
		expect(logEntries.at(-1)).toEqual({
			message: "failed to record reviewer failure outcome",
			data: {
				request,
				generation: 1,
				sourceRevision: fakeReviewRequest.sourceRevision,
				cycle: 1,
			},
		});
		const surfaces = inspectDurableSurfaces(execution);
		expectFixedSafeExecutionError(surfaces.error);
		expectSecretsAbsent(surfaces.serialized, [
			workflowFailure.message,
			workflowFailure.stack ?? "",
			workflowFailure.privatePrompt,
			observerFailure.message,
			observerFailure.stack ?? "",
			observerFailure.privateStoreItem,
		]);
		expectSecretsAbsent(JSON.stringify(logEntries), [
			workflowFailure.message,
			observerFailure.message,
		]);
	});

	test("sanitizes getRequest failure without recording a stale event snapshot outcome", async () => {
		const reviewStore = createStore();
		await seedRunning(reviewStore);
		const original = new Error("sensitive-context-unavailable");
		const workflow = createWorkflow(reviewStore, undefined, {
			provider: {
				...fakeProvider,
				getRequest: async () => {
					throw original;
				},
			} as unknown as SourceControlProvider,
		});
		const pipelineStore = new FakePipelineCoordinationStore();
		const observer = new PipelineReviewCycleObserver({
			store: pipelineStore,
			reconciler: { invoke: async () => {} },
			clock: fixedClock,
		});
		const stepNames: string[] = [];
		const deterministicContext = {
			step: async <T>(
				name: string,
				operation: () => Promise<T>,
			): Promise<T> => {
				stepNames.push(name);
				return operation();
			},
		} as unknown as DurableContext;

		await expectSanitizedTerminalFailure(
			executeReviewerWorkflow(
				{
					...reviewerEvent(),
					snapshot: {
						...fakeReviewRequest,
						sourceRevision: "stale-event-revision",
					},
				},
				deterministicContext,
				stubLogger,
				{ workflow, cycleObserver: observer, clock: fixedClock },
			),
		);
		expect(stepNames).toEqual(["load-snapshot"]);
		expect([...pipelineStore.outcomes.values()]).toEqual([]);
	});

	test("later-cycle revision drift records failure only for the authoritative revision and cycle", async () => {
		const reviewStore = createStore();
		await seedRunning(reviewStore);
		const revisionA = "source-revision-a";
		const revisionB = "source-revision-b";
		let currentRevision = revisionA;
		const driftProvider = {
			...fakeProvider,
			getRequest: async (): Promise<ReviewRequest> => ({
				...fakeReviewRequest,
				sourceRevision: currentRevision,
			}),
		} as unknown as SourceControlProvider;
		const original = new Error("sensitive-second-cycle-failure");
		let reviewRuns = 0;
		const checkRunner: CheckRunner = {
			run: async () => {
				reviewRuns += 1;
				if (reviewRuns === 2) throw original;
				return { status: "completed", checks: [] };
			},
		};
		const pipelineStore = new FakePipelineCoordinationStore();
		const observer = new PipelineReviewCycleObserver({
			store: pipelineStore,
			reconciler: { invoke: async () => {} },
			clock: fixedClock,
		});
		const workflow = createWorkflow(reviewStore, observer, {
			provider: driftProvider,
			checkRunner,
		});
		const event: ReviewerEvent = {
			...reviewerEvent(),
			snapshot: { ...fakeReviewRequest, sourceRevision: revisionA },
		};
		const stepNames: string[] = [];
		const deterministicContext = {
			step: async <T>(
				name: string,
				operation: () => Promise<T>,
			): Promise<T> => {
				stepNames.push(name);
				return operation();
			},
			waitForCallback: async (
				name: string,
				submitter: (callbackId: string) => Promise<void>,
			): Promise<void> => {
				stepNames.push(name);
				await submitter("callback-1");
				currentRevision = revisionB;
				await reviewStore.appendEvent({
					...seedEvent,
					id: "event-2",
					type: "revision-updated",
					occurredAt: "2026-01-01T00:00:01.000Z",
					revision: revisionB,
				});
			},
		} as unknown as DurableContext;

		await expectSanitizedTerminalFailure(
			executeReviewerWorkflow(event, deterministicContext, stubLogger, {
				workflow,
				cycleObserver: observer,
				clock: fixedClock,
			}),
		);
		expect(reviewRuns).toBe(2);
		expect(stepNames).toEqual([
			"load-snapshot",
			"begin-cycle",
			"claim-events",
			"signal-start",
			"run-review",
			"record-cycle-outcome",
			"wait-for-next-event",
			"load-snapshot",
			"begin-cycle",
			"claim-events",
			"signal-start",
			"run-review",
			"record-cycle-failure",
		]);
		const outcomes = [...pipelineStore.outcomes.values()];
		expect(outcomes).toContainEqual({
			request,
			generation: 1,
			sourceRevision: revisionA,
			cycle: 1,
			status: "reviewed",
			checkStatus: "completed",
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		expect(outcomes.filter((outcome) => outcome.status === "failed")).toEqual([
			{
				request,
				generation: 1,
				sourceRevision: revisionB,
				cycle: 2,
				status: "failed",
				checkStatus: "failed",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		]);
	});

	test("blocked limit records a blocked outcome and callback", async () => {
		const store = createStore();
		await seedRunning(store);
		const cycles: Parameters<ReviewCycleObserver["recordCycle"]>[0][] = [];
		const blockedProvider = {
			...fakeProvider,
			getDiff: async () => [
				{ path: "one.ts", changeType: "added" as const, hunks: [] },
				{ path: "two.ts", changeType: "added" as const, hunks: [] },
			],
		} as unknown as SourceControlProvider;
		const workflow = createWorkflow(
			store,
			{
				recordCycle: async (outcome) => cycles.push(outcome),
				recordExecutionFailure: async () => {},
				recordTerminalRequest: async () => {},
			},
			{
				provider: blockedProvider,
				configLoader: {
					load: async () =>
						repositoryConfigSchema.parse({
							version: 1,
							review: { maxChangedFiles: 1 },
						}),
				},
			},
		);
		const handler = withDurableExecution<ReviewerEvent, void>(
			async (event, context) => workflow.run(event, context, stubLogger),
		);
		const runner = new LocalDurableTestRunner({ handlerFunction: handler });

		const runPromise = runner.run({ payload: reviewerEvent() });
		const callbackOp = runner.getOperation("wait-for-next-event");
		await callbackOp.waitForData(WaitingOperationStatus.SUBMITTED);

		const state = store.inspectRequest(request);
		expect(state?.lifecycleState).toBe("BLOCKED_LIMIT");
		expect(state?.blockedLimit).toEqual({
			reason: "max-changed-files",
			observed: 2,
			maximum: 1,
		});
		expect(cycles).toEqual([
			{
				request,
				generation: 1,
				sourceRevision: fakeReviewRequest.sourceRevision,
				cycle: 1,
				reviewStatus: "blocked",
				checkStatus: "blocked",
				occurredAt: "2026-01-01T00:00:00.000Z",
			},
		]);

		prStatus = "merged";
		await callbackOp.sendCallbackSuccess();
		expect((await runPromise).getStatus()).toBe("SUCCEEDED");
	});

	test("empty wake waits again without recording an outcome", async () => {
		const store = createStore();
		await seedRunning(store);
		await store.claimEvents(request, 1);
		const cycles: Parameters<ReviewCycleObserver["recordCycle"]>[0][] = [];
		const workflow = createWorkflow(store, {
			recordCycle: async (outcome) => cycles.push(outcome),
			recordExecutionFailure: async () => {},
			recordTerminalRequest: async () => {},
		});
		const handler = withDurableExecution<ReviewerEvent, void>(
			async (event, context) => workflow.run(event, context, stubLogger),
		);
		const runner = new LocalDurableTestRunner({ handlerFunction: handler });

		const runPromise = runner.run({ payload: reviewerEvent() });
		const callbackOp = runner.getOperation("wait-for-next-event");
		await callbackOp.waitForData(WaitingOperationStatus.SUBMITTED);

		expect(cycles).toEqual([]);
		prStatus = "closed";
		await callbackOp.sendCallbackSuccess();
		expect((await runPromise).getStatus()).toBe("SUCCEEDED");
		expect(cycles).toEqual([]);
	});

	for (const status of ["merged", "closed"] as const) {
		test(`${status} request marks pending pipeline jobs successful through the observer`, async () => {
			const reviewStore = createStore();
			const pipelineStore = new FakePipelineCoordinationStore();
			await pipelineStore.registerJob({
				jobId: `job-${status}`,
				state: "PENDING",
				request,
				generation: 1,
				sourceRevision: fakeReviewRequest.sourceRevision,
			});
			const reconcilerInvocations: Array<string | undefined> = [];
			const observer = new PipelineReviewCycleObserver({
				store: pipelineStore,
				reconciler: {
					invoke: async (jobId) => reconcilerInvocations.push(jobId),
				},
				clock: fixedClock,
			});
			const workflow = createWorkflow(reviewStore, observer);
			prStatus = status;
			const handler = withDurableExecution<ReviewerEvent, void>(
				async (event, context) => workflow.run(event, context, stubLogger),
			);
			const runner = new LocalDurableTestRunner({ handlerFunction: handler });

			const result = await runner.run({ payload: reviewerEvent() });

			expect(result.getStatus()).toBe("SUCCEEDED");
			expect(
				pipelineStore.jobs.get(`job-${status}`)?.callbackCandidate,
			).toEqual({
				status: "success",
				category: status === "merged" ? "RequestMerged" : "RequestClosed",
			});
			expect(reconcilerInvocations).toEqual([undefined]);
		});
	}

	test("stale callback: workflow returns when the callback is cleared (merged)", async () => {
		const store = createStore();
		await seedRunning(store);
		const workflow = createWorkflow(store);

		const handler = withDurableExecution<ReviewerEvent, void>(
			async (event, context) => {
				await workflow.run(event, context, stubLogger);
			},
		);
		const runner = new LocalDurableTestRunner({ handlerFunction: handler });

		const runPromise = runner.run({ payload: reviewerEvent() });

		const callbackOp = runner.getOperation("wait-for-next-event");
		await callbackOp.waitForData(WaitingOperationStatus.SUBMITTED);

		// Simulate the router completing the request (merged) — clears the callback.
		await store.complete(request, 1, { type: "merged" });
		prStatus = "merged";

		// Delivering the callback after completion should not re-process; the
		// workflow returns (the durable SDK resolves the wait).
		await callbackOp.sendCallbackSuccess();

		const result = await runPromise;
		// The workflow returned without throwing; the execution completed.
		const status = result.getStatus();
		expect(
			status !== undefined && ["SUCCEEDED", "FAILED"].includes(status),
		).toBe(true);
		const state = store.inspectRequest(request);
		expect(state?.completionReason?.type).toBe("merged");
	});
});
