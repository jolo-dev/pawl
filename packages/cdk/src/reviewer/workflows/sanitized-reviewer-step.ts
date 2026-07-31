import type { DurableContext } from "@aws/durable-execution-sdk-js";
import { z } from "zod";
import { type RequestKey, requestKeySchema } from "../domain/review-request";

export interface ReviewerWorkflowFailureMetadata {
	readonly request: RequestKey;
	readonly generation: number;
	readonly sourceRevision: string;
	readonly cycle: number;
}

const reviewerWorkflowFailureMetadataSchema = z.strictObject({
	request: requestKeySchema,
	generation: z.number().int().nonnegative(),
	sourceRevision: z.string().trim().min(7).max(512),
	cycle: z.number().int().positive(),
});

/** Metadata-only control failure used after authoritative reviewer context exists. */
export class ReviewerWorkflowFailure {
	readonly metadata: ReviewerWorkflowFailureMetadata;

	constructor(metadata: ReviewerWorkflowFailureMetadata) {
		this.metadata = Object.freeze(
			reviewerWorkflowFailureMetadataSchema.parse(metadata),
		);
	}
}

const REVIEWER_STEP_FAILURE_KEY = "__pawlReviewerStepFailure" as const;

const sanitizedReviewerStepFailureSchema = z.strictObject({
	[REVIEWER_STEP_FAILURE_KEY]: reviewerWorkflowFailureMetadataSchema.nullable(),
});

type SanitizedReviewerStepFailure = z.infer<
	typeof sanitizedReviewerStepFailureSchema
>;

type ReviewerStepFailureMetadata = ReviewerWorkflowFailureMetadata | undefined;

type ReviewerStepFailureMetadataInput =
	| ReviewerStepFailureMetadata
	| (() => ReviewerStepFailureMetadata);

const CONTROL_FAILURE_NAME = "ReviewerWorkflowControlError";
const CONTROL_FAILURE_MESSAGE = "Reviewer workflow control failure";
const CALLBACK_SUBMITTER_FAILURE_NAME = "ReviewerCallbackSubmitterError";
const CALLBACK_SUBMITTER_FAILURE_MESSAGE = "Reviewer callback submitter failed";

function createControlFailure(): Error {
	const error = new Error(CONTROL_FAILURE_MESSAGE);
	error.name = CONTROL_FAILURE_NAME;
	return error;
}

export function createSanitizedReviewerCallbackFailure(): Error {
	const error = new Error(CALLBACK_SUBMITTER_FAILURE_MESSAGE);
	error.name = CALLBACK_SUBMITTER_FAILURE_NAME;
	return error;
}

function isSanitizedReviewerStepFailure(
	value: unknown,
): value is SanitizedReviewerStepFailure {
	return sanitizedReviewerStepFailureSchema.safeParse(value).success;
}

export function isReviewerWorkflowFailureMetadata(
	value: unknown,
): value is ReviewerWorkflowFailureMetadata {
	return reviewerWorkflowFailureMetadataSchema.safeParse(value).success;
}

function resolveFailureMetadata(
	input: ReviewerStepFailureMetadataInput,
): ReviewerStepFailureMetadata {
	try {
		const candidate = typeof input === "function" ? input() : input;
		const parsed = reviewerWorkflowFailureMetadataSchema.safeParse(candidate);
		return parsed.success ? parsed.data : undefined;
	} catch (_error: unknown) {
		return undefined;
	}
}

/**
 * Runs a reviewer durable step without allowing a callback failure to become a
 * durable step error. The callback returns either its unchanged success value
 * or one reserved, strict metadata-only marker. The marker is converted to a
 * control failure only after the durable step has resolved.
 */
export async function runSanitizedReviewerStep<T>(
	context: DurableContext,
	name: string,
	operation: () => Promise<T> | T,
	failureMetadata: ReviewerStepFailureMetadataInput = undefined,
): Promise<T> {
	const result = await context.step<T | SanitizedReviewerStepFailure>(
		name,
		async () => {
			try {
				return await operation();
			} catch (_error: unknown) {
				return {
					[REVIEWER_STEP_FAILURE_KEY]:
						resolveFailureMetadata(failureMetadata) ?? null,
				};
			}
		},
	);

	if (!isSanitizedReviewerStepFailure(result)) return result as T;
	const metadata = result[REVIEWER_STEP_FAILURE_KEY];
	if (metadata === null) throw createControlFailure();
	throw new ReviewerWorkflowFailure(metadata);
}
