import { describe, expect, test } from "bun:test";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { StartReviewPipelineExecution } from "../src/reviewer/adapters/codepipeline-transport";
import type { ReviewRequest } from "../src/reviewer/domain/review-request";
import type { CallbackIntent } from "../src/reviewer/pipeline/pipeline-coordination-store";
import { PipelineReviewDispatcher } from "../src/reviewer/pipeline-review-common";
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

	test("orders authoritative revisions and only dispatches the logical winner", async () => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingPipelineTransport();
		const dispatcher = new PipelineReviewDispatcher({
			pipelineName: "pipeline",
			transport,
			store,
			reconciler: new RecordingKick(),
		});
		const start = (input: {
			readonly revision: string;
			readonly generation?: number;
			readonly observedAt: string;
			readonly eventId: string;
		}) =>
			dispatcher.startReviewPipeline({
				snapshot: { ...snapshot, sourceRevision: input.revision },
				generation: input.generation ?? 3,
				observedAt: input.observedAt,
				eventId: input.eventId,
			});

		await start({
			revision: "b".repeat(40),
			observedAt: "2026-07-29T12:00:01.000Z",
			eventId: "event-b",
		});
		await start({
			revision: "a".repeat(40),
			observedAt: "2026-07-29T12:00:00.000Z",
			eventId: "event-a",
		});
		await start({
			revision: "b".repeat(40),
			observedAt: "2026-07-29T12:00:01Z",
			eventId: "event-b",
		});
		await start({
			revision: "c".repeat(40),
			observedAt: "2026-07-29T12:00:01.000Z",
			eventId: "event-a",
		});
		await start({
			revision: "d".repeat(40),
			observedAt: "2026-07-29T12:00:01.000Z",
			eventId: "event-b",
		});
		await start({
			revision: "e".repeat(40),
			observedAt: "2026-07-29T12:00:01.000Z",
			eventId: "event-c",
		});
		await start({
			revision: "f".repeat(40),
			generation: 4,
			observedAt: "2026-07-29T11:00:00.000Z",
			eventId: "generation-four",
		});

		expect(transport.starts.map((input) => input.sourceRevision)).toEqual([
			"b".repeat(40),
			"b".repeat(40),
			"e".repeat(40),
			"f".repeat(40),
		]);
		expect(await store.getAuthoritativeRevision(request, 3)).toMatchObject({
			sourceRevision: "e".repeat(40),
			observedAt: "2026-07-29T12:00:01.000Z",
			eventId: "event-c",
		});
		expect(await store.getAuthoritativeRevision(request, 4)).toMatchObject({
			sourceRevision: "f".repeat(40),
		});
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
		});
		expect(transport.starts).toHaveLength(0);
	});
});
