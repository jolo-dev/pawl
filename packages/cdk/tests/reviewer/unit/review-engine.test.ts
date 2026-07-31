import { describe, expect, test } from "bun:test";
import type {
	AcceptedFinding,
	DismissalCandidate,
} from "../../../src/reviewer/domain/finding";
import { modelReviewCandidateSchema } from "../../../src/reviewer/domain/finding";
import type { ReviewCycleSnapshot } from "../../../src/reviewer/domain/review-request";
import type {
	ReviewModel,
	ReviewModelInput,
	ReviewModelResult,
} from "../../../src/reviewer/ports/review-model";
import type { ChangedFile } from "../../../src/reviewer/ports/source-control-provider";
import type { PersistedFinding } from "../../../src/reviewer/ports/state-store";
import { ReviewEngine } from "../../../src/reviewer/services/review-engine";

type Candidate = z.infer<typeof modelReviewCandidateSchema>;

import type { z } from "zod";

const snapshot: ReviewCycleSnapshot = {
	request: { provider: "codecommit", repository: "repo", requestId: "7" },
	generation: 1,
	cycle: 1,
	sourceRevision: "source-immutable-commit-1234567",
	destinationRevision: "destination-immutable-commit-1234567",
	configVersion: 1,
	eventWatermark: "source-immutable-commit-1234567",
	startedAt: "2026-01-01T00:00:00.000Z",
};

const repositoryConfig = {
	version: 1 as const,
	checks: [],
	review: {
		timeoutDays: 30,
		modelId: "anthropic.claude-opus-4-8",
		maxChangedFiles: 100,
		maxDiffBytes: 1_000_000,
		maxModelTokens: 100_000,
		debounceSeconds: 5,
	},
};

const changedFile: ChangedFile = {
	path: "src/foo.ts",
	changeType: "modified",
	hunks: [
		{
			identity: "hunk-1",
			header: "@@ -1,2 +1,2 @@",
			lines: [{ side: "after", line: 1, content: "new line", changed: true }],
		},
	],
};

/** A stub ReviewModel returning a fixed candidate set. */
class StubModel implements ReviewModel {
	constructor(private readonly output: ReviewModelResult["output"]) {}
	async review(_input: ReviewModelInput): Promise<ReviewModelResult> {
		return {
			output: this.output,
			modelId: "stub",
			usage: { inputTokens: 5, outputTokens: 7 },
		};
	}
	async respond(): Promise<{
		reply: string;
		usage: { inputTokens: number; outputTokens: number };
	}> {
		return {
			reply: "✅ Reviewed.",
			usage: { inputTokens: 0, outputTokens: 0 },
		};
	}
}

function finding(overrides: Record<string, unknown> = {}): Candidate {
	const base = {
		kind: "finding" as const,
		category: "security" as const,
		severity: "high" as const,
		confidence: 0.9,
		path: "src/foo.ts",
		side: "after" as const,
		issueIdentity: "issue-1",
		location: { kind: "line" as const, line: 1, hunkIdentity: "hunk-1" },
		evidence: "evidence",
		impact: "impact",
		recommendation: "recommendation",
	};
	return modelReviewCandidateSchema.parse({ ...base, ...overrides });
}

const fingerprint = `review-finding:v1:${"a".repeat(64)}`;

const persistedFinding: PersistedFinding = {
	fingerprint,
	category: "security",
	path: "src/foo.ts",
	issueIdentity: "issue-1",
	finding: {} as AcceptedFinding,
	status: "open",
	providerCommentId: "provider-comment-1",
	providerContentHash: "hash-1",
	revision: "source-immutable-commit-1234567",
	updatedAt: "2026-01-01T00:00:00.000Z",
};

const linkedHumanComment = {
	id: "human-comment-1",
	authorId: "arn:aws:iam::123456789012:user/alice",
	body: "This is fixed",
	occurredAt: "2026-01-02T00:00:00.000Z",
	findingFingerprint: fingerprint,
	watermark: "2026-01-02T00:00:00.000Z#human-comment-1",
};

describe("ReviewEngine", () => {
	test("accepts a high-confidence finding on a trusted changed line", async () => {
		const model = new StubModel({ candidates: [finding()] });
		const engine = new ReviewEngine({ model });

		const result = await engine.review({
			snapshot,
			changedFiles: [changedFile],
			checks: [],
			repositoryConfig,
			humanComments: [],
			existingFindings: [],
		});

		expect(result.status).toBe("reviewed");
		if (result.status !== "reviewed") return;
		expect(result.accepted).toHaveLength(1);
		expect(result.usage.inputTokens).toBe(5);
	});

	test("drops a finding below the confidence threshold", async () => {
		const model = new StubModel({ candidates: [finding({ confidence: 0.5 })] });
		const engine = new ReviewEngine({ model });

		const result = await engine.review({
			snapshot,
			changedFiles: [changedFile],
			checks: [],
			repositoryConfig,
			humanComments: [],
			existingFindings: [],
		});

		expect(result.status).toBe("reviewed");
		if (result.status !== "reviewed") return;
		expect(result.accepted).toHaveLength(0);
	});

	test("drops a high-confidence finding on an untrusted line", async () => {
		const model = new StubModel({
			candidates: [
				finding({
					location: { kind: "line", line: 999, hunkIdentity: "hunk-1" },
				}),
			],
		});
		const engine = new ReviewEngine({ model });

		const result = await engine.review({
			snapshot,
			changedFiles: [changedFile],
			checks: [],
			repositoryConfig,
			humanComments: [],
			existingFindings: [],
		});

		expect(result.status).toBe("reviewed");
		if (result.status !== "reviewed") return;
		expect(result.accepted).toHaveLength(0);
	});

	test("accepts a dismissal candidate linked to a posted finding via a human comment", async () => {
		const dismissal: DismissalCandidate = {
			kind: "dismissal",
			findingFingerprint: fingerprint,
			linkedProviderCommentId: "provider-comment-1",
			eligibleHumanCommentId: "human-comment-1",
			rationale: "fixed in commit",
		};
		const model = new StubModel({ candidates: [dismissal] });
		const engine = new ReviewEngine({ model });

		const result = await engine.review({
			snapshot,
			changedFiles: [changedFile],
			checks: [],
			repositoryConfig,
			humanComments: [linkedHumanComment],
			existingFindings: [persistedFinding],
		});

		expect(result.status).toBe("reviewed");
		if (result.status !== "reviewed") return;
		expect(result.dismissals).toHaveLength(1);
	});

	test("drops a dismissal candidate when the human comment is not linked to a posted finding", async () => {
		const dismissal: DismissalCandidate = {
			kind: "dismissal",
			findingFingerprint: fingerprint,
			linkedProviderCommentId: "provider-comment-1",
			eligibleHumanCommentId: "unlinked-comment",
			rationale: "fixed",
		};
		const model = new StubModel({ candidates: [dismissal] });
		const engine = new ReviewEngine({ model });

		const result = await engine.review({
			snapshot,
			changedFiles: [changedFile],
			checks: [],
			repositoryConfig,
			humanComments: [linkedHumanComment],
			existingFindings: [persistedFinding],
		});

		expect(result.status).toBe("reviewed");
		if (result.status !== "reviewed") return;
		expect(result.dismissals).toHaveLength(0);
	});

	test("blocks on max-changed-files without calling the model", async () => {
		let called = false;
		const model: ReviewModel = {
			async review() {
				called = true;
				return {
					output: { candidates: [] },
					modelId: "stub",
					usage: { inputTokens: 0, outputTokens: 0 },
				};
			},
			async respond() {
				return {
					reply: "✅ Reviewed.",
					usage: { inputTokens: 0, outputTokens: 0 },
				};
			},
		};
		const engine = new ReviewEngine({ model });
		const tooMany = Array.from({ length: 101 }, () => changedFile);

		const result = await engine.review({
			snapshot,
			changedFiles: tooMany,
			checks: [],
			repositoryConfig,
			humanComments: [],
			existingFindings: [],
		});

		expect(result.status).toBe("blocked");
		if (result.status !== "blocked") return;
		expect(result.blockedLimit.reason).toBe("max-changed-files");
		expect(called).toBe(false);
	});

	test("blocks on max-diff-bytes", async () => {
		const engine = new ReviewEngine({
			model: new StubModel({ candidates: [] }),
		});
		const bigFile: ChangedFile = {
			path: "big.ts",
			changeType: "modified",
			hunks: [
				{
					identity: "h",
					header: "@@ -1,1 +1,1 @@",
					lines: [
						{
							side: "after",
							line: 1,
							content: "x".repeat(2_000_000),
							changed: true,
						},
					],
				},
			],
		};

		const result = await engine.review({
			snapshot,
			changedFiles: [bigFile],
			checks: [],
			repositoryConfig,
			humanComments: [],
			existingFindings: [],
		});

		expect(result.status).toBe("blocked");
		if (result.status !== "blocked") return;
		expect(result.blockedLimit.reason).toBe("max-diff-bytes");
	});

	test("blocks on max-model-tokens (estimated)", async () => {
		const engine = new ReviewEngine({
			model: new StubModel({ candidates: [] }),
		});
		// 100_000 tokens * 4 bytes/token = 400_000 bytes budget. Exceed it.
		const bigFile: ChangedFile = {
			path: "big.ts",
			changeType: "modified",
			hunks: [
				{
					identity: "h",
					header: "@@ -1,1 +1,1 @@",
					lines: [
						{
							side: "after",
							line: 1,
							content: "x".repeat(500_000),
							changed: true,
						},
					],
				},
			],
		};

		const result = await engine.review({
			snapshot,
			changedFiles: [bigFile],
			checks: [],
			repositoryConfig,
			humanComments: [],
			existingFindings: [],
		});

		expect(result.status).toBe("blocked");
		if (result.status !== "blocked") return;
		expect(result.blockedLimit.reason).toBe("max-model-tokens");
	});

	test("chunks many files into multiple model calls and merges candidates", async () => {
		let calls = 0;
		const model: ReviewModel = {
			async review(input: ReviewModelInput) {
				calls += 1;
				const candidates = input.changedFiles.map((f) =>
					finding({
						path: f.path,
						location: {
							kind: "line" as const,
							line: 1,
							hunkIdentity: "hunk-1",
						},
					}),
				);
				return {
					output: { candidates },
					modelId: "stub",
					usage: { inputTokens: 1, outputTokens: 1 },
				};
			},
			async respond() {
				return {
					reply: "✅ Reviewed.",
					usage: { inputTokens: 0, outputTokens: 0 },
				};
			},
		};
		const engine = new ReviewEngine({ model });
		// Each file is small; chunking is by token budget. Force multiple chunks by
		// setting a tiny maxModelTokens so the per-chunk budget splits the files.
		const tinyConfig = {
			...repositoryConfig,
			review: { ...repositoryConfig.review, maxModelTokens: 1_000 },
		};
		const files = Array.from({ length: 10 }, (_, i) => ({
			...changedFile,
			path: `src/file-${i}.ts`,
			hunks: [
				{
					identity: "hunk-1",
					header: "@@ -1,1 +1,1 @@",
					lines: [
						{
							side: "after" as const,
							line: 1,
							content: "x".repeat(300),
							changed: true,
						},
					],
				},
			],
		}));

		const result = await engine.review({
			snapshot,
			changedFiles: files,
			checks: [],
			repositoryConfig: tinyConfig,
			humanComments: [],
			existingFindings: [],
		});

		expect(result.status).toBe("reviewed");
		expect(calls).toBeGreaterThan(1);
		if (result.status !== "reviewed") return;
		expect(result.accepted.length).toBe(10);
	});

	test("respond() returns the model reply when the model succeeds", async () => {
		const model: ReviewModel = {
			async review() {
				return {
					output: { candidates: [] },
					modelId: "stub",
					usage: { inputTokens: 0, outputTokens: 0 },
				};
			},
			async respond() {
				return {
					reply: "No, eval is unsafe.",
					usage: { inputTokens: 3, outputTokens: 5 },
				};
			},
		};
		const engine = new ReviewEngine({ model });
		const { reply, usage } = await engine.respond(
			{
				snapshot,
				changedFiles: [changedFile],
				checks: [],
				humanComments: [],
				conversation: [],
			},
			[],
			{ inputTokens: 0, outputTokens: 0 },
		);
		expect(reply).toBe("No, eval is unsafe.");
		expect(usage).toEqual({ inputTokens: 3, outputTokens: 5 });
	});

	test("respond() falls back to a findings-count summary when the model throws", async () => {
		const model: ReviewModel = {
			async review() {
				return {
					output: { candidates: [] },
					modelId: "stub",
					usage: { inputTokens: 0, outputTokens: 0 },
				};
			},
			async respond() {
				throw new Error("bedrock unavailable");
			},
		};
		const engine = new ReviewEngine({ model });
		const accepted = [
			finding() as unknown as import("../../../src/reviewer/domain/finding").AcceptedFinding,
			finding({
				issueIdentity: "issue-2",
			}) as unknown as import("../../../src/reviewer/domain/finding").AcceptedFinding,
		];
		const { reply } = await engine.respond(
			{
				snapshot,
				changedFiles: [changedFile],
				checks: [],
				humanComments: [],
				conversation: [],
			},
			accepted,
			{ inputTokens: 0, outputTokens: 0 },
		);
		expect(reply).toContain("2 findings");
	});
});
