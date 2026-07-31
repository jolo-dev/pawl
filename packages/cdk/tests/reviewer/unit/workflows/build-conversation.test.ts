import { describe, expect, test } from "bun:test";
import type { ReviewComment } from "../../../../src/reviewer/ports/source-control-provider";
import { buildConversation } from "../../../../src/reviewer/workflows/reviewer-workflow";

const NAME = "Claude Sonnet 4.6";
const SIG = `🤖 AI generated review by ${NAME}`;

function comment(
	overrides: Partial<ReviewComment> & { id: string },
): ReviewComment {
	return {
		authorId: "arn:aws:iam::1:user/jolo",
		body: "",
		occurredAt: "2026-01-01T00:00:00.000Z",
		watermark: "w",
		...overrides,
	};
}

describe("buildConversation", () => {
	test("keeps human comments and reviewer replies, drops inline findings, orders by input", () => {
		const comments: ReviewComment[] = [
			comment({ id: "h1", body: "Is this safe?" }),
			comment({
				id: "f1",
				body: `<!-- pawl:eval -->\n**critical**\n...\n---\n${SIG}`,
				findingFingerprint: "review-finding:v1:abc",
			}),
			comment({
				id: "r1",
				body: `No, eval is unsafe here.\n---\n${SIG}`,
				inReplyTo: "h1",
			}),
			comment({ id: "h2", body: "What about JSON.parse?", inReplyTo: "r1" }),
		];
		const turns = buildConversation(comments, NAME);
		expect(turns).toEqual([
			{ role: "human", id: "h1", body: "Is this safe?" },
			{
				role: "reviewer",
				id: "r1",
				body: "No, eval is unsafe here.",
				inReplyTo: "h1",
			},
			{
				role: "human",
				id: "h2",
				body: "What about JSON.parse?",
				inReplyTo: "r1",
			},
		]);
	});

	test("strips the 🤖 signature from reviewer reply bodies", () => {
		const turns = buildConversation(
			[comment({ id: "r1", body: `Answer.\n---\n${SIG}` })],
			NAME,
		);
		expect(turns[0]?.body).toBe("Answer.");
		expect(turns[0]?.body).not.toContain("🤖");
	});

	test("classifies a comment without the signature as human even if from a bot arn", () => {
		const turns = buildConversation(
			[comment({ id: "x", body: "hello", authorId: "some-bot-arn" })],
			NAME,
		);
		expect(turns[0]?.role).toBe("human");
	});

	test("returns empty for an empty comment list", () => {
		expect(buildConversation([], NAME)).toEqual([]);
	});
});
