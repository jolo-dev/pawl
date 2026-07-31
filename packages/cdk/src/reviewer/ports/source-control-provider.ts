import type { Finding, FindingFingerprint } from "../domain/finding";
import type { EventWatermark } from "../domain/review-event";
import type {
	RequestRef,
	ReviewRequest,
	RevisionRange,
} from "../domain/review-request";

export interface ChangedLine {
	readonly side: "before" | "after";
	readonly line: number;
	readonly content: string;
	readonly changed: boolean;
}

export interface ChangedHunk {
	readonly identity: string;
	readonly header: string;
	readonly lines: readonly ChangedLine[];
}

export interface ChangedFile {
	readonly path: string;
	readonly previousPath?: string;
	readonly changeType: "added" | "modified" | "deleted" | "renamed";
	readonly hunks: readonly ChangedHunk[];
}

export interface ReviewComment {
	readonly id: string;
	readonly authorId: string;
	readonly body: string;
	readonly occurredAt: string;
	readonly inReplyTo?: string;
	readonly findingFingerprint?: FindingFingerprint;
	readonly watermark: EventWatermark;
}

export interface PostedComment {
	readonly id: string;
	readonly findingFingerprint: FindingFingerprint;
	readonly contentHash: string;
}

export type Resolution =
	| { readonly type: "fixed"; readonly revision: string }
	| {
			readonly type: "dismissed";
			readonly eligibleHumanCommentId: string;
			readonly rationale: string;
	  };

export interface SourceControlProvider {
	getRequest(ref: RequestRef): Promise<ReviewRequest>;
	getDiff(
		ref: RequestRef,
		revisions: RevisionRange,
	): Promise<readonly ChangedFile[]>;
	getFile(
		ref: RequestRef,
		revision: string,
		path: string,
	): Promise<string | undefined>;
	listComments(
		ref: RequestRef,
		after?: EventWatermark,
	): Promise<readonly ReviewComment[]>;
	postInlineFinding(
		ref: RequestRef,
		finding: Finding,
		revisions?: RevisionRange,
	): Promise<PostedComment>;
	postSummaryFinding(
		ref: RequestRef,
		finding: Finding,
		revisions?: RevisionRange,
	): Promise<PostedComment>;
	/** Post a PR-level (non-inline) status comment, e.g. an 👀 "reviewing" signal. */
	postStatusComment(
		ref: RequestRef,
		content: string,
		idempotencyToken: string,
		revisions?: RevisionRange,
	): Promise<PostedComment>;
	/** Append a completion note to a previously-posted status comment. */
	appendStatusUpdate(
		ref: RequestRef,
		comment: PostedComment,
		appendedBody: string,
		revisions?: RevisionRange,
	): Promise<void>;
	/** Add an emoji reaction to an existing comment (e.g. an 👀 "reviewing" signal). */
	reactToComment(
		ref: RequestRef,
		commentId: string,
		reaction: string,
	): Promise<void>;
	/** Post a threaded reply under an existing comment. */
	replyToComment(
		ref: RequestRef,
		inReplyTo: string,
		content: string,
		idempotencyToken: string,
	): Promise<PostedComment>;
	markCommentResolved(
		ref: RequestRef,
		comment: PostedComment,
		resolution: Resolution,
		revisions?: RevisionRange,
	): Promise<void>;
}
