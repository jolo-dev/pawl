import { describe, expect, test } from "bun:test";
import type { StartReviewPipelineExecution } from "../src/reviewer/adapters/codepipeline-transport";
import type { ReviewRequest } from "../src/reviewer/domain/review-request";
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
	test("supersedes older jobs and starts the exact authoritative revision", async () => {
		const store = new FakePipelineCoordinationStore();
		await store.registerJob(pendingJob("old", "a".repeat(40)));
		const transport = new RecordingPipelineTransport();
		const kick = new RecordingKick();
		const dispatcher = new PipelineReviewDispatcher({
			pipelineName: "pipeline",
			transport,
			store,
			reconciler: kick,
			clock: () => new Date("2026-07-29T12:00:00.000Z"),
		});

		await dispatcher.startReviewPipeline({ snapshot, generation: 3 });

		expect(store.jobs.get("old")?.callbackCandidate).toEqual({
			status: "failure",
			category: "Superseded",
		});
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

	test("marks only pending jobs successful when a request closes", async () => {
		const store = new FakePipelineCoordinationStore();
		await store.registerJob(pendingJob("pending", snapshot.sourceRevision));
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
			status: "closed",
		});

		expect(store.jobs.get("pending")?.callbackCandidate).toEqual({
			status: "success",
			category: "RequestClosed",
		});
		expect(store.jobs.get("completing")?.terminalIntent).toEqual({
			status: "failure",
			category: "ReviewFailed",
		});
		expect(kick.count).toBe(1);
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
		});
		expect(transport.starts).toHaveLength(0);
	});
});
