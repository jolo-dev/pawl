import { describe, expect, it } from "bun:test";
import {
	reviewCycleSnapshotSchema,
	reviewRequestSchema,
} from "../../../../src/reviewer/domain/review-request";

const request = {
	key: { provider: "codecommit", repository: "orders", requestId: "42" },
	title: "Validate checkout",
	status: "open",
	sourceBranch: "feature/checkout",
	destinationBranch: "main",
	sourceRevision: "a".repeat(40),
	destinationRevision: "b".repeat(40),
} as const;

describe("immutable review revisions", () => {
	it("parses and freezes a request snapshot", () => {
		const parsed = reviewRequestSchema.parse(request);

		expect(Object.isFrozen(parsed)).toBe(true);
		expect(Object.isFrozen(parsed.key)).toBe(true);
		expect(() => {
			Object.assign(parsed, { sourceRevision: "c".repeat(40) });
		}).toThrow();
		expect(parsed.sourceRevision).toBe(request.sourceRevision);
	});

	it("pins both revisions in each review cycle", () => {
		const snapshot = reviewCycleSnapshotSchema.parse({
			request: request.key,
			generation: 2,
			cycle: 3,
			sourceRevision: request.sourceRevision,
			destinationRevision: request.destinationRevision,
			configVersion: 1,
			eventWatermark: "event-9",
			startedAt: "2026-07-18T12:00:00.000Z",
		});

		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(snapshot.sourceRevision).not.toBe(snapshot.destinationRevision);
	});
});
