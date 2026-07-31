import { createHash } from "node:crypto";
import type {
	AcceptedFinding,
	DismissalCandidate,
	FindingFingerprint,
} from "../domain/finding";
import { createFindingFingerprint } from "../domain/fingerprint";
import type { RequestKey, ReviewCycleSnapshot } from "../domain/review-request";
import type {
	ChangedFile,
	SourceControlProvider,
} from "../ports/source-control-provider";
import type {
	FindingWriteResult,
	PersistedFinding,
	ReviewStateStore,
} from "../ports/state-store";

type ReviewCandidate = AcceptedFinding | DismissalCandidate;

export interface ReconcilerInput {
	readonly request: RequestKey;
	readonly generation: number;
	readonly candidates: readonly ReviewCandidate[];
	readonly snapshot: ReviewCycleSnapshot;
	readonly existingFindings: readonly PersistedFinding[];
	readonly changedFiles: readonly ChangedFile[];
}

export interface FindingReconciler {
	apply(input: ReconcilerInput): Promise<void>;
}

/**
 * No-op reconciler. Posts no comments and mutates no state. Used by tests that
 * exercise the workflow without a real provider.
 */
export class NoopFindingReconciler implements FindingReconciler {
	async apply(_input: ReconcilerInput): Promise<void> {
		/* no-op */
	}
}

export interface IdempotentFindingReconcilerDeps {
	readonly store: ReviewStateStore;
	readonly provider: SourceControlProvider;
	readonly clock: () => Date;
}

const NEARBY_CODE_RADIUS = 3;

/**
 * Posts/resolves provider comments idempotently via the reserve → provider-write
 * → confirm sequence. Runs inside the workflow's durable `run-review` step, so
 * replay/retry is handled by the durable SDK; the reserve/confirm idempotency
 * makes the reconciler safe to re-execute.
 */
export class IdempotentFindingReconciler implements FindingReconciler {
	readonly #store: ReviewStateStore;
	readonly #provider: SourceControlProvider;
	readonly #clock: () => Date;

	constructor(deps: IdempotentFindingReconcilerDeps) {
		this.#store = deps.store;
		this.#provider = deps.provider;
		this.#clock = deps.clock;
	}

	async apply(input: ReconcilerInput): Promise<void> {
		for (const candidate of input.candidates) {
			if (candidate.kind === "finding") {
				await this.#postFinding(input, candidate);
			} else {
				await this.#resolveFinding(input, candidate);
			}
		}
	}

	async #postFinding(
		input: ReconcilerInput,
		finding: AcceptedFinding,
	): Promise<void> {
		const fingerprint = createFindingFingerprint({
			provider: input.request.provider,
			repository: input.request.repository,
			requestId: input.request.requestId,
			category: finding.category,
			path: finding.path,
			nearbyCode: nearbyCodeFor(finding, input.changedFiles),
			issueIdentity: finding.issueIdentity,
			...(finding.location.kind === "line"
				? { line: finding.location.line }
				: {}),
		});
		const idempotencyToken = idempotencyTokenFor(input.request, fingerprint);
		const reservation = await this.#store.reserveFindingWrite({
			operation: "post",
			request: input.request,
			generation: input.generation,
			finding,
			fingerprint,
			idempotencyToken,
		});
		if (!reservation.reserved) return;

		let providerCommentId: string;
		let providerContentHash: string;
		try {
			const posted = await this.#provider.postInlineFinding(
				input.request,
				finding,
				{
					sourceRevision: input.snapshot.sourceRevision,
					destinationRevision: input.snapshot.destinationRevision,
				},
			);
			providerCommentId = posted.id;
			providerContentHash = posted.contentHash;
		} catch (error) {
			// Uncertain-retry recovery: check whether the provider already has a
			// comment for this finding (identified by its issue-identity watermark).
			const existing = await this.#findExistingProviderComment(
				input.request,
				finding,
			);
			if (existing !== undefined) {
				providerCommentId = existing;
				providerContentHash = "";
			} else {
				throw error;
			}
		}

		const result: FindingWriteResult = {
			request: input.request,
			generation: input.generation,
			reservationId: reservation.reservationId,
			fingerprint,
			providerCommentId,
			providerContentHash,
			completedAt: this.#clock().toISOString(),
		};
		await this.#store.confirmFindingWrite(result);
	}

	async #resolveFinding(
		input: ReconcilerInput,
		dismissal: DismissalCandidate,
	): Promise<void> {
		const idempotencyToken = idempotencyTokenFor(
			input.request,
			dismissal.findingFingerprint,
		);
		const reservation = await this.#store.reserveFindingWrite({
			operation: "resolve",
			request: input.request,
			generation: input.generation,
			fingerprint: dismissal.findingFingerprint,
			providerCommentId: dismissal.linkedProviderCommentId,
			idempotencyToken,
			resolution: "dismissed",
			triggeringHumanCommentId: dismissal.eligibleHumanCommentId,
		});
		if (!reservation.reserved) return;

		await this.#provider.markCommentResolved(
			input.request,
			{
				id: dismissal.linkedProviderCommentId,
				findingFingerprint: dismissal.findingFingerprint,
				contentHash: "",
			},
			{
				type: "dismissed",
				eligibleHumanCommentId: dismissal.eligibleHumanCommentId,
				rationale: dismissal.rationale,
			},
			{
				sourceRevision: input.snapshot.sourceRevision,
				destinationRevision: input.snapshot.destinationRevision,
			},
		);

		await this.#store.confirmFindingWrite({
			request: input.request,
			generation: input.generation,
			reservationId: reservation.reservationId,
			fingerprint: dismissal.findingFingerprint,
			providerCommentId: dismissal.linkedProviderCommentId,
			providerContentHash: "",
			completedAt: this.#clock().toISOString(),
		});
	}

	async #findExistingProviderComment(
		request: RequestKey,
		finding: AcceptedFinding,
	): Promise<string | undefined> {
		const comments = await this.#provider.listComments(request);
		const watermark = `<!-- pawl:${finding.issueIdentity} -->`;
		const match = comments.find((comment) => comment.body.includes(watermark));
		return match?.id;
	}
}

/** Derive a bounded ±N-line code slice around the finding's location. */
function nearbyCodeFor(
	finding: AcceptedFinding,
	files: readonly ChangedFile[],
): readonly string[] {
	const file = files.find((f) => f.path === finding.path);
	if (file === undefined) return [];
	if (finding.location.kind !== "line") {
		const hunk = file.hunks.find(
			(h) => h.identity === finding.location.hunkIdentity,
		);
		return hunk ? hunk.lines.map((line) => line.content) : [];
	}
	const hunk = file.hunks.find(
		(h) => h.identity === finding.location.hunkIdentity,
	);
	if (hunk === undefined) return [];
	const line = finding.location.line;
	const matching = hunk.lines.find(
		(l) => l.side === finding.side && l.line === line,
	);
	if (matching === undefined) return [];
	const idx = hunk.lines.indexOf(matching);
	const start = Math.max(0, idx - NEARBY_CODE_RADIUS);
	const end = Math.min(hunk.lines.length, idx + NEARBY_CODE_RADIUS + 1);
	return hunk.lines.slice(start, end).map((l) => l.content);
}

function idempotencyTokenFor(
	request: RequestKey,
	fingerprint: FindingFingerprint,
): string {
	return createHash("sha256")
		.update(JSON.stringify({ request, fingerprint }), "utf8")
		.digest("hex");
}
