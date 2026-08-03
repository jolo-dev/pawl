import type { StartReviewPipelineExecution } from "./adapters/codepipeline-transport";
import { isDynamoDbConditionalCheckFailedError } from "./adapters/dynamodb-errors";
import type { RequestKey, ReviewRequest } from "./domain/review-request";
import {
	authoritativeRevisionRecordSchema,
	type PipelineJobRecord,
} from "./pipeline/pipeline-coordination-store";
import type {
	PipelineCoordinationStore,
	PipelineExecutionMapping,
} from "./ports/pipeline-coordination-store";
import type { PipelineDispatchIntent } from "./ports/state-store";

/**
 * Runtime-only module for pipeline review coordination.
 *
 * Provides interfaces and functions for starting pipeline executions on PR
 * events, mapping execution IDs back to PRs, and posting CI results as PR
 * comments. This module is imported by Lambda handlers, not CDK construct code.
 *
 * When `pipelineTransport` is undefined (event-only review mode), all pipeline
 * functions are no-ops.
 */

/** Summary of a pipeline execution retrieved from CodePipeline. */
export interface PipelineExecutionSummary {
	readonly status:
		| "Succeeded"
		| "Failed"
		| "Stopped"
		| "InProgress"
		| "Stopping"
		| "Superseded"
		| string;
	readonly stageSummaries: ReadonlyArray<{
		readonly stageName: string;
		readonly actionStates: ReadonlyArray<{
			readonly actionName: string;
			readonly status: string;
		}>;
	}>;
}

/** Runtime transport for starting and monitoring pipeline executions. */
export interface PipelineTransport {
	startExecution(params: {
		readonly pipelineName: string;
		readonly sourceRevision?: string;
	}): Promise<{ readonly executionId: string }>;
	getExecution(params: {
		readonly pipelineName: string;
		readonly executionId: string;
	}): Promise<PipelineExecutionSummary>;
}

/** Runtime store for execution-to-PR mapping. */
export interface PipelineMappingStore {
	putMapping(params: {
		readonly executionId: string;
		readonly pullRequestId: string;
		readonly repositoryName: string;
		readonly sourceCommitId: string;
		readonly destinationCommitId: string;
	}): Promise<void>;
	getMapping(executionId: string): Promise<
		| {
				readonly pullRequestId: string;
				readonly repositoryName: string;
				readonly sourceCommitId: string;
				readonly destinationCommitId: string;
		  }
		| undefined
	>;
}

/** Runtime comment poster for PR comments. */
export interface PrCommentPoster {
	postComment(params: {
		readonly repositoryName: string;
		readonly pullRequestId: string;
		readonly content: string;
		readonly idempotencyToken?: string;
	}): Promise<void>;
}

/** Configuration for pipeline dispatch. */
export interface PipelineDispatchConfig {
	readonly pipelineTransport?: PipelineTransport;
	readonly pipelineName?: string;
	readonly mappingStore: PipelineMappingStore;
	readonly commentPoster: PrCommentPoster;
}

/** Parameters for starting a pipeline execution for a PR. */
export interface StartPipelineForPrParams {
	readonly pullRequestId: string;
	readonly repositoryName: string;
	readonly sourceCommitId: string;
	readonly destinationCommitId: string;
}

/**
 * Start a pipeline execution for a PR and persist the execution-to-PR mapping.
 *
 * No-op when `pipelineTransport` is undefined (event-only review mode).
 * Uses `sourceRevision` to ensure the pipeline builds the exact PR commit.
 */
export async function startPipelineForPr(
	params: StartPipelineForPrParams,
	config: PipelineDispatchConfig,
): Promise<void> {
	if (
		config.pipelineTransport === undefined ||
		config.pipelineName === undefined
	) {
		return;
	}
	const { executionId } = await config.pipelineTransport.startExecution({
		pipelineName: config.pipelineName,
		sourceRevision: params.sourceCommitId,
	});
	await config.mappingStore.putMapping({
		executionId,
		pullRequestId: params.pullRequestId,
		repositoryName: params.repositoryName,
		sourceCommitId: params.sourceCommitId,
		destinationCommitId: params.destinationCommitId,
	});
}

/** Parameters for handling a pipeline execution state change event. */
export interface PipelineExecutionEventParams {
	readonly executionId: string;
	readonly pipelineName: string;
}

/**
 * Handle a CodePipeline Execution State Change event.
 *
 * Resolves the execution-to-PR mapping from the store, fetches execution
 * details, formats a CI summary, and posts it as a PR comment. Ignores events
 * without a mapping (manual triggers, non-PR pushes, expired mappings).
 */
export async function handlePipelineExecutionEvent(
	event: PipelineExecutionEventParams,
	config: PipelineDispatchConfig,
): Promise<void> {
	const mapping = await config.mappingStore.getMapping(event.executionId);
	if (mapping === undefined) {
		return;
	}
	if (
		config.pipelineTransport === undefined ||
		config.pipelineName === undefined
	) {
		return;
	}
	const summary = await config.pipelineTransport.getExecution({
		pipelineName: event.pipelineName,
		executionId: event.executionId,
	});
	if (summary.status === "InProgress" || summary.status === "Stopping") {
		return;
	}
	const content = formatCiSummary(summary);
	await config.commentPoster.postComment({
		repositoryName: mapping.repositoryName,
		pullRequestId: mapping.pullRequestId,
		content,
		idempotencyToken: `pipeline-${event.executionId}`,
	});
}

/** Format a pipeline execution summary as a PR comment. */
export function formatCiSummary(summary: PipelineExecutionSummary): string {
	const statusEmoji =
		summary.status === "Succeeded"
			? "✅"
			: summary.status === "Superseded"
				? "⏭️"
				: "❌";
	const lines: string[] = [
		`${statusEmoji} **CI Pipeline: ${summary.status}**`,
		"",
		"| Stage | Status |",
		"|-------|--------|",
	];
	for (const stage of summary.stageSummaries) {
		const actionStatuses = stage.actionStates
			.map((a) => `${a.actionName}: ${a.status}`)
			.join(", ");
		lines.push(`| ${stage.stageName} | ${actionStatuses} |`);
	}
	return lines.join("\n");
}

export interface ExactPipelineTransport {
	startExecution(
		input: StartReviewPipelineExecution,
	): Promise<{ readonly executionId: string }>;
}

export interface PipelineReconcilerInvoker {
	invoke(jobId?: string): Promise<void>;
}

export interface PrPipelineDispatcher {
	startReviewPipeline(input: {
		readonly snapshot: ReviewRequest;
		readonly generation: number;
		readonly observedAt: string;
		readonly eventId: string;
		readonly refetchSnapshot: () => Promise<ReviewRequest>;
		readonly dispatchIntent?: PipelineDispatchIntent;
	}): Promise<void>;
	completeTerminalRequest(input: {
		readonly request: RequestKey;
		readonly generation: number;
		readonly status: "merged" | "closed";
	}): Promise<void>;
}

const MAX_AUTHORITATIVE_REVISION_ATTEMPTS = 4;

/** Retryable failure raised when concurrent revision arbitration cannot settle. */
export class AuthoritativeRevisionArbitrationExhaustedError extends Error {
	readonly retryable = true;

	constructor() {
		super("authoritative revision arbitration did not settle");
		this.name = "AuthoritativeRevisionArbitrationExhaustedError";
	}
}

export class PipelineReviewDispatcher implements PrPipelineDispatcher {
	readonly #pipelineName: string;
	readonly #sourceActionName: string;
	readonly #transport: ExactPipelineTransport;
	readonly #store: PipelineCoordinationStore;
	readonly #reconciler: PipelineReconcilerInvoker;
	readonly #clock: () => Date;

	constructor(options: {
		readonly pipelineName: string;
		readonly sourceActionName?: string;
		readonly transport: ExactPipelineTransport;
		readonly store: PipelineCoordinationStore;
		readonly reconciler: PipelineReconcilerInvoker;
		readonly clock?: () => Date;
	}) {
		this.#pipelineName = options.pipelineName;
		this.#sourceActionName = options.sourceActionName ?? "Source";
		this.#transport = options.transport;
		this.#store = options.store;
		this.#reconciler = options.reconciler;
		this.#clock = options.clock ?? (() => new Date());
	}

	async startReviewPipeline(input: {
		readonly snapshot: ReviewRequest;
		readonly generation: number;
		readonly observedAt: string;
		readonly eventId: string;
		readonly refetchSnapshot: () => Promise<ReviewRequest>;
		readonly dispatchIntent?: PipelineDispatchIntent;
	}): Promise<void> {
		if (input.snapshot.status !== "open") return;
		const pinned = input.dispatchIntent;
		let workingSnapshot =
			pinned === undefined
				? input.snapshot
				: {
						...input.snapshot,
						key: pinned.request,
						sourceRevision: pinned.sourceRevision,
						destinationRevision: pinned.destinationRevision,
					};
		let proposalObservedAt = input.observedAt;
		let authorized = pinned !== undefined;
		if (pinned !== undefined) {
			const winner = await this.#store.recordAuthoritativeRevision({
				request: pinned.request,
				generation: pinned.generation,
				sourceRevision: pinned.sourceRevision,
				observedAt: pinned.observedAt,
				eventId: pinned.eventId,
			});
			if (winner.sourceRevision !== pinned.sourceRevision) {
				throw new AuthoritativeRevisionArbitrationExhaustedError();
			}
		}
		for (
			let attempt = 0;
			pinned === undefined && attempt < MAX_AUTHORITATIVE_REVISION_ATTEMPTS;
			attempt += 1
		) {
			const candidate = authoritativeRevisionRecordSchema.parse({
				request: workingSnapshot.key,
				generation: input.generation,
				sourceRevision: workingSnapshot.sourceRevision,
				observedAt: proposalObservedAt,
				eventId: input.eventId,
			});
			const winner = await this.#store.recordAuthoritativeRevision(candidate);
			if (winner.sourceRevision === candidate.sourceRevision) {
				authorized = true;
				break;
			}
			const winnerTime = Date.parse(winner.observedAt);
			const candidateTime = Date.parse(candidate.observedAt);
			if (winnerTime > candidateTime) return;
			if (winnerTime !== candidateTime) continue;

			const authoritativeSnapshot = await input.refetchSnapshot();
			if (authoritativeSnapshot.status !== "open") return;
			if (authoritativeSnapshot.sourceRevision === winner.sourceRevision)
				return;
			workingSnapshot = authoritativeSnapshot;
			proposalObservedAt = new Date(winnerTime + 1).toISOString();
		}
		if (!authorized) {
			throw new AuthoritativeRevisionArbitrationExhaustedError();
		}
		await this.#markOlderJobsSuperseded(
			workingSnapshot.key,
			input.generation,
			workingSnapshot.sourceRevision,
		);
		const { executionId } = await this.#transport.startExecution({
			pipelineName: this.#pipelineName,
			sourceActionName: this.#sourceActionName,
			sourceRevision: workingSnapshot.sourceRevision,
			destinationRevision: workingSnapshot.destinationRevision,
			request: workingSnapshot.key,
			generation: input.generation,
		});
		const mapping: PipelineExecutionMapping = {
			executionId,
			pipelineName: this.#pipelineName,
			request: workingSnapshot.key,
			generation: input.generation,
			sourceRevision: workingSnapshot.sourceRevision,
			destinationRevision: workingSnapshot.destinationRevision,
			createdAt: this.#clock().toISOString(),
		};
		await this.#store.putExecutionMapping(mapping);
		await this.#reconciler.invoke();
	}

	async completeTerminalRequest(input: {
		readonly request: RequestKey;
		readonly generation: number;
		readonly status: "merged" | "closed";
	}): Promise<void> {
		const terminalState = await this.#store.recordTerminalRequestState({
			request: input.request,
			generation: input.generation,
			status: input.status,
			occurredAt: this.#clock().toISOString(),
		});
		const candidate = {
			status: "success",
			category:
				terminalState.status === "merged" ? "RequestMerged" : "RequestClosed",
		} as const;
		await this.#forEachRequestJob(
			input.request,
			input.generation,
			async (job) => {
				if (job.state !== "PENDING") return;
				try {
					await this.#store.setCallbackCandidate(job.jobId, candidate);
				} catch (error) {
					if (!isDynamoDbConditionalCheckFailedError(error)) throw error;
				}
			},
		);
		await this.#reconciler.invoke();
	}

	async #markOlderJobsSuperseded(
		request: RequestKey,
		generation: number,
		sourceRevision: string,
	): Promise<void> {
		await this.#forEachRequestJob(request, generation, async (job) => {
			if (job.state !== "PENDING" || job.sourceRevision === sourceRevision)
				return;
			try {
				await this.#store.setCallbackCandidate(job.jobId, {
					status: "failure",
					category: "Superseded",
				});
			} catch (error) {
				if (!isDynamoDbConditionalCheckFailedError(error)) throw error;
			}
		});
	}

	async #forEachRequestJob(
		request: RequestKey,
		generation: number,
		visit: (job: PipelineJobRecord) => Promise<void>,
	): Promise<void> {
		let cursor: Readonly<Record<string, unknown>> | undefined;
		do {
			const page = await this.#store.listRequestJobs(
				request,
				generation,
				cursor,
			);
			for (const job of page.jobs) await visit(job);
			cursor = page.cursor;
		} while (cursor !== undefined);
	}
}
