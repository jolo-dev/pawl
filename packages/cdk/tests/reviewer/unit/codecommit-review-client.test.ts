import { describe, expect, test } from "bun:test";
import {
	GetCommentsForPullRequestCommand,
	GetDifferencesCommand,
	GetFileCommand,
	GetPullRequestCommand,
	PostCommentForPullRequestCommand,
	UpdateCommentCommand,
} from "@aws-sdk/client-codecommit";
import { CodeCommitReviewClient } from "../../../src/reviewer/adapters/codecommit-review-client";
import type { PullRequestSnapshot } from "../../../src/reviewer/adapters/codecommit-review-types";
import binaryFileFixture from "../fixtures/codecommit/binary-file.json";
import commentsPage1 from "../fixtures/codecommit/comments-page-1.json";
import commentsPage2 from "../fixtures/codecommit/comments-page-2.json";
import differencesPage1 from "../fixtures/codecommit/differences-page-1.json";
import differencesPage2 from "../fixtures/codecommit/differences-page-2.json";
import fileFixture from "../fixtures/codecommit/file.json";
import mergedPullRequestFixture from "../fixtures/codecommit/merged-pull-request.json";
import pullRequestFixture from "../fixtures/codecommit/pull-request.json";

const snapshot: PullRequestSnapshot = {
	provider: "codecommit",
	repositoryName: "widgets",
	pullRequestId: "42",
	status: "OPEN",
	sourceReference: "refs/heads/feature/review",
	destinationReference: "refs/heads/main",
	sourceCommit: "source-immutable-abc",
	destinationCommit: "destination-immutable-def",
	revisionId: "revision-3",
};

class FakeSender {
	readonly commands: unknown[] = [];
	readonly #responses: unknown[];

	constructor(responses: unknown[]) {
		this.#responses = [...responses];
	}

	send = async (command: unknown): Promise<unknown> => {
		this.commands.push(command);
		const response = this.#responses.shift();
		if (response === undefined) {
			throw new Error("No fake response configured");
		}
		return response;
	};
}

describe("CodeCommitReviewClient", () => {
	test("maps a pull request to immutable cycle commits and status", async () => {
		const sender = new FakeSender([pullRequestFixture]);
		const client = new CodeCommitReviewClient(sender);

		const result = await client.getPullRequest("widgets", "42");

		expect(sender.commands[0]).toBeInstanceOf(GetPullRequestCommand);
		expect((sender.commands[0] as GetPullRequestCommand).input).toEqual({
			pullRequestId: "42",
		});
		expect(result).toEqual(snapshot);
	});

	test("normalizes a closed pull request with merge metadata to MERGED", async () => {
		const sender = new FakeSender([mergedPullRequestFixture]);
		const client = new CodeCommitReviewClient(sender);

		const result = await client.getPullRequest("widgets", "42");

		expect(result.status).toBe("MERGED");
	});

	test("rejects malformed optional merge metadata", async () => {
		const [target] = mergedPullRequestFixture.pullRequest.pullRequestTargets;
		const sender = new FakeSender([
			{
				pullRequest: {
					...mergedPullRequestFixture.pullRequest,
					pullRequestTargets: [
						{ ...target, mergeMetadata: { isMerged: "yes" } },
					],
				},
			},
		]);
		const client = new CodeCommitReviewClient(sender);

		await expect(client.getPullRequest("widgets", "42")).rejects.toThrow();
	});

	test("rejects malformed required pull request response fields", async () => {
		const sender = new FakeSender([
			{
				pullRequest: {
					...pullRequestFixture.pullRequest,
					revisionId: undefined,
				},
			},
		]);
		const client = new CodeCommitReviewClient(sender);

		await expect(client.getPullRequest("widgets", "42")).rejects.toThrow();
	});

	test("paginates differences with NextToken and MaxResults", async () => {
		const sender = new FakeSender([differencesPage1, differencesPage2]);
		const client = new CodeCommitReviewClient(sender);

		const files = await client.getDifferences(snapshot, 25);

		expect(sender.commands).toHaveLength(2);
		expect(sender.commands[0]).toBeInstanceOf(GetDifferencesCommand);
		expect((sender.commands[0] as GetDifferencesCommand).input).toEqual({
			repositoryName: "widgets",
			beforeCommitSpecifier: "destination-immutable-def",
			afterCommitSpecifier: "source-immutable-abc",
			MaxResults: 25,
		});
		expect((sender.commands[1] as GetDifferencesCommand).input).toEqual({
			repositoryName: "widgets",
			beforeCommitSpecifier: "destination-immutable-def",
			afterCommitSpecifier: "source-immutable-abc",
			MaxResults: 25,
			NextToken: "differences-page-2",
		});
		expect(files.map(({ changeType }) => changeType)).toEqual([
			"MODIFIED",
			"ADDED",
		]);
	});

	test("rejects cyclic differences pagination tokens", async () => {
		const sender = new FakeSender([
			{ differences: [], NextToken: "token-a" },
			{ differences: [], NextToken: "token-b" },
			{ differences: [], NextToken: "token-a" },
		]);
		const client = new CodeCommitReviewClient(sender);

		await expect(client.getDifferences(snapshot)).rejects.toThrow(
			"pagination repeated a token",
		);
		expect(sender.commands).toHaveLength(3);
	});

	test("stops differences pagination at the hard page bound", async () => {
		const sender = new FakeSender(
			Array.from({ length: 1_000 }, (_, page) => ({
				differences: [],
				NextToken: `token-${page}`,
			})),
		);
		const client = new CodeCommitReviewClient(sender);

		await expect(client.getDifferences(snapshot)).rejects.toThrow(
			"exceeded 1000 pages",
		);
		expect(sender.commands).toHaveLength(1_000);
	});

	test("retains the differences page-size limit", async () => {
		const sender = new FakeSender([{ differences: [] }]);
		const client = new CodeCommitReviewClient(sender);

		await expect(client.getDifferences(snapshot, 100)).resolves.toEqual([]);
		expect((sender.commands[0] as GetDifferencesCommand).input.MaxResults).toBe(
			100,
		);
		await expect(client.getDifferences(snapshot, 101)).rejects.toThrow();
	});

	test("always sends an explicit commit ID when reading a file", async () => {
		const sender = new FakeSender([fileFixture]);
		const client = new CodeCommitReviewClient(sender);

		const file = await client.getFile(
			"widgets",
			"source-immutable-abc",
			"src/a.ts",
		);

		expect(sender.commands[0]).toBeInstanceOf(GetFileCommand);
		expect((sender.commands[0] as GetFileCommand).input).toEqual({
			repositoryName: "widgets",
			commitSpecifier: "source-immutable-abc",
			filePath: "src/a.ts",
		});
		expect(file.content).toBe("export const x = 1");
		expect(file.isBinary).toBe(false);
	});

	test("rejects a file returned from an unexpected commit", async () => {
		const sender = new FakeSender([
			{ ...fileFixture, commitId: "different-commit" },
		]);
		const client = new CodeCommitReviewClient(sender);

		await expect(
			client.getFile("widgets", "source-immutable-abc", "src/a.ts"),
		).rejects.toThrow("unexpected commit");
	});

	test("classifies binary files without returning decoded content", async () => {
		const sender = new FakeSender([binaryFileFixture]);
		const client = new CodeCommitReviewClient(sender);

		const file = await client.getFile(
			"widgets",
			"source-immutable-abc",
			"assets/image.bin",
		);

		expect(file.isBinary).toBe(true);
		expect(file.content).toBeUndefined();
	});

	test("classifies invalid UTF-8 without NUL bytes as binary", async () => {
		const sender = new FakeSender([
			{ ...fileFixture, fileSize: 2, fileContent: [195, 40] },
		]);
		const client = new CodeCommitReviewClient(sender);

		const file = await client.getFile(
			"widgets",
			"source-immutable-abc",
			"src/a.ts",
		);

		expect(file.isBinary).toBe(true);
		expect(file.content).toBeUndefined();
	});

	test("paginates comments and preserves reply, author, and location", async () => {
		const sender = new FakeSender([commentsPage1, commentsPage2]);
		const client = new CodeCommitReviewClient(sender);

		const comments = await client.getComments(snapshot, 50);

		expect(sender.commands).toHaveLength(2);
		expect(sender.commands[0]).toBeInstanceOf(GetCommentsForPullRequestCommand);
		expect(
			(sender.commands[0] as GetCommentsForPullRequestCommand).input,
		).toEqual({
			repositoryName: "widgets",
			pullRequestId: "42",
			beforeCommitId: "destination-immutable-def",
			afterCommitId: "source-immutable-abc",
			maxResults: 50,
		});
		expect(
			(sender.commands[1] as GetCommentsForPullRequestCommand).input,
		).toEqual({
			repositoryName: "widgets",
			pullRequestId: "42",
			beforeCommitId: "destination-immutable-def",
			afterCommitId: "source-immutable-abc",
			maxResults: 50,
			nextToken: "comments-page-2",
		});
		expect(comments[0]).toMatchObject({
			commentId: "comment-1",
			inReplyTo: "root-1",
			authorArn: "arn:aws:iam::123:user/reviewer",
			location: {
				filePath: "src/a.ts",
				filePosition: 12,
				relativeFileVersion: "AFTER",
			},
		});
	});

	test("accepts the comments page-size limit and rejects values above it", async () => {
		const sender = new FakeSender([{ commentsForPullRequestData: [] }]);
		const client = new CodeCommitReviewClient(sender);

		await expect(client.getComments(snapshot, 500)).resolves.toEqual([]);
		expect(
			(sender.commands[0] as GetCommentsForPullRequestCommand).input.maxResults,
		).toBe(500);
		await expect(client.getComments(snapshot, 501)).rejects.toThrow();
	});

	test("rejects cyclic comments pagination tokens", async () => {
		const sender = new FakeSender([
			{ commentsForPullRequestData: [], nextToken: "token-a" },
			{ commentsForPullRequestData: [], nextToken: "token-b" },
			{ commentsForPullRequestData: [], nextToken: "token-a" },
		]);
		const client = new CodeCommitReviewClient(sender);

		await expect(client.getComments(snapshot)).rejects.toThrow(
			"pagination repeated a token",
		);
		expect(sender.commands).toHaveLength(3);
	});

	test("stops comments pagination at the hard page bound", async () => {
		const sender = new FakeSender(
			Array.from({ length: 1_000 }, (_, page) => ({
				commentsForPullRequestData: [],
				nextToken: `token-${page}`,
			})),
		);
		const client = new CodeCommitReviewClient(sender);

		await expect(client.getComments(snapshot)).rejects.toThrow(
			"exceeded 1000 pages",
		);
		expect(sender.commands).toHaveLength(1_000);
	});

	test("rejects malformed required comment response fields", async () => {
		const sender = new FakeSender([
			{
				commentsForPullRequestData: [
					{
						comments: [
							{
								commentId: "comment-1",
								content: "Missing author",
							},
						],
					},
				],
			},
		]);
		const client = new CodeCommitReviewClient(sender);

		await expect(client.getComments(snapshot)).rejects.toThrow();
	});

	test("posts against exact cycle commits with a stable request token", async () => {
		const sender = new FakeSender([
			{
				comment: {
					commentId: "posted-1",
					content: "Finding",
					authorArn: "arn:aws:iam::123:role/reviewer",
				},
			},
		]);
		const client = new CodeCommitReviewClient(sender);

		await client.postComment({
			snapshot,
			content: "Finding",
			location: {
				filePath: "src/a.ts",
				filePosition: 12,
				relativeFileVersion: "AFTER",
			},
			clientRequestToken: "review-cycle-42-comment-1",
		});

		expect(sender.commands[0]).toBeInstanceOf(PostCommentForPullRequestCommand);
		expect(
			(sender.commands[0] as PostCommentForPullRequestCommand).input,
		).toEqual({
			repositoryName: "widgets",
			pullRequestId: "42",
			beforeCommitId: "destination-immutable-def",
			afterCommitId: "source-immutable-abc",
			content: "Finding",
			location: {
				filePath: "src/a.ts",
				filePosition: 12,
				relativeFileVersion: "AFTER",
			},
			clientRequestToken: "review-cycle-42-comment-1",
		});
	});

	test("updates full comment content while preserving its original body", async () => {
		const sender = new FakeSender([
			{
				comment: {
					commentId: "comment-1",
					content: "Original reviewer text\n\nAutomated review complete.",
					authorArn: "arn:aws:iam::123:role/reviewer",
				},
			},
		]);
		const client = new CodeCommitReviewClient(sender);

		await client.updateComment({
			commentId: "comment-1",
			originalBody: "Original reviewer text",
			appendedBody: "Automated review complete.",
		});

		expect(sender.commands[0]).toBeInstanceOf(UpdateCommentCommand);
		expect((sender.commands[0] as UpdateCommentCommand).input).toEqual({
			commentId: "comment-1",
			content: "Original reviewer text\n\nAutomated review complete.",
		});
	});
});
