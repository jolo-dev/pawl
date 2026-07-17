import { describe, expect, test } from "bun:test";
import {
	GetCommentsForPullRequestCommand,
	GetDifferencesCommand,
	GetFileCommand,
	GetPullRequestCommand,
	PostCommentForPullRequestCommand,
	UpdateCommentCommand,
} from "@aws-sdk/client-codecommit";
import type { PullRequestSnapshot } from "../index";
import { CodeCommitReviewClient } from "../index";
import binaryFileFixture from "./fixtures/binary-file.json";
import commentsPage1 from "./fixtures/comments-page-1.json";
import commentsPage2 from "./fixtures/comments-page-2.json";
import differencesPage1 from "./fixtures/differences-page-1.json";
import differencesPage2 from "./fixtures/differences-page-2.json";
import fileFixture from "./fixtures/file.json";
import pullRequestFixture from "./fixtures/pull-request.json";

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
