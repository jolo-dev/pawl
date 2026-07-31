import { z } from "zod";
import { requestKeySchema } from "../domain/review-request";

const nonEmptyIdSchema = z.string().trim().min(1).max(512);
const revisionSchema = z.string().trim().min(7).max(512);
const occurredAtSchema = z.iso.datetime({ offset: true });
const generationSchema = z.number().int().nonnegative();
const keySegment = (value: string): string =>
	encodeURIComponent(nonEmptyIdSchema.parse(value));
const revisionKeySegment = (value: string): string =>
	encodeURIComponent(revisionSchema.parse(value));

export const jobStateSchema = z.enum([
	"PENDING",
	"COMPLETING",
	"SUCCEEDED",
	"FAILED",
]);
export type JobState = z.infer<typeof jobStateSchema>;

export const callbackSuccessCategorySchema = z.enum([
	"ReviewSucceeded",
	"RequestMerged",
	"RequestClosed",
]);
export const callbackFailureCategorySchema = z.enum([
	"ConfigurationError",
	"ReviewBlocked",
	"ReviewFailed",
	"Superseded",
	"TimedOut",
]);

const callbackIntentBaseSchema = {
	message: z.string().trim().min(1).max(1_000).optional(),
};

export const callbackIntentSchema = z
	.discriminatedUnion("status", [
		z.strictObject({
			...callbackIntentBaseSchema,
			status: z.literal("success"),
			category: callbackSuccessCategorySchema,
		}),
		z.strictObject({
			...callbackIntentBaseSchema,
			status: z.literal("failure"),
			category: callbackFailureCategorySchema,
		}),
	])
	.readonly();

export type CallbackIntent = z.infer<typeof callbackIntentSchema>;

export const reviewOutcomeSchema = z
	.strictObject({
		request: requestKeySchema,
		generation: generationSchema,
		sourceRevision: revisionSchema,
		cycle: z.number().int().positive().optional(),
		status: z.enum(["reviewed", "blocked", "failed"]),
		checkStatus: z.enum(["completed", "failed", "blocked"]).optional(),
		summary: z.string().trim().max(1_000).optional(),
		createdAt: occurredAtSchema.optional(),
	})
	.readonly();

export type ReviewOutcome = z.infer<typeof reviewOutcomeSchema>;

export const pipelineJobRecordSchema = z
	.strictObject({
		jobId: nonEmptyIdSchema,
		state: jobStateSchema,
		pipelineExecutionId: nonEmptyIdSchema.optional(),
		pipelineName: nonEmptyIdSchema.optional(),
		stageName: nonEmptyIdSchema.optional(),
		actionName: nonEmptyIdSchema.optional(),
		request: requestKeySchema.optional(),
		generation: generationSchema.optional(),
		sourceRevision: revisionSchema.optional(),
		destinationRevision: revisionSchema.optional(),
		deadlineAt: occurredAtSchema.optional(),
		nextActionAt: occurredAtSchema.optional(),
		terminalIntent: callbackIntentSchema.optional(),
		callbackCandidate: callbackIntentSchema.optional(),
		completionLeaseExpiresAt: occurredAtSchema.optional(),
	})
	.readonly();

export type PipelineJobRecord = z.infer<typeof pipelineJobRecordSchema>;

export type PipelineJobIdentityState =
	| "identified"
	| "unidentified"
	| "partial";

export const classifyPipelineJobIdentity = (
	job: PipelineJobRecord,
): PipelineJobIdentityState => {
	const identityParts = [
		job.request !== undefined,
		job.generation !== undefined,
		job.sourceRevision !== undefined,
	];
	const presentCount = identityParts.filter(Boolean).length;
	if (presentCount === identityParts.length) return "identified";
	if (presentCount === 0) return "unidentified";
	return "partial";
};

export const terminalRequestStateSchema = z.enum(["merged", "closed"]);
export type TerminalRequestState = z.infer<typeof terminalRequestStateSchema>;

export const terminalRequestRecordSchema = z
	.strictObject({
		request: requestKeySchema,
		generation: generationSchema,
		status: terminalRequestStateSchema,
		occurredAt: occurredAtSchema,
	})
	.readonly();
export type TerminalRequestRecord = z.infer<typeof terminalRequestRecordSchema>;

export const intentSelectionInputSchema = z
	.strictObject({
		job: pipelineJobRecordSchema,
		superseded: z.boolean().optional(),
		outcome: reviewOutcomeSchema.optional(),
		terminalRequestState: terminalRequestStateSchema.optional(),
		now: occurredAtSchema.optional(),
	})
	.readonly();

export type IntentSelectionInput = z.infer<typeof intentSelectionInputSchema>;

export type CoordinationKey = Readonly<{
	pk: string;
	sk: string;
}>;

export type CoordinationIndexKey = Readonly<{
	gsiPk: string;
	gsiSk: string;
}>;

export const buildPipelineExecutionKey = (
	pipelineExecutionId: string,
): CoordinationKey => ({
	pk: `PIPELINE_EXECUTION#${keySegment(pipelineExecutionId)}`,
	sk: "META",
});

export const buildPipelineJobKey = (jobId: string): CoordinationKey => ({
	pk: `PIPELINE_JOB#${keySegment(jobId)}`,
	sk: "META",
});

export const buildTerminalRequestKey = (identity: {
	readonly request: z.infer<typeof requestKeySchema>;
	readonly generation: number;
}): CoordinationKey => {
	const request = requestKeySchema.parse(identity.request);
	const generation = generationSchema.parse(identity.generation);

	return {
		pk: `TERMINAL_REQUEST#${keySegment(request.provider)}#${keySegment(request.repository)}#${keySegment(request.requestId)}#GEN#${generation}`,
		sk: "META",
	};
};

export const buildReviewOutcomeKey = (identity: {
	readonly request: z.infer<typeof requestKeySchema>;
	readonly generation: number;
	readonly sourceRevision: string;
}): CoordinationKey => {
	const request = requestKeySchema.parse(identity.request);
	const generation = generationSchema.parse(identity.generation);
	const sourceRevision = revisionSchema.parse(identity.sourceRevision);

	return {
		pk: `REVIEW_OUTCOME#${keySegment(request.provider)}#${keySegment(request.repository)}#${keySegment(request.requestId)}#GEN#${generation}`,
		sk: `REVISION#${revisionKeySegment(sourceRevision)}`,
	};
};

export const buildRequestScopedJobIndexKey = (identity: {
	readonly request: z.infer<typeof requestKeySchema>;
	readonly generation: number;
	readonly sourceRevision: string;
	readonly jobId: string;
}): CoordinationIndexKey => {
	const request = requestKeySchema.parse(identity.request);
	const generation = generationSchema.parse(identity.generation);
	const sourceRevision = revisionSchema.parse(identity.sourceRevision);
	const jobId = keySegment(identity.jobId);

	return {
		gsiPk: `REQUEST#${keySegment(request.provider)}#${keySegment(request.repository)}#${keySegment(request.requestId)}#GEN#${generation}`,
		gsiSk: `REVISION#${revisionKeySegment(sourceRevision)}#JOB#${jobId}`,
	};
};

export const buildActionableStateIndexKey = (input: {
	readonly state: Extract<JobState, "PENDING" | "COMPLETING">;
	readonly nextActionAt: string;
	readonly jobId: string;
}): CoordinationIndexKey => ({
	gsiPk: `PIPELINE_JOB_STATE#${z.enum(["PENDING", "COMPLETING"]).parse(input.state)}`,
	gsiSk: `${occurredAtSchema.parse(input.nextActionAt)}#${keySegment(input.jobId)}`,
});

const requestsMatch = (
	left: z.infer<typeof requestKeySchema>,
	right: z.infer<typeof requestKeySchema>,
): boolean =>
	left.provider === right.provider &&
	left.repository === right.repository &&
	left.requestId === right.requestId;

const outcomeMatchesJob = (
	job: PipelineJobRecord,
	outcome: ReviewOutcome,
): boolean =>
	job.request !== undefined &&
	job.generation !== undefined &&
	job.sourceRevision !== undefined &&
	requestsMatch(job.request, outcome.request) &&
	job.generation === outcome.generation &&
	job.sourceRevision === outcome.sourceRevision;

const intentFromOutcome = (outcome: ReviewOutcome): CallbackIntent => {
	if (outcome.status === "reviewed" && outcome.checkStatus === "completed") {
		return { status: "success", category: "ReviewSucceeded" };
	}
	if (outcome.status === "blocked" || outcome.checkStatus === "blocked") {
		return { status: "failure", category: "ReviewBlocked" };
	}
	return { status: "failure", category: "ReviewFailed" };
};

const intentFromTerminalRequest = (
	terminalRequestState: TerminalRequestState,
): CallbackIntent => ({
	status: "success",
	category:
		terminalRequestState === "merged" ? "RequestMerged" : "RequestClosed",
});

const isPastDeadline = (job: PipelineJobRecord, now?: string): boolean => {
	if (job.deadlineAt === undefined || now === undefined) {
		return false;
	}
	return Date.parse(now) >= Date.parse(job.deadlineAt);
};

const existingCallbackCandidate = (
	job: PipelineJobRecord,
): CallbackIntent | undefined => job.callbackCandidate;

export const selectCallbackIntent = (
	input: unknown,
): CallbackIntent | undefined => {
	const selection = intentSelectionInputSchema.parse(input);
	const { job } = selection;

	if (job.terminalIntent !== undefined) {
		return job.terminalIntent;
	}
	if (selection.superseded === true) {
		return { status: "failure", category: "Superseded" };
	}
	if (job.callbackCandidate?.category === "Superseded") {
		return job.callbackCandidate;
	}
	if (
		selection.outcome !== undefined &&
		outcomeMatchesJob(job, selection.outcome)
	) {
		return intentFromOutcome(selection.outcome);
	}
	if (selection.terminalRequestState !== undefined) {
		const existingCandidate = existingCallbackCandidate(job);
		if (existingCandidate !== undefined) {
			return existingCandidate;
		}
		if (job.state === "PENDING") {
			return intentFromTerminalRequest(selection.terminalRequestState);
		}
	}
	if (isPastDeadline(job, selection.now)) {
		return (
			existingCallbackCandidate(job) ?? {
				status: "failure",
				category: "TimedOut",
			}
		);
	}
	return existingCallbackCandidate(job);
};

export const claimCompletion = (input: {
	readonly job: PipelineJobRecord;
	readonly intent: CallbackIntent;
	readonly completionLeaseExpiresAt: string;
	readonly nextActionAt: string;
}): PipelineJobRecord | undefined => {
	const job = pipelineJobRecordSchema.parse(input.job);
	const intent = callbackIntentSchema.parse(input.intent);
	const completionLeaseExpiresAt = occurredAtSchema.parse(
		input.completionLeaseExpiresAt,
	);
	const nextActionAt = occurredAtSchema.parse(input.nextActionAt);

	if (job.state !== "PENDING" || job.terminalIntent !== undefined) {
		return undefined;
	}

	return pipelineJobRecordSchema.parse({
		...job,
		state: "COMPLETING",
		terminalIntent: intent,
		completionLeaseExpiresAt,
		nextActionAt,
	});
};

export const completeClaimedJob = (
	job: PipelineJobRecord,
): PipelineJobRecord | undefined => {
	const parsedJob = pipelineJobRecordSchema.parse(job);
	if (
		parsedJob.state !== "COMPLETING" ||
		parsedJob.terminalIntent === undefined
	) {
		return undefined;
	}
	return pipelineJobRecordSchema.parse({
		...parsedJob,
		state:
			parsedJob.terminalIntent.status === "success" ? "SUCCEEDED" : "FAILED",
		completionLeaseExpiresAt: undefined,
		nextActionAt: undefined,
	});
};
