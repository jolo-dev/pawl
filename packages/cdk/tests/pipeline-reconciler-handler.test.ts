import { describe, expect, spyOn, test } from "bun:test";
import { PipelineReviewCycleObserver } from "../src/reviewer/adapters/pipeline-review-cycle-observer";
import {
	buildPipelineReconciler,
	type PipelineJobResultTransport,
} from "../src/reviewer/handlers/pipeline-reconciler";
import { PipelineReviewDispatcher } from "../src/reviewer/pipeline-review-common";
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
	test.each([
		["merged", "RequestMerged", "dispatcher"],
		["closed", "RequestClosed", "observer"],
	] as const)("completes a late-registered job after a durable %s terminal request from the %s", async (status, category, producer) => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingResultTransport();
		const noopKick = { invoke: async () => undefined };
		if (producer === "dispatcher") {
			const dispatcher = new PipelineReviewDispatcher({
				pipelineName: "pipeline",
				transport: {
					startExecution: async () => ({ executionId: "unused" }),
				},
				store,
				reconciler: noopKick,
				clock: () => new Date(now),
			});
			await dispatcher.completeTerminalRequest({
				request,
				generation: 3,
				status,
			});
		} else {
			const observer = new PipelineReviewCycleObserver({
				store,
				reconciler: noopKick,
				clock: () => new Date(now),
			});
			await observer.recordTerminalRequest({
				request,
				generation: 3,
				status,
			});
		}

		await store.registerJob(
			pendingJob(`late-${status}`, {
				deadlineAt: "2026-07-29T11:59:00.000Z",
			}),
		);
		const reconcile = buildPipelineReconciler({
			store,
			transport,
			clock: () => new Date(now),
		});
		await reconcile(`late-${status}`);

		expect(transport.successes).toEqual([`late-${status}`]);
		expect(transport.failures).toEqual([]);
		expect(store.jobs.get(`late-${status}`)).toMatchObject({
			state: "SUCCEEDED",
			terminalIntent: { status: "success", category },
		});
	});

	test("fails a late old-revision job after the newer marker's eager scan", async () => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingResultTransport();
		const dispatcher = new PipelineReviewDispatcher({
			pipelineName: "pipeline",
			transport: {
				startExecution: async () => ({ executionId: "new-execution" }),
			},
			store,
			reconciler: { invoke: async () => undefined },
			clock: () => new Date(now),
		});
		await dispatcher.startReviewPipeline({
			snapshot: {
				key: request,
				title: "Review",
				status: "open",
				sourceBranch: "feature",
				destinationBranch: "main",
				sourceRevision: "b".repeat(40),
				destinationRevision: "c".repeat(40),
			},
			generation: 3,
			observedAt: now,
			eventId: "new-revision",
		});
		await store.registerJob(
			pendingJob("late-old", {
				sourceRevision: "a".repeat(40),
				deadlineAt: "2026-07-29T13:00:00.000Z",
			}),
		);
		const reconcile = buildPipelineReconciler({
			store,
			transport,
			clock: () => new Date(now),
		});

		await reconcile("late-old");

		expect(transport.successes).toEqual([]);
		expect(transport.failures).toEqual([
			{
				jobId: "late-old",
				category: "Superseded",
				message: "Superseded",
			},
		]);
		expect(store.jobs.get("late-old")?.state).toBe("FAILED");
	});

	test("refreshes all signals when the authoritative marker changes before claim", async () => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingResultTransport();
		await store.registerJob(
			pendingJob("marker-race", {
				deadlineAt: "2026-07-29T11:59:00.000Z",
			}),
		);
		await store.recordAuthoritativeRevision({
			request,
			generation: 3,
			sourceRevision: "a".repeat(40),
			observedAt: "2026-07-29T11:59:00.000Z",
			eventId: "old-revision",
		});
		await store.recordOutcome({
			request,
			generation: 3,
			sourceRevision: "a".repeat(40),
			status: "reviewed",
			checkStatus: "completed",
		});
		let attempts = 0;
		store.beforeClaim = async () => {
			attempts += 1;
			store.beforeClaim = undefined;
			await store.recordAuthoritativeRevision({
				request,
				generation: 3,
				sourceRevision: "b".repeat(40),
				observedAt: now,
				eventId: "new-revision",
			});
		};
		const reconcile = buildPipelineReconciler({
			store,
			transport,
			clock: () => new Date(now),
		});

		await reconcile("marker-race");

		expect(attempts).toBe(1);
		expect(transport.successes).toEqual([]);
		expect(transport.failures[0]?.category).toBe("Superseded");
		expect(store.jobs.get("marker-race")?.terminalIntent).toEqual({
			status: "failure",
			category: "Superseded",
		});
	});

	test("keeps a matching outcome ahead of the durable terminal marker", async () => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingResultTransport();
		await store.recordTerminalRequestState({
			request,
			generation: 3,
			status: "closed",
			occurredAt: now,
		});
		await store.registerJob(pendingJob("outcome-first"));
		await store.recordOutcome({
			request,
			generation: 3,
			sourceRevision: "a".repeat(40),
			status: "blocked",
			checkStatus: "blocked",
		});
		const reconcile = buildPipelineReconciler({
			store,
			transport,
			clock: () => new Date(now),
		});

		await reconcile("outcome-first");

		expect(transport.failures[0]?.category).toBe("ReviewBlocked");
		expect(store.jobs.get("outcome-first")?.state).toBe("FAILED");
	});

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

	test("refreshes after a superseded candidate appears between read and claim", async () => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingResultTransport();
		await store.registerJob(
			pendingJob("candidate-race", {
				deadlineAt: "2026-07-29T11:59:00.000Z",
			}),
		);
		store.beforeClaim = async () => {
			store.beforeClaim = undefined;
			await store.setCallbackCandidate("candidate-race", {
				status: "failure",
				category: "Superseded",
			});
		};
		const reconcile = buildPipelineReconciler({
			store,
			transport,
			clock: () => new Date(now),
		});

		await reconcile("candidate-race");

		expect(transport.failures[0]?.category).toBe("Superseded");
		expect(store.jobs.get("candidate-race")?.terminalIntent).toEqual({
			status: "failure",
			category: "Superseded",
		});
	});

	test("refreshes after a matching outcome appears before timeout claim", async () => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingResultTransport();
		await store.registerJob(
			pendingJob("outcome-race", {
				deadlineAt: "2026-07-29T11:59:00.000Z",
			}),
		);
		store.beforeClaim = async () => {
			store.beforeClaim = undefined;
			await store.recordOutcome({
				request,
				generation: 3,
				sourceRevision: "a".repeat(40),
				status: "blocked",
				checkStatus: "blocked",
			});
		};
		const reconcile = buildPipelineReconciler({
			store,
			transport,
			clock: () => new Date(now),
		});

		await reconcile("outcome-race");

		expect(transport.failures[0]?.category).toBe("ReviewBlocked");
	});

	test("refreshes after a terminal marker appears before timeout claim", async () => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingResultTransport();
		await store.registerJob(
			pendingJob("terminal-race", {
				deadlineAt: "2026-07-29T11:59:00.000Z",
			}),
		);
		store.beforeClaim = async () => {
			store.beforeClaim = undefined;
			await store.recordTerminalRequestState({
				request,
				generation: 3,
				status: "merged",
				occurredAt: now,
			});
		};
		const reconcile = buildPipelineReconciler({
			store,
			transport,
			clock: () => new Date(now),
		});

		await reconcile("terminal-race");

		expect(transport.successes).toEqual(["terminal-race"]);
		expect(store.jobs.get("terminal-race")?.terminalIntent).toEqual({
			status: "success",
			category: "RequestMerged",
		});
	});

	test("refreshes every signal after successive snapshot races", async () => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingResultTransport();
		await store.registerJob(
			pendingJob("successive-races", {
				deadlineAt: "2026-07-29T11:59:00.000Z",
			}),
		);
		let attempt = 0;
		store.beforeClaim = async () => {
			attempt += 1;
			if (attempt === 1) {
				await store.recordTerminalRequestState({
					request,
					generation: 3,
					status: "closed",
					occurredAt: now,
				});
			} else if (attempt === 2) {
				await store.recordOutcome({
					request,
					generation: 3,
					sourceRevision: "a".repeat(40),
					status: "failed",
					checkStatus: "failed",
				});
			} else {
				store.beforeClaim = undefined;
			}
		};
		const reconcile = buildPipelineReconciler({
			store,
			transport,
			clock: () => new Date(now),
		});

		await reconcile("successive-races");

		expect(attempt).toBe(3);
		expect(transport.failures[0]?.category).toBe("ReviewFailed");
	});

	test("keeps the selected intent immutable when claim wins before a later signal", async () => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingResultTransport();
		await store.registerJob(
			pendingJob("claim-wins", {
				deadlineAt: "2026-07-29T11:59:00.000Z",
			}),
		);
		store.afterClaim = async () => {
			store.afterClaim = undefined;
			await store.recordOutcome({
				request,
				generation: 3,
				sourceRevision: "a".repeat(40),
				status: "reviewed",
				checkStatus: "completed",
			});
		};
		const reconcile = buildPipelineReconciler({
			store,
			transport,
			clock: () => new Date(now),
		});

		await reconcile("claim-wins");

		expect(transport.failures[0]?.category).toBe("TimedOut");
		expect(store.jobs.get("claim-wins")?.terminalIntent).toEqual({
			status: "failure",
			category: "TimedOut",
		});
	});

	test("fails safely without callback for partially identified jobs", async () => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingResultTransport();
		await store.registerJob({
			jobId: "partial",
			state: "PENDING",
			request,
			callbackCandidate: {
				status: "failure",
				category: "ConfigurationError",
			},
		});
		const reconcile = buildPipelineReconciler({
			store,
			transport,
			clock: () => new Date(now),
		});

		await expect(reconcile("partial")).rejects.toThrow(
			"partial pipeline job identity",
		);
		expect(transport.attempts).toEqual([]);
	});

	test("claims an unidentified configuration error when candidate property order changes during normalization", async () => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingResultTransport();
		await store.registerJob({
			jobId: "unidentified-configuration",
			state: "PENDING",
			callbackCandidate: {
				status: "failure",
				category: "ConfigurationError",
				message: "Review configuration is invalid",
			},
		});
		const reconcile = buildPipelineReconciler({
			store,
			transport,
			clock: () => new Date(now),
		});

		await reconcile("unidentified-configuration");

		expect(transport.failures).toEqual([
			{
				jobId: "unidentified-configuration",
				category: "ConfigurationError",
				message: "Review configuration is invalid",
			},
		]);
		expect(store.jobs.get("unidentified-configuration")).toMatchObject({
			state: "FAILED",
			terminalIntent: {
				status: "failure",
				category: "ConfigurationError",
				message: "Review configuration is invalid",
			},
		});
	});

	test("fails a persisted superseded job despite a late successful outcome", async () => {
		const store = new FakePipelineCoordinationStore();
		const transport = new RecordingResultTransport();
		await store.registerJob(
			pendingJob("superseded-with-outcome", {
				callbackCandidate: {
					status: "failure",
					category: "Superseded",
				},
			}),
		);
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

		await reconcile("superseded-with-outcome");

		expect(transport.successes).toEqual([]);
		expect(transport.failures).toEqual([
			{
				jobId: "superseded-with-outcome",
				category: "Superseded",
				message: "Superseded",
			},
		]);
		expect(store.jobs.get("superseded-with-outcome")?.state).toBe("FAILED");
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
		await store.recordTerminalRequestState({
			request,
			generation: 3,
			status: "merged",
			occurredAt: now,
		});
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
