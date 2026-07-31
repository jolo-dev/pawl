import type {
	CommentResponseInput,
	ReviewModel,
	ReviewModelInput,
	ReviewModelResult,
} from "../ports/review-model";

/**
 * No-op review model. Returns an empty candidate list and zero token usage.
 * The real implementation (master plan Task 13) calls Amazon Bedrock Converse,
 * extracts content, validates against the schema, and retries once on repair.
 */
export class NoopReviewModel implements ReviewModel {
	async review(_input: ReviewModelInput): Promise<ReviewModelResult> {
		return {
			output: { candidates: [] },
			modelId: "configured-default",
			usage: { inputTokens: 0, outputTokens: 0 },
		};
	}

	async respond(_input: CommentResponseInput): Promise<{
		reply: string;
		usage: { inputTokens: number; outputTokens: number };
	}> {
		return {
			reply: "✅ Reviewed.",
			usage: { inputTokens: 0, outputTokens: 0 },
		};
	}
}
