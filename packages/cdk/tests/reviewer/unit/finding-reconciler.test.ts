import { describe, expect, test } from "bun:test";
import type {
	AcceptedFinding,
	DismissalCandidate,
} from "../../../src/reviewer/domain/finding";
import type {
	RequestKey,
	ReviewCycleSnapshot,
} from "../../../src/reviewer/domain/review-request";
import type {
	ChangedFile,
	PostedComment,
	Resolution,
	ReviewComment,
	SourceControlProvider,
} from "../../../src/reviewer/ports/source-control-provider";
import type { PersistedFinding } from "../../../src/reviewer/ports/state-store";
import {
	IdempotentFindingReconciler,
	type ReconcilerInput,
} from "../../../src/reviewer/services/finding-reconciler";
import { InMemoryStateStore } from "../fakes/in-memory-state-store";

const request: RequestKey = {
	provider: "codecommit",
	repository: "repo",
	requestId: "7",
};

const snapshot: ReviewCycleSnapshot = {
	request,
	generation: 1,
	cycle: 1,
	sourceRevision: "source-immutable-commit-1234567",
	destinationRevision: "destination-immutable-commit-1234567",
	configVersion: 1,
	eventWatermark: "source-immutable-commit-1234567",
	startedAt: "2026-01-01T00:00:00.000Z",
};

const changedFile: ChangedFile = {
	path: "src/foo.ts",
	changeType: "modified",
	hunks: [
		{
			identity: "hunk-1",
			header: "@@ -1,3 +1,3 @@",
			lines: [
				{ side: "after", line: 1, content: "line one", changed: true },
				{ side: "after", line: 2, content: "line two", changed: true },
				{ side: "after", line: 3, content: "line three", changed: true },
			],
		},
	],
};

function finding(overrides: Partial<AcceptedFinding> = {}): AcceptedFinding {
	return {
		kind: "finding",
		category: "security",
		severity: "high",
		confidence: 0.9,
		path: "src/foo.ts",
		side: "after",
		issueIdentity: "issue-1",
		location: { kind: "line", line: 2, hunkIdentity: "hunk-1" },
		evidence: "evidence",
		impact: "impact",
		recommendation: "recommendation",
		...overrides,
	} as AcceptedFinding;
}

const fixedClock = (): Date => new Date("2026-01-01T00:00:00.000Z");

interface FakeProviderCalls {
	postInlineFinding: Array<{ ref: RequestKey; finding: AcceptedFinding }>;
	markCommentResolved: Array<{
		ref: RequestKey;
		comment: PostedComment;
		resolution: Resolution;
	}>;
	listComments: number;
}

/** Fake provider that records calls and can throw on the first postInlineFinding. */
class FakeProvider implements SourceControlProvider {
	readonly #calls: FakeProviderCalls = {
		postInlineFinding: [],
		markCommentResolved: [],
		listComments: 0,
	};
	readonly #existingComments: ReviewComment[] = [];
	#throwOnNextPost = false;
	#commentCounter = 0;

	constructor(
		options: {
			throwOnNextPost?: boolean;
			existingComments?: ReviewComment[];
		} = {},
	) {
		this.#throwOnNextPost = options.throwOnNextPost ?? false;
		if (options.existingComments)
			this.#existingComments.push(...options.existingComments);
	}

	get calls(): FakeProviderCalls {
		return this.#calls;
	}

	async getRequest(): Promise<never> {
		throw new Error("not used");
	}
	async getDiff(): Promise<readonly ChangedFile[]> {
		return [];
	}
	async getFile(): Promise<string | undefined> {
		return undefined;
	}
	async listComments(): Promise<readonly ReviewComment[]> {
		this.#calls.listComments += 1;
		return [...this.#existingComments];
	}
	async postInlineFinding(
		ref: RequestKey,
		finding: AcceptedFinding,
	): Promise<PostedComment> {
		this.#calls.postInlineFinding.push({ ref, finding });
		if (this.#throwOnNextPost) {
			this.#throwOnNextPost = false;
			throw new Error("network timeout");
		}
		this.#commentCounter += 1;
		return {
			id: `provider-comment-${this.#commentCounter}`,
			findingFingerprint: `review-finding:v1:${"a".repeat(64)}`,
			contentHash: `hash-${this.#commentCounter}`,
		};
	}
	async postSummaryFinding(): Promise<PostedComment> {
		throw new Error("not used");
	}
	async postStatusComment(): Promise<PostedComment> {
		throw new Error("not used");
	}
	async appendStatusUpdate(): Promise<void> {}
	async reactToComment(): Promise<void> {}
	async replyToComment(): Promise<PostedComment> {
		throw new Error("not used");
	}
	async markCommentResolved(
		ref: RequestKey,
		comment: PostedComment,
		resolution: Resolution,
	): Promise<void> {
		this.#calls.markCommentResolved.push({ ref, comment, resolution });
	}
}

function baseInput(overrides: Partial<ReconcilerInput> = {}): ReconcilerInput {
	return {
		request,
		generation: 1,
		candidates: [],
		snapshot,
		existingFindings: [],
		changedFiles: [changedFile],
		...overrides,
	};
}

/** Seed the store so generation 1 is RUNNING (reserveFindingWrite requires it). */
async function seedRunning(store: InMemoryStateStore): Promise<void> {
	await store.appendEvent({
		id: "event-1",
		type: "request-opened",
		occurredAt: "2026-01-01T00:00:00.000Z",
		request,
	});
	await store.recordExecution(request, 1, "arn:execution-1");
}

describe("IdempotentFindingReconciler", () => {
	test("posts a new accepted finding and confirms it in state", async () => {
		const store = new InMemoryStateStore({ clock: fixedClock });
		await seedRunning(store);
		const provider = new FakeProvider();
		const reconciler = new IdempotentFindingReconciler({
			store,
			provider,
			clock: fixedClock,
		});

		await reconciler.apply(baseInput({ candidates: [finding()] }));

		expect(provider.calls.postInlineFinding).toHaveLength(1);
		const findings = await store.listFindings(request);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.status).toBe("open");
		expect(findings[0]?.providerCommentId).toBe("provider-comment-1");
	});

	test("suppresses a duplicate finding fingerprint (already-confirmed)", async () => {
		const store = new InMemoryStateStore({ clock: fixedClock });
		await seedRunning(store);
		const provider = new FakeProvider();
		const reconciler = new IdempotentFindingReconciler({
			store,
			provider,
			clock: fixedClock,
		});

		// First cycle: post the finding.
		await reconciler.apply(baseInput({ candidates: [finding()] }));
		// Second cycle: same finding presented again.
		await reconciler.apply(baseInput({ candidates: [finding()] }));

		expect(provider.calls.postInlineFinding).toHaveLength(1);
		const findings = await store.listFindings(request);
		expect(findings).toHaveLength(1);
	});

	test("resolves an open finding via a linked dismissal candidate", async () => {
		const store = new InMemoryStateStore({ clock: fixedClock });
		await seedRunning(store);
		const provider = new FakeProvider();
		const reconciler = new IdempotentFindingReconciler({
			store,
			provider,
			clock: fixedClock,
		});

		// First post the finding.
		await reconciler.apply(baseInput({ candidates: [finding()] }));
		const posted = await store.listFindings(request);
		const postedFinding = posted[0];
		if (postedFinding === undefined) {
			throw new Error("Expected the finding to be posted");
		}
		const fingerprint = postedFinding.fingerprint;
		const providerCommentId = postedFinding.providerCommentId;
		if (providerCommentId === undefined) {
			throw new Error("Expected the posted finding to include a comment ID");
		}

		// Then dismiss it.
		const dismissal: DismissalCandidate = {
			kind: "dismissal",
			findingFingerprint: fingerprint,
			linkedProviderCommentId: providerCommentId,
			eligibleHumanCommentId: "human-1",
			rationale: "not applicable",
		};
		await reconciler.apply(
			baseInput({
				candidates: [dismissal],
				existingFindings: posted as PersistedFinding[],
			}),
		);

		expect(provider.calls.markCommentResolved).toHaveLength(1);
		const findings = await store.listFindings(request);
		expect(findings[0]?.status).toBe("dismissed");
	});

	test("leaves carry-forward open findings untouched (no auto-resolve)", async () => {
		const store = new InMemoryStateStore({ clock: fixedClock });
		await seedRunning(store);
		const provider = new FakeProvider();
		const reconciler = new IdempotentFindingReconciler({
			store,
			provider,
			clock: fixedClock,
		});

		// Post a finding.
		await reconciler.apply(baseInput({ candidates: [finding()] }));
		const posted = await store.listFindings(request);

		// Next cycle: no candidates (the finding is not re-reported). The existing
		// open finding must remain open — no resolve, no post.
		await reconciler.apply(
			baseInput({
				candidates: [],
				existingFindings: posted as PersistedFinding[],
			}),
		);

		expect(provider.calls.markCommentResolved).toHaveLength(0);
		expect(provider.calls.postInlineFinding).toHaveLength(1);
		const findings = await store.listFindings(request);
		expect(findings[0]?.status).toBe("open");
	});

	test("skips when the reservation is stale-generation", async () => {
		const store = new InMemoryStateStore({ clock: fixedClock });
		// Do NOT seed generation 1 → reserveFindingWrite returns stale-generation.
		const provider = new FakeProvider();
		const reconciler = new IdempotentFindingReconciler({
			store,
			provider,
			clock: fixedClock,
		});

		await reconciler.apply(baseInput({ candidates: [finding()] }));

		expect(provider.calls.postInlineFinding).toHaveLength(0);
	});

	test("recovers from an uncertain provider error by reading existing comments", async () => {
		const store = new InMemoryStateStore({ clock: fixedClock });
		await seedRunning(store);
		// A pre-existing provider comment carrying the finding's issue-identity watermark.
		const existingComment: ReviewComment = {
			id: "provider-comment-existing",
			authorId: "arn:reviewer",
			body: `<!-- pawl:issue-1 -->\n**security high**\nevidence`,
			occurredAt: "2026-01-01T00:00:00.000Z",
			watermark: "2026-01-01T00:00:00.000Z#provider-comment-existing",
		};
		const provider = new FakeProvider({
			throwOnNextPost: true,
			existingComments: [existingComment],
		});
		const reconciler = new IdempotentFindingReconciler({
			store,
			provider,
			clock: fixedClock,
		});

		await reconciler.apply(baseInput({ candidates: [finding()] }));

		// Only one post attempt (which threw); then recovery via listComments.
		expect(provider.calls.postInlineFinding).toHaveLength(1);
		expect(provider.calls.listComments).toBeGreaterThanOrEqual(1);
		const findings = await store.listFindings(request);
		expect(findings[0]?.status).toBe("open");
		expect(findings[0]?.providerCommentId).toBe("provider-comment-existing");
	});

	test("re-throws when the provider errors and no existing comment matches", async () => {
		const store = new InMemoryStateStore({ clock: fixedClock });
		await seedRunning(store);
		const provider = new FakeProvider({ throwOnNextPost: true }); // no existing comments
		const reconciler = new IdempotentFindingReconciler({
			store,
			provider,
			clock: fixedClock,
		});

		await expect(
			reconciler.apply(baseInput({ candidates: [finding()] })),
		).rejects.toThrow("network timeout");
		// The pending reservation remains; the durable step will retry.
		const findings = await store.listFindings(request);
		expect(findings[0]?.status).toBe("pending");
	});
});
