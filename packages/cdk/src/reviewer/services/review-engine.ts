import type { z } from "zod";
import type {
	AcceptedFinding,
	DismissalCandidate,
	modelReviewCandidateSchema,
} from "../domain/finding";
import {
	type DismissalPolicyContext,
	evaluateDismissalCandidate,
	evaluateFindingCandidate,
	type FindingPolicyContext,
	type TrustedChangedLine,
	type TrustedIntroducedHunk,
} from "../domain/review-policy";
import type { ReviewCycleSnapshot } from "../domain/review-request";
import type {
	CommentResponseInput,
	ReviewModel,
	ReviewModelInput,
	ReviewModelUsage,
} from "../ports/review-model";
import type {
	ChangedFile,
	ChangedLine,
	ReviewComment,
} from "../ports/source-control-provider";
import type {
	BlockedLimitDetail,
	PersistedFinding,
} from "../ports/state-store";

type ModelReviewCandidate = z.infer<typeof modelReviewCandidateSchema>;

export interface ReviewEngineInput {
	readonly snapshot: ReviewCycleSnapshot;
	readonly changedFiles: readonly ChangedFile[];
	readonly checks: ReviewModelInput["checks"];
	readonly repositoryConfig: ReviewModelInput["repositoryConfig"];
	readonly humanComments: readonly ReviewComment[];
	readonly existingFindings: readonly PersistedFinding[];
}

export type ReviewEngineResult =
	| {
			readonly status: "reviewed";
			readonly accepted: readonly AcceptedFinding[];
			readonly dismissals: readonly DismissalCandidate[];
			readonly usage: ReviewModelUsage;
	  }
	| {
			readonly status: "blocked";
			readonly blockedLimit: BlockedLimitDetail;
	  };

export interface ReviewEngineDeps {
	readonly model: ReviewModel;
}

const BYTES_PER_TOKEN = 4;

/**
 * Orchestrates the LLM review: hard-limit check → diff chunking → model calls
 * → policy filtering. Policy enforcement is post-model (the model only produces
 * candidates; the engine applies `evaluateFindingCandidate`/
 * `evaluateDismissalCandidate`). The engine never calls the provider — accepted
 * findings flow to the `FindingReconciler` port.
 */
export class ReviewEngine {
	readonly #model: ReviewModel;

	constructor(deps: ReviewEngineDeps) {
		this.#model = deps.model;
	}

	async review(input: ReviewEngineInput): Promise<ReviewEngineResult> {
		const limits = input.repositoryConfig.review;

		const blocked = checkHardLimits(input, limits);
		if (blocked !== undefined)
			return { status: "blocked", blockedLimit: blocked };

		const chunks = chunkFiles(input.changedFiles, limits.maxModelTokens);
		const allCandidates: ModelReviewCandidate[] = [];
		let inputTokens = 0;
		let outputTokens = 0;
		for (const chunk of chunks) {
			const result = await this.#model.review({
				snapshot: input.snapshot,
				changedFiles: chunk,
				checks: input.checks,
				repositoryConfig: input.repositoryConfig,
				humanComments: input.humanComments,
			});
			allCandidates.push(...result.output.candidates);
			inputTokens += result.usage.inputTokens;
			outputTokens += result.usage.outputTokens;
		}

		const findingContext = buildFindingPolicyContext(input.changedFiles);
		const dismissalContext = buildDismissalPolicyContext(
			input.humanComments,
			input.existingFindings,
		);

		const accepted: AcceptedFinding[] = [];
		const dismissals: DismissalCandidate[] = [];
		for (const candidate of allCandidates) {
			if (candidate.kind === "finding") {
				const eval_ = evaluateFindingCandidate(candidate, findingContext);
				if (eval_.accepted) accepted.push(eval_.value);
			} else {
				const eval_ = evaluateDismissalCandidate(candidate, dismissalContext);
				if (eval_.accepted) dismissals.push(eval_.value);
			}
		}

		return {
			status: "reviewed",
			accepted,
			dismissals,
			usage: { inputTokens, outputTokens },
		};
	}

	/**
	 * Generate a conversational reply to the human comment(s), using the diff,
	 * check results, and accepted findings as context. Falls back to a generic
	 * summary if the model call fails so the user still gets a response.
	 */
	async respond(
		input: {
			readonly snapshot: ReviewCycleSnapshot;
			readonly changedFiles: readonly ChangedFile[];
			readonly checks: ReviewModelInput["checks"];
			readonly humanComments: readonly ReviewComment[];
			readonly conversation: CommentResponseInput["conversation"];
		},
		findings: readonly AcceptedFinding[],
		reviewUsage: ReviewModelUsage,
	): Promise<{ reply: string; usage: ReviewModelUsage }> {
		const findingContext: CommentResponseInput["findings"] = findings.map(
			(f) => ({
				severity: f.severity,
				category: f.category,
				path: f.path,
				line: f.location.kind === "line" ? f.location.line : 0,
				evidence: f.evidence,
				recommendation: f.recommendation,
			}),
		);
		try {
			const result = await this.#model.respond({
				snapshot: input.snapshot,
				changedFiles: input.changedFiles,
				checks: input.checks,
				humanComments: input.humanComments,
				conversation: input.conversation,
				findings: findingContext,
			});
			return { reply: result.reply, usage: result.usage };
		} catch {
			const count = findings.length;
			const summary =
				count > 0
					? `✅ Reviewed — ${count} finding${count === 1 ? "" : "s"}.`
					: "✅ Reviewed — no new findings.";
			return { reply: summary, usage: reviewUsage };
		}
	}
}

function checkHardLimits(
	input: ReviewEngineInput,
	limits: ReviewEngineInput["repositoryConfig"]["review"],
): BlockedLimitDetail | undefined {
	if (input.changedFiles.length > limits.maxChangedFiles) {
		return {
			reason: "max-changed-files",
			observed: input.changedFiles.length,
			maximum: limits.maxChangedFiles,
		};
	}
	const diffBytes = totalDiffBytes(input.changedFiles);
	if (diffBytes > limits.maxDiffBytes) {
		return {
			reason: "max-diff-bytes",
			observed: diffBytes,
			maximum: limits.maxDiffBytes,
		};
	}
	const estimatedTokens = Math.ceil(diffBytes / BYTES_PER_TOKEN);
	if (estimatedTokens > limits.maxModelTokens) {
		return {
			reason: "max-model-tokens",
			observed: estimatedTokens,
			maximum: limits.maxModelTokens,
		};
	}
	return undefined;
}

function totalDiffBytes(files: readonly ChangedFile[]): number {
	let total = 0;
	for (const file of files) {
		for (const hunk of file.hunks) {
			for (const line of hunk.lines) {
				total += line.content.length;
			}
		}
	}
	return total;
}

/**
 * Split files into chunks under the per-chunk token budget. Each chunk keeps
 * room for the system prompt + response (half the budget reserved for the
 * response). Files are sorted by path for deterministic chunking.
 */
function chunkFiles(
	files: readonly ChangedFile[],
	maxModelTokens: number,
): readonly ChangedFile[][] {
	const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
	const perChunkBytes = Math.max(
		1,
		Math.floor((maxModelTokens / 2) * BYTES_PER_TOKEN),
	);
	const chunks: ChangedFile[][] = [];
	let current: ChangedFile[] = [];
	let currentBytes = 0;
	for (const file of sorted) {
		const fileBytes = file.hunks.reduce(
			(sum, hunk) =>
				sum + hunk.lines.reduce((s, line) => s + line.content.length, 0),
			0,
		);
		if (currentBytes + fileBytes > perChunkBytes && current.length > 0) {
			chunks.push(current);
			current = [];
			currentBytes = 0;
		}
		current.push(file);
		currentBytes += fileBytes;
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}

function buildFindingPolicyContext(
	files: readonly ChangedFile[],
): FindingPolicyContext {
	const changedLines: TrustedChangedLine[] = [];
	const introducedHunks: TrustedIntroducedHunk[] = [];
	for (const file of files) {
		for (const hunk of file.hunks) {
			for (const line of hunk.lines) {
				if (line.changed) {
					changedLines.push({
						path: file.path,
						side: line.side,
						line: line.line,
						hunkIdentity: hunk.identity,
					});
				}
			}
			// A hunk is "introduced" if any changed line exists on the "after" side.
			if (
				hunk.lines.some(
					(line: ChangedLine) => line.changed && line.side === "after",
				)
			) {
				introducedHunks.push({
					path: file.path,
					side: "after",
					hunkIdentity: hunk.identity,
				});
			}
		}
	}
	return { changedLines, introducedHunks };
}

function buildDismissalPolicyContext(
	comments: readonly ReviewComment[],
	findings: readonly PersistedFinding[],
): DismissalPolicyContext {
	const byFingerprint = new Map(findings.map((f) => [f.fingerprint, f]));
	const map = new Map<
		string,
		{ findingFingerprint: string; linkedProviderCommentId: string }
	>();
	for (const comment of comments) {
		if (comment.findingFingerprint === undefined) continue;
		const posted = byFingerprint.get(comment.findingFingerprint);
		if (posted?.providerCommentId === undefined) continue;
		map.set(comment.id, {
			findingFingerprint: comment.findingFingerprint,
			linkedProviderCommentId: posted.providerCommentId,
		});
	}
	return { linkedDismissalByHumanCommentId: map };
}

// Re-export the candidate type for callers that need to thread it.
export type { ModelReviewCandidate };
