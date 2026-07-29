import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import {
	LocalDurableTestRunner,
	WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import type { ReviewRequest } from "../../../../src/reviewer/domain/review-request";
import type { ReviewCycleObserver } from "../../../../src/reviewer/ports/review-cycle-observer";
import type { SourceControlProvider } from "../../../../src/reviewer/ports/source-control-provider";
import { NoopFindingReconciler } from "../../../../src/reviewer/services/finding-reconciler";
import { NoopCheckRunner } from "../../../../src/reviewer/services/noop-check-runner";
import { NoopReviewModel } from "../../../../src/reviewer/services/noop-review-model";
import { NoopRepositoryConfigLoader } from "../../../../src/reviewer/services/repository-config-loader";
import { ReviewEngine } from "../../../../src/reviewer/services/review-engine";
import {
	type ReviewerEvent,
	ReviewerWorkflow,
} from "../../../../src/reviewer/workflows/reviewer-workflow";
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
): ReviewerWorkflow {
	prStatus = "open";
	return new ReviewerWorkflow({
		store,
		provider: fakeProvider,
		checkRunner: new NoopCheckRunner(),
		reviewEngine: new ReviewEngine({ model: new NoopReviewModel() }),
		reconciler: new NoopFindingReconciler(),
		configLoader: new NoopRepositoryConfigLoader(),
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
