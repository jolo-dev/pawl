import type { ModelReviewOutput } from "../domain/finding";
import type { RepositoryConfig } from "../domain/repository-config";
import type { ReviewCycleSnapshot } from "../domain/review-request";
import type { CheckResult } from "./check-runner";
import type { ChangedFile, ReviewComment } from "./source-control-provider";

export interface ReviewModelInput {
  readonly snapshot: ReviewCycleSnapshot;
  readonly changedFiles: readonly ChangedFile[];
  readonly checks: readonly CheckResult[];
  readonly repositoryConfig: RepositoryConfig;
  readonly humanComments: readonly ReviewComment[];
}

export interface ReviewModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ReviewModelResult {
  readonly output: ModelReviewOutput;
  readonly modelId: string;
  readonly usage: ReviewModelUsage;
}

/** A finding accepted by policy, summarised for the reply model. */
export interface ReplyFindingContext {
  readonly severity: string;
  readonly category: string;
  readonly path: string;
  readonly line: number;
  readonly evidence: string;
  readonly recommendation: string;
}

/** A single turn in the PR conversation (human comment or reviewer reply). */
export interface ConversationTurn {
  readonly role: "human" | "reviewer";
  readonly id: string;
  readonly body: string;
  readonly inReplyTo?: string;
}

export interface CommentResponseInput {
  readonly snapshot: ReviewCycleSnapshot;
  readonly changedFiles: readonly ChangedFile[];
  readonly checks: readonly CheckResult[];
  readonly humanComments: readonly ReviewComment[];
  /** Ordered conversation history (human questions + reviewer replies) for follow-up context. */
  readonly conversation: readonly ConversationTurn[];
  readonly findings: readonly ReplyFindingContext[];
}

export interface CommentResponseResult {
  readonly reply: string;
  readonly usage: ReviewModelUsage;
}

export interface ReviewModel {
  review(input: ReviewModelInput): Promise<ReviewModelResult>;
  /** Generate a conversational reply to human comment(s), using the diff + findings as context. */
  respond(input: CommentResponseInput): Promise<CommentResponseResult>;
}
