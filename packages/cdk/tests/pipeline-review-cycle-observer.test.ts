import { describe, expect, test } from "bun:test";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { PipelineReviewCycleObserver } from "../src/reviewer/adapters/pipeline-review-cycle-observer";
import type { CallbackIntent } from "../src/reviewer/pipeline/pipeline-coordination-store";
import type { PipelineJobPage } from "../src/reviewer/ports/pipeline-coordination-store";
import { FakePipelineCoordinationStore } from "./pipeline-coordination-fakes";

const request = {
	provider: "codecommit",
	repository: "orders",
	requestId: "42",
} as const;
const now = "2026-07-29T12:00:00.000Z";

const pendingJob = (jobId: string) => ({
	jobId,
	state: "PENDING" as const,
	request,
	generation: 3,
	sourceRevision: "a".repeat(40),
	deadlineAt: "2026-07-29T13:00:00.000Z",
	nextActionAt: now,
});

class PaginatedTerminalStore extends FakePipelineCoordinationStore {
	listCalls = 0;
	override async listRequestJobs(
		_request: typeof request,
		_generation: number,
		cursor?: Readonly<Record<string, unknown>>,
	): Promise<PipelineJobPage> {
		expect(await this.getTerminalRequestState(request, 3)).toMatchObject({
			status: "closed",
		});
		this.listCalls += 1;
		if (cursor === undefined) {
			const job = this.jobs.get("first");
			return {
				jobs: job === undefined ? [] : [job],
				cursor: { page: 2 },
			};
		}
		const job = this.jobs.get("second");
		return { jobs: job === undefined ? [] : [job] };
	}
}

class ConcurrentlySelectedTerminalStore extends FakePipelineCoordinationStore {
	selectionAttempts = 0;
	override async setCallbackCandidate(
		jobId: string,
		_candidate: CallbackIntent,
	): Promise<void> {
		this.selectionAttempts += 1;
		const job = this.jobs.get(jobId);
		if (job && job.callbackCandidate === undefined) {
			this.jobs.set(jobId, {
				...job,
				callbackCandidate: {
					status: "failure",
					category: "ReviewBlocked",
				},
			});
		}
		throw new ConditionalCheckFailedException({
			message: "The conditional request failed",
			$metadata: {
				httpStatusCode: 400,
				requestId: "concurrent-selection",
			},
		});
	}
}

class UnexpectedlyFailingTerminalStore extends FakePipelineCoordinationStore {
	readonly failure = new Error("DynamoDB unavailable");
	override async setCallbackCandidate(
		_jobId: string,
		_candidate: CallbackIntent,
	): Promise<void> {
		throw this.failure;
	}
}

describe("PipelineReviewCycleObserver", () => {
	test("persists terminal state before scanning every page and preserves immediate current-job updates", async () => {
		const store = new PaginatedTerminalStore();
		await store.registerJob(pendingJob("first"));
		await store.registerJob(pendingJob("second"));
		const kicks: Array<string | undefined> = [];
		const observer = new PipelineReviewCycleObserver({
			store,
			reconciler: { invoke: async (jobId) => kicks.push(jobId) },
			clock: () => new Date(now),
		});

		await observer.recordTerminalRequest({
			request,
			generation: 3,
			status: "closed",
		});

		expect(store.listCalls).toBe(2);
		expect(store.jobs.get("first")?.callbackCandidate).toEqual({
			status: "success",
			category: "RequestClosed",
		});
		expect(store.jobs.get("second")?.callbackCandidate).toEqual({
			status: "success",
			category: "RequestClosed",
		});
		expect(kicks).toEqual([undefined]);
	});

	test("treats concurrent callback selection as idempotent across duplicate terminal calls and still reconciles", async () => {
		const store = new ConcurrentlySelectedTerminalStore();
		await store.registerJob(pendingJob("concurrent"));
		const kicks: Array<string | undefined> = [];
		const observer = new PipelineReviewCycleObserver({
			store,
			reconciler: { invoke: async (jobId) => kicks.push(jobId) },
			clock: () => new Date(now),
		});

		await observer.recordTerminalRequest({
			request,
			generation: 3,
			status: "merged",
		});
		await observer.recordTerminalRequest({
			request,
			generation: 3,
			status: "closed",
		});

		expect(store.selectionAttempts).toBe(2);
		expect(await store.getTerminalRequestState(request, 3)).toMatchObject({
			status: "merged",
		});
		expect(store.jobs.get("concurrent")?.callbackCandidate).toEqual({
			status: "failure",
			category: "ReviewBlocked",
		});
		expect(kicks).toEqual([undefined, undefined]);
	});

	test("propagates unexpected callback selection errors without invoking the reconciler", async () => {
		const store = new UnexpectedlyFailingTerminalStore();
		await store.registerJob(pendingJob("failing"));
		const kicks: Array<string | undefined> = [];
		const observer = new PipelineReviewCycleObserver({
			store,
			reconciler: { invoke: async (jobId) => kicks.push(jobId) },
			clock: () => new Date(now),
		});

		await expect(
			observer.recordTerminalRequest({
				request,
				generation: 3,
				status: "closed",
			}),
		).rejects.toBe(store.failure);
		expect(kicks).toEqual([]);
	});
});
