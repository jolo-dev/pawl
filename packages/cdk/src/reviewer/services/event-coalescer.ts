import type { ReviewEvent } from "../domain/review-event";

export type RevisionEvent = Extract<ReviewEvent, { readonly type: "revision-updated" }>;
export type HumanCommentEvent = Extract<ReviewEvent, { readonly type: "human-comment" }>;
export type TerminalRequestEvent = Extract<
  ReviewEvent,
  { readonly type: "request-merged" | "request-closed" }
>;

export interface CoalescedReviewEvents {
  readonly latestRevision?: RevisionEvent;
  readonly humanComments: readonly HumanCommentEvent[];
  readonly terminalEvent?: TerminalRequestEvent;
  readonly requiresProviderSnapshot: boolean;
}

function compareEvents(left: ReviewEvent, right: ReviewEvent): number {
  const instant = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
  return instant === 0 ? left.id.localeCompare(right.id) : instant;
}

/**
 * Reduces an inbox batch without treating webhook revision data as a provider
 * snapshot. A caller still refreshes the request when requiresProviderSnapshot
 * is true; latestRevision is the deterministic newest revision signal.
 */
export function coalesceReviewEvents(events: readonly ReviewEvent[]): CoalescedReviewEvents {
  const ordered = [...events].sort(compareEvents);
  const revisions = ordered.filter(
    (event): event is RevisionEvent => event.type === "revision-updated",
  );
  const terminalEvents = ordered.filter(
    (event): event is TerminalRequestEvent =>
      event.type === "request-merged" || event.type === "request-closed",
  );

  return {
    latestRevision: revisions.at(-1),
    humanComments: ordered.filter(
      (event): event is HumanCommentEvent => event.type === "human-comment",
    ),
    terminalEvent: terminalEvents.at(-1),
    requiresProviderSnapshot: ordered.some(({ type }) => type !== "human-comment"),
  };
}
