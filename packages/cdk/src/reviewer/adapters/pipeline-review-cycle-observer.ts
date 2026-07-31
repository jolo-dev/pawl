import type { PipelineCoordinationStore } from "../ports/pipeline-coordination-store";
import type {
	ReviewCycleObserver,
	ReviewCycleOutcome,
	ReviewExecutionFailure,
	ReviewTerminalRequest,
} from "../ports/review-cycle-observer";

interface ReconcilerKick {
	invoke(jobId?: string): Promise<void>;
}

export class PipelineReviewCycleObserver implements ReviewCycleObserver {
	readonly #store: PipelineCoordinationStore;
	readonly #reconciler: ReconcilerKick;
	readonly #clock: () => Date;

	constructor(options: {
		readonly store: PipelineCoordinationStore;
		readonly reconciler: ReconcilerKick;
		readonly clock?: () => Date;
	}) {
		this.#store = options.store;
		this.#reconciler = options.reconciler;
		this.#clock = options.clock ?? (() => new Date());
	}

	async recordCycle(outcome: ReviewCycleOutcome): Promise<void> {
		await this.#store.recordOutcome({
			request: outcome.request,
			generation: outcome.generation,
			sourceRevision: outcome.sourceRevision,
			cycle: outcome.cycle,
			status: outcome.reviewStatus,
			checkStatus: outcome.checkStatus,
			createdAt: outcome.occurredAt,
		});
		await this.#wakeRequestJobs(outcome.request, outcome.generation);
	}

	async recordExecutionFailure(failure: ReviewExecutionFailure): Promise<void> {
		await this.#store.recordOutcome({
			request: failure.request,
			generation: failure.generation,
			sourceRevision: failure.sourceRevision,
			cycle: failure.cycle,
			status: "failed",
			checkStatus: "failed",
			createdAt: failure.occurredAt,
		});
		await this.#wakeRequestJobs(failure.request, failure.generation);
	}

	async recordTerminalRequest(terminal: ReviewTerminalRequest): Promise<void> {
		const candidate = {
			status: "success",
			category:
				terminal.status === "merged" ? "RequestMerged" : "RequestClosed",
		} as const;
		let cursor: Readonly<Record<string, unknown>> | undefined;
		do {
			const page = await this.#store.listRequestJobs(
				terminal.request,
				terminal.generation,
				cursor,
			);
			for (const job of page.jobs) {
				if (job.state === "PENDING") {
					await this.#store.setCallbackCandidate(job.jobId, candidate);
				}
			}
			cursor = page.cursor;
		} while (cursor !== undefined);
		await this.#reconciler.invoke();
	}

	async #wakeRequestJobs(
		request: ReviewCycleOutcome["request"],
		generation: number,
	): Promise<void> {
		const now = this.#clock().toISOString();
		let cursor: Readonly<Record<string, unknown>> | undefined;
		do {
			const page = await this.#store.listRequestJobs(
				request,
				generation,
				cursor,
			);
			for (const job of page.jobs) {
				if (job.state === "PENDING") {
					await this.#store.reschedule(job.jobId, now);
				}
			}
			cursor = page.cursor;
		} while (cursor !== undefined);
		await this.#reconciler.invoke();
	}
}
