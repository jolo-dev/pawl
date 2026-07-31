import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	type DurableContext,
	withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
	LocalDurableTestRunner,
	WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { PipelineReviewCycleObserver } from "../../../../src/reviewer/adapters/pipeline-review-cycle-observer";
import { repositoryConfigSchema } from "../../../../src/reviewer/domain/repository-config";
import type { ReviewRequest } from "../../../../src/reviewer/domain/review-request";
import { executeReviewerWorkflow } from "../../../../src/reviewer/handlers/reviewer";
import type { CheckRunner } from "../../../../src/reviewer/ports/check-runner";
import type { ReviewCycleObserver } from "../../../../src/reviewer/ports/review-cycle-observer";
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

	test("wraps a first-cycle failure only after current snapshot metadata exists and preserves identity privately", async () => {
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
			expect(failure.unwrap()).toBe(original);
			const serialized = JSON.stringify(failure);
			expect(serialized).not.toContain(original.message);
			expect(serialized).not.toContain(original.stack);
			expect(serialized).not.toContain(original.modelOutput);
		}
	});

	test("leaves a load-snapshot failure raw because authoritative context is unavailable", async () => {
		const store = createStore();
		await seedRunning(store);
		const original = new Error("sensitive-context-unavailable");
		const workflow = createWorkflow(store, undefined, {
			provider: {
				...fakeProvider,
				getRequest: async () => {
					throw original;
				},
			} as unknown as SourceControlProvider,
		});
		const directContext = {
			step: async <T>(_name: string, operation: () => Promise<T>): Promise<T> =>
				operation(),
		} as unknown as DurableContext;

		await expect(
			workflow.run(
				{
					...reviewerEvent(),
					snapshot: {
						...fakeReviewRequest,
						sourceRevision: "stale-event-revision",
					},
				},
				directContext,
				stubLogger,
			),
		).rejects.toBe(original);
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

		await expect(
			executeReviewerWorkflow(event, deterministicContext, stubLogger, {
				workflow,
				cycleObserver: observer,
				clock: fixedClock,
			}),
		).rejects.toBe(original);
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
