import { describe, expect, test } from "bun:test";
import type { StartReviewPipelineExecution } from "../src/reviewer/adapters/codepipeline-transport";
import { pipelineClientRequestToken } from "../src/reviewer/adapters/codepipeline-transport";
import type { ReviewRequest } from "../src/reviewer/domain/review-request";
import {
	PipelineReviewDispatcher,
	type PrPipelineDispatcher,
} from "../src/reviewer/pipeline-review-common";
import type {
	CompletionReason,
	FailAndRequeueClaimInput,
	PipelineDispatchIntent,
	PipelineDispatchOwnership,
} from "../src/reviewer/ports/state-store";
import { PipelineEventRouter } from "../src/reviewer/router/pipeline-event-router";
import { RetryPolicy } from "../src/reviewer/services/retry-policy";
import { FakePipelineCoordinationStore } from "./pipeline-coordination-fakes";
import { InMemoryStateStore } from "./reviewer/fakes/in-memory-state-store";

const now = "2026-08-01T12:00:00.000Z";
const request = {
	provider: "codecommit",
	repository: "orders",
	requestId: "42",
} as const;
const sourceOne = "a".repeat(40);
const sourceTwo = "b".repeat(40);
const destination = "c".repeat(40);

function snapshot(
	sourceRevision = sourceOne,
	destinationRevision = destination,
): ReviewRequest {
	return {
		key: request,
		title: "Review orders",
		status: "open",
		sourceBranch: "feature",
		destinationBranch: "main",
		sourceRevision,
		destinationRevision,
	};
}

function revisionEvent(
	id: string,
	revision: string,
	occurredAt = now,
): unknown {
	return {
		id,
		time: occurredAt,
		source: "aws.codecommit",
		"detail-type": "CodeCommit Pull Request State Change",
		detail: {
			repositoryName: request.repository,
			pullRequestId: request.requestId,
			event: "pullRequestSourceBranchUpdated",
			sourceCommit: revision,
		},
	};
}

function closedEvent(id: string): unknown {
	return {
		id,
		time: now,
		source: "aws.codecommit",
		"detail-type": "CodeCommit Pull Request State Change",
		detail: {
			repositoryName: request.repository,
			pullRequestId: request.requestId,
			event: "pullRequestStatusChanged",
			pullRequestStatus: "CLOSED",
		},
	};
}

class RecordingDispatcher implements PrPipelineDispatcher {
	readonly starts: Array<{
		readonly snapshot: ReviewRequest;
		readonly generation: number;
		readonly observedAt: string;
		readonly eventId: string;
	}> = [];
	readonly terminals: Array<{
		readonly generation: number;
		readonly status: "merged" | "closed";
	}> = [];
	beforeStart?: () => Promise<void>;
	beforeTerminal?: () => Promise<void>;

	async startReviewPipeline(input: {
		readonly snapshot: ReviewRequest;
		readonly generation: number;
		readonly observedAt: string;
		readonly eventId: string;
		readonly refetchSnapshot: () => Promise<ReviewRequest>;
	}): Promise<undefined> {
		this.starts.push(input);
		await this.beforeStart?.();
		return undefined;
	}

	async completeTerminalRequest(input: {
		readonly generation: number;
		readonly status: "merged" | "closed";
	}): Promise<void> {
		this.terminals.push(input);
		await this.beforeTerminal?.();
	}
}

class IdempotentTransport {
	readonly executionsByToken = new Map<string, string>();
	readonly starts: StartReviewPipelineExecution[] = [];
	failAfterAccepted = false;

	async startExecution(input: StartReviewPipelineExecution) {
		this.starts.push(input);
		const token = pipelineClientRequestToken(input);
		const executionId =
			this.executionsByToken.get(token) ??
			`execution-${this.executionsByToken.size + 1}`;
		this.executionsByToken.set(token, executionId);
		if (this.failAfterAccepted) {
			this.failAfterAccepted = false;
			throw Object.assign(new Error("secret accepted transport failure"), {
				stack: "secret stack",
				custom: { token: "secret custom payload" },
			});
		}
		return { executionId };
	}
}

class FaultInjectingCoordinationStore extends FakePipelineCoordinationStore {
	failMapping = false;

	override async putExecutionMapping(
		mapping: Parameters<
			FakePipelineCoordinationStore["putExecutionMapping"]
		>[0],
	): Promise<void> {
		if (this.failMapping) {
			this.failMapping = false;
			throw new Error("secret mapping failure");
		}
		await super.putExecutionMapping(mapping);
	}
}

class FaultInjectingReconciler {
	fail = false;
	count = 0;

	async invoke(): Promise<void> {
		this.count += 1;
		if (this.fail) {
			this.fail = false;
			throw new Error("secret reconciler failure");
		}
	}
}

class FaultInjectingStateStore extends InMemoryStateStore {
	claimCalls = 0;
	failClaimAt?: number;
	failCompletionType?: "clean" | "closed";
	requeueFailuresRemaining = 0;
	failedCompletions = 0;
	requeueCalls = 0;
	failOrphanRecovery = false;
	commitRequeueThenThrow = false;
	forceAmbiguousRequeue = false;
	commitIntentCompletionThenThrow = false;

	override async claimPipelineEvents(
		...args: Parameters<InMemoryStateStore["claimPipelineEvents"]>
	) {
		this.claimCalls += 1;
		if (this.claimCalls === this.failClaimAt) {
			throw Object.assign(new Error("secret claim failure"), {
				name: "TimeoutError",
				stack: "secret claim stack",
			});
		}
		return super.claimPipelineEvents(...args);
	}

	override async complete(
		requestKey: Parameters<InMemoryStateStore["complete"]>[0],
		generation: number,
		reason: CompletionReason,
	): Promise<void> {
		if (reason.type === "failed") this.failedCompletions += 1;
		if (reason.type === this.failCompletionType) {
			this.failCompletionType = undefined;
			throw Object.assign(new Error("secret completion failure"), {
				name: "TimeoutError",
				stack: "secret completion stack",
			});
		}
		await super.complete(requestKey, generation, reason);
	}

	override async recoverOrphanedPipelineClaim(
		...args: Parameters<InMemoryStateStore["recoverOrphanedPipelineClaim"]>
	) {
		if (this.failOrphanRecovery) {
			throw Object.assign(new Error("secret orphan recovery failure"), {
				stack: "secret orphan stack",
				custom: { raw: "secret raw payload" },
			});
		}
		return super.recoverOrphanedPipelineClaim(...args);
	}

	override async completePipelineDispatchIntent(
		intent: PipelineDispatchIntent,
		ownership: PipelineDispatchOwnership,
	) {
		const result = await super.completePipelineDispatchIntent(
			intent,
			ownership,
		);
		if (this.commitIntentCompletionThenThrow) {
			this.commitIntentCompletionThenThrow = false;
			throw new Error("secret response lost after intent completion");
		}
		return result;
	}

	override async failAndRequeueClaim(input: FailAndRequeueClaimInput) {
		this.requeueCalls += 1;
		if (this.requeueFailuresRemaining > 0) {
			this.requeueFailuresRemaining -= 1;
			throw Object.assign(new Error("secret requeue failure"), {
				name: "TimeoutError",
				stack: "secret requeue stack",
			});
		}
		if (this.commitRequeueThenThrow) {
			this.commitRequeueThenThrow = false;
			await super.failAndRequeueClaim(input);
			throw new Error("secret response lost after requeue commit");
		}
		if (this.forceAmbiguousRequeue) {
			return { requeued: false as const, reason: "changed" as const };
		}
		return super.failAndRequeueClaim(input);
	}
}

function immediateRetryPolicy(maxAttempts = 3): RetryPolicy {
	return new RetryPolicy({
		baseDelayMs: 0,
		maxDelayMs: 0,
		maxAttempts,
		random: () => 0,
		sleep: async () => {},
	});
}

function productionRouter(options: {
	readonly stateStore?: InMemoryStateStore;
	readonly transport?: IdempotentTransport;
	readonly coordinationStore?: FaultInjectingCoordinationStore;
	readonly reconciler?: FaultInjectingReconciler;
	readonly retryPolicy?: RetryPolicy;
	readonly getRequest?: () => Promise<ReviewRequest>;
	readonly clock?: () => Date;
}) {
	const stateStore =
		options.stateStore ??
		new InMemoryStateStore({ clock: () => new Date(now) });
	const transport = options.transport ?? new IdempotentTransport();
	const coordinationStore =
		options.coordinationStore ?? new FaultInjectingCoordinationStore();
	const reconciler = options.reconciler ?? new FaultInjectingReconciler();
	return {
		stateStore,
		transport,
		coordinationStore,
		reconciler,
		router: new PipelineEventRouter({
			stateStore,
			provider: { getRequest: options.getRequest ?? (async () => snapshot()) },
			pipelineDispatcher: new PipelineReviewDispatcher({
				pipelineName: "review-pipeline",
				transport,
				store: coordinationStore,
				reconciler,
				clock: () => new Date(now),
			}),
			clock: options.clock ?? (() => new Date(now)),
			retryPolicy: options.retryPolicy,
		}),
	};
}

describe("PipelineEventRouter", () => {
	test("pipeline-only mode appends, claims, dispatches, and completes once", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		const dispatcher = new RecordingDispatcher();
		const router = new PipelineEventRouter({
			stateStore: store,
			provider: { getRequest: async () => snapshot() },
			pipelineDispatcher: dispatcher,
			clock: () => new Date(now),
		});

		const result = await router.routePipelineOnly(
			revisionEvent("revision-one", sourceOne),
		);

		expect(result).toMatchObject({
			appended: true,
			started: true,
			generation: 1,
		});
		expect(dispatcher.starts).toHaveLength(1);
		expect(dispatcher.starts[0]).toMatchObject({
			snapshot: { sourceRevision: sourceOne },
			generation: 1,
			eventId: "revision-one",
		});
		expect(store.inspectRequest(request)).toMatchObject({
			lifecycleState: "COMPLETED",
			generation: 1,
		});
	});

	test("reviewed dispatch persists intent without owning review lifecycle state", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		await store.appendEvent({
			id: "reviewed-event",
			type: "revision-updated",
			request,
			occurredAt: now,
			revision: sourceOne,
		});
		const before = store.inspectRequest(request);
		const dispatcher = new RecordingDispatcher();
		const router = new PipelineEventRouter({
			stateStore: store,
			provider: { getRequest: async () => snapshot() },
			pipelineDispatcher: dispatcher,
		});

		await router.dispatchReviewedEvent({
			event: {
				id: "reviewed-event",
				type: "revision-updated",
				request,
				occurredAt: now,
				revision: sourceOne,
			},
			snapshot: snapshot(),
			generation: 1,
			refetchSnapshot: async () => snapshot(),
		});

		expect(dispatcher.starts).toHaveLength(1);
		expect(dispatcher.starts[0]?.generation).toBe(1);
		expect(store.inspectRequest(request)).toEqual(before);
	});

	test("reviewed dispatch pins drifted revisions and gives a newer event a separate execution", async () => {
		const stateStore = new InMemoryStateStore({ clock: () => new Date(now) });
		await stateStore.appendEvent({
			id: "reviewed-old",
			type: "revision-updated",
			request,
			occurredAt: now,
			revision: sourceOne,
		});
		const reconciler = new FaultInjectingReconciler();
		reconciler.fail = true;
		const transport = new IdempotentTransport();
		const { router } = productionRouter({ stateStore, reconciler, transport });
		const oldEvent = {
			id: "reviewed-old",
			type: "revision-updated" as const,
			request,
			occurredAt: now,
			revision: sourceOne,
		};

		await expect(
			router.dispatchReviewedEvent({
				event: oldEvent,
				snapshot: snapshot(sourceOne, destination),
				generation: 1,
				refetchSnapshot: async () => snapshot(sourceTwo, "d".repeat(40)),
			}),
		).rejects.toThrow("Pipeline routing failed");
		await router.dispatchReviewedEvent({
			event: oldEvent,
			snapshot: snapshot(sourceTwo, "d".repeat(40)),
			generation: 1,
			refetchSnapshot: async () => snapshot(sourceTwo, "d".repeat(40)),
		});
		const newerAt = "2026-08-01T12:00:01.000Z";
		await stateStore.appendEvent({
			id: "reviewed-new",
			type: "revision-updated",
			request,
			occurredAt: newerAt,
			revision: sourceOne,
		});
		await router.dispatchReviewedEvent({
			event: {
				...oldEvent,
				id: "reviewed-new",
				occurredAt: newerAt,
			},
			snapshot: snapshot(sourceOne, destination),
			generation: 1,
			refetchSnapshot: async () => snapshot(sourceOne, destination),
		});

		expect(transport.starts.slice(0, 2)).toEqual([
			expect.objectContaining({
				sourceRevision: sourceOne,
				destinationRevision: destination,
			}),
			expect.objectContaining({
				sourceRevision: sourceOne,
				destinationRevision: destination,
			}),
		]);
		expect(transport.executionsByToken).toHaveLength(2);
	});

	test("replays an accepted reviewed intent after a newer revision wins", async () => {
		const stateStore = new InMemoryStateStore({ clock: () => new Date(now) });
		await stateStore.appendEvent({
			id: "reviewed-old-interleaved",
			type: "revision-updated",
			request,
			occurredAt: now,
			revision: sourceOne,
		});
		const reconciler = new FaultInjectingReconciler();
		reconciler.fail = true;
		const transport = new IdempotentTransport();
		const { router, coordinationStore } = productionRouter({
			stateStore,
			reconciler,
			transport,
		});
		const oldEvent = {
			id: "reviewed-old-interleaved",
			type: "revision-updated" as const,
			request,
			occurredAt: now,
			revision: sourceOne,
		};

		await expect(
			router.dispatchReviewedEvent({
				event: oldEvent,
				snapshot: snapshot(sourceOne, destination),
				generation: 1,
				refetchSnapshot: async () => snapshot(sourceOne, destination),
			}),
		).rejects.toThrow("Pipeline routing failed");

		const newerAt = "2026-08-01T12:00:01.000Z";
		const newerDestination = "d".repeat(40);
		await router.dispatchReviewedEvent({
			event: {
				...oldEvent,
				id: "reviewed-new-interleaved",
				occurredAt: newerAt,
				revision: sourceTwo,
			},
			snapshot: snapshot(sourceTwo, newerDestination),
			generation: 1,
			refetchSnapshot: async () => snapshot(sourceTwo, newerDestination),
		});

		await router.dispatchReviewedEvent({
			event: oldEvent,
			snapshot: snapshot(sourceTwo, newerDestination),
			generation: 1,
			refetchSnapshot: async () => snapshot(sourceTwo, newerDestination),
		});

		expect(
			transport.starts.map(({ sourceRevision }) => sourceRevision),
		).toEqual([sourceOne, sourceTwo, sourceOne]);
		expect(
			pipelineClientRequestToken(
				transport.starts[0] as StartReviewPipelineExecution,
			),
		).toBe(
			pipelineClientRequestToken(
				transport.starts[2] as StartReviewPipelineExecution,
			),
		);
		expect(transport.executionsByToken).toHaveLength(2);
		expect(coordinationStore.mappings.get("execution-1")).toMatchObject({
			sourceRevision: sourceOne,
			destinationRevision: destination,
		});
		expect(coordinationStore.mappings.get("execution-2")).toMatchObject({
			sourceRevision: sourceTwo,
			destinationRevision: newerDestination,
		});
		expect(
			await coordinationStore.getAuthoritativeRevision(request, 1),
		).toMatchObject({ sourceRevision: sourceTwo });
	});

	test("reviewed completion response loss uses the tombstone despite provider drift", async () => {
		const stateStore = new FaultInjectingStateStore({
			clock: () => new Date(now),
		});
		stateStore.commitIntentCompletionThenThrow = true;
		await stateStore.appendEvent({
			id: "reviewed-completion-lost",
			type: "revision-updated",
			request,
			occurredAt: now,
			revision: sourceOne,
		});
		const transport = new IdempotentTransport();
		const { router } = productionRouter({ stateStore, transport });
		const event = {
			id: "reviewed-completion-lost",
			type: "revision-updated" as const,
			request,
			occurredAt: now,
			revision: sourceOne,
		};

		await expect(
			router.dispatchReviewedEvent({
				event,
				snapshot: snapshot(sourceOne, destination),
				generation: 1,
				refetchSnapshot: async () => snapshot(sourceOne, destination),
			}),
		).rejects.toThrow("Pipeline routing failed");
		await router.dispatchReviewedEvent({
			event,
			snapshot: snapshot(sourceTwo, "d".repeat(40)),
			generation: 1,
			refetchSnapshot: async () => snapshot(sourceTwo, "d".repeat(40)),
		});

		expect(transport.starts).toHaveLength(1);
		expect(transport.executionsByToken).toHaveLength(1);
		expect(transport.starts[0]).toMatchObject({
			sourceRevision: sourceOne,
			destinationRevision: destination,
		});
	});

	test("retains matching terminal completion while draining a concurrent comment", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		const dispatcher = new RecordingDispatcher();
		dispatcher.beforeTerminal = async () => {
			await store.appendEvent({
				type: "human-comment",
				id: "concurrent-comment",
				request,
				occurredAt: "2026-08-01T12:01:00.000Z",
				commentId: "comment-1",
			});
		};
		const router = new PipelineEventRouter({
			stateStore: store,
			provider: { getRequest: async () => snapshot() },
			pipelineDispatcher: dispatcher,
			clock: () => new Date(now),
		});

		await router.routePipelineOnly(closedEvent("closed"));

		expect(dispatcher.terminals).toEqual([
			{ generation: 1, status: "closed", request },
		]);
		expect(store.inspectRequest(request)).toMatchObject({
			lifecycleState: "COMPLETED",
			completionReason: { type: "closed" },
			pendingEventCount: 0,
		});
	});

	test("a nonowner retries while the owner drains a concurrently appended revision", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		const dispatcher = new RecordingDispatcher();
		let currentSnapshot = snapshot(sourceOne);
		let releaseFirst: (() => void) | undefined;
		const firstBlocked = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		dispatcher.beforeStart = async () => {
			if (dispatcher.starts.length === 1) await firstBlocked;
		};
		const router = new PipelineEventRouter({
			stateStore: store,
			provider: { getRequest: async () => currentSnapshot },
			pipelineDispatcher: dispatcher,
			clock: () => new Date(now),
		});

		const owner = router.routePipelineOnly(
			revisionEvent("revision-one", sourceOne),
		);
		while (dispatcher.starts.length === 0) await Promise.resolve();
		currentSnapshot = snapshot(sourceTwo);
		await expect(
			router.routePipelineOnly(
				revisionEvent("revision-two", sourceTwo, "2026-08-01T12:01:00.000Z"),
			),
		).rejects.toMatchObject({
			name: "PipelineRoutingError",
			retryable: true,
		});
		releaseFirst?.();
		await owner;

		expect(
			dispatcher.starts.map(({ snapshot: value }) => value.sourceRevision),
		).toEqual([sourceOne, sourceTwo]);
		expect(store.inspectRequest(request)?.lifecycleState).toBe("COMPLETED");
	});

	test("keeps first-claim failures retryable until the active lease expires", async () => {
		const clock = { value: new Date(now) };
		const stateStore = new FaultInjectingStateStore({
			clock: () => clock.value,
			leaseDurationSeconds: 60,
		});
		stateStore.failClaimAt = 1;
		const { router, transport } = productionRouter({
			stateStore,
			clock: () => clock.value,
			retryPolicy: immediateRetryPolicy(),
		});
		const delivery = revisionEvent("first-claim-failure", sourceOne);

		await expect(router.routePipelineOnly(delivery)).rejects.toThrow(
			"Pipeline routing failed",
		);
		await expect(router.routePipelineOnly(delivery)).rejects.toMatchObject({
			name: "PipelineRoutingError",
			retryable: true,
		});
		expect(transport.starts).toHaveLength(0);

		clock.value = new Date("2026-08-01T12:01:01.000Z");
		await expect(router.routePipelineOnly(delivery)).resolves.toMatchObject({
			appended: false,
			started: true,
			generation: 1,
		});
		expect(transport.starts).toHaveLength(1);
	});

	test("sanitizes orphan-recovery transport failures on duplicate delivery", async () => {
		const stateStore = new FaultInjectingStateStore({
			clock: () => new Date(now),
		});
		stateStore.failClaimAt = 1;
		const { router } = productionRouter({
			stateStore,
			retryPolicy: immediateRetryPolicy(),
		});
		const delivery = revisionEvent("orphan-recovery-error", sourceOne);
		await expect(router.routePipelineOnly(delivery)).rejects.toThrow(
			"Pipeline routing failed",
		);
		stateStore.failOrphanRecovery = true;

		const error = await router
			.routePipelineOnly(delivery)
			.catch((caught) => caught);
		expect(error).toMatchObject({
			name: "PipelineRoutingError",
			message: "Pipeline routing failed",
			retryable: true,
		});
		expect(JSON.stringify(error)).not.toContain("secret");
	});

	test("replays one accepted pipeline start with the same generation and client token", async () => {
		const transport = new IdempotentTransport();
		transport.failAfterAccepted = true;
		const { router, stateStore } = productionRouter({ transport });
		const delivery = revisionEvent("accepted-then-thrown", sourceOne);

		await expect(router.routePipelineOnly(delivery)).rejects.toThrow(
			"Pipeline routing failed",
		);
		const failed = stateStore.inspectRequest(request);
		expect(failed).toMatchObject({
			lifecycleState: "STARTING",
			generation: 1,
			leaseVersion: 2,
		});
		await expect(router.routePipelineOnly(delivery)).resolves.toMatchObject({
			appended: false,
			started: true,
			generation: 1,
		});

		expect(transport.starts).toHaveLength(2);
		expect(
			pipelineClientRequestToken(
				transport.starts[0] as StartReviewPipelineExecution,
			),
		).toBe(
			pipelineClientRequestToken(
				transport.starts[1] as StartReviewPipelineExecution,
			),
		);
		expect(transport.executionsByToken).toHaveLength(1);
	});

	test("never acknowledges an ambiguous changed requeue result", async () => {
		const stateStore = new FaultInjectingStateStore({
			clock: () => new Date(now),
		});
		stateStore.forceAmbiguousRequeue = true;
		const transport = new IdempotentTransport();
		transport.failAfterAccepted = true;
		const { router } = productionRouter({
			stateStore,
			transport,
			retryPolicy: immediateRetryPolicy(),
		});

		await expect(
			router.routePipelineOnly(revisionEvent("ambiguous-requeue", sourceOne)),
		).rejects.toMatchObject({
			name: "PipelineRoutingError",
			message: "Pipeline routing failed",
			retryable: true,
		});
	});

	test("recovers a response-lost requeue on redelivery with the same generation and execution token", async () => {
		const stateStore = new FaultInjectingStateStore({
			clock: () => new Date(now),
		});
		stateStore.commitRequeueThenThrow = true;
		const transport = new IdempotentTransport();
		transport.failAfterAccepted = true;
		const { router } = productionRouter({
			stateStore,
			transport,
			retryPolicy: immediateRetryPolicy(),
		});
		const delivery = revisionEvent("requeue-response-lost", sourceOne);

		await expect(router.routePipelineOnly(delivery)).rejects.toThrow(
			"Pipeline routing failed",
		);
		expect(stateStore.inspectRequest(request)).toMatchObject({
			lifecycleState: "STARTING",
			generation: 1,
			leaseVersion: 2,
			pendingEventCount: 1,
		});
		await expect(router.routePipelineOnly(delivery)).resolves.toMatchObject({
			generation: 1,
			started: true,
		});
		expect(transport.starts).toHaveLength(2);
		expect(
			pipelineClientRequestToken(
				transport.starts[0] as StartReviewPipelineExecution,
			),
		).toBe(
			pipelineClientRequestToken(
				transport.starts[1] as StartReviewPipelineExecution,
			),
		);
		expect(transport.executionsByToken).toHaveLength(1);
	});

	test("pipeline-only completion response loss uses the tombstone despite provider drift", async () => {
		const stateStore = new FaultInjectingStateStore({
			clock: () => new Date(now),
		});
		stateStore.commitIntentCompletionThenThrow = true;
		const transport = new IdempotentTransport();
		let current = snapshot(sourceOne, destination);
		const { router } = productionRouter({
			stateStore,
			transport,
			getRequest: async () => current,
			retryPolicy: immediateRetryPolicy(),
		});
		const delivery = revisionEvent("pipeline-only-completion-lost", sourceOne);

		await expect(router.routePipelineOnly(delivery)).rejects.toThrow(
			"Pipeline routing failed",
		);
		current = snapshot(sourceTwo, "d".repeat(40));
		await expect(router.routePipelineOnly(delivery)).resolves.toMatchObject({
			generation: 1,
			started: true,
		});

		expect(transport.starts).toHaveLength(1);
		expect(transport.executionsByToken).toHaveLength(1);
		expect(transport.starts[0]).toMatchObject({
			sourceRevision: sourceOne,
			destinationRevision: destination,
		});
	});

	test("pins source and destination intent across an accepted-start retry, then drains a newer revision", async () => {
		const clock = { value: new Date(now) };
		const stateStore = new FaultInjectingStateStore({
			clock: () => clock.value,
			leaseDurationSeconds: 60,
		});
		stateStore.requeueFailuresRemaining = 3;
		const transport = new IdempotentTransport();
		transport.failAfterAccepted = true;
		let current = snapshot(sourceOne, destination);
		const { router, coordinationStore } = productionRouter({
			stateStore,
			transport,
			clock: () => clock.value,
			getRequest: async () => current,
			retryPolicy: immediateRetryPolicy(),
		});
		const first = revisionEvent("intent-old", sourceOne);

		await expect(router.routePipelineOnly(first)).rejects.toThrow(
			"Pipeline routing failed",
		);
		current = snapshot(sourceTwo, "d".repeat(40));
		await expect(
			router.routePipelineOnly(
				revisionEvent("intent-new", sourceTwo, "2026-08-01T12:00:01.000Z"),
			),
		).rejects.toThrow("Pipeline routing failed");
		clock.value = new Date("2026-08-01T12:01:01.000Z");
		await router.routePipelineOnly(first);

		expect(
			transport.starts.map(({ sourceRevision }) => sourceRevision),
		).toEqual([sourceOne, sourceOne, sourceTwo]);
		expect(transport.starts.slice(0, 2)).toEqual([
			expect.objectContaining({
				sourceRevision: sourceOne,
				destinationRevision: destination,
			}),
			expect.objectContaining({
				sourceRevision: sourceOne,
				destinationRevision: destination,
			}),
		]);
		expect(transport.starts[2]).toMatchObject({
			sourceRevision: sourceTwo,
			destinationRevision: "d".repeat(40),
		});
		expect(transport.executionsByToken).toHaveLength(2);
		expect([...coordinationStore.mappings]).toEqual([
			["execution-1", expect.objectContaining({ sourceRevision: sourceOne })],
			["execution-2", expect.objectContaining({ sourceRevision: sourceTwo })],
		]);
		expect(
			await coordinationStore.getAuthoritativeRevision(request, 1),
		).toMatchObject({
			sourceRevision: sourceTwo,
		});
	});

	test("pins destination intent while replaying mapping persistence", async () => {
		const coordinationStore = new FaultInjectingCoordinationStore();
		coordinationStore.failMapping = true;
		let current = snapshot(sourceOne, destination);
		const { router, transport } = productionRouter({
			coordinationStore,
			getRequest: async () => current,
		});
		const delivery = revisionEvent("destination-intent", sourceOne);

		await expect(router.routePipelineOnly(delivery)).rejects.toThrow(
			"Pipeline routing failed",
		);
		current = snapshot(sourceOne, "d".repeat(40));
		await router.routePipelineOnly(delivery);

		expect(transport.starts).toEqual([
			expect.objectContaining({ destinationRevision: destination }),
			expect.objectContaining({ destinationRevision: destination }),
		]);
		expect(coordinationStore.mappings.get("execution-1")).toMatchObject({
			sourceRevision: sourceOne,
			destinationRevision: destination,
		});
	});

	test("replays mapping persistence after start with the same execution identity", async () => {
		const coordinationStore = new FaultInjectingCoordinationStore();
		coordinationStore.failMapping = true;
		const { router, transport } = productionRouter({ coordinationStore });
		const delivery = revisionEvent("mapping-replay", sourceOne);

		await expect(router.routePipelineOnly(delivery)).rejects.toThrow(
			"Pipeline routing failed",
		);
		await router.routePipelineOnly(delivery);

		expect(transport.executionsByToken).toHaveLength(1);
		expect(coordinationStore.mappings).toHaveLength(1);
		expect([...coordinationStore.mappings]).toEqual([
			["execution-1", expect.objectContaining({ generation: 1 })],
		]);
	});

	test("replays reconciliation with the pinned revisions and execution identity", async () => {
		const reconciler = new FaultInjectingReconciler();
		reconciler.fail = true;
		let current = snapshot(sourceOne, destination);
		const { router, transport, coordinationStore } = productionRouter({
			reconciler,
			getRequest: async () => current,
		});
		const delivery = revisionEvent("reconciler-replay", sourceOne);

		await expect(router.routePipelineOnly(delivery)).rejects.toThrow(
			"Pipeline routing failed",
		);
		current = snapshot(sourceTwo, "d".repeat(40));
		await router.routePipelineOnly(delivery);

		expect(transport.starts).toEqual([
			expect.objectContaining({
				sourceRevision: sourceOne,
				destinationRevision: destination,
			}),
			expect.objectContaining({
				sourceRevision: sourceOne,
				destinationRevision: destination,
			}),
		]);
		expect(transport.executionsByToken).toHaveLength(1);
		expect(coordinationStore.mappings).toHaveLength(1);
		expect(coordinationStore.mappings.get("execution-1")).toMatchObject({
			sourceRevision: sourceOne,
			destinationRevision: destination,
		});
		expect(reconciler.count).toBe(2);
	});

	test("atomically requeues claimed overflow when bounded draining is exhausted", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		const dispatcher = new RecordingDispatcher();
		dispatcher.beforeStart = async () => {
			const index = dispatcher.starts.length;
			if (index > 16) return;
			await store.appendEvent({
				type: "revision-updated",
				id: `overflow-${index}`,
				request,
				occurredAt: new Date(Date.parse(now) + index * 1_000).toISOString(),
				revision: sourceOne,
			});
		};
		const router = new PipelineEventRouter({
			stateStore: store,
			provider: { getRequest: async () => snapshot() },
			pipelineDispatcher: dispatcher,
			clock: () => new Date(now),
		});

		await expect(
			router.routePipelineOnly(revisionEvent("overflow-seed", sourceOne)),
		).rejects.toThrow("Pipeline routing failed");

		expect(dispatcher.starts).toHaveLength(16);
		expect(store.inspectRequest(request)).toMatchObject({
			lifecycleState: "STARTING",
			generation: 1,
			leaseVersion: 2,
			pendingEventCount: 1,
			lastPipelineRoutingFailure: { attempts: 4 },
		});
	});

	test("requeues the dispatched page when the next claim fails without terminalizing", async () => {
		const stateStore = new FaultInjectingStateStore({
			clock: () => new Date(now),
		});
		stateStore.failClaimAt = 2;
		const { router, transport } = productionRouter({
			stateStore,
			retryPolicy: immediateRetryPolicy(),
		});

		await expect(
			router.routePipelineOnly(revisionEvent("next-claim-failure", sourceOne)),
		).rejects.toThrow("Pipeline routing failed");

		expect(stateStore.failedCompletions).toBe(0);
		expect(stateStore.requeueCalls).toBe(1);
		expect(stateStore.inspectRequest(request)).toMatchObject({
			lifecycleState: "STARTING",
			generation: 1,
			pendingEventCount: 1,
		});
		expect(transport.starts).toHaveLength(1);
		await expect(
			router.routePipelineOnly(revisionEvent("next-claim-failure", sourceOne)),
		).resolves.toMatchObject({ generation: 1, started: true });
		expect(transport.starts).toHaveLength(1);
		expect(JSON.stringify(stateStore.inspectRequest(request))).not.toContain(
			"secret",
		);
	});

	test("requeues the dispatched page when final completion fails without terminalizing", async () => {
		const stateStore = new FaultInjectingStateStore({
			clock: () => new Date(now),
		});
		stateStore.failCompletionType = "clean";
		const { router, transport } = productionRouter({
			stateStore,
			retryPolicy: immediateRetryPolicy(),
		});

		await expect(
			router.routePipelineOnly(revisionEvent("completion-failure", sourceOne)),
		).rejects.toThrow("Pipeline routing failed");

		expect(stateStore.failedCompletions).toBe(0);
		expect(stateStore.requeueCalls).toBe(1);
		expect(stateStore.inspectRequest(request)).toMatchObject({
			lifecycleState: "STARTING",
			generation: 1,
			pendingEventCount: 1,
		});
		await expect(
			router.routePipelineOnly(revisionEvent("completion-failure", sourceOne)),
		).resolves.toMatchObject({ generation: 1, started: true });
		expect(transport.starts).toHaveLength(1);
		expect(transport.executionsByToken).toHaveLength(1);
		expect(JSON.stringify(stateStore.inspectRequest(request))).not.toContain(
			"secret",
		);
	});

	test("requeues a terminal page when terminal completion fails", async () => {
		const stateStore = new FaultInjectingStateStore({
			clock: () => new Date(now),
		});
		stateStore.failCompletionType = "closed";
		const dispatcher = new RecordingDispatcher();
		const router = new PipelineEventRouter({
			stateStore,
			provider: { getRequest: async () => snapshot() },
			pipelineDispatcher: dispatcher,
			retryPolicy: immediateRetryPolicy(),
			clock: () => new Date(now),
		});

		await expect(
			router.routePipelineOnly(closedEvent("terminal-failure")),
		).rejects.toThrow("Pipeline routing failed");

		expect(stateStore.failedCompletions).toBe(0);
		expect(stateStore.requeueCalls).toBe(1);
		expect(stateStore.inspectRequest(request)).toMatchObject({
			lifecycleState: "STARTING",
			generation: 1,
			pendingEventCount: 1,
		});
		expect(JSON.stringify(stateStore.inspectRequest(request))).not.toContain(
			"secret",
		);
	});

	test("recovers an orphaned claim on the same generation after its lease expires", async () => {
		const clock = { value: new Date(now) };
		const stateStore = new FaultInjectingStateStore({
			clock: () => clock.value,
			leaseDurationSeconds: 60,
		});
		stateStore.requeueFailuresRemaining = 3;
		const transport = new IdempotentTransport();
		transport.failAfterAccepted = true;
		const { router } = productionRouter({
			stateStore,
			transport,
			clock: () => clock.value,
			retryPolicy: immediateRetryPolicy(),
		});
		const delivery = revisionEvent("orphaned-claim", sourceOne);

		await expect(router.routePipelineOnly(delivery)).rejects.toThrow(
			"Pipeline routing failed",
		);
		await expect(router.routePipelineOnly(delivery)).rejects.toMatchObject({
			name: "PipelineRoutingError",
			retryable: true,
		});
		expect(transport.starts).toHaveLength(1);

		clock.value = new Date("2026-08-01T12:01:01.000Z");
		await expect(router.routePipelineOnly(delivery)).resolves.toMatchObject({
			appended: false,
			started: true,
			generation: 1,
		});
		expect(transport.starts).toHaveLength(2);
		expect(
			pipelineClientRequestToken(
				transport.starts[0] as StartReviewPipelineExecution,
			),
		).toBe(
			pipelineClientRequestToken(
				transport.starts[1] as StartReviewPipelineExecution,
			),
		);
		expect(stateStore.inspectRequest(request)).toMatchObject({
			lifecycleState: "COMPLETED",
			generation: 1,
			pendingEventCount: 0,
		});
	});

	test("bounds transient requeue retries without terminalizing claimed work", async () => {
		const stateStore = new FaultInjectingStateStore({
			clock: () => new Date(now),
		});
		stateStore.requeueFailuresRemaining = 3;
		const transport = new IdempotentTransport();
		transport.failAfterAccepted = true;
		const { router } = productionRouter({
			stateStore,
			transport,
			retryPolicy: immediateRetryPolicy(),
		});

		await expect(
			router.routePipelineOnly(revisionEvent("requeue-failure", sourceOne)),
		).rejects.toThrow("Pipeline routing failed");

		expect(stateStore.requeueCalls).toBe(3);
		expect(stateStore.failedCompletions).toBe(0);
		expect(stateStore.inspectRequest(request)).toMatchObject({
			lifecycleState: "RUNNING",
			generation: 1,
			leaseVersion: 1,
			pendingEventCount: 0,
		});
		expect(stateStore.inspectRequest(request)?.lastPipelineRoutingFailure).toBe(
			undefined,
		);
		expect(transport.starts[0]).toMatchObject({
			generation: 1,
			sourceRevision: sourceOne,
		});
		expect(transport.executionsByToken).toHaveLength(1);
		expect(JSON.stringify(stateStore.inspectRequest(request))).not.toContain(
			"secret",
		);
	});

	test("persists only the fixed sanitized pipeline routing failure", async () => {
		const transport = new IdempotentTransport();
		transport.failAfterAccepted = true;
		const { router, stateStore } = productionRouter({ transport });

		await expect(
			router.routePipelineOnly(revisionEvent("sanitize", sourceOne)),
		).rejects.toThrow("Pipeline routing failed");

		const persisted = JSON.stringify(
			stateStore.inspectRequest(request)?.lastPipelineRoutingFailure,
		);
		expect(JSON.parse(persisted)).toEqual({
			type: "operational-failure",
			lifecycleState: "FAILED",
			operation: "pipeline-route",
			reason: "retry-exhausted",
			attempts: 1,
			lastError: {
				name: "PipelineRoutingError",
				message: "Pipeline routing failed",
			},
		});
		expect(persisted).not.toContain("secret");
		expect(persisted).not.toContain("stack");
		expect(persisted).not.toContain("custom");
	});
});
