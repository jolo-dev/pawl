import type { ReviewEvent } from "../domain/review-event";
import type { ReviewRequest } from "../domain/review-request";
import type { PrPipelineDispatcher } from "../pipeline-review-common";
import type { SourceControlProvider } from "../ports/source-control-provider";
import {
	type ReviewStateStore,
	sanitizedPipelineRoutingFailure,
} from "../ports/state-store";
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

	constructor(options: PipelineEventRouterOptions) {
		this.#store = options.stateStore;
		this.#provider = options.provider;
		this.#dispatcher = options.pipelineDispatcher;
		this.#filters = {
			reviewerArn: options.reviewerArn,
			botArnPatterns: options.botArnPatterns,
		};
		this.#clock = options.clock ?? (() => new Date());
	}

	async dispatchReviewedEvent(
		input: DispatchReviewedEventInput,
	): Promise<void> {
		const startsPipeline =
			input.event.type === "request-opened" ||
			input.event.type === "revision-updated";
		if (
			startsPipeline &&
			input.snapshot?.status === "open" &&
			(input.event.type !== "revision-updated" ||
				input.event.revision === input.snapshot.sourceRevision)
		) {
			await this.#dispatcher.startReviewPipeline({
				snapshot: input.snapshot,
				generation: input.generation,
				observedAt: input.event.occurredAt,
				eventId: input.event.id,
				refetchSnapshot: input.refetchSnapshot,
			});
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
			if (!appended.recoveryEligible) {
				return {
					appended: appended.appended,
					started: false,
					generation,
				};
			}
			const recovery = await this.#store.recoverLease({
				request: event.request,
				generation,
				leaseVersion,
				remoteStatus: "NOT_FOUND",
				recoveredAt: this.#clock().toISOString(),
			});
			if (!recovery.recovered) {
				if (recovery.reason === "remote-status-required") {
					throw new Error(
						"pipeline-only recovery unexpectedly required remote execution status",
					);
				}
				return {
					appended: appended.appended,
					started: false,
					generation:
						recovery.reason === "changed"
							? (recovery.generation ?? generation)
							: generation,
				};
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

		try {
			const started = await this.#drain(event, generation, leaseVersion);
			return {
				appended: appended.appended,
				started,
				generation,
			};
		} catch (error) {
			if (error instanceof PipelineRoutingError) throw error;
			try {
				await this.#store.complete(event.request, generation, {
					type: "failed",
					failure: sanitizedPipelineRoutingFailure(1),
					ownership: { kind: "lease", leaseVersion },
				});
			} catch (completionError) {
				if (!isStaleState(completionError)) throw completionError;
			}
			throw new PipelineRoutingError();
		}
	}

	async #drain(
		initialEvent: ReviewEvent,
		generation: number,
		leaseVersion: number,
	): Promise<boolean> {
		let started = false;
		let completion: "clean" | "merged" | "closed" = "clean";
		for (let stage = 0; stage < MAX_DRAIN_STAGES; stage += 1) {
			const claimed = await this.#store.claimEvents(
				initialEvent.request,
				generation,
			);
			if (claimed.events.length === 0) {
				try {
					await this.#store.complete(initialEvent.request, generation, {
						type: completion,
					});
					return started;
				} catch (error) {
					if (isPendingWork(error)) continue;
					if (isStaleState(error)) return started;
					throw error;
				}
			}

			try {
				const outcome = await this.#dispatchClaimed(claimed.events, generation);
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
						if (isPendingWork(error)) continue;
						if (isStaleState(error)) return started;
						throw error;
					}
				}
			} catch (error) {
				if (isPendingWork(error)) continue;
				if (isStaleState(error)) return started;
				const requeue = await this.#store.failAndRequeueClaim({
					request: initialEvent.request,
					generation,
					leaseVersion,
					events: claimed.events,
					failedAt: this.#clock().toISOString(),
					failure: sanitizedPipelineRoutingFailure(stage + 1),
				});
				if (!requeue.requeued) return started;
				throw new PipelineRoutingError();
			}
		}
		let overflow = await this.#store.claimEvents(
			initialEvent.request,
			generation,
		);
		if (overflow.events.length === 0) {
			try {
				await this.#store.complete(initialEvent.request, generation, {
					type: completion,
				});
				return started;
			} catch (error) {
				if (isStaleState(error)) return started;
				if (!isPendingWork(error)) throw error;
				overflow = await this.#store.claimEvents(
					initialEvent.request,
					generation,
				);
			}
		}
		if (overflow.events.length > 0) {
			const requeue = await this.#store.failAndRequeueClaim({
				request: initialEvent.request,
				generation,
				leaseVersion,
				events: overflow.events,
				failedAt: this.#clock().toISOString(),
				failure: sanitizedPipelineRoutingFailure(MAX_DRAIN_STAGES),
			});
			if (!requeue.requeued) return started;
		}
		throw new PipelineRoutingError();
	}

	async #dispatchClaimed(
		events: readonly ReviewEvent[],
		generation: number,
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
		await this.#dispatcher.startReviewPipeline({
			snapshot: authoritative,
			generation,
			observedAt: latest.occurredAt,
			eventId: latest.id,
			refetchSnapshot: () => this.#provider.getRequest(latest.request),
		});
		return { started: true };
	}
}
