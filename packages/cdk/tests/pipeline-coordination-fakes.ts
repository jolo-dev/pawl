import type { RequestKey } from "../src/reviewer/domain/review-request";
import {
	type CallbackIntent,
	claimCompletion as claimJob,
	completeClaimedJob,
	type JobState,
	type PipelineJobRecord,
	type ReviewOutcome,
	type TerminalRequestRecord,
	terminalRequestRecordSchema,
} from "../src/reviewer/pipeline/pipeline-coordination-store";
import type {
	PipelineCoordinationStore,
	PipelineExecutionMapping,
	PipelineJobPage,
} from "../src/reviewer/ports/pipeline-coordination-store";

const requestKey = (request: RequestKey, generation: number): string =>
	JSON.stringify([
		request.provider,
		request.repository,
		request.requestId,
		generation,
	]);
const terminalRequestKey = (request: RequestKey, generation: number): string =>
	requestKey(request, generation);
const outcomeKey = (job: PipelineJobRecord): string | undefined =>
	job.request && job.generation !== undefined && job.sourceRevision
		? JSON.stringify([
				job.request.provider,
				job.request.repository,
				job.request.requestId,
				job.generation,
				job.sourceRevision,
			])
		: undefined;

export class FakePipelineCoordinationStore
	implements PipelineCoordinationStore
{
	readonly jobs = new Map<string, PipelineJobRecord>();
	readonly outcomes = new Map<string, ReviewOutcome>();
	readonly terminalRequests = new Map<string, TerminalRequestRecord>();
	readonly mappings = new Map<string, PipelineExecutionMapping>();

	async registerJob(job: PipelineJobRecord): Promise<PipelineJobRecord> {
		const existing = this.jobs.get(job.jobId);
		if (existing) return existing;
		this.jobs.set(job.jobId, job);
		return job;
	}
	async getJob(jobId: string): Promise<PipelineJobRecord | undefined> {
		return this.jobs.get(jobId);
	}
	async putExecutionMapping(mapping: PipelineExecutionMapping): Promise<void> {
		this.mappings.set(mapping.executionId, mapping);
	}
	async getExecutionMapping(
		executionId: string,
	): Promise<PipelineExecutionMapping | undefined> {
		return this.mappings.get(executionId);
	}
	async recordOutcome(outcome: ReviewOutcome): Promise<ReviewOutcome> {
		const key = JSON.stringify([
			outcome.request.provider,
			outcome.request.repository,
			outcome.request.requestId,
			outcome.generation,
			outcome.sourceRevision,
		]);
		const existing = this.outcomes.get(key);
		if (existing) return existing;
		this.outcomes.set(key, outcome);
		return outcome;
	}
	async getOutcome(job: PipelineJobRecord): Promise<ReviewOutcome | undefined> {
		const key = outcomeKey(job);
		return key ? this.outcomes.get(key) : undefined;
	}
	async recordTerminalRequestState(
		terminalInput: TerminalRequestRecord,
	): Promise<TerminalRequestRecord> {
		const terminal = terminalRequestRecordSchema.parse(terminalInput);
		const key = terminalRequestKey(terminal.request, terminal.generation);
		const existing = this.terminalRequests.get(key);
		if (existing) return existing;
		this.terminalRequests.set(key, terminal);
		return terminal;
	}
	async getTerminalRequestState(
		request: RequestKey,
		generation: number,
	): Promise<TerminalRequestRecord | undefined> {
		return this.terminalRequests.get(terminalRequestKey(request, generation));
	}
	async listDueJobs(
		state: Extract<JobState, "PENDING" | "COMPLETING">,
		now: string,
		_cursor?: Readonly<Record<string, unknown>>,
	): Promise<PipelineJobPage> {
		return {
			jobs: [...this.jobs.values()].filter(
				(job) =>
					job.state === state &&
					job.nextActionAt !== undefined &&
					Date.parse(job.nextActionAt) <= Date.parse(now),
			),
		};
	}
	async listRequestJobs(
		request: RequestKey,
		generation: number,
		_cursor?: Readonly<Record<string, unknown>>,
	): Promise<PipelineJobPage> {
		const key = requestKey(request, generation);
		return {
			jobs: [...this.jobs.values()].filter(
				(job) =>
					job.request !== undefined &&
					job.generation !== undefined &&
					requestKey(job.request, job.generation) === key,
			),
		};
	}
	async setCallbackCandidate(
		jobId: string,
		candidate: CallbackIntent,
	): Promise<void> {
		const job = this.jobs.get(jobId);
		if (job?.state !== "PENDING" || job.terminalIntent || job.callbackCandidate)
			return;
		this.jobs.set(jobId, { ...job, callbackCandidate: candidate });
	}
	async claimCompletion(input: {
		readonly jobId: string;
		readonly intent: CallbackIntent;
		readonly leaseExpiresAt: string;
		readonly nextActionAt: string;
	}): Promise<PipelineJobRecord | undefined> {
		const job = this.jobs.get(input.jobId);
		if (!job) return undefined;
		const claimed = claimJob({
			job,
			intent: input.intent,
			completionLeaseExpiresAt: input.leaseExpiresAt,
			nextActionAt: input.nextActionAt,
		});
		if (claimed) this.jobs.set(input.jobId, claimed);
		return claimed;
	}
	async reclaimCompletion(input: {
		readonly jobId: string;
		readonly intent: CallbackIntent;
		readonly now: string;
		readonly leaseExpiresAt: string;
		readonly nextActionAt: string;
	}): Promise<PipelineJobRecord | undefined> {
		const job = this.jobs.get(input.jobId);
		if (
			job?.state !== "COMPLETING" ||
			JSON.stringify(job.terminalIntent) !== JSON.stringify(input.intent) ||
			!job.completionLeaseExpiresAt ||
			Date.parse(job.completionLeaseExpiresAt) > Date.parse(input.now)
		)
			return undefined;
		const reclaimed = {
			...job,
			completionLeaseExpiresAt: input.leaseExpiresAt,
			nextActionAt: input.nextActionAt,
		};
		this.jobs.set(input.jobId, reclaimed);
		return reclaimed;
	}
	async finishCompletion(jobId: string, intent: CallbackIntent): Promise<void> {
		const job = this.jobs.get(jobId);
		if (
			job?.state !== "COMPLETING" ||
			JSON.stringify(job.terminalIntent) !== JSON.stringify(intent)
		)
			return;
		const completed = completeClaimedJob(job);
		if (completed) this.jobs.set(jobId, completed);
	}
	async reschedule(jobId: string, nextActionAt: string): Promise<void> {
		const job = this.jobs.get(jobId);
		if (job?.state === "PENDING")
			this.jobs.set(jobId, { ...job, nextActionAt });
	}
}
