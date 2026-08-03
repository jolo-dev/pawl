import { expect, test } from "bun:test";
import type {
	LeaseRecoveryInput,
	LeaseRecoveryResult,
} from "../../../src/reviewer/ports/state-store";
import {
	durableExecutionName,
	EventRouter,
} from "../../../src/reviewer/router/event-router";
import { RetryPolicy } from "../../../src/reviewer/services/retry-policy";
import { InMemoryStateStore } from "../fakes/in-memory-state-store";

const request = {
	provider: "codecommit",
	repository: "repo",
	requestId: "7",
} as const;
const event = {
	id: "event",
	type: "request-opened" as const,
	occurredAt: "2026-01-01T00:00:00.000Z",
	request,
};
function commandInput(command: unknown): Record<string, unknown> {
	return (command as { input: Record<string, unknown> }).input;
}

class ConditionalRecoveryLoserStore extends InMemoryStateStore {
	#raceInjected = false;

	override async recoverLease(
		input: LeaseRecoveryInput,
	): Promise<LeaseRecoveryResult> {
		if (!this.#raceInjected && input.remoteStatus !== undefined) {
			this.#raceInjected = true;
			const winner = await super.recoverLease(input);
			if (!winner.recovered)
				throw new Error("expected competing recovery to win");
		}
		return super.recoverLease(input);
	}
}

class TerminalCompletionRaceStore extends InMemoryStateStore {
	#raceInjected = false;

	override async recoverLease(
		input: LeaseRecoveryInput,
	): Promise<LeaseRecoveryResult> {
		if (!this.#raceInjected) {
			this.#raceInjected = true;
			await super.complete(input.request, input.generation, {
				type: "failed",
				failure: {
					type: "operational-failure",
					lifecycleState: "FAILED",
					operation: "review",
					reason: "permanent-error",
					attempts: 1,
					lastError: { name: "Error", message: "review failed" },
				},
				ownership: { kind: "lease", leaseVersion: input.leaseVersion },
			});
		}
		return super.recoverLease(input);
	}
}

test("appends before invoking a named durable execution and records its ARN", async () => {
	const store = new InMemoryStateStore();
	const commands: unknown[] = [];
	const router = new EventRouter({
		stateStore: store,
		provider: {} as never,
		reviewerFunctionName: "reviewer",
		reviewerAlias: "live",
		reviewerArn: "arn:reviewer",
		lambda: {
			send: async (command: unknown) => {
				commands.push(command);
				return { DurableExecutionArn: "arn:execution" };
			},
		},
		repositoryHash: (repository) =>
			repository === "repo" ? "hash" : repository,
	});
	await router.route({
		id: "event",
		type: "request-opened",
		occurredAt: "2026-01-01T00:00:00.000Z",
		request: { provider: "codecommit", repository: "repo", requestId: "7" },
	});
	expect(
		store.inspectRequest({
			provider: "codecommit",
			repository: "repo",
			requestId: "7",
		})?.lifecycleState,
	).toBe("RUNNING");
	expect(commands).toHaveLength(1);
	expect(
		(
			commands[0] as {
				input: { DurableExecutionName: string; Qualifier: string };
			}
		).input.DurableExecutionName,
	).toBe(durableExecutionName("codecommit", "hash", "7", 1));
	expect(
		(commands[0] as { input: { Qualifier: string } }).input.Qualifier,
	).toBe("live");
});

test("callback wake sends UTF-8 JSON and stale callbacks are no-op", async () => {
	const store = new InMemoryStateStore({
		clock: () => new Date("2026-01-01T00:00:00.000Z"),
	});
	const sent: unknown[] = [];
	const router = new EventRouter({
		stateStore: store,
		provider: {} as never,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		lambda: {
			send: async (command: unknown) => {
				sent.push(command);
				return { DurableExecutionArn: "arn:execution" };
			},
		},
	});
	await router.route(event);
	await store.registerCallback({
		request,
		generation: 1,
		callbackId: "callback",
		callbackGeneration: 1,
		lifecycleState: "WAITING",
		registeredAt: "2026-01-01T00:00:01.000Z",
		leaseVersion: 1,
	});
	await router.wake({
		callbackId: "callback",
		request,
		generation: 1,
		callbackGeneration: 1,
		leaseVersion: 1,
	});
	expect(
		new TextDecoder().decode(
			(sent.at(-1) as { input: { Result: Uint8Array } }).input.Result,
		),
	).toContain("callback");
	await router.wake({
		callbackId: "expired",
		request,
		generation: 0,
		callbackGeneration: 0,
		leaseVersion: 1,
	});
	expect(
		sent.filter(
			(command) => (command as { kind?: string }).kind === "callback",
		),
	).toHaveLength(1);
});

test("recovers duplicate durable names by listing the base function then getting the matching execution", async () => {
	const store = new InMemoryStateStore();
	const commands: unknown[] = [];
	const router = new EventRouter({
		stateStore: store,
		provider: {} as never,
		reviewerFunctionName: "reviewer",
		reviewerAlias: "live",
		reviewerArn: "arn:reviewer",
		repositoryHash: () => "hash",
		lambda: {
			send: async (command: unknown) => {
				commands.push(command);
				const name = (command as { kind?: string }).kind ?? "unknown";
				if (name === "invoke")
					throw Object.assign(new Error("duplicate"), {
						name: "DurableExecutionAlreadyStartedException",
					});
				if (name === "list")
					return {
						DurableExecutions: [
							{
								DurableExecutionName: "other",
								DurableExecutionArn: "arn:other",
							},
							{
								DurableExecutionName: "codecommit-hash-7-g1",
								DurableExecutionArn: "arn:execution",
							},
						],
					};
				return { Status: "RUNNING", DurableExecutionArn: "arn:execution" };
			},
		},
	});
	const result = await router.route(event);
	expect(result.durableExecutionArn).toBe("arn:execution");
	expect(commands.map((command) => (command as { kind: string }).kind)).toEqual(
		["invoke", "list", "status"],
	);
	expect(commandInput(commands[0])).toMatchObject({
		FunctionName: "reviewer",
		Qualifier: "live",
		DurableExecutionName: "codecommit-hash-7-g1",
	});
	expect(commandInput(commands[1])).toEqual({
		FunctionName: "reviewer",
		DurableExecutionName: "codecommit-hash-7-g1",
	});
	expect(commandInput(commands[2])).toEqual({
		DurableExecutionArn: "arn:execution",
		IncludeExecutionData: false,
	});
});

test("persists FAILED for permanent and exhausted start failures", async () => {
	for (const mode of ["permanent", "retryable"] as const) {
		const store = new InMemoryStateStore();
		const router = new EventRouter({
			stateStore: store,
			provider: {} as never,
			reviewerFunctionName: "reviewer",
			reviewerArn: "arn:reviewer",
			retryPolicy: new RetryPolicy({
				baseDelayMs: 0,
				maxDelayMs: 0,
				maxAttempts: mode === "retryable" ? 2 : 1,
				sleep: async () => undefined,
			}),
			lambda: {
				send: async () => {
					throw Object.assign(new Error(mode), {
						name:
							mode === "retryable"
								? "ThrottlingException"
								: "AccessDeniedException",
					});
				},
			},
		});
		await router.route({ ...event, id: `failure-${mode}` });
		expect(store.inspectRequest(request)?.lifecycleState).toBe("FAILED");
	}
});

test("passes the normalized event timestamp and id to pipeline dispatch", async () => {
	const store = new InMemoryStateStore();
	const starts: unknown[] = [];
	const router = new EventRouter({
		stateStore: store,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		provider: {
			getRequest: async () => ({
				key: request,
				title: "Review",
				status: "open",
				sourceBranch: "feature",
				destinationBranch: "main",
				sourceRevision: "source-1",
				destinationRevision: "base-123",
			}),
		} as never,
		pipelineDispatcher: {
			startReviewPipeline: async (input) => {
				starts.push(input);
			},
			completeTerminalRequest: async () => undefined,
		},
		lambda: { send: async () => ({ DurableExecutionArn: "arn:execution" }) },
	});

	await router.routeCodeCommit({
		id: "revision-event-1",
		time: "2026-01-01T01:00:00+01:00",
		source: "aws.codecommit",
		"detail-type": "CodeCommit Pull Request State Change",
		detail: {
			repositoryName: "repo",
			pullRequestId: "7",
			event: "pullRequestSourceBranchUpdated",
			sourceCommit: "source-1",
			destinationCommit: "base-123",
		},
	});

	expect(starts).toEqual([
		expect.objectContaining({
			snapshot: expect.objectContaining({ sourceRevision: "source-1" }),
			generation: 1,
			observedAt: "2026-01-01T00:00:00.000Z",
			eventId: "revision-event-1",
			refetchSnapshot: expect.any(Function),
			dispatchIntent: expect.objectContaining({
				status: "PENDING",
				sourceRevision: "source-1",
				destinationRevision: "base-123",
			}),
		}),
	]);
});

test("pins reviewed pipeline arbitration to the immutable dispatch intent", async () => {
	const store = new InMemoryStateStore();
	let providerCalls = 0;
	let refetchedRevision: string | undefined;
	const router = new EventRouter({
		stateStore: store,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		retryPolicy: new RetryPolicy({
			baseDelayMs: 0,
			maxDelayMs: 0,
			maxAttempts: 2,
			sleep: async () => undefined,
		}),
		provider: {
			getRequest: async () => {
				providerCalls += 1;
				if (providerCalls === 2) {
					throw Object.assign(new Error("retry refetch"), {
						name: "ThrottlingException",
					});
				}
				return {
					key: request,
					title: "Review",
					status: "open",
					sourceBranch: "feature",
					destinationBranch: "main",
					sourceRevision: providerCalls === 1 ? "source-1" : "source-2",
					destinationRevision: "base-123",
				};
			},
		} as never,
		pipelineDispatcher: {
			startReviewPipeline: async (input) => {
				refetchedRevision = (await input.refetchSnapshot()).sourceRevision;
			},
			completeTerminalRequest: async () => undefined,
		},
		lambda: { send: async () => ({ DurableExecutionArn: "arn:execution" }) },
	});

	await router.routeCodeCommit({
		id: "revision-event-refetch",
		time: "2026-01-01T00:00:00.000Z",
		source: "aws.codecommit",
		"detail-type": "CodeCommit Pull Request State Change",
		detail: {
			repositoryName: "repo",
			pullRequestId: "7",
			event: "pullRequestSourceBranchUpdated",
			sourceCommit: "source-1",
			destinationCommit: "base-123",
		},
	});

	expect(providerCalls).toBe(1);
	expect(refetchedRevision).toBe("source-1");
});

test("records permanent provider refetch failures accurately", async () => {
	const store = new InMemoryStateStore();
	const router = new EventRouter({
		stateStore: store,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		provider: {
			getRequest: async () => {
				throw Object.assign(new Error("refetch denied"), {
					name: "AccessDeniedException",
				});
			},
		} as never,
		lambda: { send: async () => ({ DurableExecutionArn: "arn:execution" }) },
	});

	await router.routeCodeCommit({
		id: "permanent-refetch",
		time: "2026-01-01T00:00:00.000Z",
		source: "aws.codecommit",
		"detail-type": "CodeCommit Pull Request State Change",
		detail: {
			repositoryName: "repo",
			pullRequestId: "7",
			event: "pullRequestCreated",
		},
	});

	expect(store.inspectRequest(request)?.completionReason).toMatchObject({
		type: "failed",
		failure: {
			operation: "provider-refetch",
			reason: "permanent-error",
			attempts: 1,
			lastError: {
				name: "AccessDeniedException",
				message: "refetch denied",
			},
		},
	});
});

test("records permanent start failures accurately", async () => {
	const store = new InMemoryStateStore();
	const router = new EventRouter({
		stateStore: store,
		provider: {} as never,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		lambda: {
			send: async () => {
				throw Object.assign(new Error("start denied"), {
					name: "AccessDeniedException",
				});
			},
		},
	});

	await router.route({ ...event, id: "permanent-start" });

	expect(store.inspectRequest(request)?.completionReason).toMatchObject({
		type: "failed",
		failure: {
			operation: "start",
			reason: "permanent-error",
			attempts: 1,
			lastError: {
				name: "AccessDeniedException",
				message: "start denied",
			},
		},
	});
});

test("persists FAILED when callback retries are exhausted", async () => {
	const now = new Date("2026-01-01T00:00:00.000Z");
	const store = new InMemoryStateStore({ clock: () => now });
	const router = new EventRouter({
		stateStore: store,
		provider: {} as never,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		retryPolicy: new RetryPolicy({
			baseDelayMs: 0,
			maxDelayMs: 0,
			maxAttempts: 2,
			sleep: async () => undefined,
		}),
		lambda: {
			send: async (command: unknown) =>
				(command as { kind?: string }).kind === "invoke"
					? { DurableExecutionArn: "arn:execution" }
					: (() => {
							throw Object.assign(new Error("throttle"), {
								name: "ThrottlingException",
							});
						})(),
		},
	});
	await router.route({ ...event, id: "callback-failure" });
	await store.registerCallback({
		request,
		generation: 1,
		callbackId: "callback",
		callbackGeneration: 1,
		lifecycleState: "WAITING",
		registeredAt: now.toISOString(),
		leaseVersion: 1,
	});
	await router.wake({
		request,
		generation: 1,
		callbackId: "callback",
		callbackGeneration: 1,
		leaseVersion: 1,
	});
	expect(store.inspectRequest(request)?.lifecycleState).toBe("FAILED");
});

test("lists the deterministic durable name on the base function before stale STARTING recovery", async () => {
	let now = new Date("2026-01-01T00:00:00.000Z");
	const store = new InMemoryStateStore({
		clock: () => now,
		leaseDurationSeconds: 1,
	});
	const commands: unknown[] = [];
	const router = new EventRouter({
		stateStore: store,
		provider: {} as never,
		reviewerFunctionName: "reviewer",
		reviewerAlias: "live",
		reviewerArn: "arn:reviewer",
		repositoryHash: () => "hash",
		lambda: {
			send: async (command: unknown) => {
				commands.push(command);
				const name = (command as { kind?: string }).kind ?? "unknown";
				if (name === "invoke") return { DurableExecutionArn: "arn:execution" };
				if (name === "list")
					return {
						DurableExecutions: [
							{
								DurableExecutionName: "codecommit-hash-7-g1",
								DurableExecutionArn: "arn:execution",
							},
						],
					};
				return { Status: "RUNNING" };
			},
		},
	});
	await router.route({ ...event, id: "starting-recovery" });
	now = new Date("2026-01-01T00:00:02.000Z");
	await router.recover({
		request,
		generation: 1,
		leaseVersion: 1,
		recoveredAt: now.toISOString(),
	});
	expect(
		commands.map((command) => (command as { kind: string }).kind).slice(-2),
	).toEqual(["list", "status"]);
	expect(commandInput(commands[0])).toMatchObject({
		FunctionName: "reviewer",
		Qualifier: "live",
		DurableExecutionName: "codecommit-hash-7-g1",
	});
	expect(commandInput(commands[1])).toEqual({
		FunctionName: "reviewer",
		DurableExecutionName: "codecommit-hash-7-g1",
	});
	expect(commandInput(commands[2])).toEqual({
		DurableExecutionArn: "arn:execution",
		IncludeExecutionData: false,
	});
});

test("automatically recovers an expired lease when the remote execution failed", async () => {
	let now = new Date("2026-01-01T00:00:00.000Z");
	const store = new InMemoryStateStore({
		clock: () => now,
		leaseDurationSeconds: 1,
	});
	let invokes = 0;
	const router = new EventRouter({
		stateStore: store,
		provider: {} as never,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		repositoryHash: () => "hash",
		clock: () => now,
		lambda: {
			send: async (command) => {
				if (command.kind === "invoke") {
					invokes += 1;
					return { DurableExecutionArn: `arn:execution:${invokes}` };
				}
				if (command.kind === "list") {
					return {
						DurableExecutions: [
							{
								DurableExecutionName: "codecommit-hash-7-g1",
								DurableExecutionArn: "arn:execution:1",
							},
						],
					};
				}
				if (command.kind === "status") return { Status: "FAILED" };
				throw new Error(`unexpected ${command.kind} command`);
			},
		},
	});

	await router.route({ ...event, id: "automatic-recovery-seed" });
	await store.claimEvents(request, 1);
	now = new Date("2026-01-01T00:00:02.000Z");
	const result = await router.route({
		...event,
		id: "automatic-recovery-revision",
		type: "revision-updated",
		occurredAt: now.toISOString(),
		revision: "source-2",
	});

	expect(result).toMatchObject({
		appended: true,
		started: true,
		generation: 2,
	});
	expect(invokes).toBe(2);
	expect(store.inspectRequest(request)).toMatchObject({
		lifecycleState: "RUNNING",
		generation: 2,
	});
});

test("does not look up remote status for pending work on an unexpired RUNNING lease", async () => {
	let now = new Date("2026-01-01T00:00:00.000Z");
	const store = new InMemoryStateStore({
		clock: () => now,
		leaseDurationSeconds: 60,
	});
	const calls: string[] = [];
	const router = new EventRouter({
		stateStore: store,
		provider: {} as never,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		clock: () => now,
		lambda: {
			send: async (command) => {
				calls.push(command.kind);
				if (command.kind === "invoke") {
					return { DurableExecutionArn: "arn:execution:active" };
				}
				throw Object.assign(new Error("transient remote lookup failure"), {
					name: "ThrottlingException",
				});
			},
		},
	});

	await router.route({ ...event, id: "active-recovery-seed" });
	await store.claimEvents(request, 1);
	now = new Date("2026-01-01T00:00:30.000Z");
	const result = await router.route({
		...event,
		id: "active-recovery-pending",
		type: "revision-updated",
		occurredAt: now.toISOString(),
		revision: "source-active",
	});

	expect(result).toMatchObject({ started: false, generation: 1 });
	expect(calls).toEqual(["invoke"]);
	expect(store.inspectRequest(request)?.lifecycleState).toBe("RUNNING");
});

test("does not replace an expired lease while the remote execution is running", async () => {
	let now = new Date("2026-01-01T00:00:00.000Z");
	const store = new InMemoryStateStore({
		clock: () => now,
		leaseDurationSeconds: 1,
	});
	let invokes = 0;
	const router = new EventRouter({
		stateStore: store,
		provider: {} as never,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		repositoryHash: () => "hash",
		clock: () => now,
		lambda: {
			send: async (command) => {
				if (command.kind === "invoke") {
					invokes += 1;
					return { DurableExecutionArn: "arn:execution:1" };
				}
				if (command.kind === "list") {
					return {
						DurableExecutions: [
							{
								DurableExecutionName: "codecommit-hash-7-g1",
								DurableExecutionArn: "arn:execution:1",
							},
						],
					};
				}
				if (command.kind === "status") return { Status: "RUNNING" };
				throw new Error(`unexpected ${command.kind} command`);
			},
		},
	});

	await router.route({ ...event, id: "running-recovery-seed" });
	await store.claimEvents(request, 1);
	now = new Date("2026-01-01T00:00:02.000Z");
	const result = await router.route({
		...event,
		id: "running-recovery-revision",
		type: "revision-updated",
		occurredAt: now.toISOString(),
		revision: "source-2",
	});

	expect(result).toMatchObject({
		appended: true,
		started: false,
		generation: 1,
	});
	expect(invokes).toBe(1);
	expect(store.inspectRequest(request)?.generation).toBe(1);
});

test("recovers terminal completion racing between append and lease recovery", async () => {
	let now = new Date("2026-01-01T00:00:00.000Z");
	let sourceRevision = "source-1";
	const store = new TerminalCompletionRaceStore({
		clock: () => now,
		leaseDurationSeconds: 1,
	});
	const calls: string[] = [];
	const dispatchedGenerations: number[] = [];
	const router = new EventRouter({
		stateStore: store,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		clock: () => now,
		provider: {
			getRequest: async () => ({
				key: request,
				title: "current",
				status: "open",
				sourceBranch: "feature",
				destinationBranch: "main",
				sourceRevision,
				destinationRevision: "base",
			}),
		} as never,
		pipelineDispatcher: {
			startReviewPipeline: async ({ generation }) => {
				dispatchedGenerations.push(generation);
			},
			completeTerminalRequest: async () => undefined,
		},
		lambda: {
			send: async (command) => {
				calls.push(command.kind);
				if (command.kind === "invoke") {
					return { DurableExecutionArn: `arn:execution:${calls.length}` };
				}
				throw new Error(`terminal recovery must not require ${command.kind}`);
			},
		},
	});

	await router.routeCodeCommit({
		id: "terminal-race-seed",
		time: now.toISOString(),
		source: "aws.codecommit",
		"detail-type": "CodeCommit Pull Request State Change",
		detail: {
			repositoryNames: ["repo"],
			pullRequestId: "7",
			event: "pullRequestCreated",
		},
	});
	await store.claimEvents(request, 1);
	now = new Date("2026-01-01T00:00:02.000Z");
	sourceRevision = "source-2";

	const result = await router.routeCodeCommit({
		id: "terminal-race-pending",
		time: now.toISOString(),
		source: "aws.codecommit",
		"detail-type": "CodeCommit Pull Request State Change",
		detail: {
			repositoryNames: ["repo"],
			pullRequestId: "7",
			event: "pullRequestSourceBranchUpdated",
			sourceCommit: sourceRevision,
			destinationCommit: "base",
		},
	});

	expect(result).toMatchObject({
		appended: true,
		started: true,
		generation: 2,
	});
	expect(dispatchedGenerations).toEqual([1, 2]);
	expect(calls).toEqual(["invoke", "invoke"]);
	expect(store.inspectRequest(request)).toMatchObject({
		generation: 2,
		lifecycleState: "RUNNING",
	});
});

test("converges when terminal completion races with a transient remote lookup", async () => {
	let now = new Date("2026-01-01T00:00:00.000Z");
	const store = new InMemoryStateStore({
		clock: () => now,
		leaseDurationSeconds: 1,
	});
	let completed = false;
	let invokes = 0;
	const router = new EventRouter({
		stateStore: store,
		provider: {} as never,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		clock: () => now,
		retryPolicy: new RetryPolicy({
			baseDelayMs: 0,
			maxDelayMs: 0,
			maxAttempts: 2,
			sleep: async () => undefined,
		}),
		lambda: {
			send: async (command) => {
				if (command.kind === "invoke") {
					invokes += 1;
					return { DurableExecutionArn: `arn:execution:${invokes}` };
				}
				if (command.kind === "list") {
					if (!completed) {
						completed = true;
						await store.complete(request, 1, {
							type: "failed",
							failure: {
								type: "operational-failure",
								lifecycleState: "FAILED",
								operation: "review",
								reason: "permanent-error",
								attempts: 1,
								lastError: { name: "Error", message: "review failed" },
							},
							ownership: { kind: "lease", leaseVersion: 1 },
						});
					}
					throw Object.assign(new Error("lookup unavailable"), {
						name: "ThrottlingException",
					});
				}
				throw new Error(`unexpected ${command.kind} command`);
			},
		},
	});

	await router.route({ ...event, id: "transient-race-seed" });
	await store.claimEvents(request, 1);
	now = new Date("2026-01-01T00:00:02.000Z");
	const result = await router.route({
		...event,
		id: "transient-race-pending",
		type: "revision-updated",
		occurredAt: now.toISOString(),
		revision: "source-2",
	});

	expect(result).toMatchObject({
		appended: true,
		started: true,
		generation: 2,
	});
	expect(invokes).toBe(2);
});

test("duplicate terminal delivery repairs pending work without remote lookup", async () => {
	const now = new Date("2026-01-01T00:00:00.000Z");
	const store = new InMemoryStateStore({ clock: () => now });
	const calls: string[] = [];
	const router = new EventRouter({
		stateStore: store,
		provider: {} as never,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		clock: () => now,
		lambda: {
			send: async (command) => {
				calls.push(command.kind);
				if (command.kind === "invoke") {
					return { DurableExecutionArn: `arn:execution:${calls.length}` };
				}
				throw new Error(`terminal replay must not require ${command.kind}`);
			},
		},
	});
	const pending = {
		...event,
		id: "terminal-replay-pending",
		type: "revision-updated" as const,
		revision: "source-2",
	};

	await router.route({ ...event, id: "terminal-replay-seed" });
	await store.claimEvents(request, 1);
	await store.appendEvent(pending);
	await store.complete(request, 1, {
		type: "failed",
		failure: {
			type: "operational-failure",
			lifecycleState: "FAILED",
			operation: "review",
			reason: "permanent-error",
			attempts: 1,
			lastError: { name: "Error", message: "review failed" },
		},
		ownership: { kind: "lease", leaseVersion: 1 },
	});

	const result = await router.route(pending);

	expect(result).toMatchObject({
		appended: false,
		started: true,
		generation: 2,
	});
	expect(calls).toEqual(["invoke", "invoke"]);
});

test("concurrent terminal recovery winner and loser converge without a stale generation or double start", async () => {
	const now = new Date("2026-01-01T00:00:00.000Z");
	const store = new InMemoryStateStore({ clock: () => now });
	const pending = {
		...event,
		id: "terminal-concurrent-pending",
		type: "revision-updated" as const,
		revision: "source-2",
	};
	await store.appendEvent({ ...event, id: "terminal-concurrent-seed" });
	await store.recordExecution(request, 1, "arn:execution:1");
	await store.claimEvents(request, 1);
	await store.appendEvent(pending);
	await store.complete(request, 1, {
		type: "failed",
		failure: {
			type: "operational-failure",
			lifecycleState: "FAILED",
			operation: "review",
			reason: "permanent-error",
			attempts: 1,
			lastError: { name: "Error", message: "review failed" },
		},
		ownership: { kind: "lease", leaseVersion: 1 },
	});
	let starts = 0;
	const router = new EventRouter({
		stateStore: store,
		provider: {} as never,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		clock: () => now,
		lambda: {
			send: async (command) => {
				if (command.kind !== "invoke")
					throw new Error(`unexpected ${command.kind} command`);
				starts += 1;
				return { DurableExecutionArn: "arn:execution:2" };
			},
		},
	});
	const recovery = {
		request,
		generation: 1,
		leaseVersion: 1,
		recoveredAt: now.toISOString(),
	} as const;

	const results = await Promise.all([
		router.recover(recovery),
		router.recover(recovery),
	]);

	expect(results).toContainEqual({
		appended: false,
		started: true,
		generation: 2,
		durableExecutionArn: "arn:execution:2",
	});
	expect(results).toContainEqual({
		appended: false,
		started: false,
		generation: 2,
	});
	expect(starts).toBe(1);
});

test("concurrent recovery loser returns the winning authoritative generation", async () => {
	let now = new Date("2026-01-01T00:00:00.000Z");
	const store = new InMemoryStateStore({
		clock: () => now,
		leaseDurationSeconds: 1,
	});
	await store.appendEvent({ ...event, id: "concurrent-seed" });
	await store.recordExecution(request, 1, "arn:execution:1");
	await store.claimEvents(request, 1);
	await store.appendEvent({
		...event,
		id: "concurrent-pending",
		type: "revision-updated",
		revision: "source-2",
	});
	now = new Date("2026-01-01T00:00:02.000Z");
	let starts = 0;
	const router = new EventRouter({
		stateStore: store,
		provider: {} as never,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		lambda: {
			send: async (command) => {
				if (command.kind === "status") return { Status: "FAILED" };
				if (command.kind === "invoke") {
					starts += 1;
					return { DurableExecutionArn: "arn:execution:2" };
				}
				throw new Error(`unexpected ${command.kind} command`);
			},
		},
	});
	const input = {
		request,
		generation: 1,
		leaseVersion: 1,
		executionArn: "arn:execution:1",
		recoveredAt: now.toISOString(),
	} as const;

	const results = await Promise.all([
		router.recover(input),
		router.recover(input),
	]);

	expect(results).toContainEqual({
		appended: false,
		started: true,
		generation: 2,
		durableExecutionArn: "arn:execution:2",
	});
	expect(results).toContainEqual({
		appended: false,
		started: false,
		generation: 2,
	});
	expect(starts).toBe(1);
});

test("dispatches CodeCommit pipeline review with the winning concurrent recovery generation", async () => {
	let now = new Date("2026-01-01T00:00:00.000Z");
	let sourceRevision = "source-1";
	const store = new ConditionalRecoveryLoserStore({
		clock: () => now,
		leaseDurationSeconds: 1,
	});
	const dispatchedGenerations: number[] = [];
	const router = new EventRouter({
		stateStore: store,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		repositoryHash: () => "hash",
		clock: () => now,
		provider: {
			getRequest: async () => ({
				key: request,
				title: "current",
				status: "open",
				sourceBranch: "feature",
				destinationBranch: "main",
				sourceRevision,
				destinationRevision: "base",
			}),
		} as never,
		pipelineDispatcher: {
			startReviewPipeline: async ({ generation }) => {
				dispatchedGenerations.push(generation);
			},
			completeTerminalRequest: async () => undefined,
		},
		lambda: {
			send: async (command) => {
				if (command.kind === "invoke") {
					return {
						DurableExecutionArn:
							sourceRevision === "source-1"
								? "arn:execution:1"
								: "arn:execution:2",
					};
				}
				if (command.kind === "list") {
					return {
						DurableExecutions: [
							{
								DurableExecutionName: "codecommit-hash-7-g1",
								DurableExecutionArn: "arn:execution:1",
							},
						],
					};
				}
				if (command.kind === "status") return { Status: "FAILED" };
				throw new Error(`unexpected ${command.kind} command`);
			},
		},
	});

	await router.routeCodeCommit({
		id: "pipeline-recovery-seed",
		time: now.toISOString(),
		source: "aws.codecommit",
		"detail-type": "CodeCommit Pull Request State Change",
		detail: {
			repositoryNames: ["repo"],
			pullRequestId: "7",
			event: "pullRequestCreated",
		},
	});
	await store.claimEvents(request, 1);
	now = new Date("2026-01-01T00:00:02.000Z");
	sourceRevision = "source-2";
	const result = await router.routeCodeCommit({
		id: "pipeline-recovery-revision",
		time: now.toISOString(),
		source: "aws.codecommit",
		"detail-type": "CodeCommit Pull Request State Change",
		detail: {
			repositoryNames: ["repo"],
			pullRequestId: "7",
			event: "pullRequestSourceBranchUpdated",
			sourceCommit: sourceRevision,
			destinationCommit: "base",
		},
	});

	expect(result).toMatchObject({ started: false, generation: 2 });
	expect(dispatchedGenerations).toEqual([1, 2]);
});

test("leaves expired recovery state unchanged when status lookup is unavailable", async () => {
	let now = new Date("2026-01-01T00:00:00.000Z");
	const store = new InMemoryStateStore({
		clock: () => now,
		leaseDurationSeconds: 1,
	});
	const router = new EventRouter({
		stateStore: store,
		provider: {} as never,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		retryPolicy: new RetryPolicy({
			baseDelayMs: 0,
			maxDelayMs: 0,
			maxAttempts: 2,
			sleep: async () => undefined,
		}),
		lambda: {
			send: async (command: unknown) => {
				if ((command as { kind?: string }).kind === "invoke")
					return { DurableExecutionArn: "arn:execution" };
				throw Object.assign(new Error("status unavailable"), {
					name: "ThrottlingException",
				});
			},
		},
	});
	await router.route({ ...event, id: "status-failure" });
	now = new Date("2026-01-01T00:00:02.000Z");
	await router.recover({
		request,
		generation: 1,
		leaseVersion: 1,
		executionArn: "arn:execution",
		recoveredAt: now.toISOString(),
	});
	expect(store.inspectRequest(request)).toMatchObject({
		lifecycleState: "RUNNING",
		generation: 1,
	});
});

test("refetches CodeCommit request before appending and starting", async () => {
	const store = new InMemoryStateStore();
	let refetched = 0;
	let payloadBytes: Uint8Array | undefined;
	const router = new EventRouter({
		stateStore: store,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		provider: {
			getRequest: async () => {
				refetched += 1;
				return {
					key: request,
					title: "current",
					status: "open",
					sourceBranch: "feature",
					destinationBranch: "main",
					sourceRevision: "current-source-123",
					destinationRevision: "current-dest-123",
				};
			},
		} as never,
		lambda: {
			send: async (command: unknown) => {
				payloadBytes = commandInput(command).Payload as Uint8Array;
				return { DurableExecutionArn: "arn:execution" };
			},
		},
	});
	await router.routeCodeCommit({
		id: "event-refetch",
		time: "2026-01-01T00:00:00.000Z",
		source: "aws.codecommit",
		"detail-type": "CodeCommit Pull Request State Change",
		detail: {
			repositoryNames: ["repo"],
			pullRequestId: "7",
			event: "pullRequestSourceBranchUpdated",
			sourceCommit: "stale-source-123",
			destinationCommit: "stale-dest-123",
		},
	});
	expect(refetched).toBe(1);
	expect(new TextDecoder().decode(payloadBytes)).toContain(
		"current-source-123",
	);
});

test("persists FAILED when recovery obtains ownership but restart fails", async () => {
	let now = new Date("2026-01-01T00:00:00.000Z");
	const store = new InMemoryStateStore({
		clock: () => now,
		leaseDurationSeconds: 1,
	});
	let invokes = 0;
	const router = new EventRouter({
		stateStore: store,
		provider: {} as never,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		retryPolicy: new RetryPolicy({
			baseDelayMs: 0,
			maxDelayMs: 0,
			maxAttempts: 1,
		}),
		lambda: {
			send: async (command) => {
				if (command.kind === "invoke") {
					invokes += 1;
					if (invokes > 1)
						throw Object.assign(new Error("denied"), {
							name: "AccessDeniedException",
						});
					return { DurableExecutionArn: "arn:execution" };
				}
				if (command.kind === "status") return { Status: "SUCCEEDED" };
				throw new Error(`unexpected ${command.kind} command`);
			},
		},
	});
	await router.route({ ...event, id: "recover-start-failure" });
	now = new Date("2026-01-01T00:00:02.000Z");
	await router.recover({
		request,
		generation: 1,
		leaseVersion: 1,
		executionArn: "arn:execution",
		recoveredAt: now.toISOString(),
	});
	expect(store.inspectRequest(request)?.lifecycleState).toBe("FAILED");
});

test("appends a CodeCommit event before a transient refetch failure", async () => {
	const store = new InMemoryStateStore();
	let attempts = 0;
	const router = new EventRouter({
		stateStore: store,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		retryPolicy: new RetryPolicy({
			baseDelayMs: 0,
			maxDelayMs: 0,
			maxAttempts: 2,
			sleep: async () => undefined,
		}),
		provider: {
			getRequest: async () => {
				attempts += 1;
				if (attempts === 1)
					throw Object.assign(new Error("throttle"), {
						name: "ThrottlingException",
					});
				return {
					key: request,
					title: "current",
					status: "open",
					sourceBranch: "feature",
					destinationBranch: "main",
					sourceRevision: "source",
					destinationRevision: "base",
				};
			},
		} as never,
		lambda: { send: async () => ({ DurableExecutionArn: "arn:execution" }) },
	});
	await router.routeCodeCommit({
		id: "persist-first",
		time: "2026-01-01T00:00:00.000Z",
		source: "aws.codecommit",
		"detail-type": "CodeCommit Pull Request State Change",
		detail: {
			repositoryNames: ["repo"],
			pullRequestId: "7",
			event: "pullRequestCreated",
		},
	});
	expect(attempts).toBe(2);
	expect(store.inspectRequest(request)?.eventSortKeys).toHaveLength(1);
});

test("treats duplicate callback completion as idempotent", async () => {
	const store = new InMemoryStateStore();
	let sends = 0;
	const router = new EventRouter({
		stateStore: store,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		provider: {} as never,
		lambda: {
			send: async (command: { kind?: string }) => {
				if (command.kind === "invoke")
					return { DurableExecutionArn: "arn:execution" };
				sends += 1;
				throw Object.assign(new Error("done"), {
					name: "CallbackAlreadyCompletedException",
				});
			},
		},
	});
	await router.route(event);
	await store.registerCallback({
		request,
		generation: 1,
		callbackId: "callback",
		callbackGeneration: 1,
		lifecycleState: "WAITING",
		registeredAt: new Date().toISOString(),
		leaseVersion: 1,
	});
	await router.wake({
		request,
		generation: 1,
		callbackId: "callback",
		callbackGeneration: 1,
		leaseVersion: 1,
	});
	expect(sends).toBe(1);
	expect(store.inspectRequest(request)?.lifecycleState).not.toBe("FAILED");
});

test("persists retry metadata unchanged when callback signaling is exhausted", async () => {
	const store = new InMemoryStateStore();
	let callbackAttempts = 0;
	const router = new EventRouter({
		stateStore: store,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		provider: {} as never,
		retryPolicy: new RetryPolicy({
			baseDelayMs: 0,
			maxDelayMs: 0,
			maxAttempts: 2,
			sleep: async () => undefined,
		}),
		lambda: {
			send: async (command) => {
				if (command.kind === "invoke") {
					return { DurableExecutionArn: "arn:execution" };
				}
				if (command.kind === "callback") {
					callbackAttempts += 1;
					throw Object.assign(new Error("callback throttled"), {
						name: "ThrottlingException",
					});
				}
				throw new Error(`unexpected ${command.kind} command`);
			},
		},
	});
	await router.route(event);
	await store.registerCallback({
		request,
		generation: 1,
		callbackId: "callback",
		callbackGeneration: 1,
		lifecycleState: "WAITING",
		registeredAt: new Date().toISOString(),
		leaseVersion: 1,
	});
	await router.wake({
		request,
		generation: 1,
		callbackId: "callback",
		callbackGeneration: 1,
		leaseVersion: 1,
	});
	expect(callbackAttempts).toBe(2);
	expect(store.inspectRequest(request)?.completionReason).toEqual({
		type: "failed",
		failure: {
			type: "operational-failure",
			lifecycleState: "FAILED",
			operation: "callback",
			reason: "retry-exhausted",
			attempts: 2,
			lastError: {
				name: "ThrottlingException",
				message: "callback throttled",
			},
		},
		ownership: {
			kind: "callback",
			callbackId: "callback",
			callbackGeneration: 1,
			leaseVersion: 1,
		},
	});
});

test("does not let an old callback failure clear a newer callback owner", async () => {
	const now = new Date("2026-01-01T00:00:00.000Z");
	const store = new InMemoryStateStore({ clock: () => now });
	let callbackAttempts = 0;
	const retry = new RetryPolicy({
		baseDelayMs: 0,
		maxDelayMs: 0,
		maxAttempts: 2,
		sleep: async () => {
			await store.registerCallback({
				request,
				generation: 1,
				callbackId: "new-callback",
				callbackGeneration: 2,
				lifecycleState: "WAITING",
				registeredAt: now.toISOString(),
				leaseVersion: 1,
			});
		},
	});
	const router = new EventRouter({
		stateStore: store,
		provider: {} as never,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		retryPolicy: retry,
		lambda: {
			send: async (command) => {
				if (command.kind === "invoke")
					return { DurableExecutionArn: "arn:execution" };
				callbackAttempts += 1;
				throw Object.assign(new Error("throttle"), {
					name: "ThrottlingException",
				});
			},
		},
	});
	await router.route({ ...event, id: "callback-owner-race" });
	await store.registerCallback({
		request,
		generation: 1,
		callbackId: "old-callback",
		callbackGeneration: 1,
		lifecycleState: "WAITING",
		registeredAt: now.toISOString(),
		leaseVersion: 1,
	});
	await router.wake({
		request,
		generation: 1,
		callbackId: "old-callback",
		callbackGeneration: 1,
		leaseVersion: 1,
	});
	expect(callbackAttempts).toBe(2);
	expect(store.inspectRequest(request)?.lifecycleState).toBe("WAITING");
	expect(
		await store.validateCallback({
			request,
			generation: 1,
			callbackId: "new-callback",
			callbackGeneration: 2,
			leaseVersion: 1,
		}),
	).toBe(true);
});

test("does not let a stale status failure beat a renewed lease", async () => {
	const now = new Date("2026-01-01T00:00:00.000Z");
	const store = new InMemoryStateStore({ clock: () => now });
	const router = new EventRouter({
		stateStore: store,
		provider: {} as never,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		retryPolicy: new RetryPolicy({
			baseDelayMs: 0,
			maxDelayMs: 0,
			maxAttempts: 2,
			sleep: async () => {
				expect(
					await store.heartbeat({
						request,
						generation: 1,
						leaseVersion: 1,
						heartbeatAt: "2026-01-01T00:00:01.000Z",
					}),
				).toEqual({ renewed: true, leaseVersion: 2 });
			},
		}),
		lambda: {
			send: async (command) => {
				if (command.kind === "invoke")
					return { DurableExecutionArn: "arn:execution" };
				throw Object.assign(new Error("status throttle"), {
					name: "ThrottlingException",
				});
			},
		},
	});
	await router.route({ ...event, id: "lease-owner-race" });
	await router.recover({
		request,
		generation: 1,
		leaseVersion: 1,
		executionArn: "arn:execution",
		recoveredAt: "2026-01-01T00:00:02.000Z",
	});
	expect(store.inspectRequest(request)?.lifecycleState).toBe("RUNNING");
});

test("persists FAILED for malformed durable execution status", async () => {
	let now = new Date("2026-01-01T00:00:00.000Z");
	const store = new InMemoryStateStore({
		clock: () => now,
		leaseDurationSeconds: 1,
	});
	const router = new EventRouter({
		stateStore: store,
		provider: {} as never,
		reviewerFunctionName: "reviewer",
		reviewerArn: "arn:reviewer",
		lambda: {
			send: async (command) => {
				if (command.kind === "invoke") {
					return { DurableExecutionArn: "arn:execution" };
				}
				if (command.kind === "status") return {};
				throw new Error(`unexpected ${command.kind} command`);
			},
		},
	});
	await router.route({ ...event, id: "malformed-status" });
	now = new Date("2026-01-01T00:00:02.000Z");
	await router.recover({
		request,
		generation: 1,
		leaseVersion: 1,
		executionArn: "arn:execution",
		recoveredAt: now.toISOString(),
	});
	expect(store.inspectRequest(request)?.lifecycleState).toBe("FAILED");
});
