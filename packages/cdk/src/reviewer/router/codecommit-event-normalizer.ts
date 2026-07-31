import { type ReviewEvent, reviewEventSchema } from "../domain/review-event";
import type { RequestKey } from "../domain/review-request";

export interface CodeCommitEventFilterOptions {
	readonly reviewerArn?: string;
	readonly botArnPatterns?: readonly (string | RegExp)[];
}

export interface NormalizedCodeCommitEvent {
	readonly id: string;
	readonly type: ReviewEvent["type"];
	readonly request: RequestKey;
	readonly occurredAt: string;
	readonly revision?: string;
	readonly commentId?: string;
	readonly inReplyTo?: string;
}

type RecordValue = Readonly<Record<string, unknown>>;
function record(value: unknown): RecordValue | undefined {
	return typeof value === "object" && value !== null
		? (value as RecordValue)
		: undefined;
}
function string(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
function bool(value: unknown): boolean {
	return value === true || value === "True" || value === "true";
}
function firstString(...values: readonly unknown[]): string | undefined {
	for (const value of values) {
		const found = string(value);
		if (found !== undefined) return found;
	}
	return undefined;
}
function testPattern(pattern: RegExp, value: string): boolean {
	pattern.lastIndex = 0;
	try {
		return pattern.test(value);
	} finally {
		pattern.lastIndex = 0;
	}
}

function matchesBot(
	value: string | undefined,
	options: CodeCommitEventFilterOptions,
): boolean {
	if (value === undefined) return false;
	if (options.reviewerArn === value) return true;
	return (
		options.botArnPatterns?.some((pattern) =>
			typeof pattern === "string"
				? value === pattern || value.includes(pattern)
				: testPattern(pattern, value),
		) ?? false
	);
}
function requestFrom(
	detail: RecordValue,
	envelope: RecordValue,
): RequestKey | undefined {
	const repository = firstString(
		detail.repositoryName,
		record(detail.requestParameters)?.repositoryName,
		Array.isArray(detail.repositoryNames)
			? detail.repositoryNames[0]
			: undefined,
		Array.isArray(envelope.resources) ? envelope.resources[0] : undefined,
	)
		?.split("/")
		.at(-1);
	const parameters = record(detail.requestParameters);
	const requestId = firstString(
		detail.pullRequestId,
		parameters?.pullRequestId,
		Array.isArray(parameters?.pullRequestIds)
			? parameters?.pullRequestIds[0]
			: undefined,
	);
	if (repository === undefined || requestId === undefined) return undefined;
	return { provider: "codecommit", repository, requestId };
}
function validateNormalizedEvent(
	event: unknown,
): NormalizedCodeCommitEvent | undefined {
	const parsed = reviewEventSchema.safeParse(event);
	return parsed.success ? parsed.data : undefined;
}

/** Converts native EventBridge CodeCommit envelopes and CloudTrail fallbacks.
 * Event bodies are intentionally not read or copied into the normalized event.
 */
export function normalizeCodeCommitEvent(
	value: unknown,
	options: CodeCommitEventFilterOptions = {},
): NormalizedCodeCommitEvent | undefined {
	const envelope = record(value);
	if (envelope === undefined) return undefined;
	const envelopeDetail = record(envelope.detail);
	const detailType = string(envelope["detail-type"]);
	const wrappedCloudTrail = detailType === "AWS API Call via CloudTrail";
	const directCloudTrail =
		!wrappedCloudTrail && string(envelope.eventSource) !== undefined;

	let detail: RecordValue;
	let payload: RecordValue;
	let id: string | undefined;
	let at: string | undefined;
	let actor: string | undefined;
	let eventName: string | undefined;
	if (wrappedCloudTrail || directCloudTrail) {
		detail = wrappedCloudTrail ? (envelopeDetail ?? {}) : envelope;
		if (
			(wrappedCloudTrail && string(envelope.source) !== "aws.codecommit") ||
			string(detail.eventSource) !== "codecommit.amazonaws.com"
		)
			return undefined;
		payload = record(detail.requestParameters) ?? {};
		id = string(detail.eventID);
		at = string(detail.eventTime);
		actor = firstString(
			record(detail.userIdentity)?.arn,
			payload.userIdentityArn,
			payload.author,
		);
		eventName = string(detail.eventName);
	} else {
		const nativeDetailTypes = new Set([
			"CodeCommit Pull Request State Change",
			"CodeCommit Comment on Pull Request",
			"CodeCommit Repository State Change",
		]);
		if (
			string(envelope.source) !== "aws.codecommit" ||
			detailType === undefined ||
			!nativeDetailTypes.has(detailType) ||
			envelopeDetail === undefined
		) {
			return undefined;
		}
		detail = envelopeDetail;
		payload = detail;
		id = string(envelope.id);
		at = string(envelope.time);
		actor = firstString(
			payload.callerUserArn,
			payload.userIdentityArn,
			record(detail.userIdentity)?.arn,
			payload.author,
		);
		eventName = firstString(payload.event, payload.eventName);
	}

	const request = requestFrom(detail, envelope);
	if (id === undefined || at === undefined || request === undefined)
		return undefined;
	if (matchesBot(actor, options)) return undefined;
	const status = firstString(payload.pullRequestStatus, payload.status);
	const mergeEventNames = new Set([
		"pullRequestMergeStatusUpdated",
		"pullRequestMerged",
		"MergePullRequestByFastForward",
		"MergePullRequestBySquash",
		"MergePullRequestByThreeWay",
	]);
	const merged = bool(payload.isMerged) || mergeEventNames.has(eventName ?? "");
	let type: ReviewEvent["type"];
	let revision: string | undefined;
	let commentId: string | undefined;
	if (
		eventName === "commentOnPullRequestCreated" ||
		eventName === "PostCommentForPullRequest" ||
		envelope["detail-type"] === "CodeCommit Comment on Pull Request"
	) {
		const responseComment = record(record(detail.responseElements)?.comment);
		commentId = firstString(
			payload.commentId,
			payload.commentID,
			responseComment?.commentId,
			responseComment?.commentID,
		);
		if (commentId === undefined) return undefined;
		type = "human-comment";
		const inReplyTo = firstString(
			payload.inReplyTo,
			responseComment?.inReplyTo,
		);
		const timestamp = new Date(at);
		if (Number.isNaN(timestamp.getTime())) return undefined;
		return validateNormalizedEvent({
			id,
			type,
			request,
			occurredAt: timestamp.toISOString(),
			commentId,
			...(inReplyTo === undefined ? {} : { inReplyTo }),
		});
	} else if (merged) {
		type = "request-merged";
	} else if (eventName === "pullRequestStatusChanged") {
		const normalizedStatus = status?.toLowerCase();
		if (normalizedStatus === "open") type = "request-opened";
		else if (normalizedStatus === "closed") type = "request-closed";
		else return undefined;
	} else if (status?.toLowerCase() === "closed") {
		type = "request-closed";
	} else if (
		eventName === "pullRequestSourceBranchUpdated" ||
		eventName === "pullRequestRevisionUpdated"
	) {
		revision = firstString(payload.sourceCommit, payload.revisionId);
		if (revision === undefined) return undefined;
		type = "revision-updated";
	} else if (eventName === "pullRequestCreated") {
		type = "request-opened";
	} else {
		return undefined;
	}
	const timestamp = new Date(at);
	if (Number.isNaN(timestamp.getTime())) return undefined;
	return validateNormalizedEvent({
		id,
		type,
		request,
		occurredAt: timestamp.toISOString(),
		...(revision === undefined ? {} : { revision }),
		...(commentId === undefined ? {} : { commentId }),
	});
}

export function normalizeCodeCommitEvents(
	values: readonly unknown[],
	options: CodeCommitEventFilterOptions = {},
): readonly NormalizedCodeCommitEvent[] {
	return values.flatMap((value) => {
		const normalized = normalizeCodeCommitEvent(value, options);
		return normalized === undefined ? [] : [normalized];
	});
}

export class CodeCommitEventNormalizer {
	readonly #options: CodeCommitEventFilterOptions;
	constructor(options: CodeCommitEventFilterOptions = {}) {
		this.#options = options;
	}
	normalize(value: unknown): NormalizedCodeCommitEvent | undefined {
		return normalizeCodeCommitEvent(value, this.#options);
	}
}
