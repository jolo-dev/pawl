import { describe, expect, it } from "bun:test";
import { reviewEventSchema } from "../../../../src/reviewer/domain/review-event";

const request = {
	provider: "codecommit",
	repository: "orders",
	requestId: "42",
};

const common = {
	id: "event-1",
	request,
	occurredAt: "2026-07-18T12:00:00.000Z",
};

describe("reviewEventSchema", () => {
	it.each([
		{ ...common, type: "request-opened" },
		{ ...common, type: "revision-updated", revision: "a".repeat(40) },
		{ ...common, type: "human-comment", commentId: "comment-1" },
		{ ...common, type: "request-merged" },
		{ ...common, type: "request-closed" },
	])("accepts normalized $type events", (event) => {
		expect(reviewEventSchema.parse(event)).toEqual(event);
	});

	it("rejects provider payload fields", () => {
		expect(() =>
			reviewEventSchema.parse({
				...common,
				type: "request-opened",
				rawProviderPayload: { secret: "not-domain-data" },
			}),
		).toThrow();
	});
});
