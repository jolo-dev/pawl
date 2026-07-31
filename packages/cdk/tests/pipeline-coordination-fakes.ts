import type { RequestKey } from "../src/reviewer/domain/review-request";
import {
	type CallbackIntent,
	callbackIntentSchema,
	claimCompletion as claimJob,
	classifyPipelineJobIdentity,
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
	ReviewOutcomeObservation,
	TerminalRequestObservation,
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

const callbackIntentsMatch = (
	left: CallbackIntent | undefined,
	right: CallbackIntent | undefined,
): boolean => {
	if (left === undefined || right === undefined) return left === right;
	const parsedLeft = callbackIntentSchema.parse(left);
	const parsedRight = callbackIntentSchema.parse(right);
	return (
		parsedLeft.status === parsedRight.status &&
		parsedLeft.category === parsedRight.category &&
		parsedLeft.message === parsedRight.message
	);
};

export class FakePipelineCoordinationStore
	implements PipelineCoordinationStore
{
	readonly jobs = new Map<string, PipelineJobRecord>();
	readonly outcomes = new Map<string, ReviewOutcome>();
	readonly terminalRequests = new Map<string, TerminalRequestRecord>();
	readonly mappings = new Map<string, PipelineExecutionMapping>();
	beforeClaim?: () => void | Promise<void>;
	afterClaim?: () => void | Promise<void>;

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
		readonly observedJob: PipelineJobRecord;
		readonly outcomeObservation: ReviewOutcomeObservation;
		readonly terminalRequestObservation: TerminalRequestObservation;
		readonly intent: CallbackIntent;
		readonly leaseExpiresAt: string;
		readonly nextActionAt: string;
	}): Promise<PipelineJobRecord | undefined> {
		const identityState = classifyPipelineJobIdentity(input.observedJob);
		if (identityState === "partial") {
			throw new Error("cannot claim a partial pipeline job identity");
		}
		await this.beforeClaim?.();
		const currentJob = this.jobs.get(input.observedJob.jobId);
		if (
			currentJob?.state !== "PENDING" ||
			currentJob.terminalIntent !== undefined ||
			!callbackIntentsMatch(
				currentJob.callbackCandidate,
				input.observedJob.callbackCandidate,
			)
		) {
			return undefined;
		}
		if (identityState === "identified") {
			if (
				input.outcomeObservation.status === "not-applicable" ||
				input.terminalRequestObservation.status === "not-applicable"
			) {
				throw new Error("identified pipeline jobs require both observations");
			}
			const currentOutcome = this.getOutcome(input.observedJob);
			const currentTerminal =
				input.observedJob.request !== undefined &&
				input.observedJob.generation !== undefined
					? this.getTerminalRequestState(
							input.observedJob.request,
							input.observedJob.generation,
						)
					: Promise.resolve(undefined);
			const [outcome, terminal] = await Promise.all([
				currentOutcome,
				currentTerminal,
			]);
			if (
				(input.outcomeObservation.status === "present") !==
					(outcome !== undefined) ||
				(input.terminalRequestObservation.status === "present") !==
					(terminal !== undefined)
			) {
				return undefined;
			}
		} else if (
			input.outcomeObservation.status !== "not-applicable" ||
			input.terminalRequestObservation.status !== "not-applicable" ||
			input.intent.status !== "failure" ||
			input.intent.category !== "ConfigurationError" ||
			currentJob.callbackCandidate?.status !== "failure" ||
			currentJob.callbackCandidate.category !== "ConfigurationError" ||
			!callbackIntentsMatch(currentJob.callbackCandidate, input.intent)
		) {
			throw new Error(
				"unidentified pipeline jobs require an observed ConfigurationError candidate",
			);
		}
		const persisted = claimJob({
			job: currentJob,
			intent: input.intent,
			completionLeaseExpiresAt: input.leaseExpiresAt,
			nextActionAt: input.nextActionAt,
		});
		const claimed = claimJob({
			job: input.observedJob,
			intent: input.intent,
			completionLeaseExpiresAt: input.leaseExpiresAt,
			nextActionAt: input.nextActionAt,
		});
		if (persisted) this.jobs.set(input.observedJob.jobId, persisted);
		await this.afterClaim?.();
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
			!callbackIntentsMatch(job.terminalIntent, input.intent) ||
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
			!callbackIntentsMatch(job.terminalIntent, intent)
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
