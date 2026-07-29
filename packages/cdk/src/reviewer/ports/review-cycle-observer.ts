import type { RequestKey } from "../domain/review-request";

export interface ReviewCycleOutcome {
	readonly request: RequestKey;
	readonly generation: number;
	readonly sourceRevision: string;
	readonly cycle: number;
	readonly reviewStatus: "reviewed" | "blocked" | "failed";
	readonly checkStatus: "completed" | "failed" | "blocked";
	readonly occurredAt: string;
}

export interface ReviewTerminalRequest {
	readonly request: RequestKey;
	readonly generation: number;
	readonly status: "merged" | "closed";
}

export interface ReviewCycleObserver {
	recordCycle(outcome: ReviewCycleOutcome): Promise<void>;
	recordTerminalRequest(terminal: ReviewTerminalRequest): Promise<void>;
}

export class NoopReviewCycleObserver implements ReviewCycleObserver {
	async recordCycle(_outcome: ReviewCycleOutcome): Promise<void> {}
	async recordTerminalRequest(
		_terminal: ReviewTerminalRequest,
	): Promise<void> {}
}
