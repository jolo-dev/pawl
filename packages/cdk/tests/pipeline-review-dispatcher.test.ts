import { describe, expect, test } from "bun:test";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { StartReviewPipelineExecution } from "../src/reviewer/adapters/codepipeline-transport";
import type { ReviewRequest } from "../src/reviewer/domain/review-request";
import type { CallbackIntent } from "../src/reviewer/pipeline/pipeline-coordination-store";
import {
	AuthoritativeRevisionArbitrationExhaustedError,
	PipelineReviewDispatcher,
} from "../src/reviewer/pipeline-review-common";
import { classifyRetryError } from "../src/reviewer/services/retry-policy";
import { FakePipelineCoordinationStore } from "./pipeline-coordination-fakes";

const request = {
	provider: "codecommit",
	repository: "orders",
	requestId: "42",
} as const;
const snapshot: ReviewRequest = {
	key: request,
	title: "Review",
	status: "open",
	sourceBranch: "feature",
	destinationBranch: "main",
	sourceRevision: "b".repeat(40),
	destinationRevision: "c".repeat(40),
};

class RecordingPipelineTransport {
	readonly starts: StartReviewPipelineExecution[] = [];
	async startExecution(input: StartReviewPipelineExecution) {
		this.starts.push(input);
		return { executionId: "exec-new" };
	}
}

class RecordingKick {
	count = 0;
	async invoke(): Promise<void> {
		this.count += 1;
	}
}

class ContendedRevisionStore extends FakePipelineCoordinationStore {
	readonly proposals: Array<{
		readonly sourceRevision: string;
		readonly observedAt: string;
		readonly eventId: string;
	}> = [];
	conflictsRemaining: number;

	constructor(conflictsRemaining: number) {
		super();
		this.conflictsRemaining = conflictsRemaining;
	}

	override async recordAuthoritativeRevision(
		marker: Parameters<
			FakePipelineCoordinationStore["recordAuthoritativeRevision"]
		>[0],
	) {
		this.proposals.push(marker);
		if (this.conflictsRemaining > 0) {
			this.conflictsRemaining -= 1;
			return {
				...marker,
				sourceRevision: "a".repeat(40),
				eventId: `contender-${this.conflictsRemaining}`,
			};
		}
		return super.recordAuthoritativeRevision(marker);
	}
}

class ConcurrentlySelectedStore extends FakePipelineCoordinationStore {
	override async setCallbackCandidate(
		jobId: string,
		_candidate: CallbackIntent,
	): Promise<void> {
		const job = this.jobs.get(jobId);
		if (job) {
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

const pendingJob = (jobId: string, sourceRevision: string) => ({
	jobId,
	state: "PENDING" as const,
	pipelineExecutionId: `exec-${jobId}`,
	pipelineName: "pipeline",
	stageName: "Build",
	actionName: "AIReview",
	request,
	generation: 3,
	sourceRevision,
	destinationRevision: "c".repeat(40),
	deadlineAt: "2026-07-29T13:00:00.000Z",
	nextActionAt: "2026-07-29T12:00:00.000Z",
});

describe("PipelineReviewDispatcher", () => {
	test("supersedes older pending jobs only and starts the exact authoritative revision", async () => {
		const store = new FakePipelineCoordinationStore();
		await store.registerJob(pendingJob("old", "a".repeat(40)));
		await store.registerJob(pendingJob("current", snapshot.sourceRevision));
		await store.registerJob({
			...pendingJob("completing", "a".repeat(40)),
			state: "COMPLETING",
			terminalIntent: { status: "failure", category: "ReviewFailed" },
			completionLeaseExpiresAt: "2026-07-29T12:02:00.000Z",
		});
		const transport = new RecordingPipelineTransport();
		const kick = new RecordingKick();
		const dispatcher = new PipelineReviewDispatcher({
			pipelineName: "pipeline",
			transport,
			store,
			reconciler: kick,
			clock: () => new Date("2026-07-29T12:00:00.000Z"),
		});

		await dispatcher.startReviewPipeline({
			snapshot,
			generation: 3,
			observedAt: "2026-07-29T12:00:00.000Z",
			eventId: "revision-new",
			refetchSnapshot: async () => snapshot,
		});

		expect(store.jobs.get("old")?.callbackCandidate).toEqual({
			status: "failure",
			category: "Superseded",
		});
		expect(store.jobs.get("current")?.callbackCandidate).toBeUndefined();
		expect(store.jobs.get("completing")?.terminalIntent).toEqual({
			status: "failure",
			category: "ReviewFailed",
		});
		expect(store.jobs.get("completing")?.callbackCandidate).toBeUndefined();
		expect(transport.starts).toEqual([
			{
				pipelineName: "pipeline",
				sourceActionName: "Source",
				sourceRevision: snapshot.sourceRevision,
				destinationRevision: snapshot.destinationRevision,
				request,
				generation: 3,
			},
		]);
		expect(store.mappings.get("exec-new")).toMatchObject({
			executionId: "exec-new",
			request,
			generation: 3,
			sourceRevision: snapshot.sourceRevision,
		});
		expect(kick.count).toBe(1);
	});

	test.each([
		["merged", "RequestMerged"],
		["closed", "RequestClosed"],
	] as const)("marks genuinely pending jobs successful when a request is %s", async (status, category) => {
		const store = new FakePipelineCoordinationStore();
		await store.registerJob(pendingJob("pending", snapshot.sourceRevision));
		await store.registerJob({
			...pendingJob("already-selected", snapshot.sourceRevision),
			callbackCandidate: {
				status: "failure",
				category: "ReviewBlocked",
			},
		});
		await store.registerJob({
			...pendingJob("completing", snapshot.sourceRevision),
			state: "COMPLETING",
			terminalIntent: { status: "failure", category: "ReviewFailed" },
			completionLeaseExpiresAt: "2026-07-29T12:02:00.000Z",
		});
		const kick = new RecordingKick();
		const dispatcher = new PipelineReviewDispatcher({
			pipelineName: "pipeline",
			transport: new RecordingPipelineTransport(),
			store,
			reconciler: kick,
		});

		await dispatcher.completeTerminalRequest({
			request,
			generation: 3,
			status,
		});

		expect(store.jobs.get("pending")?.callbackCandidate).toEqual({
			status: "success",
			category,
		});
		expect(store.jobs.get("already-selected")?.callbackCandidate).toEqual({
			status: "failure",
			category: "ReviewBlocked",
		});
		expect(store.jobs.get("completing")?.terminalIntent).toEqual({
			status: "failure",
			category: "ReviewFailed",
		});
		expect(kick.count).toBe(1);
	});

	test("keeps the first terminal marker stable across duplicate terminal events", async () => {
		const store = new FakePipelineCoordinationStore();
		const dispatcher = new PipelineReviewDispatcher({
			pipelineName: "pipeline",
			transport: new RecordingPipelineTransport(),
			store,
			reconciler: new RecordingKick(),
			clock: () => new Date("2026-07-29T12:00:00.000Z"),
		});

		await dispatcher.completeTerminalRequest({
			request,
			generation: 3,
			status: "merged",
		});
		await store.registerJob(
			pendingJob("between-events", snapshot.sourceRevision),
		);
		await dispatcher.completeTerminalRequest({
			request,
			generation: 3,
			status: "closed",
		});

		expect(await store.getTerminalRequestState(request, 3)).toEqual({
			request,
			generation: 3,
			status: "merged",
			occurredAt: "2026-07-29T12:00:00.000Z",
		});
		expect(store.jobs.get("between-events")?.callbackCandidate).toEqual({
			status: "success",
			category: "RequestMerged",
		});
	});

	test("ignores a conditional conflict for a concurrently selected callback and still invokes the reconciler", async () => {
		const store = new ConcurrentlySelectedStore();
		await store.registerJob(pendingJob("concurrent", snapshot.sourceRevision));
		const kick = new RecordingKick();
		const dispatcher = new PipelineReviewDispatcher({
			pipelineName: "pipeline",
			transport: new RecordingPipelineTransport(),
			store,
			reconciler: kick,
		});

		await expect(
			dispatcher.completeTerminalRequest({
				request,
				generation: 3,
				status: "closed",
			}),
		).resolves.toBeUndefined();

		expect(store.jobs.get("concurrent")?.callbackCandidate).toEqual({
			status: "failure",
			category: "ReviewBlocked",
		});
		expect(kick.count).toBe(1);
	});

	test.each([
		["event-z", "event-a"],
		["event-a", "event-z"],
	] as const)("arbitrates equal-time different revisions without ordering opaque event ids (%s vs %s)", async (candidateEventId, winnerEventId) => {
		const store = new FakePipelineCoordinationStore();
		await store.recordAuthoritativeRevision({
			request,
			generation: 3,
			sourceRevision: "a".repeat(40),
			observedAt: "2026-07-29T12:00:00.000Z",
			eventId: winnerEventId,
		});
		const transport = new RecordingPipelineTransport();
		const dispatcher = new PipelineReviewDispatcher({
			pipelineName: "pipeline",
			transport,
			store,
			reconciler: new RecordingKick(),
			clock: () => new Date("2026-07-29T11:00:00.000Z"),
		});

		await dispatcher.startReviewPipeline({
			snapshot,
			generation: 3,
			observedAt: "2026-07-29T12:00:00.000Z",
			eventId: candidateEventId,
			refetchSnapshot: async () => snapshot,
		});

		expect(transport.starts.map((input) => input.sourceRevision)).toEqual([
			snapshot.sourceRevision,
		]);
		expect(await store.getAuthoritativeRevision(request, 3)).toMatchObject({
			sourceRevision: snapshot.sourceRevision,
			observedAt: "2026-07-29T12:00:00.001Z",
			eventId: candidateEventId,
		});
	});

	test("authorizes an exact-revision idempotent start for equal-time different event ids", async () => {
		const store = new FakePipelineCoordinationStore();
		await store.recordAuthoritativeRevision({
			request,
			generation: 3,
			sourceRevision: snapshot.sourceRevision,
			observedAt: "2026-07-29T12:00:00.000Z",
			eventId: "first-id",
		});
		const transport = new RecordingPipelineTransport();
		let refetches = 0;
		const dispatcher = new PipelineReviewDispatcher({
			pipelineName: "pipeline",
			transport,
			store,
			reconciler: new RecordingKick(),
		});

		await dispatcher.startReviewPipeline({
			snapshot,
			generation: 3,
			observedAt: "2026-07-29T12:00:00.000Z",
			eventId: "second-id",
			refetchSnapshot: async () => {
				refetches += 1;
				return snapshot;
			},
		});

		expect(refetches).toBe(0);
		expect(transport.starts).toHaveLength(1);
	});

	test("rejects an older revision and accepts a newer revision", async () => {
		const store = new FakePipelineCoordinationStore();
		await store.recordAuthoritativeRevision({
			request,
			generation: 3,
			sourceRevision: "a".repeat(40),
			observedAt: "2026-07-29T12:00:01.000Z",
			eventId: "winner",
		});
		const transport = new RecordingPipelineTransport();
		const dispatcher = new PipelineReviewDispatcher({
			pipelineName: "pipeline",
			transport,
			store,
			reconciler: new RecordingKick(),
		});
		const refetchSnapshot = async () => snapshot;

		await dispatcher.startReviewPipeline({
			snapshot,
			generation: 3,
			observedAt: "2026-07-29T12:00:00.000Z",
			eventId: "older",
			refetchSnapshot,
		});
		await dispatcher.startReviewPipeline({
			snapshot,
			generation: 3,
			observedAt: "2026-07-29T12:00:02.000Z",
			eventId: "newer",
			refetchSnapshot,
		});

		expect(transport.starts).toHaveLength(1);
	});

	test.each([
		["winner", "open", "a", false],
		["candidate", "open", "b", true],
		["third", "open", "d", true],
		["terminal", "closed", "b", false],
	] as const)("uses an authoritative %s refetch during equal-time arbitration", async (_case, status, revisionPrefix, starts) => {
		const store = new FakePipelineCoordinationStore();
		await store.recordAuthoritativeRevision({
			request,
			generation: 3,
			sourceRevision: "a".repeat(40),
			observedAt: "2026-07-29T12:00:00.000Z",
			eventId: "winner",
		});
		const transport = new RecordingPipelineTransport();
		const dispatcher = new PipelineReviewDispatcher({
			pipelineName: "pipeline",
			transport,
			store,
			reconciler: new RecordingKick(),
			clock: () => new Date("2026-07-29T12:00:05.000Z"),
		});
		const authoritative = {
			...snapshot,
			status,
			sourceRevision: revisionPrefix.repeat(40),
			destinationRevision: "e".repeat(40),
		};

		await dispatcher.startReviewPipeline({
			snapshot,
			generation: 3,
			observedAt: "2026-07-29T12:00:00.000Z",
			eventId: "candidate",
			refetchSnapshot: async () => authoritative,
		});

		expect(transport.starts).toHaveLength(starts ? 1 : 0);
		if (starts) {
			expect(transport.starts[0]).toMatchObject({
				sourceRevision: authoritative.sourceRevision,
				destinationRevision: authoritative.destinationRevision,
			});
			expect(await store.getAuthoritativeRevision(request, 3)).toMatchObject({
				sourceRevision: authoritative.sourceRevision,
				observedAt: "2026-07-29T12:00:00.001Z",
				eventId: "candidate",
			});
		}
	});

	test("does not let a far-future wall clock suppress a delayed newer revision", async () => {
		const store = new FakePipelineCoordinationStore();
		await store.recordAuthoritativeRevision({
			request,
			generation: 3,
			sourceRevision: "a".repeat(40),
			observedAt: "2026-07-29T12:00:00.000Z",
			eventId: "winner",
		});
		const transport = new RecordingPipelineTransport();
		const dispatcher = new PipelineReviewDispatcher({
			pipelineName: "pipeline",
			transport,
			store,
			reconciler: new RecordingKick(),
			clock: () => new Date("2027-07-29T12:00:00.000Z"),
		});
		const delayedNewerSnapshot = {
			...snapshot,
			sourceRevision: "d".repeat(40),
			destinationRevision: "e".repeat(40),
		};

		await dispatcher.startReviewPipeline({
			snapshot,
			generation: 3,
			observedAt: "2026-07-29T12:00:00.000Z",
			eventId: "equal-time-candidate",
			refetchSnapshot: async () => snapshot,
		});
		await dispatcher.startReviewPipeline({
			snapshot: delayedNewerSnapshot,
			generation: 3,
			observedAt: "2026-07-29T12:00:01.000Z",
			eventId: "delayed-newer",
			refetchSnapshot: async () => delayedNewerSnapshot,
		});

		expect(transport.starts).toEqual([
			expect.objectContaining({
				sourceRevision: snapshot.sourceRevision,
				destinationRevision: snapshot.destinationRevision,
			}),
			expect.objectContaining({
				sourceRevision: delayedNewerSnapshot.sourceRevision,
				destinationRevision: delayedNewerSnapshot.destinationRevision,
			}),
		]);
		expect(await store.getAuthoritativeRevision(request, 3)).toMatchObject({
			sourceRevision: delayedNewerSnapshot.sourceRevision,
			observedAt: "2026-07-29T12:00:01.000Z",
			eventId: "delayed-newer",
		});
	});

	test("retries multiple equal-time contentions and starts the final exact snapshot", async () => {
		const store = new ContendedRevisionStore(2);
		const transport = new RecordingPipelineTransport();
		const dispatcher = new PipelineReviewDispatcher({
			pipelineName: "pipeline",
			transport,
			store,
			reconciler: new RecordingKick(),
			clock: () => new Date("2026-07-29T11:00:00.000Z"),
		});
		const third = {
			...snapshot,
			sourceRevision: "d".repeat(40),
			destinationRevision: "e".repeat(40),
		};

		await dispatcher.startReviewPipeline({
			snapshot,
			generation: 3,
			observedAt: "2026-07-29T12:00:00.000Z",
			eventId: "opaque-event",
			refetchSnapshot: async () => third,
		});

		expect(store.proposals.map((marker) => marker.observedAt)).toEqual([
			"2026-07-29T12:00:00.000Z",
			"2026-07-29T12:00:00.001Z",
			"2026-07-29T12:00:00.002Z",
		]);
		expect(transport.starts[0]).toMatchObject({
			sourceRevision: third.sourceRevision,
			destinationRevision: third.destinationRevision,
		});
	});

	test("throws a typed retryable error when bounded arbitration is exhausted", async () => {
		const store = new ContendedRevisionStore(10);
		const transport = new RecordingPipelineTransport();
		const dispatcher = new PipelineReviewDispatcher({
			pipelineName: "pipeline",
			transport,
			store,
			reconciler: new RecordingKick(),
			clock: () => new Date("2026-07-29T11:00:00.000Z"),
		});

		await expect(
			dispatcher.startReviewPipeline({
				snapshot,
				generation: 3,
				observedAt: "2026-07-29T12:00:00.000Z",
				eventId: "opaque-event",
				refetchSnapshot: async () => snapshot,
			}),
		).rejects.toBeInstanceOf(AuthoritativeRevisionArbitrationExhaustedError);
		expect(store.proposals).toHaveLength(4);
		expect(transport.starts).toHaveLength(0);
		expect(
			classifyRetryError(new AuthoritativeRevisionArbitrationExhaustedError()),
		).toBe("retryable");
	});

	test("does not start a pipeline for a terminal snapshot", async () => {
		const transport = new RecordingPipelineTransport();
		const dispatcher = new PipelineReviewDispatcher({
			pipelineName: "pipeline",
			transport,
			store: new FakePipelineCoordinationStore(),
			reconciler: new RecordingKick(),
		});
		await dispatcher.startReviewPipeline({
			snapshot: { ...snapshot, status: "merged" },
			generation: 3,
			observedAt: "2026-07-29T12:00:00.000Z",
			eventId: "terminal",
			refetchSnapshot: async () => snapshot,
		});
		expect(transport.starts).toHaveLength(0);
	});
});
