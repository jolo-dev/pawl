import {
	CodeCommitClient,
	GetCommentsForPullRequestCommand,
	GetDifferencesCommand,
	GetFileCommand,
	GetPullRequestCommand,
	PostCommentForPullRequestCommand,
	UpdateCommentCommand,
} from "@aws-sdk/client-codecommit";
import { z } from "zod";
import type {
	BlobMetadata,
	ChangedFile,
	CodeCommitReviewTransport,
	FileBlob,
	PostCommentInput,
	PullRequestSnapshot,
	ReviewComment,
	ReviewLocation,
	UpdateCommentInput,
} from "./types";

const MAX_PAGES = 1_000;
const pageSizeSchema = z.number().int().min(1).max(100);
const requiredString = z.string().min(1);

const pullRequestResponseSchema = z.object({
	pullRequest: z.object({
		pullRequestId: requiredString,
		pullRequestStatus: z.enum(["OPEN", "CLOSED", "MERGED"]),
		revisionId: requiredString,
		pullRequestTargets: z
			.array(
				z.object({
					repositoryName: requiredString,
					sourceReference: requiredString,
					destinationReference: requiredString,
					sourceCommit: requiredString,
					destinationCommit: requiredString,
				}),
			)
			.min(1),
	}),
});

const blobMetadataSchema = z.object({
	blobId: requiredString,
	path: requiredString,
	mode: requiredString,
});

const differenceResponseSchema = z.object({
	differences: z
		.array(
			z.object({
				beforeBlob: blobMetadataSchema.optional(),
				afterBlob: blobMetadataSchema.optional(),
				changeType: z.enum(["A", "M", "D"]),
			}),
		)
		.default([]),
	NextToken: requiredString.optional(),
});

const fileResponseSchema = z.object({
	commitId: requiredString,
	blobId: requiredString,
	filePath: requiredString,
	fileMode: requiredString,
	fileSize: z.number().int().nonnegative(),
	fileContent: z.union([
		z.instanceof(Uint8Array),
		z
			.array(z.number().int().min(0).max(255))
			.transform((bytes) => Uint8Array.from(bytes)),
	]),
});

const locationSchema = z.object({
	filePath: requiredString,
	filePosition: z.number().int().nonnegative(),
	relativeFileVersion: z.enum(["BEFORE", "AFTER"]),
});

const dateSchema = z
	.union([z.date(), z.string().datetime()])
	.transform((value) =>
		typeof value === "string"
			? new Date(value).toISOString()
			: value.toISOString(),
	);

const commentSchema = z.object({
	commentId: requiredString,
	content: z.string(),
	authorArn: requiredString,
	inReplyTo: requiredString.optional(),
	creationDate: dateSchema.optional(),
	lastModifiedDate: dateSchema.optional(),
});

const commentsResponseSchema = z.object({
	commentsForPullRequestData: z
		.array(
			z.object({
				location: locationSchema.optional(),
				comments: z.array(commentSchema).default([]),
			}),
		)
		.default([]),
	nextToken: requiredString.optional(),
});

const commentResponseSchema = z.object({
	comment: commentSchema,
});

const postCommentInputSchema = z.object({
	content: z.string().min(1),
	clientRequestToken: requiredString,
	location: locationSchema.optional(),
});

const updateCommentInputSchema = z.object({
	commentId: requiredString,
	originalBody: z.string().min(1),
	appendedBody: z.string().min(1),
});

const changeTypes = {
	A: "ADDED",
	M: "MODIFIED",
	D: "DELETED",
} as const;

function mapBlob(blob: z.infer<typeof blobMetadataSchema>): BlobMetadata {
	return {
		blobId: blob.blobId,
		path: blob.path,
		mode: blob.mode,
	};
}

function mapComment(
	comment: z.infer<typeof commentSchema>,
	location?: ReviewLocation,
): ReviewComment {
	return {
		commentId: comment.commentId,
		content: comment.content,
		authorArn: comment.authorArn,
		...(comment.inReplyTo === undefined
			? {}
			: { inReplyTo: comment.inReplyTo }),
		...(location === undefined ? {} : { location }),
		...(comment.creationDate === undefined
			? {}
			: { createdAt: comment.creationDate }),
		...(comment.lastModifiedDate === undefined
			? {}
			: { updatedAt: comment.lastModifiedDate }),
	};
}

function decodeFile(bytes: Uint8Array): Pick<FileBlob, "content" | "isBinary"> {
	if (bytes.includes(0)) {
		return { isBinary: true };
	}
	try {
		const { TextDecoder } = globalThis as unknown as {
			TextDecoder: new (
				label?: string,
				options?: { fatal?: boolean },
			) => { decode(input?: Uint8Array): string };
		};
		return {
			content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			isBinary: false,
		};
	} catch {
		return { isBinary: true };
	}
}

export class CodeCommitReviewClient {
	readonly #transport: CodeCommitReviewTransport;

	constructor(transport?: CodeCommitReviewTransport) {
		if (transport !== undefined) {
			this.#transport = transport;
			return;
		}
		const client = new CodeCommitClient({});
		this.#transport = {
			send: (command) => client.send(command as never),
		};
	}

	async getPullRequest(
		repositoryName: string,
		pullRequestId: string,
	): Promise<PullRequestSnapshot> {
		const response = pullRequestResponseSchema.parse(
			await this.#transport.send(
				new GetPullRequestCommand({
					pullRequestId: requiredString.parse(pullRequestId),
				}),
			),
		);
		const target = response.pullRequest.pullRequestTargets.find(
			(candidate) => candidate.repositoryName === repositoryName,
		);
		if (target === undefined) {
			throw new Error(
				`Pull request ${pullRequestId} has no target for repository ${repositoryName}`,
			);
		}
		return {
			provider: "codecommit",
			repositoryName: target.repositoryName,
			pullRequestId: response.pullRequest.pullRequestId,
			status: response.pullRequest.pullRequestStatus,
			sourceReference: target.sourceReference,
			destinationReference: target.destinationReference,
			sourceCommit: target.sourceCommit,
			destinationCommit: target.destinationCommit,
			revisionId: response.pullRequest.revisionId,
		};
	}

	async getDifferences(
		snapshot: PullRequestSnapshot,
		maxResults = 100,
	): Promise<ChangedFile[]> {
		const pageSize = pageSizeSchema.parse(maxResults);
		const results: ChangedFile[] = [];
		let nextToken: string | undefined;
		const seenTokens = new Set<string>();
		for (let page = 0; page < MAX_PAGES; page += 1) {
			const response = differenceResponseSchema.parse(
				await this.#transport.send(
					new GetDifferencesCommand({
						repositoryName: snapshot.repositoryName,
						beforeCommitSpecifier: snapshot.destinationCommit,
						afterCommitSpecifier: snapshot.sourceCommit,
						MaxResults: pageSize,
						...(nextToken === undefined ? {} : { NextToken: nextToken }),
					}),
				),
			);
			for (const difference of response.differences) {
				results.push({
					changeType: changeTypes[difference.changeType],
					...(difference.beforeBlob === undefined
						? {}
						: { before: mapBlob(difference.beforeBlob) }),
					...(difference.afterBlob === undefined
						? {}
						: { after: mapBlob(difference.afterBlob) }),
				});
			}
			if (response.NextToken === undefined) {
				return results;
			}
			if (seenTokens.has(response.NextToken)) {
				throw new Error("CodeCommit differences pagination repeated a token");
			}
			seenTokens.add(response.NextToken);
			nextToken = response.NextToken;
		}
		throw new Error(`CodeCommit differences exceeded ${MAX_PAGES} pages`);
	}

	async getFile(
		repositoryName: string,
		commitId: string,
		filePath: string,
	): Promise<FileBlob> {
		const explicitCommitId = requiredString.parse(commitId);
		const response = fileResponseSchema.parse(
			await this.#transport.send(
				new GetFileCommand({
					repositoryName: requiredString.parse(repositoryName),
					commitSpecifier: explicitCommitId,
					filePath: requiredString.parse(filePath),
				}),
			),
		);
		if (response.commitId !== explicitCommitId) {
			throw new Error("CodeCommit returned a file from an unexpected commit");
		}
		return {
			commitId: response.commitId,
			blobId: response.blobId,
			filePath: response.filePath,
			fileMode: response.fileMode,
			fileSize: response.fileSize,
			...decodeFile(response.fileContent),
		};
	}

	async getComments(
		snapshot: PullRequestSnapshot,
		maxResults = 100,
	): Promise<ReviewComment[]> {
		const pageSize = pageSizeSchema.parse(maxResults);
		const results: ReviewComment[] = [];
		let nextToken: string | undefined;
		const seenTokens = new Set<string>();
		for (let page = 0; page < MAX_PAGES; page += 1) {
			const response = commentsResponseSchema.parse(
				await this.#transport.send(
					new GetCommentsForPullRequestCommand({
						repositoryName: snapshot.repositoryName,
						pullRequestId: snapshot.pullRequestId,
						beforeCommitId: snapshot.destinationCommit,
						afterCommitId: snapshot.sourceCommit,
						maxResults: pageSize,
						...(nextToken === undefined ? {} : { nextToken }),
					}),
				),
			);
			for (const group of response.commentsForPullRequestData) {
				for (const comment of group.comments) {
					results.push(mapComment(comment, group.location));
				}
			}
			if (response.nextToken === undefined) {
				return results;
			}
			if (seenTokens.has(response.nextToken)) {
				throw new Error("CodeCommit comments pagination repeated a token");
			}
			seenTokens.add(response.nextToken);
			nextToken = response.nextToken;
		}
		throw new Error(`CodeCommit comments exceeded ${MAX_PAGES} pages`);
	}

	async postComment(input: PostCommentInput): Promise<ReviewComment> {
		const parsed = postCommentInputSchema.parse(input);
		const response = commentResponseSchema.parse(
			await this.#transport.send(
				new PostCommentForPullRequestCommand({
					repositoryName: input.snapshot.repositoryName,
					pullRequestId: input.snapshot.pullRequestId,
					beforeCommitId: input.snapshot.destinationCommit,
					afterCommitId: input.snapshot.sourceCommit,
					content: parsed.content,
					...(parsed.location === undefined
						? {}
						: { location: parsed.location }),
					clientRequestToken: parsed.clientRequestToken,
				}),
			),
		);
		return mapComment(response.comment, parsed.location);
	}

	async updateComment(input: UpdateCommentInput): Promise<ReviewComment> {
		const parsed = updateCommentInputSchema.parse(input);
		const content = `${parsed.originalBody}\n\n${parsed.appendedBody}`;
		const response = commentResponseSchema.parse(
			await this.#transport.send(
				new UpdateCommentCommand({
					commentId: parsed.commentId,
					content,
				}),
			),
		);
		return mapComment(response.comment);
	}
}
