import { createHash } from "node:crypto";
import type { ReviewEvent } from "../domain/review-event";
import type { ReviewRequest } from "../domain/review-request";
import type { PrPipelineDispatcher } from "../pipeline-review-common";
import type { SourceControlProvider } from "../ports/source-control-provider";
import {
	type FailAndRequeueClaimResult,
	type PipelineClaimedEvents,
	type PipelineDispatchIntent,
	type ReviewStateStore,
	sanitizedPipelineRoutingFailure,
} from "../ports/state-store";
import { RetryPolicy } from "../services/retry-policy";
import type { NormalizedCodeCommitEvent } from "./codecommit-event-normalizer";
import {
	type CodeCommitEventFilterOptions,
	normalizeCodeCommitEvent,
} from "./codecommit-event-normalizer";

const MAX_DRAIN_STAGES = 16;

export interface PipelineEventRouterOptions {
	readonly stateStore: ReviewStateStore;
	readonly provider: Pick<SourceControlProvider, "getRequest">;
	readonly pipelineDispatcher: PrPipelineDispatcher;
	readonly reviewerArn?: string;
	readonly botArnPatterns?: readonly (string | RegExp)[];
	readonly clock?: () => Date;
	readonly retryPolicy?: RetryPolicy;
}

export interface PipelineRouteResult {
	readonly appended: boolean;
	readonly started: boolean;
	readonly generation: number;
}

export interface DispatchReviewedEventInput {
	readonly event: NormalizedCodeCommitEvent;
	readonly snapshot?: ReviewRequest;
	readonly generation: number;
	readonly refetchSnapshot: () => Promise<ReviewRequest>;
}

export class PipelineRoutingError extends Error {
	readonly retryable = true;

	constructor() {
		super("Pipeline routing failed");
		this.name = "PipelineRoutingError";
	}
}

class OwnedPipelineRoutingError extends PipelineRoutingError {}

function reviewEvent(normalized: NormalizedCodeCommitEvent): ReviewEvent {
	if (normalized.type === "revision-updated") {
		if (normalized.revision === undefined) {
			throw new Error("Expected revision-updated event to include a revision");
		}
		return {
			id: normalized.id,
			type: normalized.type,
			request: normalized.request,
			occurredAt: normalized.occurredAt,
			revision: normalized.revision,
		};
	}
	if (normalized.type === "human-comment") {
		if (normalized.commentId === undefined) {
			throw new Error("Expected human-comment event to include a comment id");
		}
		return {
			id: normalized.id,
			type: normalized.type,
			request: normalized.request,
			occurredAt: normalized.occurredAt,
			commentId: normalized.commentId,
			...(normalized.inReplyTo === undefined
				? {}
				: { inReplyTo: normalized.inReplyTo }),
		};
	}
	return {
		id: normalized.id,
		type: normalized.type,
		request: normalized.request,
		occurredAt: normalized.occurredAt,
	};
}

function compareEvents(left: ReviewEvent, right: ReviewEvent): number {
	const instant = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
	return instant === 0 ? left.id.localeCompare(right.id) : instant;
}

function dispatchIdentity(event: {
	readonly id: string;
	readonly type: string;
	readonly revision?: string;
}): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				eventId: event.id,
				sourceSignal: event.revision ?? event.type,
			}),
			"utf8",
		)
		.digest("base64url");
}

function isPendingWork(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(("code" in error && error.code === "PENDING_WORK") ||
			("name" in error && error.name === "PendingWorkError"))
	);
}

function isStaleState(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(("code" in error && error.code === "STATE_CHANGED") ||
			("name" in error && error.name === "StaleStateError"))
	);
}

export class PipelineEventRouter {
	readonly #store: ReviewStateStore;
	readonly #provider: Pick<SourceControlProvider, "getRequest">;
	readonly #dispatcher: PrPipelineDispatcher;
	readonly #filters: CodeCommitEventFilterOptions;
	readonly #clock: () => Date;
	readonly #retry: RetryPolicy;

	constructor(options: PipelineEventRouterOptions) {
		this.#store = options.stateStore;
		this.#provider = options.provider;
		this.#dispatcher = options.pipelineDispatcher;
		this.#filters = {
			reviewerArn: options.reviewerArn,
			botArnPatterns: options.botArnPatterns,
		};
		this.#clock = options.clock ?? (() => new Date());
		this.#retry =
			options.retryPolicy ??
			new RetryPolicy({ baseDelayMs: 25, maxDelayMs: 1_000, maxAttempts: 3 });
	}

	async dispatchReviewedEvent(
		input: DispatchReviewedEventInput,
	): Promise<void> {
		try {
			await this.#dispatchReviewedEvent(input);
		} catch {
			throw new PipelineRoutingError();
		}
	}

	async #dispatchReviewedEvent(
		input: DispatchReviewedEventInput,
	): Promise<void> {
		const startsPipeline =
			input.event.type === "request-opened" ||
			input.event.type === "revision-updated";
		if (startsPipeline) {
			const identity = dispatchIdentity(input.event);
			const existing = await this.#store.getPipelineDispatchIntent(
				input.event.request,
				input.generation,
				identity,
			);
			if (existing !== undefined) {
				if (existing.status === "COMPLETED") return;
				const receipt = await this.#dispatchIntent(existing, undefined, true);
				const completed = await this.#store.completePipelineDispatchIntent(
					receipt === undefined ? existing : { ...existing, ...receipt },
					{ kind: "reviewed" },
				);
				if (!completed.completed) throw new PipelineRoutingError();
				return;
			}
			if (
				input.snapshot?.status === "open" &&
				(input.event.type !== "revision-updated" ||
					input.event.revision === input.snapshot.sourceRevision)
			) {
				const intent = await this.#store.getOrCreatePipelineDispatchIntent(
					{
						request: input.event.request,
						generation: input.generation,
						dispatchIdentity: identity,
						status: "PENDING",
						sourceRevision: input.snapshot.sourceRevision,
						destinationRevision: input.snapshot.destinationRevision,
						observedAt: input.event.occurredAt,
						eventId: input.event.id,
					},
					{ kind: "reviewed" },
				);
				if (intent.status === "COMPLETED") return;
				const receipt = await this.#dispatchIntent(intent, input.snapshot);
				const completed = await this.#store.completePipelineDispatchIntent(
					receipt === undefined ? intent : { ...intent, ...receipt },
					{ kind: "reviewed" },
				);
				if (!completed.completed) throw new PipelineRoutingError();
			}
			return;
		}
		if (
			input.event.type === "request-merged" ||
			input.event.type === "request-closed"
		) {
			await this.#dispatcher.completeTerminalRequest({
				request: input.event.request,
				generation: input.generation,
				status: input.event.type === "request-merged" ? "merged" : "closed",
			});
		}
	}

	async routePipelineOnly(
		value: unknown,
	): Promise<PipelineRouteResult | undefined> {
		const normalized = normalizeCodeCommitEvent(value, this.#filters);
		if (normalized === undefined) return undefined;
		const event = reviewEvent(normalized);
		const appended = await this.#store.appendEvent(event);
		let generation = appended.generation;
		let leaseVersion = appended.leaseVersion;
		if (!appended.shouldStart) {
			let shouldRecover = appended.recoveryEligible;
			const terminal =
				appended.lifecycleState === "COMPLETED" ||
				appended.lifecycleState === "TIMED_OUT" ||
				appended.lifecycleState === "FAILED";
			if (!terminal) {
				const orphan = await this.#store
					.recoverOrphanedPipelineClaim({
						request: event.request,
						generation,
						leaseVersion,
						recoveredAt: this.#clock().toISOString(),
					})
					.catch(() => {
						throw new PipelineRoutingError();
					});
				if (orphan.recovered) {
					generation = orphan.generation;
					leaseVersion = orphan.leaseVersion;
					shouldRecover = true;
				} else if (orphan.reason === "active") {
					if (appended.appended) {
						return {
							appended: true,
							started: false,
							generation,
						};
					}
					throw new PipelineRoutingError();
				} else if (!shouldRecover) {
					if (orphan.reason === "no-claimed-events") {
						return {
							appended: appended.appended,
							started: false,
							generation,
						};
					}
					throw new PipelineRoutingError();
				}
			}
			if (!shouldRecover) {
				return {
					appended: appended.appended,
					started: false,
					generation,
				};
			}
			const recovery = await this.#store
				.recoverLease({
					request: event.request,
					generation,
					leaseVersion,
					remoteStatus: "NOT_FOUND",
					recoveredAt: this.#clock().toISOString(),
				})
				.catch(() => {
					throw new PipelineRoutingError();
				});
			if (!recovery.recovered) {
				if (recovery.reason === "no-pending-events") {
					return {
						appended: appended.appended,
						started: false,
						generation,
					};
				}
				throw new PipelineRoutingError();
			}
			generation = recovery.generation;
			leaseVersion = recovery.leaseVersion;
			if (!recovery.shouldStart) {
				return {
					appended: appended.appended,
					started: false,
					generation,
				};
			}
		}

		const started = await this.#drain(event, generation, leaseVersion);
		return {
			appended: appended.appended,
			started,
			generation,
		};
	}

	async #drain(
		initialEvent: ReviewEvent,
		generation: number,
		leaseVersion: number,
	): Promise<boolean> {
		try {
			return await this.#drainOwned(initialEvent, generation, leaseVersion);
		} catch (error) {
			if (error instanceof OwnedPipelineRoutingError) throw error;
			throw new OwnedPipelineRoutingError();
		}
	}

	async #drainOwned(
		initialEvent: ReviewEvent,
		generation: number,
		leaseVersion: number,
	): Promise<boolean> {
		let started = false;
		let replayableClaim:
			| {
					readonly claimIdentity: string;
					readonly events: readonly ReviewEvent[];
			  }
			| undefined;
		let completion: "clean" | "merged" | "closed" = "clean";
		for (let stage = 0; stage < MAX_DRAIN_STAGES; stage += 1) {
			let claimed: PipelineClaimedEvents;
			try {
				claimed = await this.#store.claimPipelineEvents(
					initialEvent.request,
					generation,
					leaseVersion,
				);
			} catch {
				if (replayableClaim !== undefined) {
					await this.#requeueClaim(
						initialEvent,
						generation,
						leaseVersion,
						replayableClaim.claimIdentity,
						replayableClaim.events,
						stage + 1,
					);
				}
				throw new OwnedPipelineRoutingError();
			}
			if (claimed.events.length === 0) {
				try {
					await this.#store.complete(initialEvent.request, generation, {
						type: completion,
					});
					return started;
				} catch (error) {
					if (isPendingWork(error)) continue;
					if (isStaleState(error)) return started;
					if (replayableClaim !== undefined) {
						const requeue = await this.#requeueClaim(
							initialEvent,
							generation,
							leaseVersion,
							replayableClaim.claimIdentity,
							replayableClaim.events,
							stage + 1,
						);
						if (!requeue.requeued) throw new OwnedPipelineRoutingError();
					}
					throw new OwnedPipelineRoutingError();
				}
			}
			const claimIdentity = claimed.claimIdentity;
			if (claimIdentity === undefined) throw new OwnedPipelineRoutingError();
			replayableClaim = { claimIdentity, events: claimed.events };

			let outcome: {
				readonly started: boolean;
				readonly terminal?: "merged" | "closed";
			};
			try {
				outcome = await this.#dispatchClaimed(
					claimed.events,
					generation,
					leaseVersion,
				);
			} catch {
				const requeue = await this.#requeueClaim(
					initialEvent,
					generation,
					leaseVersion,
					claimIdentity,
					claimed.events,
					stage + 1,
				);
				if (!requeue.requeued) throw new OwnedPipelineRoutingError();
				throw new OwnedPipelineRoutingError();
			}
			started = started || outcome.started;
			if (outcome.started) completion = "clean";
			if (outcome.terminal !== undefined) {
				completion = outcome.terminal;
				try {
					await this.#store.complete(initialEvent.request, generation, {
						type: outcome.terminal,
					});
					return started;
				} catch (error) {
					if (isStaleState(error)) return started;
					if (isPendingWork(error)) {
						const settled = await this.#settleClaim(
							initialEvent,
							generation,
							leaseVersion,
							claimIdentity,
							claimed.events,
						);
						if (!settled) throw new OwnedPipelineRoutingError();
						continue;
					}
					const requeue = await this.#requeueClaim(
						initialEvent,
						generation,
						leaseVersion,
						claimIdentity,
						claimed.events,
						stage + 1,
					);
					if (!requeue.requeued) throw new OwnedPipelineRoutingError();
					throw new OwnedPipelineRoutingError();
				}
			}
			const settled = await this.#settleClaim(
				initialEvent,
				generation,
				leaseVersion,
				claimIdentity,
				claimed.events,
			);
			if (!settled) throw new OwnedPipelineRoutingError();
		}

		let overflow: PipelineClaimedEvents;
		try {
			overflow = await this.#store.claimPipelineEvents(
				initialEvent.request,
				generation,
				leaseVersion,
			);
		} catch {
			if (replayableClaim !== undefined) {
				await this.#requeueClaim(
					initialEvent,
					generation,
					leaseVersion,
					replayableClaim.claimIdentity,
					replayableClaim.events,
					MAX_DRAIN_STAGES,
				);
			}
			throw new OwnedPipelineRoutingError();
		}
		if (overflow.events.length === 0) {
			try {
				await this.#store.complete(initialEvent.request, generation, {
					type: completion,
				});
				return started;
			} catch (error) {
				if (isStaleState(error)) return started;
				if (!isPendingWork(error)) {
					if (replayableClaim !== undefined) {
						const requeue = await this.#requeueClaim(
							initialEvent,
							generation,
							leaseVersion,
							replayableClaim.claimIdentity,
							replayableClaim.events,
							MAX_DRAIN_STAGES,
						);
						if (!requeue.requeued) throw new OwnedPipelineRoutingError();
					}
					throw new OwnedPipelineRoutingError();
				}
				try {
					overflow = await this.#store.claimPipelineEvents(
						initialEvent.request,
						generation,
						leaseVersion,
					);
				} catch {
					if (replayableClaim !== undefined) {
						await this.#requeueClaim(
							initialEvent,
							generation,
							leaseVersion,
							replayableClaim.claimIdentity,
							replayableClaim.events,
							MAX_DRAIN_STAGES,
						);
					}
					throw new OwnedPipelineRoutingError();
				}
			}
		}
		if (overflow.events.length > 0) {
			if (overflow.claimIdentity === undefined) {
				throw new OwnedPipelineRoutingError();
			}
			const requeue = await this.#requeueClaim(
				initialEvent,
				generation,
				leaseVersion,
				overflow.claimIdentity,
				overflow.events,
				MAX_DRAIN_STAGES,
			);
			if (!requeue.requeued) throw new OwnedPipelineRoutingError();
		}
		throw new OwnedPipelineRoutingError();
	}

	async #settleClaim(
		initialEvent: ReviewEvent,
		generation: number,
		leaseVersion: number,
		claimIdentity: string,
		events: readonly ReviewEvent[],
	): Promise<boolean> {
		try {
			const settled = await this.#store.settlePipelineClaim({
				request: initialEvent.request,
				generation,
				leaseVersion,
				claimIdentity,
				events,
			});
			return settled.settled;
		} catch {
			throw new OwnedPipelineRoutingError();
		}
	}

	async #requeueClaim(
		initialEvent: ReviewEvent,
		generation: number,
		leaseVersion: number,
		claimIdentity: string,
		events: readonly ReviewEvent[],
		attempts: number,
	): Promise<FailAndRequeueClaimResult> {
		try {
			const input = {
				request: initialEvent.request,
				generation,
				leaseVersion,
				claimIdentity,
				events,
				failedAt: this.#clock().toISOString(),
				failure: sanitizedPipelineRoutingFailure(attempts),
			};
			const retried = await this.#retry.execute("pipeline-claim-requeue", () =>
				this.#store.failAndRequeueClaim(input),
			);
			if (!retried.ok) throw new OwnedPipelineRoutingError();
			return retried.value;
		} catch {
			throw new OwnedPipelineRoutingError();
		}
	}

	async #dispatchClaimed(
		events: readonly ReviewEvent[],
		generation: number,
		leaseVersion: number,
	): Promise<{
		readonly started: boolean;
		readonly terminal?: "merged" | "closed";
	}> {
		const ordered = [...events].sort(compareEvents);
		for (const event of ordered) {
			if (
				event.type === "human-comment" ||
				event.type === "request-merged" ||
				event.type === "request-closed"
			) {
				continue;
			}
			const existingIntent = await this.#store.getPipelineDispatchIntent(
				event.request,
				generation,
				dispatchIdentity(event),
			);
			if (existingIntent === undefined) continue;
			if (existingIntent.status === "PENDING") {
				const receipt = await this.#dispatchIntent(
					existingIntent,
					undefined,
					true,
				);
				const completed = await this.#store.completePipelineDispatchIntent(
					receipt === undefined
						? existingIntent
						: { ...existingIntent, ...receipt },
					{ kind: "pipeline-only", leaseVersion },
				);
				if (!completed.completed) throw new PipelineRoutingError();
			}
			const remaining = ordered.filter(
				(candidate) => compareEvents(candidate, event) > 0,
			);
			if (remaining.length === 0) return { started: true };
			const next = await this.#dispatchFreshClaimed(
				remaining,
				generation,
				leaseVersion,
			);
			return { ...next, started: true };
		}
		return this.#dispatchFreshClaimed(ordered, generation, leaseVersion);
	}

	async #dispatchFreshClaimed(
		events: readonly ReviewEvent[],
		generation: number,
		leaseVersion: number,
	): Promise<{
		readonly started: boolean;
		readonly terminal?: "merged" | "closed";
	}> {
		const latest = [...events]
			.sort(compareEvents)
			.filter(({ type }) => type !== "human-comment")
			.at(-1);
		if (latest === undefined) return { started: false };
		if (latest.type === "request-merged" || latest.type === "request-closed") {
			const status = latest.type === "request-merged" ? "merged" : "closed";
			await this.#dispatcher.completeTerminalRequest({
				request: latest.request,
				generation,
				status,
			});
			return { started: false, terminal: status };
		}
		const authoritative = await this.#provider.getRequest(latest.request);
		if (authoritative.status !== "open") {
			await this.#dispatcher.completeTerminalRequest({
				request: latest.request,
				generation,
				status: authoritative.status,
			});
			return { started: false, terminal: authoritative.status };
		}
		const intent = await this.#store.getOrCreatePipelineDispatchIntent(
			{
				request: authoritative.key,
				generation,
				dispatchIdentity: dispatchIdentity(latest),
				status: "PENDING",
				sourceRevision: authoritative.sourceRevision,
				destinationRevision: authoritative.destinationRevision,
				observedAt: latest.occurredAt,
				eventId: latest.id,
			},
			{ kind: "pipeline-only", leaseVersion },
		);
		if (intent.status === "COMPLETED") return { started: true };
		const receipt = await this.#dispatchIntent(intent, authoritative);
		const completed = await this.#store.completePipelineDispatchIntent(
			receipt === undefined ? intent : { ...intent, ...receipt },
			{
				kind: "pipeline-only",
				leaseVersion,
			},
		);
		if (!completed.completed) throw new PipelineRoutingError();
		return { started: true };
	}

	async #dispatchIntent(
		intent: PipelineDispatchIntent,
		snapshot?: ReviewRequest,
		replayAcceptedIntent = false,
	) {
		const pinnedSnapshot: ReviewRequest = snapshot ?? {
			key: intent.request,
			title: "Pipeline dispatch intent",
			status: "open",
			sourceBranch: "pipeline-intent-source",
			destinationBranch: "pipeline-intent-destination",
			sourceRevision: intent.sourceRevision,
			destinationRevision: intent.destinationRevision,
		};
		return this.#dispatcher.startReviewPipeline({
			snapshot: pinnedSnapshot,
			generation: intent.generation,
			observedAt: intent.observedAt,
			eventId: intent.eventId,
			refetchSnapshot: async () => pinnedSnapshot,
			dispatchIntent: intent,
			replayAcceptedIntent,
		});
	}
}
