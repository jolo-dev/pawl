import { createHash } from "node:crypto";
import { diffLines } from "diff";
import type { Finding } from "../domain/finding";
import type {
	RequestRef,
	ReviewRequest,
	RevisionRange,
} from "../domain/review-request";
import type {
	ChangedFile,
	ChangedHunk,
	ChangedLine,
	PostedComment,
	Resolution,
	ReviewComment,
	SourceControlProvider,
} from "../ports/source-control-provider";
import { CodeCommitReviewClient } from "./codecommit-review-client";
import type {
	ChangedFile as CodeCommitChangedFile,
	ReviewComment as CodeCommitReviewComment,
	CodeCommitReviewTransport,
	PullRequestSnapshot,
} from "./codecommit-review-types";

export interface CodeCommitClientPort {
	getPullRequest(
		repository: string,
		requestId: string,
	): Promise<PullRequestSnapshot>;
	getDifferences(
		snapshot: PullRequestSnapshot,
	): Promise<readonly CodeCommitChangedFile[]>;
	getFile(
		repository: string,
		commit: string,
		path: string,
	): Promise<
		| {
				readonly commitId: string;
				readonly blobId: string;
				readonly filePath: string;
				readonly fileMode: string;
				readonly fileSize: number;
				readonly isBinary: boolean;
				readonly content?: string;
		  }
		| undefined
	>;
	getComments(
		snapshot: PullRequestSnapshot,
	): Promise<readonly CodeCommitReviewComment[]>;
	postComment(input: {
		readonly snapshot: PullRequestSnapshot;
		readonly content: string;
		readonly location?: {
			readonly filePath: string;
			readonly filePosition: number;
			readonly relativeFileVersion: "BEFORE" | "AFTER";
		};
		readonly clientRequestToken: string;
	}): Promise<CodeCommitReviewComment>;
	updateComment(input: {
		readonly commentId: string;
		readonly originalBody: string;
		readonly appendedBody: string;
	}): Promise<CodeCommitReviewComment>;
	postCommentReply(input: {
		readonly inReplyTo: string;
		readonly content: string;
		readonly clientRequestToken: string;
	}): Promise<CodeCommitReviewComment>;
	putCommentReaction(input: {
		readonly commentId: string;
		readonly reactionValue: string;
	}): Promise<void>;
}

export interface CodeCommitProviderOptions {
	readonly client?: CodeCommitClientPort;
	readonly transport?: CodeCommitReviewTransport;
	readonly reviewerArn?: string;
	/** Human-readable name appended to every review comment (e.g. "Claude Sonnet 4.6"). */
	readonly reviewerDisplayName?: string;
	readonly clock?: () => Date;
	readonly onInvalidInlineLocation?: (outcome: {
		readonly path: string;
		readonly line: number;
		readonly side: Finding["side"];
	}) => void;
}

function freezeSnapshot(snapshot: PullRequestSnapshot): PullRequestSnapshot {
	return Object.freeze({ ...snapshot });
}

function splitLines(value: string): string[] {
	if (value.length === 0) return [];
	const lines = value.split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

function hunkIdentity(header: string, lines: readonly ChangedLine[]): string {
	const data = JSON.stringify({ header, lines });
	return `hunk-${createHash("sha256").update(data, "utf8").digest("hex").slice(0, 16)}`;
}

function makeHunks(before: string, after: string): readonly ChangedHunk[] {
	const parts = diffLines(before, after);
	let beforeLine = 1;
	let afterLine = 1;
	const output: ChangedHunk[] = [];
	let pending: ChangedLine[] = [];
	let startBefore = 1;
	let startAfter = 1;
	let changed = false;

	const flush = (): void => {
		if (!changed) {
			pending = [];
			return;
		}
		const beforeCount = pending.filter((line) => line.side === "before").length;
		const afterCount = pending.filter((line) => line.side === "after").length;
		const header = `@@ -${startBefore},${beforeCount} +${startAfter},${afterCount} @@`;
		output.push({
			identity: hunkIdentity(header, pending),
			header,
			lines: pending,
		});
		pending = [];
		changed = false;
	};

	for (const part of parts) {
		const lines = splitLines(part.value);
		if (part.added || part.removed) {
			if (pending.length === 0) {
				startBefore = beforeLine;
				startAfter = afterLine;
			}
			for (const content of lines) {
				const side = part.removed ? "before" : "after";
				pending.push({
					side,
					line: side === "before" ? beforeLine : afterLine,
					content,
					changed: true,
				});
				if (side === "before") beforeLine += 1;
				else afterLine += 1;
			}
			changed = true;
			continue;
		}
		if (changed) {
			const context = lines.slice(0, 3);
			for (const content of context) {
				pending.push({
					side: "before",
					line: beforeLine,
					content,
					changed: false,
				});
				pending.push({
					side: "after",
					line: afterLine,
					content,
					changed: false,
				});
				beforeLine += 1;
				afterLine += 1;
			}
			flush();
			const skipped = lines.length - context.length;
			beforeLine += skipped;
			afterLine += skipped;
		} else {
			beforeLine += lines.length;
			afterLine += lines.length;
		}
	}
	flush();
	return output;
}

function filePath(file: CodeCommitChangedFile): string {
	return file.after?.path ?? file.before?.path ?? "";
}

function mapChangeType(
	type: CodeCommitChangedFile["changeType"],
): ChangedFile["changeType"] {
	return type === "ADDED"
		? "added"
		: type === "DELETED"
			? "deleted"
			: "modified";
}

function tokenFor(ref: RequestRef, finding: Finding): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				ref,
				fingerprint: finding.issueIdentity,
				path: finding.path,
				side: finding.side,
				location: finding.location,
			}),
			"utf8",
		)
		.digest("hex");
}

export class CodeCommitProvider implements SourceControlProvider {
	readonly #client: CodeCommitClientPort;
	readonly #clock: () => Date;
	readonly #invalidInline?: CodeCommitProviderOptions["onInvalidInlineLocation"];
	readonly #reviewerDisplayName: string;
	readonly #snapshots = new Map<string, PullRequestSnapshot>();

	constructor(options: CodeCommitProviderOptions = {}) {
		this.#client =
			options.client ?? new CodeCommitReviewClient(options.transport);
		this.#clock = options.clock ?? (() => new Date());
		this.#invalidInline = options.onInvalidInlineLocation;
		this.#reviewerDisplayName = options.reviewerDisplayName ?? "AI Reviewer";
	}

	async getRequest(ref: RequestRef): Promise<ReviewRequest> {
		const snapshot = freezeSnapshot(
			await this.#client.getPullRequest(ref.repository, ref.requestId),
		);
		this.#snapshots.set(this.#snapshotKey(ref), snapshot);
		return {
			key: { ...ref },
			title: snapshot.pullRequestId,
			status:
				snapshot.status === "MERGED"
					? "merged"
					: snapshot.status === "CLOSED"
						? "closed"
						: "open",
			sourceBranch: snapshot.sourceReference,
			destinationBranch: snapshot.destinationReference,
			sourceRevision: snapshot.sourceCommit,
			destinationRevision: snapshot.destinationCommit,
		};
	}

	async getDiff(
		ref: RequestRef,
		revisions: RevisionRange,
	): Promise<readonly ChangedFile[]> {
		const snapshot = await this.#snapshot(ref, revisions);
		const differences = await this.#client.getDifferences(snapshot);
		const files: ChangedFile[] = [];
		for (const difference of differences) {
			const path = filePath(difference);
			const previousPath = difference.before?.path;
			const before =
				difference.before === undefined
					? undefined
					: await this.#client.getFile(
							ref.repository,
							revisions.destinationRevision,
							previousPath ?? path,
						);
			const after =
				difference.after === undefined
					? undefined
					: await this.#client.getFile(
							ref.repository,
							revisions.sourceRevision,
							difference.after.path,
						);
			const binary = before?.isBinary === true || after?.isBinary === true;
			files.push({
				path,
				...(previousPath !== undefined && previousPath !== path
					? { previousPath }
					: {}),
				changeType:
					difference.changeType === "ADDED"
						? "added"
						: difference.changeType === "DELETED"
							? "deleted"
							: previousPath !== path
								? "renamed"
								: mapChangeType(difference.changeType),
				hunks: binary
					? []
					: makeHunks(before?.content ?? "", after?.content ?? ""),
			});
		}
		return files;
	}

	async getFile(
		ref: RequestRef,
		revision: string,
		path: string,
	): Promise<string | undefined> {
		const file = await this.#client.getFile(ref.repository, revision, path);
		return file?.isBinary === true ? undefined : file?.content;
	}

	async listComments(
		ref: RequestRef,
		after?: string,
	): Promise<readonly ReviewComment[]> {
		return this.#listComments(ref, after);
	}

	async #listComments(
		ref: RequestRef,
		after?: string,
		revisions?: RevisionRange,
	): Promise<readonly ReviewComment[]> {
		const snapshot = await this.#snapshot(ref, revisions);
		const comments = await this.#client.getComments(snapshot);
		return comments
			.map((comment) => {
				const occurredAt =
					comment.createdAt ?? comment.updatedAt ?? this.#clock().toISOString();
				return {
					id: comment.commentId,
					authorId: comment.authorArn,
					body: comment.content,
					occurredAt,
					...(comment.inReplyTo === undefined
						? {}
						: { inReplyTo: comment.inReplyTo }),
					watermark: `${occurredAt}#${comment.commentId}`,
				};
			})
			.sort((left, right) => left.watermark.localeCompare(right.watermark))
			.filter((comment) => after === undefined || comment.watermark > after);
	}

	async postInlineFinding(
		ref: RequestRef,
		finding: Finding,
		revisions?: RevisionRange,
	): Promise<PostedComment> {
		const request =
			revisions === undefined
				? await this.getRequest(ref)
				: await this.#requestForRevisions(ref, revisions);
		const cycleRevisions = revisions ?? {
			sourceRevision: request.sourceRevision,
			destinationRevision: request.destinationRevision,
		};
		const files = await this.getDiff(ref, cycleRevisions);
		const location =
			finding.location.kind === "line"
				? this.#inlineLocation(files, finding)
				: undefined;
		if (location === undefined) {
			this.#invalidInline?.({
				path: finding.path,
				line: finding.location.kind === "line" ? finding.location.line : 0,
				side: finding.side,
			});
			throw new Error(
				`invalid inline location for ${finding.path}:${finding.location.kind === "line" ? finding.location.line : 0}`,
			);
		}
		return this.#post(ref, request, finding, location, cycleRevisions);
	}

	async postSummaryFinding(
		ref: RequestRef,
		finding: Finding,
		revisions?: RevisionRange,
	): Promise<PostedComment> {
		const request =
			revisions === undefined
				? await this.getRequest(ref)
				: await this.#requestForRevisions(ref, revisions);
		return this.#post(ref, request, finding, undefined, revisions);
	}

	async postStatusComment(
		ref: RequestRef,
		content: string,
		idempotencyToken: string,
		revisions?: RevisionRange,
	): Promise<PostedComment> {
		const request =
			revisions === undefined
				? await this.getRequest(ref)
				: await this.#requestForRevisions(ref, revisions);
		const snapshot = await this.#snapshot(
			ref,
			revisions ?? {
				sourceRevision: request.sourceRevision,
				destinationRevision: request.destinationRevision,
			},
		);
		const response = await this.#client.postComment({
			snapshot,
			content,
			clientRequestToken: idempotencyToken,
		});
		return {
			id: response.commentId,
			findingFingerprint: `status:v1:${idempotencyToken}`,
			contentHash: createHash("sha256")
				.update(response.content, "utf8")
				.digest("hex"),
		};
	}

	async appendStatusUpdate(
		ref: RequestRef,
		comment: PostedComment,
		appendedBody: string,
		revisions?: RevisionRange,
	): Promise<void> {
		const existing = (await this.#listComments(ref, undefined, revisions)).find(
			(candidate) => candidate.id === comment.id,
		);
		if (existing === undefined) return;
		if (existing.body.includes(appendedBody)) return;
		await this.#client.updateComment({
			commentId: comment.id,
			originalBody: existing.body,
			appendedBody,
		});
	}

	async reactToComment(
		ref: RequestRef,
		commentId: string,
		reaction: string,
	): Promise<void> {
		// Request the snapshot so the provider validates the PR is accessible.
		await this.#snapshot(ref);
		await this.#client.putCommentReaction({
			commentId,
			reactionValue: reaction,
		});
	}

	async replyToComment(
		ref: RequestRef,
		inReplyTo: string,
		content: string,
		idempotencyToken: string,
	): Promise<PostedComment> {
		await this.#snapshot(ref);
		const response = await this.#client.postCommentReply({
			inReplyTo,
			content,
			clientRequestToken: idempotencyToken,
		});
		return {
			id: response.commentId,
			findingFingerprint: `status:v1:${idempotencyToken}`,
			contentHash: createHash("sha256")
				.update(response.content, "utf8")
				.digest("hex"),
		};
	}

	async markCommentResolved(
		ref: RequestRef,
		comment: PostedComment,
		resolution: Resolution,
		revisions?: RevisionRange,
	): Promise<void> {
		const existing = (await this.#listComments(ref, undefined, revisions)).find(
			(candidate) => candidate.id === comment.id,
		);
		if (existing === undefined) return;
		const body =
			resolution.type === "fixed"
				? `Resolved: fixed in ${resolution.revision}`
				: `Resolved: dismissed (${resolution.rationale})`;
		if (existing.body.includes(body)) return;
		await this.#client.updateComment({
			commentId: comment.id,
			originalBody: existing.body,
			appendedBody: body,
		});
	}

	#contentForFinding(finding: Finding): string {
		return [
			`<!-- pawl:${finding.issueIdentity} -->`,
			`**${finding.severity} ${finding.category}**`,
			finding.evidence,
			`Impact: ${finding.impact}`,
			`Recommendation: ${finding.recommendation}`,
			...(finding.suggestion === undefined
				? []
				: [`Suggestion:\n\`\`\`\n${finding.suggestion}\n\`\`\``]),
			`---\n🤖 AI generated review by ${this.#reviewerDisplayName}`,
		].join("\n\n");
	}

	async #post(
		ref: RequestRef,
		request: ReviewRequest,
		finding: Finding,
		location?: {
			filePath: string;
			filePosition: number;
			relativeFileVersion: "BEFORE" | "AFTER";
		},
		revisions?: RevisionRange,
	): Promise<PostedComment> {
		const response = await this.#client.postComment({
			snapshot: await this.#snapshot(
				ref,
				revisions ?? {
					sourceRevision: request.sourceRevision,
					destinationRevision: request.destinationRevision,
				},
			),
			content: this.#contentForFinding(finding),
			...(location === undefined ? {} : { location }),
			clientRequestToken: tokenFor(ref, finding),
		});
		return {
			id: response.commentId,
			findingFingerprint: `review-finding:v1:${createHash("sha256").update(JSON.stringify({ ref, finding }), "utf8").digest("hex")}`,
			contentHash: createHash("sha256")
				.update(response.content, "utf8")
				.digest("hex"),
		};
	}

	#inlineLocation(
		files: readonly ChangedFile[],
		finding: Finding,
	):
		| {
				filePath: string;
				filePosition: number;
				relativeFileVersion: "BEFORE" | "AFTER";
		  }
		| undefined {
		if (finding.location.kind !== "line") return undefined;
		const candidate = finding.location;
		const file = files.find(
			(entry) =>
				entry.path === finding.path || entry.previousPath === finding.path,
		);
		const hunk = file?.hunks.find(
			(entry) => entry.identity === candidate.hunkIdentity,
		);
		if (
			file === undefined ||
			hunk === undefined ||
			!hunk.lines.some(
				(line) =>
					line.changed &&
					line.side === finding.side &&
					line.line === candidate.line,
			)
		)
			return undefined;
		if (file.changeType === "deleted" && finding.side === "after")
			return undefined;
		if (file.changeType === "added" && finding.side === "before")
			return undefined;
		if (
			file.changeType === "renamed" &&
			((finding.path === file.previousPath && finding.side !== "before") ||
				(finding.path === file.path && finding.side !== "after"))
		)
			return undefined;
		return {
			filePath: finding.path,
			filePosition: candidate.line,
			relativeFileVersion: finding.side === "before" ? "BEFORE" : "AFTER",
		};
	}

	async #requestForRevisions(
		ref: RequestRef,
		revisions: RevisionRange,
	): Promise<ReviewRequest> {
		const current = await this.getRequest(ref);
		return {
			...current,
			sourceRevision: revisions.sourceRevision,
			destinationRevision: revisions.destinationRevision,
		};
	}

	async #snapshot(
		ref: RequestRef,
		revisions?: RevisionRange,
	): Promise<PullRequestSnapshot> {
		const cached = this.#snapshots.get(this.#snapshotKey(ref));
		const base =
			cached ??
			(await this.#client.getPullRequest(ref.repository, ref.requestId));
		if (revisions === undefined) return freezeSnapshot(base);
		return freezeSnapshot({
			...base,
			sourceCommit: revisions.sourceRevision,
			destinationCommit: revisions.destinationRevision,
			revisionId: revisions.sourceRevision,
		});
	}

	#snapshotKey(ref: RequestRef): string {
		return `${ref.repository}\0${ref.requestId}`;
	}
}
