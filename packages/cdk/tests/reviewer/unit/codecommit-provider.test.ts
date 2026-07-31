import { expect, test } from "bun:test";
import { CodeCommitProvider } from "../../../src/reviewer/adapters/codecommit-provider";
import type { Finding } from "../../../src/reviewer/domain/finding";

const snapshot = {
	provider: "codecommit" as const,
	repositoryName: "repo",
	pullRequestId: "7",
	status: "OPEN" as const,
	sourceReference: "refs/heads/feature",
	destinationReference: "refs/heads/main",
	sourceCommit: "source-commit-123",
	destinationCommit: "destination-commit-123",
	revisionId: "revision-123",
};

function finding(): Finding {
	return {
		kind: "finding",
		category: "correctness",
		severity: "high",
		confidence: 1,
		path: "src/a.ts",
		side: "after",
		issueIdentity: "bug",
		evidence: "evidence",
		impact: "impact",
		recommendation: "fix",
		location: { kind: "line", line: 2, hunkIdentity: "hunk-1" },
	} as Finding;
}

test("keeps immutable request snapshots and reads exact revisions", async () => {
	const calls: unknown[] = [];
	const client = {
		getPullRequest: async () => structuredClone(snapshot),
		getDifferences: async (value: unknown) => {
			calls.push(value);
			return [
				{
					changeType: "MODIFIED" as const,
					before: { blobId: "b", path: "src/a.ts", mode: "100644" },
					after: { blobId: "a", path: "src/a.ts", mode: "100644" },
				},
			];
		},
		getFile: async (_repo: string, revision: string) => {
			calls.push([_repo, revision]);
			return {
				commitId: revision,
				blobId: "x",
				filePath: "src/a.ts",
				fileMode: "100644",
				fileSize: 4,
				isBinary: false,
				content:
					revision === "destination-commit-123" ? "old\nline\n" : "old\nnew\n",
			};
		},
		getComments: async () => [],
		postComment: async () => ({
			commentId: "c",
			content: "x",
			authorArn: "reviewer",
		}),
		updateComment: async () => ({
			commentId: "c",
			content: "resolved",
			authorArn: "reviewer",
		}),
		postCommentReply: async () => ({
			commentId: "r",
			content: "r",
			authorArn: "reviewer",
		}),
		putCommentReaction: async () => {},
	};
	const provider = new CodeCommitProvider({ client, reviewerArn: "reviewer" });
	const request = await provider.getRequest({
		provider: "codecommit",
		repository: "repo",
		requestId: "7",
	});
	const changed = await provider.getDiff(request.key, {
		sourceRevision: request.sourceRevision,
		destinationRevision: request.destinationRevision,
	});
	expect(request.sourceRevision).toBe(snapshot.sourceCommit);
	expect(changed[0]?.hunks.length).toBeGreaterThan(0);
	expect(calls).toContainEqual(["repo", "destination-commit-123"]);
});

test("computes deterministic multi-hunk line positions without double advancing context", async () => {
	const before = "a\nold\nctx\nkeep\nctx2\nold2\nz\n";
	const after = "a\nnew\nctx\nkeep\nctx2\nnew2\nz\n";
	const client = {
		getPullRequest: async () => snapshot,
		getDifferences: async () => [
			{
				changeType: "MODIFIED" as const,
				before: { blobId: "b", path: "x.ts", mode: "100644" },
				after: { blobId: "a", path: "x.ts", mode: "100644" },
			},
		],
		getFile: async (_repo: string, revision: string) => ({
			commitId: revision,
			blobId: "x",
			filePath: "x.ts",
			fileMode: "100644",
			fileSize: 1,
			isBinary: false,
			content: revision === snapshot.destinationCommit ? before : after,
		}),
		getComments: async () => [],
		postComment: async () => ({
			commentId: "c",
			content: "body",
			authorArn: "reviewer",
		}),
		updateComment: async () => ({
			commentId: "c",
			content: "body",
			authorArn: "reviewer",
		}),
		postCommentReply: async () => ({
			commentId: "r",
			content: "r",
			authorArn: "reviewer",
		}),
		putCommentReaction: async () => {},
	};
	const files = await new CodeCommitProvider({ client }).getDiff(
		{ provider: "codecommit", repository: "repo", requestId: "7" },
		{
			sourceRevision: snapshot.sourceCommit,
			destinationRevision: snapshot.destinationCommit,
		},
	);
	const changed = files[0]?.hunks.flatMap((hunk) =>
		hunk.lines.filter((line) => line.changed),
	);
	expect(changed?.map((line) => [line.side, line.line, line.content])).toEqual([
		["before", 2, "old"],
		["after", 2, "new"],
		["before", 6, "old2"],
		["after", 6, "new2"],
	]);
});

test("accepts only the existing side of renamed paths for inline comments", async () => {
	const posts: unknown[] = [];
	const client = {
		getPullRequest: async () => snapshot,
		getDifferences: async () => [
			{
				changeType: "MODIFIED" as const,
				before: { blobId: "b", path: "old.ts", mode: "100644" },
				after: { blobId: "a", path: "new.ts", mode: "100644" },
			},
		],
		getFile: async (_repo: string, revision: string, path: string) => ({
			commitId: revision,
			blobId: "x",
			filePath: path,
			fileMode: "100644",
			fileSize: 1,
			isBinary: false,
			content: revision === snapshot.destinationCommit ? "old\n" : "new\n",
		}),
		getComments: async () => [],
		postComment: async (input: unknown) => {
			posts.push(input);
			return { commentId: "c", content: "body", authorArn: "reviewer" };
		},
		updateComment: async () => ({
			commentId: "c",
			content: "body",
			authorArn: "reviewer",
		}),
		postCommentReply: async () => ({
			commentId: "r",
			content: "r",
			authorArn: "reviewer",
		}),
		putCommentReaction: async () => {},
	};
	const provider = new CodeCommitProvider({ client });
	const files = await provider.getDiff(
		{ provider: "codecommit", repository: "repo", requestId: "7" },
		{
			sourceRevision: snapshot.sourceCommit,
			destinationRevision: snapshot.destinationCommit,
		},
	);
	const firstFile = files[0];
	if (firstFile === undefined) {
		throw new Error("Expected the diff to include a file");
	}
	const firstHunk = firstFile.hunks[0];
	if (firstHunk === undefined) {
		throw new Error("Expected the diff file to include a hunk");
	}
	const hunkIdentity = firstHunk.identity;
	const base = finding() as Finding;
	await provider.postInlineFinding(
		{ provider: "codecommit", repository: "repo", requestId: "7" },
		{
			...base,
			path: "old.ts",
			side: "before",
			location: { kind: "line", line: 1, hunkIdentity },
		} as Finding,
	);
	expect(
		(
			posts.at(-1) as {
				location?: {
					filePath: string;
					filePosition: number;
					relativeFileVersion: string;
				};
			}
		).location,
	).toEqual({
		filePath: "old.ts",
		filePosition: 1,
		relativeFileVersion: "BEFORE",
	});
	await expect(
		provider.postInlineFinding(
			{ provider: "codecommit", repository: "repo", requestId: "7" },
			{
				...base,
				path: "old.ts",
				side: "after",
				location: { kind: "line", line: 1, hunkIdentity },
			} as Finding,
		),
	).rejects.toThrow("invalid inline location");
	await provider.postInlineFinding(
		{ provider: "codecommit", repository: "repo", requestId: "7" },
		{
			...base,
			path: "new.ts",
			side: "after",
			location: { kind: "line", line: 1, hunkIdentity },
		} as Finding,
	);
	expect(
		(
			posts.at(-1) as {
				location?: {
					filePath: string;
					filePosition: number;
					relativeFileVersion: string;
				};
			}
		).location,
	).toEqual({
		filePath: "new.ts",
		filePosition: 1,
		relativeFileVersion: "AFTER",
	});
});

test("uses the persisted revision range even when the current head drifts", async () => {
	const calls: unknown[] = [];
	const drifted = {
		...snapshot,
		sourceCommit: "new-head",
		destinationCommit: "new-base",
	};
	const client = {
		getPullRequest: async () => drifted,
		getDifferences: async (value: unknown) => {
			calls.push(value);
			return [];
		},
		getFile: async () => undefined,
		getComments: async () => [],
		postComment: async (input: unknown) => {
			calls.push(input);
			return {
				commentId: "cycle-comment",
				content: "body",
				authorArn: "reviewer",
			};
		},
		updateComment: async () => ({
			commentId: "cycle-comment",
			content: "body",
			authorArn: "reviewer",
		}),
		postCommentReply: async () => ({
			commentId: "r",
			content: "r",
			authorArn: "reviewer",
		}),
		putCommentReaction: async () => {},
	};
	const provider = new CodeCommitProvider({ client });
	const ref = {
		provider: "codecommit" as const,
		repository: "repo",
		requestId: "7",
	};
	const revisions = {
		sourceRevision: "cycle-source",
		destinationRevision: "cycle-base",
	};
	await provider.getDiff(ref, revisions);
	await provider.postSummaryFinding(ref, finding(), revisions);
	expect(calls[0]).toMatchObject({
		sourceCommit: "cycle-source",
		destinationCommit: "cycle-base",
	});
	expect(calls[1]).toMatchObject({
		snapshot: { sourceCommit: "cycle-source", destinationCommit: "cycle-base" },
	});
});

test("filters and orders comments after the supplied watermark", async () => {
	const client = {
		getPullRequest: async () => snapshot,
		getDifferences: async () => [],
		getFile: async () => undefined,
		getComments: async () => [
			{
				commentId: "later",
				content: "later",
				authorArn: "human",
				createdAt: "2026-01-01T00:00:02.000Z",
			},
			{
				commentId: "before",
				content: "before",
				authorArn: "human",
				createdAt: "2026-01-01T00:00:01.000Z",
			},
		],
		postComment: async () => ({
			commentId: "c",
			content: "body",
			authorArn: "reviewer",
		}),
		updateComment: async () => ({
			commentId: "c",
			content: "body",
			authorArn: "reviewer",
		}),
		postCommentReply: async () => ({
			commentId: "r",
			content: "r",
			authorArn: "reviewer",
		}),
		putCommentReaction: async () => {},
	};
	const provider = new CodeCommitProvider({ client });
	const comments = await provider.listComments(
		refForTest(),
		"2026-01-01T00:00:01.000Z#before",
	);
	expect(comments.map((comment) => comment.id)).toEqual(["later"]);
});

test("resolves against the immutable cycle range after the current head drifts", async () => {
	const commentSnapshots: unknown[] = [];
	const client = {
		getPullRequest: async () => ({
			...snapshot,
			sourceCommit: "current-source",
			destinationCommit: "current-base",
		}),
		getDifferences: async () => [],
		getFile: async () => undefined,
		getComments: async (value: unknown) => {
			commentSnapshots.push(value);
			return [
				{
					commentId: "cycle-comment",
					content: "original",
					authorArn: "reviewer",
					createdAt: "2026-01-01T00:00:00.000Z",
				},
			];
		},
		postComment: async () => ({
			commentId: "cycle-comment",
			content: "original",
			authorArn: "reviewer",
		}),
		updateComment: async () => ({
			commentId: "cycle-comment",
			content: "updated",
			authorArn: "reviewer",
		}),
		postCommentReply: async () => ({
			commentId: "r",
			content: "r",
			authorArn: "reviewer",
		}),
		putCommentReaction: async () => {},
	};
	const provider = new CodeCommitProvider({ client });
	await provider.markCommentResolved(
		refForTest(),
		{
			id: "cycle-comment",
			findingFingerprint: `review-finding:v1:${"a".repeat(64)}`,
			contentHash: "hash",
		},
		{ type: "fixed", revision: "cycle-source" },
		{
			sourceRevision: "cycle-source",
			destinationRevision: "cycle-base",
		},
	);
	expect(commentSnapshots).toEqual([
		expect.objectContaining({
			sourceCommit: "cycle-source",
			destinationCommit: "cycle-base",
		}),
	]);
});

test("does not duplicate an existing resolution marker", async () => {
	let updates = 0;
	const client = {
		getPullRequest: async () => snapshot,
		getDifferences: async () => [],
		getFile: async () => undefined,
		getComments: async () => [
			{
				commentId: "comment-1",
				content: "body\\n\\nResolved: fixed in source-1",
				authorArn: "reviewer",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		],
		postComment: async () => ({
			commentId: "c",
			content: "body",
			authorArn: "reviewer",
		}),
		updateComment: async () => {
			updates += 1;
			return { commentId: "comment-1", content: "body", authorArn: "reviewer" };
		},
		postCommentReply: async () => ({
			commentId: "r",
			content: "r",
			authorArn: "reviewer",
		}),
		putCommentReaction: async () => {},
	};
	const provider = new CodeCommitProvider({ client });
	await provider.markCommentResolved(
		refForTest(),
		{
			id: "comment-1",
			findingFingerprint: `review-finding:v1:${"a".repeat(64)}`,
			contentHash: "hash",
		},
		{ type: "fixed", revision: "source-1" },
	);
	expect(updates).toBe(0);
});

function refForTest() {
	return {
		provider: "codecommit" as const,
		repository: "repo",
		requestId: "7",
	};
}

test("maps authors/replies and reuses finding idempotency tokens", async () => {
	const posted: unknown[] = [];
	const client = {
		getPullRequest: async () => snapshot,
		getDifferences: async () => [],
		getFile: async () => undefined,
		getComments: async () => [
			{
				commentId: "c",
				content: "body",
				authorArn: "human",
				inReplyTo: "p",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		],
		postComment: async (input: unknown) => {
			posted.push(input);
			return { commentId: "c2", content: "body", authorArn: "reviewer" };
		},
		updateComment: async () => ({
			commentId: "c2",
			content: "resolved",
			authorArn: "reviewer",
		}),
		postCommentReply: async () => ({
			commentId: "r",
			content: "r",
			authorArn: "reviewer",
		}),
		putCommentReaction: async () => {},
	};
	const provider = new CodeCommitProvider({ client, reviewerArn: "reviewer" });
	const comments = await provider.listComments({
		provider: "codecommit",
		repository: "repo",
		requestId: "7",
	});
	expect(comments[0]?.authorId).toBe("human");
	expect(comments[0]?.inReplyTo).toBe("p");
	await provider.postSummaryFinding(
		{ provider: "codecommit", repository: "repo", requestId: "7" },
		finding(),
	);
	await provider.postSummaryFinding(
		{ provider: "codecommit", repository: "repo", requestId: "7" },
		finding(),
	);
	expect((posted[0] as { clientRequestToken: string }).clientRequestToken).toBe(
		(posted[1] as { clientRequestToken: string }).clientRequestToken,
	);
});

test("reactToComment forwards an emoji reaction to the client", async () => {
	const calls: { commentId: string; reactionValue: string }[] = [];
	const client = {
		getPullRequest: async () => structuredClone(snapshot),
		getDifferences: async () => [],
		getFile: async () => undefined,
		getComments: async () => [],
		postComment: async () => ({
			commentId: "c",
			content: "x",
			authorArn: "reviewer",
		}),
		updateComment: async () => ({
			commentId: "c",
			content: "x",
			authorArn: "reviewer",
		}),
		postCommentReply: async () => ({
			commentId: "r",
			content: "r",
			authorArn: "reviewer",
		}),
		putCommentReaction: async (input: {
			commentId: string;
			reactionValue: string;
		}) => {
			calls.push(input);
		},
	};
	const provider = new CodeCommitProvider({ client });
	await provider.reactToComment(
		{ provider: "codecommit", repository: "repo", requestId: "7" },
		"comment-42",
		"👀",
	);
	expect(calls).toEqual([{ commentId: "comment-42", reactionValue: "👀" }]);
});

test("replyToComment posts a threaded reply with an idempotency token", async () => {
	const calls: {
		inReplyTo: string;
		content: string;
		clientRequestToken: string;
	}[] = [];
	const client = {
		getPullRequest: async () => structuredClone(snapshot),
		getDifferences: async () => [],
		getFile: async () => undefined,
		getComments: async () => [],
		postComment: async () => ({
			commentId: "c",
			content: "x",
			authorArn: "reviewer",
		}),
		updateComment: async () => ({
			commentId: "c",
			content: "x",
			authorArn: "reviewer",
		}),
		postCommentReply: async (input: {
			inReplyTo: string;
			content: string;
			clientRequestToken: string;
		}) => {
			calls.push(input);
			return {
				commentId: "reply-1",
				content: input.content,
				authorArn: "reviewer",
			};
		},
		putCommentReaction: async () => {},
	};
	const provider = new CodeCommitProvider({ client });
	const posted = await provider.replyToComment(
		{ provider: "codecommit", repository: "repo", requestId: "7" },
		"comment-42",
		"✅ Reviewed — no new findings.",
		"token-1",
	);
	expect(calls).toEqual([
		{
			inReplyTo: "comment-42",
			content: "✅ Reviewed — no new findings.",
			clientRequestToken: "token-1",
		},
	]);
	expect(posted.id).toBe("reply-1");
	expect(posted.findingFingerprint).toBe("status:v1:token-1");
});
