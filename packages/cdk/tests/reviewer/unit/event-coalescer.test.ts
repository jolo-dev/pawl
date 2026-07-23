import { describe, expect, it } from "bun:test";
import type { ReviewEvent } from "../../../src/reviewer/domain/review-event";
import { coalesceReviewEvents } from "../../../src/reviewer/services/event-coalescer";

const request = {
  provider: "codecommit",
  repository: "orders",
  requestId: "42",
} as const;

type EventWithoutRequest = ReviewEvent extends infer Event
  ? Event extends ReviewEvent
    ? Omit<Event, "request">
    : never
  : never;

function event(value: EventWithoutRequest): ReviewEvent {
  return { ...value, request } as ReviewEvent;
}

describe("coalesceReviewEvents", () => {
  it("keeps the latest revision signal and every human comment chronologically", () => {
    const result = coalesceReviewEvents([
      event({
        type: "revision-updated",
        id: "push-2",
        occurredAt: "2026-07-18T12:02:00.000Z",
        revision: "bbbbbbb",
      }),
      event({
        type: "human-comment",
        id: "event-comment-2",
        commentId: "comment-2",
        occurredAt: "2026-07-18T12:03:00.000Z",
      }),
      event({
        type: "revision-updated",
        id: "push-1",
        occurredAt: "2026-07-18T12:00:00.000Z",
        revision: "aaaaaaa",
      }),
      event({
        type: "human-comment",
        id: "event-comment-1",
        commentId: "comment-1",
        occurredAt: "2026-07-18T12:01:00.000Z",
      }),
    ]);

    expect(result.latestRevision?.revision).toBe("bbbbbbb");
    expect(result.humanComments.map(({ commentId }) => commentId)).toEqual([
      "comment-1",
      "comment-2",
    ]);
  });

  it("orders offset timestamps by instant rather than their source text", () => {
    const result = coalesceReviewEvents([
      event({
        type: "human-comment",
        id: "earlier-offset",
        commentId: "comment-earlier",
        occurredAt: "2026-07-18T12:00:00.000+02:00",
      }),
      event({
        type: "human-comment",
        id: "later-zulu",
        commentId: "comment-later",
        occurredAt: "2026-07-18T11:00:00.000Z",
      }),
    ]);

    expect(result.humanComments.map(({ id }) => id)).toEqual(["earlier-offset", "later-zulu"]);
  });

  it("breaks equal-instant ties by provider event id", () => {
    const occurredAt = "2026-07-18T12:00:00.000Z";
    const result = coalesceReviewEvents([
      event({
        type: "revision-updated",
        id: "event-a",
        occurredAt,
        revision: "aaaaaaa",
      }),
      event({
        type: "revision-updated",
        id: "event-b",
        occurredAt: "2026-07-18T14:00:00.000+02:00",
        revision: "bbbbbbb",
      }),
      event({
        type: "human-comment",
        id: "comment-b-event",
        commentId: "comment-b",
        occurredAt,
      }),
      event({
        type: "human-comment",
        id: "comment-a-event",
        commentId: "comment-a",
        occurredAt,
      }),
    ]);

    expect(result.latestRevision?.id).toBe("event-b");
    expect(result.humanComments.map(({ id }) => id)).toEqual([
      "comment-a-event",
      "comment-b-event",
    ]);
  });
});
