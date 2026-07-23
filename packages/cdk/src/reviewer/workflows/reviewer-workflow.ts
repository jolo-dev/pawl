import type { DurableContext } from "@aws/durable-execution-sdk-js";
import type { ReviewEvent } from "../domain/review-event";
import type { RequestKey, ReviewCycleSnapshot, ReviewRequest } from "../domain/review-request";
import type { CheckRunner } from "../ports/check-runner";
import type { ConversationTurn } from "../ports/review-model";
import type { ReviewComment, SourceControlProvider } from "../ports/source-control-provider";
import type { ReviewStateStore } from "../ports/state-store";
import type { FindingReconciler } from "../services/finding-reconciler";
import type { ReviewEngine, ReviewEngineResult } from "../services/review-engine";
import type { RepositoryConfigLoader } from "../services/repository-config-loader";

/** Structural logger the workflow needs (Powertools Logger satisfies this). */
export interface ReviewerLogger {
  info(message: string, data?: Record<string, unknown>): void;
}

/** Payload the router sends when starting a reviewer durable execution. */
export interface ReviewerEvent {
  readonly request: RequestKey;
  readonly generation: number;
  readonly leaseVersion: number;
  readonly reviewerArn: string;
  readonly snapshot?: ReviewRequest;
}

export interface ReviewerWorkflowDeps {
  readonly store: ReviewStateStore;
  readonly provider: SourceControlProvider;
  readonly checkRunner: CheckRunner;
  readonly reviewEngine: ReviewEngine;
  readonly reconciler: FindingReconciler;
  readonly configLoader: RepositoryConfigLoader;
  readonly reviewerDisplayName: string;
  readonly clock: () => Date;
}

/**
 * Replay-safe durable reviewer lifecycle.
 *
 * Every store mutation is inside a `context.step` so that on durable replay
 * the step is skipped (cached result returned) and the store is not
 * double-written. The workflow processes one claimed event batch per cycle,
 * then registers a callback and waits for the next event. The router wakes the
 * execution by sending `SendDurableExecutionCallbackSuccess(callbackId)` when a
 * new event arrives for this generation.
 *
 * Termination (merged/closed/timed-out) is driven by the router/store clearing
 * the callback; the durable SDK surfaces the cleared callback as a terminal
 * resumption and the workflow returns without throwing.
 */
export class ReviewerWorkflow {
  readonly #deps: ReviewerWorkflowDeps;

  constructor(deps: ReviewerWorkflowDeps) {
    this.#deps = deps;
  }

  async run(event: ReviewerEvent, context: DurableContext, logger: ReviewerLogger): Promise<void> {
    const { request, generation, leaseVersion } = event;

    // The reviewer is a durable event loop: one execution per PR, kept alive
    // across events via waitForCallback. Each wake (router signals a new
    // event) re-claims, re-loads context (fresh comments/diff), re-reviews,
    // and re-waits. Termination: when the PR is merged/closed, the loop exits.
    for (let cycle = 1; ; cycle++) {
      // 1. Load snapshot + review context (re-fetched each cycle so new human
      //    comments and new pushes are seen). `context.step` caches by
      //    operation index, so a genuine new iteration re-executes while a
      //    replay returns the cached result.
      const ctx = await context.step("load-snapshot", async () => {
        const reviewRequest = await this.#deps.provider.getRequest(request);
        const startedAt = this.#deps.clock().toISOString();
        const snapshot: ReviewCycleSnapshot = {
          request,
          generation,
          cycle,
          sourceRevision: reviewRequest.sourceRevision,
          destinationRevision: reviewRequest.destinationRevision,
          configVersion: 1,
          eventWatermark: event.snapshot?.sourceRevision ?? reviewRequest.sourceRevision,
          startedAt,
        };
        const [changedFiles, comments, existingFindings, repositoryConfig] = await Promise.all([
          this.#deps.provider.getDiff(request, {
            sourceRevision: reviewRequest.sourceRevision,
            destinationRevision: reviewRequest.destinationRevision,
          }),
          this.#deps.provider.listComments(request),
          this.#deps.store.listFindings(request),
          this.#deps.configLoader.load(request, reviewRequest.destinationRevision),
        ]);
        // Build the ordered conversation history (human comments + reviewer
        // replies) so follow-up questions can be answered with context. Inline
        // finding comments are excluded (they're summarised in `findings`).
        const conversation = buildConversation(comments, this.#deps.reviewerDisplayName);
        const humanComments = comments;
        return {
          snapshot,
          reviewRequest,
          changedFiles,
          humanComments,
          conversation,
          existingFindings,
          repositoryConfig,
        };
      });

      // Termination: a merged/closed PR ends the execution without re-reviewing.
      if (ctx.reviewRequest.status !== "open") {
        logger.info("reviewer terminating: request not open", {
          request,
          generation,
          status: ctx.reviewRequest.status,
        });
        return;
      }

      await context.step("begin-cycle", () => this.#deps.store.beginCycle(ctx.snapshot));
      logger.info("reviewer cycle began", {
        request,
        generation,
        cycle: ctx.snapshot.cycle,
        changedFiles: ctx.changedFiles.length,
      });

      // 2. Claim pending events for this generation.
      const claimed = await context.step("claim-events", () =>
        this.#deps.store.claimEvents(request, generation),
      );
      logger.info("claimed events", { count: claimed.events.length });

      // 3. Review. Only run when there are events to process; an empty claim
      //    is a no-op wake. The engine enforces hard limits + policy filtering.
      let reviewResult: ReviewEngineResult | undefined;
      if (claimed.events.length > 0) {
        // Immediate feedback: when a human comment triggered this cycle, react
        // 👀 directly on that comment so the user sees their input was received.
        // For pushes/opens (no comment), fall back to a PR-level 👀 status comment.
        const triggerCommentIds = claimed.events
          .filter(
            (event): event is Extract<ReviewEvent, { type: "human-comment" }> =>
              event.type === "human-comment",
          )
          .map((event) => event.commentId);
        const triggerCommentId = triggerCommentIds.at(-1);
        const statusComment = await context.step("signal-start", async () => {
          for (const commentId of triggerCommentIds) {
            try {
              await this.#deps.provider.reactToComment(request, commentId, "👀");
            } catch {
              logger.info("failed to set 👀 reaction", { commentId });
            }
          }
          if (triggerCommentId === undefined) {
            return this.#deps.provider.postStatusComment(
              request,
              "👀 Reviewing…",
              `status-${request.provider}-${request.repository}-${request.requestId}-g${generation}-c${ctx.snapshot.cycle}`,
              {
                sourceRevision: ctx.snapshot.sourceRevision,
                destinationRevision: ctx.snapshot.destinationRevision,
              },
            );
          }
          return undefined;
        });
        reviewResult = await context.step("run-review", async () => {
          const runResult = await this.#deps.checkRunner.run({
            request,
            snapshot: ctx.snapshot,
            checks: ctx.repositoryConfig.checks,
            installCommand: ctx.repositoryConfig.install?.command,
          });
          const checks = runResult.status === "completed" ? runResult.checks : [];
          const reviewInput = {
            snapshot: ctx.snapshot,
            changedFiles: ctx.changedFiles,
            checks,
            repositoryConfig: ctx.repositoryConfig,
            humanComments: ctx.humanComments,
            existingFindings: ctx.existingFindings,
          };
          const result = await this.#deps.reviewEngine.review(reviewInput);
          if (result.status === "reviewed") {
            await this.#deps.reconciler.apply({
              request,
              generation,
              candidates: [...result.accepted, ...result.dismissals],
              snapshot: ctx.snapshot,
              existingFindings: ctx.existingFindings,
              changedFiles: ctx.changedFiles,
            });
          }
          // Post the completion feedback.
          if (triggerCommentId !== undefined) {
            // Human-comment trigger: generate a conversational reply that
            // answers the comment (using the diff + findings as context), post
            // it as a threaded reply, and swap the 👀 reaction → ✅.
            const accepted = result.status === "reviewed" ? result.accepted : [];
            const { reply } = await this.#deps.reviewEngine.respond(
              {
                snapshot: ctx.snapshot,
                changedFiles: ctx.changedFiles,
                checks,
                humanComments: ctx.humanComments,
                conversation: ctx.conversation,
              },
              accepted,
              result.status === "reviewed" ? result.usage : { inputTokens: 0, outputTokens: 0 },
            );
            const signed = `${reply}\n\n---\n🤖 AI generated review by ${this.#deps.reviewerDisplayName}`;
            await this.#deps.provider.replyToComment(
              request,
              triggerCommentId,
              signed,
              `reply-${request.provider}-${request.repository}-${request.requestId}-g${generation}-c${ctx.snapshot.cycle}`,
            );
            // Swap the 👀 reaction for 👍 when done. CodeCommit only supports a
            // tiny set of reaction emojis (👍 👎 😄 😕 ❤️ 😠 😢 👀) — no ✅ — so
            // 👍 (thumbsup) is the "review finished / looks good" signal.
            // Best-effort: a reaction failure must not fail the review.
            for (const commentId of triggerCommentIds) {
              try {
                await this.#deps.provider.reactToComment(request, commentId, "👍");
              } catch {
                logger.info("failed to swap 👀→👍 reaction", { commentId });
              }
            }
          } else if (statusComment !== undefined) {
            // Push/open trigger: append a ✅ summary to the 👀 status comment.
            const findingCount =
              result.status === "reviewed" ? result.accepted.length + result.dismissals.length : 0;
            const summary =
              result.status === "reviewed"
                ? findingCount > 0
                  ? `✅ Reviewed — ${findingCount} finding${findingCount === 1 ? "" : "s"}.`
                  : "✅ Reviewed — no new findings."
                : result.status === "blocked"
                  ? `⏸️ Review paused (${result.blockedLimit}).`
                  : "✅ Reviewed.";
            await this.#deps.provider.appendStatusUpdate(request, statusComment, summary, {
              sourceRevision: ctx.snapshot.sourceRevision,
              destinationRevision: ctx.snapshot.destinationRevision,
            });
          }
          return result;
        });
        logger.info("review completed", { status: reviewResult.status });
      }

      // 4. Register a callback and wait for the next event. A BLOCKED_LIMIT
      //    review registers a BLOCKED_LIMIT callback; otherwise WAITING. The
      //    submitter runs once per cycle (the SDK tracks it as a durable
      //    operation and skips it on replay); registerCallback is idempotent
      //    under the state-store contract.
      const blockedLimit =
        reviewResult?.status === "blocked" ? reviewResult.blockedLimit : undefined;
      await context.waitForCallback("wait-for-next-event", async (callbackId) => {
        const registration =
          blockedLimit === undefined
            ? {
                request,
                generation,
                callbackGeneration: generation,
                callbackId,
                registeredAt: this.#deps.clock().toISOString(),
                leaseVersion,
                lifecycleState: "WAITING" as const,
              }
            : {
                request,
                generation,
                callbackGeneration: generation,
                callbackId,
                registeredAt: this.#deps.clock().toISOString(),
                leaseVersion,
                lifecycleState: "BLOCKED_LIMIT" as const,
                blockedLimit,
              };
        await this.#deps.store.registerCallback(registration);
        logger.info("registered callback", {
          callbackId,
          generation,
          lifecycleState: registration.lifecycleState,
        });
      });
      // On resume (router signalled a new event), loop to re-claim + re-review.
    }
  }
}

/**
 * Build the ordered PR conversation (human comments + reviewer replies) for
 * follow-up context. Inline finding comments are excluded (the accepted
 * findings are passed separately as `findings`). A comment is a reviewer
 * reply when it carries the 🤖 signature we append to every review reply.
 * Comments are ordered by creation time so the model sees the thread in order.
 */
export function buildConversation(
  comments: readonly ReviewComment[],
  reviewerDisplayName: string,
): readonly ConversationTurn[] {
  const signature = `🤖 AI generated review by ${reviewerDisplayName}`;
  const turns: ConversationTurn[] = [];
  for (const comment of comments) {
    if (comment.findingFingerprint !== undefined) continue; // inline finding
    const isReviewer = comment.body.includes(signature);
    const body = isReviewer
      ? comment.body.split(`\n---\n${signature}`)[0]!.trimEnd()
      : comment.body;
    if (body === "") continue;
    turns.push({
      role: isReviewer ? "reviewer" : "human",
      id: comment.id,
      body,
      ...(comment.inReplyTo === undefined ? {} : { inReplyTo: comment.inReplyTo }),
    });
  }
  return turns;
}
