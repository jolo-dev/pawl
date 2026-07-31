import { describe, expect, spyOn, test } from "bun:test";
import {
	buildPipelineReconciler,
	type PipelineJobResultTransport,
} from "../src/reviewer/handlers/pipeline-reconciler";
import { FakePipelineCoordinationStore } from "./pipeline-coordination-fakes";

const request = {
	provider: "codecommit",
	repository: "orders",
	requestId: "42",
} as const;
const now = "2026-07-29T12:00:00.000Z";

class RecordingResultTransport implements PipelineJobResultTransport {
	readonly attempts: string[] = [];
	readonly successes: string[] = [];
	readonly failures: Array<{
		jobId: string;
		category: string;
		message: string;
	}> = [];
	readonly errorsByJob = new Map<string, Error>();
	error?: Error;
	async putJobSuccess(jobId: string): Promise<void> {
		this.attempts.push(jobId);
		const error = this.errorsByJob.get(jobId) ?? this.error;
		if (error) throw error;
		this.successes.push(jobId);
	}
	async putJobFailure(input: {
		readonly jobId: string;
		readonly category: string;
		readonly message: string;
	}): Promise<void> {
		this.attempts.push(input.jobId);
		const error = this.errorsByJob.get(input.jobId) ?? this.error;
		if (error) throw error;
		this.failures.push(input);
	}
}

const pendingJob = (
	jobId: string,
	overrides: Record<string, unknown> = {},
) => ({
	jobId,
	state: "PENDING" as const,
	pipelineExecutionId: `exec-${jobId}`,
	pipelineName: "pipeline",
	stageName: "Build",
	actionName: "AIReview",
	request,
	generation: 3,
	sourceRevision: "a".repeat(40),
	destinationRevision: "b".repeat(40),
	deadlineAt: "2026-07-29T13:00:00.000Z",
	nextActionAt: now,
	...overrides,
});

describe("pipeline review reconciler", () => {
	test("completes reviewed outcomes successfully regardless of findings", async () => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingResultTransport();
		await store.registerJob(pendingJob("reviewed"));
		await store.recordOutcome({
			request,
			generation: 3,
			sourceRevision: "a".repeat(40),
			cycle: 1,
			status: "reviewed",
			checkStatus: "completed",
		});
		const reconcile = buildPipelineReconciler({
			store,
			transport,
			clock: () => new Date(now),
		});

		await reconcile("reviewed");

		expect(transport.successes).toEqual(["reviewed"]);
		expect(store.jobs.get("reviewed")?.state).toBe("SUCCEEDED");
	});

	test("fails blocked, configuration, superseded, and timed-out jobs", async () => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingResultTransport();
		for (const [jobId, category] of [
			["blocked", "ReviewBlocked"],
			["configuration", "ConfigurationError"],
			["superseded", "Superseded"],
		] as const) {
			await store.registerJob(
				pendingJob(jobId, {
					callbackCandidate: { status: "failure", category },
				}),
			);
		}
		await store.registerJob(
			pendingJob("timeout", { deadlineAt: "2026-07-29T11:59:00.000Z" }),
		);
		const reconcile = buildPipelineReconciler({
			store,
			transport,
			clock: () => new Date(now),
		});

		await reconcile();

		expect(transport.failures.map(({ category }) => category).sort()).toEqual([
			"ConfigurationError",
			"ReviewBlocked",
			"Superseded",
			"TimedOut",
		]);
	});

	test("redrives an expired completion lease with the immutable intent", async () => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingResultTransport();
		const intent = { status: "failure", category: "ReviewFailed" } as const;
		await store.registerJob(
			pendingJob("retry", {
				state: "COMPLETING",
				terminalIntent: intent,
				completionLeaseExpiresAt: "2026-07-29T11:59:00.000Z",
			}),
		);
		const reconcile = buildPipelineReconciler({
			store,
			transport,
			clock: () => new Date(now),
		});

		await reconcile("retry");

		expect(transport.failures[0]?.category).toBe("ReviewFailed");
		expect(store.jobs.get("retry")?.terminalIntent).toEqual(intent);
		expect(store.jobs.get("retry")?.state).toBe("FAILED");
	});

	test("reschedules an ambiguous transient callback without terminal completion or intent mutation", async () => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingResultTransport();
		const intent = {
			status: "failure",
			category: "ReviewFailed",
			message: "Review could not be completed",
		} as const;
		transport.error = Object.assign(new Error("temporary callback failure"), {
			name: "ServiceUnavailableException",
		});
		await store.registerJob(
			pendingJob("ambiguous", { callbackCandidate: intent }),
		);
		const reconcile = buildPipelineReconciler({
			store,
			transport,
			clock: () => new Date(now),
		});

		await expect(reconcile("ambiguous")).rejects.toThrow(
			"temporary callback failure",
		);

		const job = store.jobs.get("ambiguous");
		expect(transport.attempts).toEqual(["ambiguous"]);
		expect(job?.state).toBe("COMPLETING");
		expect(job?.terminalIntent).toEqual(intent);
		expect(job?.completionLeaseExpiresAt).toBe("2026-07-29T12:02:00.000Z");
		expect(job?.nextActionAt).toBe("2026-07-29T12:02:00.000Z");
	});

	test("continues reconciling later jobs after one callback fails", async () => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingResultTransport();
		transport.errorsByJob.set(
			"bad",
			Object.assign(new Error("temporary callback failure"), {
				name: "ServiceUnavailableException",
			}),
		);
		for (const jobId of ["bad", "later"]) {
			await store.registerJob(
				pendingJob(jobId, {
					callbackCandidate: {
						status: "success",
						category: "ReviewSucceeded",
					},
				}),
			);
		}
		const reconcile = buildPipelineReconciler({
			store,
			transport,
			clock: () => new Date(now),
		});
		const consoleError = spyOn(console, "error").mockImplementation(
			() => undefined,
		);

		await reconcile();

		expect(transport.attempts).toEqual(["bad", "later"]);
		expect(store.jobs.get("bad")?.state).toBe("COMPLETING");
		expect(store.jobs.get("later")?.state).toBe("SUCCEEDED");
		expect(consoleError).toHaveBeenCalledTimes(1);
		consoleError.mockRestore();
	});

	test("treats an already-completed callback as terminal confirmation", async () => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingResultTransport();
		transport.error = Object.assign(new Error("already completed"), {
			name: "InvalidJobStateException",
		});
		await store.registerJob(
			pendingJob("already", {
				callbackCandidate: { status: "success", category: "RequestClosed" },
			}),
		);
		const reconcile = buildPipelineReconciler({
			store,
			transport,
			clock: () => new Date(now),
		});

		await reconcile("already");

		expect(store.jobs.get("already")?.state).toBe("SUCCEEDED");
	});
});
