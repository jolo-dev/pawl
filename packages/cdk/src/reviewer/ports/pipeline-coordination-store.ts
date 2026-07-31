import type { RequestKey } from "../domain/review-request";
import type {
	CallbackIntent,
	JobState,
	PipelineJobRecord,
	ReviewOutcome,
	TerminalRequestRecord,
} from "../pipeline/pipeline-coordination-store";

export interface PipelineExecutionMapping {
	readonly executionId: string;
	readonly pipelineName: string;
	readonly request: RequestKey;
	readonly generation: number;
	readonly sourceRevision: string;
	readonly destinationRevision: string;
	readonly createdAt: string;
}

export interface PipelineJobPage {
	readonly jobs: readonly PipelineJobRecord[];
	readonly cursor?: Readonly<Record<string, unknown>>;
}

export interface PipelineCoordinationStore {
	registerJob(job: PipelineJobRecord): Promise<PipelineJobRecord>;
	getJob(jobId: string): Promise<PipelineJobRecord | undefined>;
	putExecutionMapping(mapping: PipelineExecutionMapping): Promise<void>;
	getExecutionMapping(
		executionId: string,
	): Promise<PipelineExecutionMapping | undefined>;
	recordOutcome(outcome: ReviewOutcome): Promise<ReviewOutcome>;
	getOutcome(job: PipelineJobRecord): Promise<ReviewOutcome | undefined>;
	recordTerminalRequestState(
		terminal: TerminalRequestRecord,
	): Promise<TerminalRequestRecord>;
	getTerminalRequestState(
		request: RequestKey,
		generation: number,
	): Promise<TerminalRequestRecord | undefined>;
	listDueJobs(
		state: Extract<JobState, "PENDING" | "COMPLETING">,
		now: string,
		cursor?: Readonly<Record<string, unknown>>,
	): Promise<PipelineJobPage>;
	listRequestJobs(
		request: RequestKey,
		generation: number,
		cursor?: Readonly<Record<string, unknown>>,
	): Promise<PipelineJobPage>;
	setCallbackCandidate(jobId: string, candidate: CallbackIntent): Promise<void>;
	claimCompletion(input: {
		readonly jobId: string;
		readonly intent: CallbackIntent;
		readonly leaseExpiresAt: string;
		readonly nextActionAt: string;
	}): Promise<PipelineJobRecord | undefined>;
	reclaimCompletion(input: {
		readonly jobId: string;
		readonly intent: CallbackIntent;
		readonly now: string;
		readonly leaseExpiresAt: string;
		readonly nextActionAt: string;
	}): Promise<PipelineJobRecord | undefined>;
	finishCompletion(jobId: string, intent: CallbackIntent): Promise<void>;
	reschedule(jobId: string, nextActionAt: string): Promise<void>;
}
