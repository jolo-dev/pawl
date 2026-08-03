import { describe, expect, it } from "bun:test";
import {
	type DynamoDbDocumentTransport,
	DynamoDbStateStore,
	encodeStateKeyComponent,
	PendingWorkError,
	StaleStateError,
} from "../../../src/reviewer/adapters/dynamodb-state-store";
import type {
	Finding,
	FindingFingerprint,
} from "../../../src/reviewer/domain/finding";
import type { ReviewEvent } from "../../../src/reviewer/domain/review-event";
import { InMemoryStateStore } from "../fakes/in-memory-state-store";

const request = {
	provider: "codecommit",
	repository: "orders",
	requestId: "42",
} as const;
const now = "2026-07-18T12:00:00.000Z";

function revisionEvent(id: string, occurredAt = now): ReviewEvent {
	return {
		type: "revision-updated",
		id,
		request,
		occurredAt,
		revision: "abcdef1",
	};
}

function replyEvent(id: string): ReviewEvent {
	return {
		type: "human-comment",
		id,
		request,
		occurredAt: now,
		commentId: "reply-1",
		inReplyTo: "parent-1",
	};
}

const fingerprint =
	"review-finding:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as FindingFingerprint;
const finding = {
	kind: "finding",
	category: "correctness",
	severity: "high",
	confidence: 0.95,
	path: "src/order.ts",
	side: "after",
	issueIdentity: "missing-idempotency",
	evidence: "The retry repeats the charge.",
	impact: "A customer can be charged twice.",
	recommendation: "Persist and reuse an idempotency key.",
	location: { kind: "line", line: 12, hunkIdentity: "hunk-1" },
} as Finding;

describe("transactional state protocol", () => {
	it("deduplicates events and grants only one STARTING owner", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		const first = await store.appendEvent(revisionEvent("push-1"));
		const duplicate = await store.appendEvent(revisionEvent("push-1"));
		const next = await store.appendEvent(revisionEvent("push-2"));

		expect(first).toMatchObject({
			appended: true,
			generation: 1,
			shouldStart: true,
		});
		expect(duplicate).toMatchObject({
			appended: false,
			generation: 1,
			shouldStart: false,
		});
		expect(next).toMatchObject({
			appended: true,
			generation: 1,
			shouldStart: false,
		});
	});

	it("preserves reply context when the fake claims a human comment", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		await store.appendEvent(replyEvent("reply-event"));
		const claimed = await store.claimEvents(request, 1);
		expect(claimed.events).toEqual([replyEvent("reply-event")]);
		expect(claimed.events[0]).toMatchObject({
			type: "human-comment",
			commentId: "reply-1",
			inReplyTo: "parent-1",
		});
	});

	it("persists reply context without a comment body in the DynamoDB event item", async () => {
		const commands: object[] = [];
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commands.push(command);
				if (command.constructor.name === "GetCommand") return {};
				return {};
			},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });
		await store.appendEvent(replyEvent("reply-event"));
		const serialized = JSON.stringify(commands);
		expect(serialized).toContain('"inReplyTo":"parent-1"');
		expect(serialized).not.toContain("notificationBody");
		expect(serialized).not.toContain("secret body");
	});

	it("increments generation when work arrives after completion", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		await store.appendEvent(revisionEvent("push-1"));
		await store.claimEvents(request, 1);
		await store.complete(request, 1, { type: "clean" });

		expect(await store.appendEvent(revisionEvent("push-2"))).toMatchObject({
			generation: 2,
			lifecycleState: "STARTING",
			shouldStart: true,
		});
	});

	it("returns an active callback again for duplicate delivery after a lost wake", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		await store.appendEvent(revisionEvent("push-duplicate"));
		await store.recordExecution(request, 1, "arn:execution:1");
		await store.claimEvents(request, 1);
		await store.registerCallback({
			request,
			generation: 1,
			callbackGeneration: 1,
			callbackId: "callback-1",
			registeredAt: now,
			leaseVersion: 1,
			lifecycleState: "WAITING",
		});

		const first = await store.appendEvent(revisionEvent("push-duplicate"));
		const retry = await store.appendEvent(revisionEvent("push-duplicate"));
		expect(first.callback).toMatchObject({ callbackGeneration: 1 });
		expect(retry.callback).toMatchObject({ callbackGeneration: 1 });
		expect((await store.claimEvents(request, 1)).events).toEqual([]);
	});

	it("enforces completion lifecycle ownership and rejects repeat completion", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		await store.appendEvent(revisionEvent("completion-lifecycle"));
		await expect(
			store.complete(request, 1, { type: "clean" }),
		).rejects.toBeInstanceOf(StaleStateError);
		await store.claimEvents(request, 1);
		await expect(
			store.complete(request, 1, { type: "clean" }),
		).resolves.toBeUndefined();
		await expect(
			store.complete(request, 1, { type: "clean" }),
		).rejects.toBeInstanceOf(StaleStateError);
	});

	it("rejects beginCycle after completion and only allows RUNNING ownership", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		await store.appendEvent(revisionEvent("cycle-terminal"));
		await store.claimEvents(request, 1);
		await store.beginCycle({
			request,
			generation: 1,
			cycle: 1,
			sourceRevision: "abcdef1",
			destinationRevision: "1234567",
			configVersion: 1,
			eventWatermark: "2026-07-18T12:00:00.000Z#cycle-terminal",
			startedAt: now,
		});
		await store.complete(request, 1, { type: "clean" });
		await expect(
			store.beginCycle({
				request,
				generation: 1,
				cycle: 2,
				sourceRevision: "abcdef2",
				destinationRevision: "1234567",
				configVersion: 1,
				eventWatermark: "2026-07-18T12:00:00.000Z#cycle-terminal",
				startedAt: now,
			}),
		).rejects.toBeInstanceOf(StaleStateError);
	});

	it("does not complete while pending work exists and eventually claims 105 events", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		await store.appendEvent(revisionEvent("seed"));
		await expect(
			store.complete(request, 1, { type: "clean" }),
		).rejects.toBeInstanceOf(StaleStateError);
		for (let index = 0; index < 105; index += 1) {
			await store.appendEvent(revisionEvent(`event-${index}`));
		}
		const claimed: string[] = [];
		for (;;) {
			const batch = await store.claimEvents(request, 1);
			claimed.push(...batch.events.map(({ id }) => id));
			if (batch.events.length === 0) break;
		}
		expect(claimed).toHaveLength(106);
		await expect(
			store.complete(request, 1, { type: "clean" }),
		).resolves.toBeUndefined();
		await expect(
			store.appendEvent(revisionEvent("after-complete")),
		).resolves.toMatchObject({
			generation: 2,
			shouldStart: true,
		});
	});

	it("replays reservations by token and rejects a different token", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		await store.appendEvent(revisionEvent("reserve"));
		const write = {
			operation: "post" as const,
			request,
			generation: 1,
			finding,
			fingerprint,
			idempotencyToken: "same-token",
		};
		const first = await store.reserveFindingWrite(write);
		const replay = await store.reserveFindingWrite(write);
		expect(first).toMatchObject({ reserved: true });
		expect(replay).toEqual(first);
		expect(
			await store.reserveFindingWrite({
				...write,
				idempotencyToken: "other-token",
			}),
		).toMatchObject({ reserved: false, reason: "already-reserved" });
	});

	it("returns changed for a stale STARTING lease with a non-NOT_FOUND remote status", async () => {
		const clock = { value: new Date(now) };
		const store = new InMemoryStateStore({
			clock: () => clock.value,
			leaseDurationSeconds: 1,
		});
		await store.appendEvent(revisionEvent("starting-stale"));
		clock.value = new Date("2026-07-18T12:00:02.000Z");
		expect(
			await store.recoverLease({
				request,
				generation: 1,
				leaseVersion: 1,
				remoteStatus: "FAILED",
				recoveredAt: clock.value.toISOString(),
			}),
		).toEqual({
			recovered: false,
			reason: "changed",
			generation: 1,
			leaseVersion: 1,
		});
	});

	it("appends before returning a callback to wake", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		await store.appendEvent(revisionEvent("push-1"));
		await store.recordExecution(request, 1, "arn:execution:1");
		await store.claimEvents(request, 1);
		await store.registerCallback({
			request,
			generation: 1,
			callbackGeneration: 1,
			callbackId: "callback-1",
			registeredAt: now,
			leaseVersion: 1,
			lifecycleState: "WAITING",
		});

		const appended = await store.appendEvent(revisionEvent("push-2"));
		expect(appended.callback).toMatchObject({ callbackGeneration: 1 });
		expect(
			(await store.claimEvents(request, 1)).events.map(({ id }) => id),
		).toEqual(["push-2"]);
	});

	it("rejects stale callbacks and watermark regression", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		await store.appendEvent(revisionEvent("push-1"));
		await store.recordExecution(request, 1, "arn:execution:1");
		await store.claimEvents(request, 1);
		expect(
			await store.registerCallback({
				request,
				generation: 0,
				callbackGeneration: 1,
				callbackId: "stale",
				registeredAt: now,
				leaseVersion: 1,
				lifecycleState: "WAITING",
			}),
		).toEqual({ registered: false, reason: "stale-generation" });

		await store.beginCycle({
			request,
			generation: 1,
			cycle: 1,
			sourceRevision: "abcdef1",
			destinationRevision: "1234567",
			configVersion: 1,
			eventWatermark: "2026-07-18T12:00:00.000Z#push-1",
			startedAt: now,
		});
		// beginCycle no longer enforces an eventWatermark monotonic guard: the
		// event watermark is owned by claimEvents (which progresses it forward via
		// the claim cursor). beginCycle must not reject a new cycle based on the
		// snapshot watermark (which is derived from the source revision, not the
		// event watermark, and would otherwise compare incompatible formats).
		await expect(
			store.beginCycle({
				request,
				generation: 1,
				cycle: 2,
				sourceRevision: "abcdef2",
				destinationRevision: "1234567",
				configVersion: 1,
				eventWatermark: "2026-07-18T11:00:00.000Z#push-0",
				startedAt: now,
			}),
		).resolves.toBeUndefined();
	});

	it("detects an event between callback persistence and the final inbox check", async () => {
		let store: InMemoryStateStore;
		store = new InMemoryStateStore({
			clock: () => new Date(now),
			afterCallbackPersisted: async () => {
				await store.appendEvent(
					revisionEvent("push-raced", "2026-07-18T12:01:00.000Z"),
				);
			},
		});
		await store.appendEvent(revisionEvent("push-1"));
		await store.recordExecution(request, 1, "arn:execution:1");
		await store.claimEvents(request, 1);

		const registration = await store.registerCallback({
			request,
			generation: 1,
			callbackGeneration: 1,
			callbackId: "callback-1",
			registeredAt: now,
			leaseVersion: 1,
			lifecycleState: "WAITING",
		});
		expect(registration).toEqual({ registered: true, hasPendingEvents: true });
		expect(
			(await store.claimEvents(request, 1)).events.map(({ id }) => id),
		).toEqual(["push-raced"]);
		expect((await store.claimEvents(request, 1)).events).toEqual([]);
	});

	it("reserves and conditionally confirms finding writes", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		await store.appendEvent(revisionEvent("push-1"));
		const reservation = await store.reserveFindingWrite({
			operation: "post",
			request,
			generation: 1,
			finding,
			fingerprint,
			idempotencyToken: "post-1",
		});
		expect(reservation.reserved).toBe(true);
		if (!reservation.reserved) throw new Error("expected reservation");
		expect((await store.listFindings(request))[0]).toMatchObject({
			fingerprint,
			status: "pending",
		});
		expect(
			await store.reserveFindingWrite({
				operation: "post",
				request,
				generation: 1,
				finding,
				fingerprint,
				idempotencyToken: "post-2",
			}),
		).toMatchObject({ reserved: false, reason: "already-reserved" });

		await store.confirmFindingWrite({
			request,
			generation: 1,
			reservationId: reservation.reservationId,
			fingerprint,
			providerCommentId: "comment-9",
			providerContentHash: "hash-9",
			completedAt: now,
		});
		expect((await store.listFindings(request))[0]).toMatchObject({
			status: "open",
			providerCommentId: "comment-9",
		});

		const resolution = await store.reserveFindingWrite({
			operation: "resolve",
			request,
			generation: 1,
			fingerprint,
			providerCommentId: "comment-9",
			idempotencyToken: "resolve-1",
			resolution: "fixed",
		});
		if (!resolution.reserved)
			throw new Error("expected resolution reservation");
		await store.confirmFindingWrite({
			request,
			generation: 1,
			reservationId: resolution.reservationId,
			fingerprint,
			providerCommentId: "comment-10",
			providerContentHash: "hash-10",
			completedAt: now,
		});
		expect((await store.listFindings(request))[0]).toMatchObject({
			status: "resolved",
			providerCommentId: "comment-10",
		});
	});

	it("exposes recovery eligibility only after an active lease expires, including duplicates", async () => {
		const clock = { value: new Date(now) };
		const store = new InMemoryStateStore({
			clock: () => clock.value,
			leaseDurationSeconds: 60,
		});
		await store.appendEvent(revisionEvent("eligibility-seed"));
		await store.recordExecution(request, 1, "arn:execution:eligibility");
		await store.claimEvents(request, 1);

		const active = await store.appendEvent(
			revisionEvent("eligibility-pending"),
		);
		expect(active.recoveryEligible).toBeFalse();

		clock.value = new Date("2026-07-18T12:02:00.000Z");
		const expiredDuplicate = await store.appendEvent(
			revisionEvent("eligibility-pending"),
		);
		expect(expiredDuplicate).toMatchObject({
			appended: false,
			recoveryEligible: true,
		});
	});

	it("recovers expired ownership conditionally and respects remote RUNNING", async () => {
		const clock = { value: new Date(now) };
		const store = new InMemoryStateStore({
			clock: () => clock.value,
			leaseDurationSeconds: 60,
		});
		await store.appendEvent(revisionEvent("push-1"));
		clock.value = new Date("2026-07-18T12:02:00.000Z");

		expect(
			await store.recoverLease({
				request,
				generation: 1,
				leaseVersion: 1,
				remoteStatus: "NOT_FOUND",
				recoveredAt: clock.value.toISOString(),
			}),
		).toEqual({
			recovered: true,
			generation: 1,
			leaseVersion: 2,
			shouldStart: true,
		});
		expect(
			await store.recoverLease({
				request,
				generation: 1,
				leaseVersion: 1,
				remoteStatus: "NOT_FOUND",
				recoveredAt: clock.value.toISOString(),
			}),
		).toEqual({
			recovered: false,
			reason: "changed",
			generation: 1,
			leaseVersion: 2,
		});

		await store.recordExecution(request, 1, "arn:execution:1");
		await store.claimEvents(request, 1);
		await store.appendEvent(revisionEvent("push-2"));
		clock.value = new Date("2026-07-18T12:04:00.000Z");
		expect(
			await store.recoverLease({
				request,
				generation: 1,
				leaseVersion: 2,
				remoteStatus: "RUNNING",
				recoveredAt: clock.value.toISOString(),
			}),
		).toEqual({ recovered: false, reason: "active" });
		expect(
			await store.recoverLease({
				request,
				generation: 1,
				leaseVersion: 2,
				remoteStatus: "FAILED",
				recoveredAt: clock.value.toISOString(),
			}),
		).toEqual({
			recovered: true,
			generation: 2,
			leaseVersion: 3,
			shouldStart: true,
		});
	});

	it("recovers an expired WAITING owner and preserves findings on BLOCKED_LIMIT", async () => {
		const clock = { value: new Date(now) };
		const store = new InMemoryStateStore({
			clock: () => clock.value,
			leaseDurationSeconds: 60,
		});
		await store.appendEvent(revisionEvent("push-1"));
		await store.recordExecution(request, 1, "arn:execution:1");
		await store.claimEvents(request, 1);
		const reservation = await store.reserveFindingWrite({
			operation: "post",
			request,
			generation: 1,
			finding,
			fingerprint,
			idempotencyToken: "post-blocked",
		});
		if (!reservation.reserved) throw new Error("expected reservation");
		await store.confirmFindingWrite({
			request,
			generation: 1,
			reservationId: reservation.reservationId,
			fingerprint,
			providerCommentId: "comment-blocked",
			providerContentHash: "hash-blocked",
			completedAt: now,
		});
		const blockedLimit = {
			reason: "max-diff-bytes",
			observed: 1_500_000,
			maximum: 1_000_000,
		} as const;
		await store.registerCallback({
			request,
			generation: 1,
			callbackGeneration: 1,
			callbackId: "callback-blocked",
			registeredAt: now,
			leaseVersion: 1,
			lifecycleState: "BLOCKED_LIMIT",
			blockedLimit,
		});
		expect(await store.listFindings(request)).toHaveLength(1);
		expect(store.inspectRequest(request)?.blockedLimit).toEqual(blockedLimit);
		await store.registerCallback({
			request,
			generation: 1,
			callbackGeneration: 2,
			callbackId: "callback-waiting",
			registeredAt: now,
			leaseVersion: 1,
			lifecycleState: "WAITING",
		});
		await store.appendEvent(
			revisionEvent("push-2", "2026-07-18T12:01:00.000Z"),
		);
		clock.value = new Date("2026-07-18T12:02:00.000Z");

		expect(
			await store.recoverLease({
				request,
				generation: 1,
				leaseVersion: 1,
				remoteStatus: "NOT_FOUND",
				recoveredAt: clock.value.toISOString(),
			}),
		).toEqual({
			recovered: true,
			generation: 2,
			leaseVersion: 2,
			shouldStart: true,
		});
		expect(await store.listFindings(request)).toHaveLength(1);
	});

	it("allows a new generation to supersede an unconfirmed finding reservation", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		await store.appendEvent(revisionEvent("push-1"));
		expect(
			await store.reserveFindingWrite({
				operation: "post",
				request,
				generation: 1,
				finding,
				fingerprint,
				idempotencyToken: "generation-1",
			}),
		).toMatchObject({ reserved: true });
		await store.claimEvents(request, 1);
		await store.complete(request, 1, { type: "clean" });
		await store.appendEvent(revisionEvent("push-2"));
		expect(
			await store.reserveFindingWrite({
				operation: "post",
				request,
				generation: 2,
				finding,
				fingerprint,
				idempotencyToken: "generation-2",
			}),
		).toMatchObject({ reserved: true });
	});

	it("resets generation-local cycle and snapshot state after terminal restart", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		await store.appendEvent(revisionEvent("push-1"));
		await store.claimEvents(request, 1);
		await store.beginCycle({
			request,
			generation: 1,
			cycle: 1,
			sourceRevision: "abcdef1",
			destinationRevision: "1234567",
			configVersion: 1,
			eventWatermark: "2026-07-18T12:00:00.000Z#push-1",
			startedAt: now,
		});
		await store.complete(request, 1, { type: "clean" });
		await store.appendEvent(
			revisionEvent("push-2", "2026-07-18T12:01:00.000Z"),
		);
		expect(store.inspectRequest(request)).toMatchObject({
			generation: 2,
			cycle: undefined,
			sourceRevision: undefined,
			destinationRevision: undefined,
			eventWatermark: undefined,
		});
		await store.recordExecution(request, 2, "arn:execution:2");
		await store.claimEvents(request, 2);
		await expect(
			store.beginCycle({
				request,
				generation: 2,
				cycle: 1,
				sourceRevision: "abcdef2",
				destinationRevision: "1234568",
				configVersion: 1,
				eventWatermark: "2026-07-18T12:01:00.000Z#push-2",
				startedAt: now,
			}),
		).resolves.toBeUndefined();
	});

	it("resets generation-local state when lease recovery advances generation", async () => {
		const clock = { value: new Date(now) };
		const store = new InMemoryStateStore({
			clock: () => clock.value,
			leaseDurationSeconds: 60,
		});
		await store.appendEvent(revisionEvent("push-1"));
		await store.recordExecution(request, 1, "arn:execution:1");
		await store.claimEvents(request, 1);
		await store.beginCycle({
			request,
			generation: 1,
			cycle: 1,
			sourceRevision: "abcdef1",
			destinationRevision: "1234567",
			configVersion: 1,
			eventWatermark: "2026-07-18T12:00:00.000Z#push-1",
			startedAt: now,
		});
		await store.appendEvent(
			revisionEvent("push-2", "2026-07-18T12:01:00.000Z"),
		);
		clock.value = new Date("2026-07-18T12:02:00.000Z");
		expect(
			await store.recoverLease({
				request,
				generation: 1,
				leaseVersion: 1,
				remoteStatus: "FAILED",
				recoveredAt: clock.value.toISOString(),
			}),
		).toMatchObject({ recovered: true, generation: 2 });
		await store.recordExecution(request, 2, "arn:execution:2");
		await store.claimEvents(request, 2);
		expect(store.inspectRequest(request)?.cycle).toBeUndefined();
		await expect(
			store.beginCycle({
				request,
				generation: 2,
				cycle: 1,
				sourceRevision: "abcdef2",
				destinationRevision: "1234568",
				configVersion: 1,
				eventWatermark: "2026-07-18T12:01:00.000Z#push-2",
				startedAt: clock.value.toISOString(),
			}),
		).resolves.toBeUndefined();
	});

	it("bounds fake keys for maximum schema-valid UTF-8 identifiers", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		const highByte = "界".repeat(512);
		const firstRequest = {
			provider: highByte,
			repository: highByte,
			requestId: highByte,
		} as const;
		const secondRequest = {
			provider: highByte,
			repository: highByte,
			requestId: `${"界".repeat(511)}語`,
		} as const;
		for (const [key, id] of [
			[firstRequest, "😀".repeat(256)],
			[secondRequest, `${"😀".repeat(255)}😁`],
		] as const) {
			await store.appendEvent({
				...revisionEvent(id, "2026-07-18T12:00:00.000+02:00"),
				request: key,
			});
		}

		const inspected = [firstRequest, secondRequest].map((key) =>
			store.inspectRequest(key),
		);
		expect(new Set(inspected.map((state) => state?.partitionKey)).size).toBe(2);
		for (const state of inspected) {
			if (state === undefined) {
				throw new Error("Expected request state to be inspectable");
			}
			expect(Buffer.byteLength(state.partitionKey, "utf8")).toBeLessThanOrEqual(
				2048,
			);
			expect(state.eventSortKeys).toHaveLength(1);
			const eventSortKey = state.eventSortKeys[0];
			if (eventSortKey === undefined) {
				throw new Error("Expected request state to include an event sort key");
			}
			expect(eventSortKey).toMatch(
				/^EVENT#2026-07-18T10:00:00\.000Z#v1~[A-Za-z0-9_-]{43}$/,
			);
			expect(Buffer.byteLength(eventSortKey, "utf8")).toBeLessThanOrEqual(1024);
		}
	});

	it("uses collision-safe request keys and canonical event instants", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		const first = { provider: "a#b", repository: "c", requestId: "d" } as const;
		const second = {
			provider: "a",
			repository: "b#c",
			requestId: "d",
		} as const;
		const percent = {
			provider: "a%23b",
			repository: "c",
			requestId: "d",
		} as const;
		for (const [index, key] of [first, second, percent].entries()) {
			expect(
				await store.appendEvent({
					...revisionEvent(`collision-${index}`),
					request: key,
				}),
			).toMatchObject({ shouldStart: true });
		}
		const partitionKeys = [first, second, percent].map(
			(key) => store.inspectRequest(key)?.partitionKey ?? "",
		);
		expect(new Set(partitionKeys).size).toBe(3);
		for (const partitionKey of partitionKeys) {
			expect(partitionKey).toMatch(
				/^REQUEST#v1~[A-Za-z0-9_-]{43}#v1~[A-Za-z0-9_-]{43}#v1~[A-Za-z0-9_-]{43}$/,
			);
			expect(Buffer.byteLength(partitionKey, "utf8")).toBeLessThanOrEqual(2048);
		}

		await store.appendEvent(
			revisionEvent("equal-b", "2026-07-18T10:00:00.000Z"),
		);
		await store.appendEvent(
			revisionEvent("equal-a", "2026-07-18T12:00:00.000+02:00"),
		);
		await store.appendEvent(revisionEvent("later", "2026-07-18T11:00:00.000Z"));
		const claimed = await store.claimEvents(request, 1);
		expect(claimed.events.map(({ id }) => id)).toEqual([
			"equal-a",
			"equal-b",
			"later",
		]);
		expect(claimed.throughWatermark).toBe("2026-07-18T11:00:00.000Z#later");
	});
});

describe("DynamoDbStateStore", () => {
	it("uses the REQUEST single-table keys, transactions, and deterministic TTL", async () => {
		const commands: object[] = [];
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commands.push(command);
				if (command.constructor.name === "GetCommand") return {};
				return {};
			},
		};
		const store = new DynamoDbStateStore({
			transport,
			tableName: "review-state",
			clock: () => new Date(now),
			ttlPolicy: { metaSeconds: 100, eventSeconds: 50, findingSeconds: 200 },
		});

		await store.appendEvent(revisionEvent("push-1"));
		const transaction = commands.find(
			(command) => command.constructor.name === "TransactWriteCommand",
		) as
			| { input?: { TransactItems?: readonly Record<string, unknown>[] } }
			| undefined;
		expect(transaction?.input?.TransactItems).toHaveLength(2);
		expect(JSON.stringify(transaction?.input)).toMatch(
			/REQUEST#v1~[A-Za-z0-9_-]{43}#v1~[A-Za-z0-9_-]{43}#v1~[A-Za-z0-9_-]{43}/,
		);
		expect(JSON.stringify(transaction?.input)).toMatch(
			/EVENT#2026-07-18T12:00:00.000Z#v1~[A-Za-z0-9_-]{43}/,
		);
		expect(JSON.stringify(transaction?.input)).toContain("1784376050");
		expect(JSON.stringify(transaction?.input)).toContain("deadlineAt");
	});

	it("returns recovery eligibility for an expired duplicate with pending work", async () => {
		const clock = { value: new Date(now) };
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name !== "GetCommand") return {};
				const key = (command as { input?: { Key?: { sk?: string } } }).input
					?.Key;
				return key?.sk?.startsWith("EVENT#")
					? { Item: { pk: "x" } }
					: {
							Item: {
								lifecycleState: "RUNNING",
								generation: 3,
								leaseVersion: 5,
								leaseExpiresAt: "2026-07-18T12:01:00.000Z",
								pendingEventCount: 1,
							},
						};
			},
		};
		const store = new DynamoDbStateStore({
			transport,
			tableName: "state",
			clock: () => clock.value,
		});

		expect(
			(await store.appendEvent(revisionEvent("expired-duplicate")))
				.recoveryEligible,
		).toBeFalse();
		clock.value = new Date("2026-07-18T12:02:00.000Z");
		expect(
			await store.appendEvent(revisionEvent("expired-duplicate")),
		).toMatchObject({
			appended: false,
			generation: 3,
			leaseVersion: 5,
			recoveryEligible: true,
		});
	});

	it("returns the active callback for a duplicate event in the adapter", async () => {
		const commands: object[] = [];
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commands.push(command);
				if (command.constructor.name === "GetCommand") {
					const key = (command as { input?: { Key?: { sk?: string } } }).input
						?.Key;
					return key?.sk?.startsWith("EVENT#")
						? { Item: { pk: "x" } }
						: {
								Item: {
									lifecycleState: "WAITING",
									generation: 1,
									callbackId: "callback-1",
									callbackGeneration: 7,
								},
							};
				}
				return {};
			},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });
		expect(await store.appendEvent(revisionEvent("duplicate"))).toMatchObject({
			appended: false,
			callback: { request, callbackGeneration: 7 },
		});
	});

	it("conditions FAILED completion on exact callback and lease ownership", async () => {
		const commands: object[] = [];
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commands.push(command);
				return {};
			},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });
		const failure = {
			type: "operational-failure",
			lifecycleState: "FAILED",
			operation: "callback",
			reason: "retry-exhausted",
			attempts: 2,
			lastError: { name: "ThrottlingException", message: "throttled" },
		} as const;
		await store.complete(request, 3, {
			type: "failed",
			failure,
			ownership: {
				kind: "callback",
				callbackId: "callback-3",
				callbackGeneration: 4,
				leaseVersion: 7,
			},
		});
		const callbackCommand = JSON.stringify(
			(commands.at(-1) as { input?: unknown }).input,
		);
		expect(callbackCommand).toContain("leaseVersion = :leaseVersion");
		expect(callbackCommand).toContain("callbackId = :callbackId");
		expect(callbackCommand).toContain(
			"callbackGeneration = :callbackGeneration",
		);
		expect(callbackCommand).toContain('":leaseVersion":7');
		expect(callbackCommand).toContain('":callbackId":"callback-3"');

		await store.complete(request, 3, {
			type: "failed",
			failure,
			ownership: {
				kind: "lease",
				leaseVersion: 8,
				lifecycleState: "STARTING",
			},
		});
		const leaseCommand = JSON.stringify(
			(commands.at(-1) as { input?: unknown }).input,
		);
		expect(leaseCommand).toContain("leaseVersion = :leaseVersion");
		expect(leaseCommand).toContain("#currentState = :ownedState");
		expect(leaseCommand).toContain('":ownedState":"STARTING"');
	});

	it("conditions adapter completion on zero pending events and generation", async () => {
		const commands: object[] = [];
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commands.push(command);
				return {};
			},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });
		await store.complete(request, 3, { type: "clean" });
		const serialized = JSON.stringify(
			(commands[0] as { input?: unknown }).input,
		);
		expect(serialized).toContain("pendingEventCount = :zero");
		expect(serialized).toContain("generation = :generation");
	});

	it("replays an adapter reservation only for the same idempotency token", async () => {
		let reservationItem: Record<string, unknown> | undefined;
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name === "GetCommand") {
					const key = (command as { input?: { Key?: { sk?: string } } }).input
						?.Key;
					if (key?.sk === "META") {
						return { Item: { lifecycleState: "RUNNING", generation: 1 } };
					}
					return reservationItem ? { Item: reservationItem } : {};
				}
				const input = (
					command as {
						input?: { TransactItems?: readonly Record<string, unknown>[] };
					}
				).input;
				const serialized = JSON.stringify(input);
				if (serialized.includes("reservationId")) {
					const token = serialized.includes("same-token")
						? "same-token"
						: "other-token";
					if (reservationItem) return {};
					reservationItem = {
						status: "pending",
						reservationId: `1:${token}`,
						reservationGeneration: 1,
						reservationOperation: "post",
						idempotencyToken: token,
					};
				}
				return {};
			},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });
		const write = {
			operation: "post" as const,
			request,
			generation: 1,
			finding,
			fingerprint,
			idempotencyToken: "same-token",
		};
		const first = await store.reserveFindingWrite(write);
		const replay = await store.reserveFindingWrite(write);
		expect(first).toMatchObject({ reserved: true });
		expect(replay).toEqual(first);
		expect(
			await store.reserveFindingWrite({
				...write,
				idempotencyToken: "other-token",
			}),
		).toMatchObject({ reserved: false, reason: "already-reserved" });
	});

	it("uses the scanned hashed sort-key boundary rather than sorted provider-event output", async () => {
		const ids = Array.from(
			{ length: 100 },
			(_, index) => `provider-event-${index}`,
		);
		const scanned = ids
			.map((id) => ({
				id,
				sk: `EVENT#${now}#${encodeStateKeyComponent(id)}`,
			}))
			.sort((left, right) => left.sk.localeCompare(right.sk));
		const firstBatch = scanned.slice(0, 99);
		const remaining = scanned.slice(99);
		const expectedBoundary = firstBatch.at(-1);
		if (expectedBoundary === undefined) {
			throw new Error("Expected the first event batch to include a boundary");
		}
		const remainingEvent = remaining[0];
		if (remainingEvent === undefined) {
			throw new Error("Expected an event to remain after the first batch");
		}
		let persistedCursor: string | undefined;
		let queryCount = 0;
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name === "GetCommand") {
					return {
						Item: {
							lifecycleState: "RUNNING",
							generation: 1,
							pendingEventCount: persistedCursor ? 1 : 100,
							...(persistedCursor ? { claimCursor: persistedCursor } : {}),
						},
					};
				}
				if (command.constructor.name === "QueryCommand") {
					queryCount += 1;
					const input = (
						command as {
							input?: { ExclusiveStartKey?: { pk?: string; sk?: string } };
						}
					).input;
					if (queryCount === 1) {
						expect(input?.ExclusiveStartKey).toBeUndefined();
						return {
							Items: scanned.map(({ id, sk }) => ({
								pk: "request",
								sk,
								eventId: id,
								eventType: "revision-updated",
								occurredAt: now,
								revision: "abcdef1",
								watermark: `${now}#${id}`,
							})),
							LastEvaluatedKey: { pk: "request", sk: remainingEvent.sk },
						};
					}
					expect(input?.ExclusiveStartKey?.sk).toBe(expectedBoundary.sk);
					return {
						Items: remaining.map(({ id, sk }) => ({
							pk: "request",
							sk,
							eventId: id,
							eventType: "revision-updated",
							occurredAt: now,
							revision: "abcdef1",
							watermark: `${now}#${id}`,
						})),
					};
				}
				if (command.constructor.name === "TransactWriteCommand") {
					const serialized = JSON.stringify(
						(command as { input?: unknown }).input,
					);
					const match = serialized.match(/claimCursor":"([^"]+)/);
					if (match) persistedCursor = match[1];
					return {};
				}
				return {};
			},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });
		expect((await store.claimEvents(request, 1)).events).toHaveLength(99);
		expect(persistedCursor).toBe(expectedBoundary.sk);
		expect((await store.claimEvents(request, 1)).events).toHaveLength(1);
		expect(expectedBoundary.id).not.toBe([...ids].sort().at(-1));
	});

	it("does not persist an unnecessary cursor when exactly 99 reach page end", async () => {
		const commands: object[] = [];
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commands.push(command);
				if (command.constructor.name === "GetCommand") {
					return {
						Item: {
							lifecycleState: "RUNNING",
							generation: 1,
							pendingEventCount: 99,
						},
					};
				}
				if (command.constructor.name === "QueryCommand") {
					return {
						Items: Array.from({ length: 99 }, (_, index) => ({
							pk: "request",
							sk: `EVENT#${now}#${encodeStateKeyComponent(`exact-${index}`)}`,
							eventId: `exact-${index}`,
							eventType: "revision-updated",
							occurredAt: now,
							revision: "abcdef1",
							watermark: `${now}#exact-${index}`,
						})),
					};
				}
				return {};
			},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });
		expect((await store.claimEvents(request, 1)).events).toHaveLength(99);
		expect(JSON.stringify(commands)).not.toContain('":claimCursor"');
	});

	it("invalidates a stale cursor when an out-of-order event is appended", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		for (let index = 0; index < 100; index += 1) {
			await store.appendEvent(
				revisionEvent(
					`cursor-${index}`,
					new Date(Date.parse(now) + index * 1_000).toISOString(),
				),
			);
		}
		await store.claimEvents(request, 1);
		expect(store.inspectRequest(request)?.claimCursor).toBeDefined();

		await store.appendEvent(
			revisionEvent("late-arrival", "2026-07-18T11:00:00.000Z"),
		);
		expect(store.inspectRequest(request)?.claimCursor).toBeUndefined();
		const claimed = await store.claimEvents(request, 1);
		expect(claimed.events.map(({ id }) => id)).toContain("late-arrival");
	});

	it("clears the persisted claim cursor when appending an event", async () => {
		const commands: object[] = [];
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commands.push(command);
				if (command.constructor.name === "GetCommand") {
					const input = (command as { input?: { Key?: { sk?: string } } })
						.input;
					if (input?.Key?.sk === "META") {
						return {
							Item: {
								pk: "REQUEST#v1~provider#v1~repository#v1~request",
								sk: "META",
								lifecycleState: "RUNNING",
								generation: 1,
								pendingEventCount: 1,
								claimCursor: "EVENT#cursor",
							},
						};
					}
					return {};
				}
				return {};
			},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });
		await store.appendEvent(revisionEvent("append-clears-cursor"));
		expect(JSON.stringify(commands)).toContain("REMOVE claimCursor");
	});

	it("preserves the last claimed item as the cursor at the 99-event page boundary", async () => {
		let claimCursor: string | undefined;
		let queryCount = 0;
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name === "GetCommand") {
					return {
						Item: {
							lifecycleState: "RUNNING",
							generation: 1,
							pendingEventCount: claimCursor === "EVENT#98" ? 1 : 100,
							...(claimCursor ? { claimCursor } : {}),
						},
					};
				}
				if (command.constructor.name === "QueryCommand") {
					queryCount += 1;
					const input = (
						command as {
							input?: { ExclusiveStartKey?: { pk?: string; sk?: string } };
						}
					).input;
					if (queryCount === 1) {
						expect(input?.ExclusiveStartKey).toBeUndefined();
						return {
							Items: Array.from({ length: 99 }, (_, index) => ({
								pk: "request",
								sk: `EVENT#${index}`,
								eventId: `event-${index}`,
								eventType: "revision-updated",
								occurredAt: now,
								revision: "abcdef1",
								watermark: `${now}#event-${index}`,
							})),
							LastEvaluatedKey: { pk: "request", sk: "EVENT#98" },
						};
					}
					expect(input?.ExclusiveStartKey?.pk).toMatch(/^REQUEST#/);
					expect(input?.ExclusiveStartKey?.sk).toBe("EVENT#98");
					return {
						Items: [
							{
								pk: "request",
								sk: "EVENT#99",
								eventId: "event-99",
								eventType: "revision-updated",
								occurredAt: now,
								revision: "abcdef1",
								watermark: `${now}#event-99`,
							},
						],
					};
				}
				if (command.constructor.name === "TransactWriteCommand") {
					const serialized = JSON.stringify(
						(command as { input?: unknown }).input,
					);
					if (serialized.includes('":claimCursor":"EVENT#98"')) {
						claimCursor = "EVENT#98";
					} else if (serialized.includes('":claimCursor":"EVENT#99"')) {
						claimCursor = "EVENT#99";
					}
					return {};
				}
				return {};
			},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });
		expect((await store.claimEvents(request, 1)).events).toHaveLength(99);
		expect(
			(await store.claimEvents(request, 1)).events.map(({ id }) => id),
		).toEqual(["event-99"]);
	});

	it("rejects a stale cursor claim after an append invalidates the cursor", async () => {
		let transactionCount = 0;
		let cursorInvalidated = false;
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name === "GetCommand") {
					return {
						Item: {
							lifecycleState: "RUNNING",
							generation: 1,
							pendingEventCount: 1,
							...(cursorInvalidated ? {} : { claimCursor: "EVENT#98" }),
						},
					};
				}
				if (command.constructor.name === "QueryCommand") {
					const input = (
						command as { input?: { ExclusiveStartKey?: { sk?: string } } }
					).input;
					if (!cursorInvalidated) {
						expect(input?.ExclusiveStartKey?.sk).toBe("EVENT#98");
						return {
							Items: [
								{
									pk: "request",
									sk: "EVENT#99",
									eventId: "stale-event",
									eventType: "revision-updated",
									occurredAt: now,
									revision: "abcdef1",
									watermark: `${now}#stale-event`,
								},
							],
						};
					}
					return {
						Items: [
							{
								pk: "request",
								sk: "EVENT#late",
								eventId: "late-event",
								eventType: "revision-updated",
								occurredAt: now,
								revision: "abcdef1",
								watermark: `${now}#late-event`,
							},
						],
					};
				}
				if (command.constructor.name === "TransactWriteCommand") {
					transactionCount += 1;
					const serialized = JSON.stringify(
						(command as { input?: unknown }).input,
					);
					if (transactionCount === 1) {
						expect(serialized).toContain("claimCursor = :observedCursor");
						cursorInvalidated = true;
						throw {
							name: "TransactionCanceledException",
							CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
						};
					}
					expect(serialized).toContain("attribute_not_exists(claimCursor)");
					return {};
				}
				return {};
			},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });
		expect(
			(await store.claimEvents(request, 1)).events.map(({ id }) => id),
		).toEqual(["late-event"]);
		expect(transactionCount).toBe(2);
	});

	it("retries an absent-cursor claim after an append changes the pending count", async () => {
		let transactionCount = 0;
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name === "GetCommand") {
					return {
						Item: {
							lifecycleState: "RUNNING",
							generation: 1,
							pendingEventCount: transactionCount === 0 ? 1 : 2,
						},
					};
				}
				if (command.constructor.name === "QueryCommand") {
					return {
						Items: [
							{
								pk: "request",
								sk: "EVENT#late",
								eventId: "late-event",
								eventType: "revision-updated",
								occurredAt: now,
								revision: "abcdef1",
								watermark: `${now}#late-event`,
							},
						],
					};
				}
				if (command.constructor.name === "TransactWriteCommand") {
					transactionCount += 1;
					const serialized = JSON.stringify(
						(command as { input?: unknown }).input,
					);
					expect(serialized).toContain(
						"pendingEventCount = :observedPendingCount",
					);
					if (transactionCount === 1) {
						throw {
							name: "TransactionCanceledException",
							CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
						};
					}
				}
				return {};
			},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });
		expect(
			(await store.claimEvents(request, 1)).events.map(({ id }) => id),
		).toEqual(["late-event"]);
		expect(transactionCount).toBe(2);
	});

	it("retries cursor-only metadata updates after an append race", async () => {
		let transactionCount = 0;
		let queryCount = 0;
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name === "GetCommand") {
					return {
						Item: {
							lifecycleState: "RUNNING",
							generation: 1,
							pendingEventCount: 0,
							...(queryCount > 1 ? { claimCursor: "EVENT#cursor" } : {}),
						},
					};
				}
				if (command.constructor.name === "QueryCommand") {
					queryCount += 1;
					return {
						Items: Array.from({ length: 100 }, (_, index) => ({
							pk: "request",
							sk: `EVENT#claimed-${queryCount}-${index}`,
							claimedGeneration: 1,
						})),
						LastEvaluatedKey: {
							pk: "request",
							sk: `EVENT#cursor-${queryCount}`,
						},
					};
				}
				if (command.constructor.name === "TransactWriteCommand") {
					transactionCount += 1;
					expect(
						JSON.stringify((command as { input?: unknown }).input),
					).toContain("pendingEventCount = :observedPendingCount");
					if (transactionCount === 1) {
						throw {
							name: "TransactionCanceledException",
							CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
						};
					}
				}
				return {};
			},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });
		await expect(store.claimEvents(request, 1)).resolves.toEqual({
			events: [],
		});
		expect(transactionCount).toBe(2);
	});

	it("compares lease recovery offsets as instants", async () => {
		const transport: DynamoDbDocumentTransport = {
			send: async (command) =>
				command.constructor.name === "GetCommand"
					? {
							Item: {
								lifecycleState: "WAITING",
								generation: 1,
								leaseVersion: 1,
								leaseExpiresAt: "2026-07-18T09:00:00.000Z",
								pendingEventCount: 1,
							},
						}
					: {},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });
		await expect(
			store.recoverLease({
				request,
				generation: 1,
				leaseVersion: 1,
				remoteStatus: "FAILED",
				recoveredAt: "2026-07-18T10:00:00+02:00",
			}),
		).resolves.toEqual({ recovered: false, reason: "active" });
	});

	it("continues claiming after more than four retained pages", async () => {
		const queries: object[] = [];
		let claimPage = 0;
		let cursor: string | undefined;
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name === "GetCommand") {
					return {
						Item: {
							lifecycleState: "RUNNING",
							generation: 1,
							pendingEventCount: 1,
							...(cursor ? { claimCursor: cursor } : {}),
						},
					};
				}
				if (command.constructor.name === "QueryCommand") {
					queries.push(command);
					claimPage += 1;
					const input = (
						command as { input?: { ExclusiveStartKey?: { sk?: string } } }
					).input;
					if (claimPage <= 4) {
						return {
							Items: Array.from({ length: 100 }, (_, index) => ({
								pk: "request",
								sk: `EVENT#${claimPage}-${index}`,
								eventId: `claimed-${claimPage}-${index}`,
								eventType: "revision-updated",
								occurredAt: now,
								revision: "abcdef1",
								watermark: `${now}#claimed-${claimPage}-${index}`,
								claimedGeneration: 1,
							})),
							LastEvaluatedKey: {
								pk: "request",
								sk: `EVENT#${claimPage}-99`,
							},
						};
					}
					expect(input?.ExclusiveStartKey?.sk).toBe("EVENT#4-99");
					return {
						Items: [
							{
								pk: "request",
								sk: "EVENT#later",
								eventId: "later",
								eventType: "revision-updated",
								occurredAt: now,
								revision: "abcdef1",
								watermark: `${now}#later`,
							},
						],
					};
				}
				if (command.constructor.name === "TransactWriteCommand") {
					const serialized = JSON.stringify(
						(command as { input?: unknown }).input,
					);
					if (serialized.includes("EVENT#4-99")) cursor = "EVENT#4-99";
				}
				return {};
			},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });
		expect((await store.claimEvents(request, 1)).events).toHaveLength(0);
		expect(
			(await store.claimEvents(request, 1)).events.map(({ id }) => id),
		).toEqual(["later"]);
		expect(queries.length).toBeGreaterThan(4);
	});

	it("uses a bounded query page budget while claiming events", async () => {
		const queries: object[] = [];
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name === "GetCommand") {
					return {
						Item: {
							lifecycleState: "RUNNING",
							generation: 1,
							pendingEventCount: 0,
						},
					};
				}
				if (command.constructor.name === "QueryCommand") {
					queries.push(command);
					return { Items: [] };
				}
				return {};
			},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });
		await store.claimEvents(request, 1);
		expect(queries.length).toBeLessThanOrEqual(4);
		expect(JSON.stringify(queries[0])).toContain("Limit");
	});

	it("classifies conditional completion cancellation from fresh metadata", async () => {
		const conditional = Object.assign(new Error("conditional"), {
			name: "TransactionCanceledException",
			CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
		});
		let completionAttempted = false;
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name === "TransactWriteCommand") {
					completionAttempted = true;
					throw conditional;
				}
				return completionAttempted
					? {
							Item: {
								generation: 1,
								lifecycleState: "COMPLETED",
								pendingEventCount: 0,
							},
						}
					: {
							Item: {
								generation: 1,
								lifecycleState: "RUNNING",
								pendingEventCount: 0,
							},
						};
			},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });
		await expect(
			store.complete(request, 1, { type: "clean" }),
		).rejects.toBeInstanceOf(StaleStateError);
		expect(PendingWorkError).toBeDefined();
	});

	it("classifies stale FAILED ownership before pending work", async () => {
		const conditional = Object.assign(new Error("conditional"), {
			name: "TransactionCanceledException",
			CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
		});
		const failure = {
			type: "operational-failure",
			lifecycleState: "FAILED",
			operation: "callback",
			reason: "retry-exhausted",
			attempts: 2,
			lastError: { name: "ThrottlingException", message: "throttled" },
		} as const;
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name === "TransactWriteCommand") {
					throw conditional;
				}
				return {
					Item: {
						generation: 3,
						lifecycleState: "WAITING",
						pendingEventCount: 1,
						leaseVersion: 8,
						callbackId: "callback-new",
						callbackGeneration: 5,
					},
				};
			},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });

		await expect(
			store.complete(request, 3, {
				type: "failed",
				failure,
				ownership: {
					kind: "callback",
					callbackId: "callback-old",
					callbackGeneration: 4,
					leaseVersion: 7,
				},
			}),
		).rejects.toBeInstanceOf(StaleStateError);
		await expect(
			store.complete(request, 3, {
				type: "failed",
				failure: { ...failure, operation: "status" },
				ownership: {
					kind: "lease",
					leaseVersion: 7,
					lifecycleState: "WAITING",
				},
			}),
		).rejects.toBeInstanceOf(StaleStateError);
	});

	it("preserves pending-work classification for the current FAILED owner", async () => {
		const conditional = Object.assign(new Error("conditional"), {
			name: "TransactionCanceledException",
			CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
		});
		const failure = {
			type: "operational-failure",
			lifecycleState: "FAILED",
			operation: "callback",
			reason: "retry-exhausted",
			attempts: 2,
			lastError: { name: "ThrottlingException", message: "throttled" },
		} as const;
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name === "TransactWriteCommand") {
					throw conditional;
				}
				return {
					Item: {
						generation: 3,
						lifecycleState: "WAITING",
						pendingEventCount: 1,
						leaseVersion: 7,
						callbackId: "callback-current",
						callbackGeneration: 4,
					},
				};
			},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });

		await expect(
			store.complete(request, 3, {
				type: "failed",
				failure,
				ownership: {
					kind: "callback",
					callbackId: "callback-current",
					callbackGeneration: 4,
					leaseVersion: 7,
				},
			}),
		).rejects.toBeInstanceOf(PendingWorkError);
	});

	it("performs the callback inbox check after its conditional transaction", async () => {
		let callbackPersisted = false;
		const commandOrder: string[] = [];
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commandOrder.push(command.constructor.name);
				if (command.constructor.name === "TransactWriteCommand") {
					callbackPersisted = true;
					return {};
				}
				return {
					Item: callbackPersisted
						? { generation: 1, lifecycleState: "WAITING", pendingEventCount: 1 }
						: undefined,
				};
			},
		};
		const store = new DynamoDbStateStore({
			transport,
			tableName: "review-state",
			clock: () => new Date(now),
		});

		expect(
			await store.registerCallback({
				request,
				generation: 1,
				callbackGeneration: 1,
				callbackId: "callback-race",
				registeredAt: now,
				leaseVersion: 1,
				lifecycleState: "WAITING",
			}),
		).toEqual({ registered: true, hasPendingEvents: true });
		expect(commandOrder).toEqual(["TransactWriteCommand", "GetCommand"]);
	});

	it("conditions lease recovery on the observed generation and lease version", async () => {
		const commands: object[] = [];
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commands.push(command);
				if (command.constructor.name === "GetCommand") {
					return {
						Item: {
							lifecycleState: "WAITING",
							generation: 4,
							leaseVersion: 7,
							leaseExpiresAt: "2026-07-18T11:59:00.000Z",
							pendingEventCount: 1,
						},
					};
				}
				return {};
			},
		};
		const store = new DynamoDbStateStore({
			transport,
			tableName: "review-state",
			clock: () => new Date(now),
		});

		expect(
			await store.recoverLease({
				request,
				generation: 4,
				leaseVersion: 7,
				remoteStatus: "SUCCEEDED",
				recoveredAt: now,
			}),
		).toEqual({
			recovered: true,
			generation: 5,
			leaseVersion: 8,
			shouldStart: true,
		});
		const transaction = commands.at(-1) as {
			input?: { TransactItems?: readonly Record<string, unknown>[] };
		};
		const serialized = JSON.stringify(transaction.input);
		expect(serialized).toContain("leaseVersion = :leaseVersion");
		expect(serialized).toContain('":leaseVersion":7');
		expect(serialized).toContain("pendingEventCount > :zero");
		expect(serialized).toContain("REMOVE executionArn");
		expect(serialized).toContain("#cycle");
		expect(serialized).toContain("sourceRevision");
		expect(serialized).toContain("eventWatermark");
	});

	it("atomically restarts terminal pending work without requiring remote status or lease expiry", async () => {
		const commands: object[] = [];
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commands.push(command);
				if (command.constructor.name === "GetCommand") {
					return {
						Item: {
							lifecycleState: "FAILED",
							generation: 4,
							leaseVersion: 7,
							leaseExpiresAt: "2026-07-18T13:00:00.000Z",
							pendingEventCount: 1,
							executionArn: "arn:stale",
							cycle: 3,
							sourceRevision: "stale-source",
						},
					};
				}
				return {};
			},
		};
		const store = new DynamoDbStateStore({
			transport,
			tableName: "review-state",
			clock: () => new Date(now),
		});

		expect(
			await store.recoverLease({
				request,
				generation: 4,
				leaseVersion: 7,
				recoveredAt: now,
			}),
		).toEqual({
			recovered: true,
			generation: 5,
			leaseVersion: 8,
			shouldStart: true,
		});
		const transaction = commands.at(-1) as {
			input?: {
				TransactItems?: readonly {
					Update?: { ConditionExpression?: string; UpdateExpression?: string };
				}[];
			};
		};
		const update = transaction.input?.TransactItems?.[0]?.Update;
		expect(update?.ConditionExpression).not.toContain("leaseExpiresAt <=");
		expect(update?.ConditionExpression).toContain("pendingEventCount > :zero");
		expect(update?.UpdateExpression).toContain("REMOVE executionArn");
		expect(update?.UpdateExpression).toContain("#cycle");
	});

	it("marks duplicate terminal delivery with pending work as recovery eligible", async () => {
		let gets = 0;
		const terminalMeta = {
			lifecycleState: "FAILED",
			generation: 4,
			leaseVersion: 7,
			leaseExpiresAt: "2026-07-18T13:00:00.000Z",
			pendingEventCount: 1,
		};
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name !== "GetCommand") return {};
				gets += 1;
				return gets === 2
					? { Item: { pk: "event", sk: "event" } }
					: { Item: terminalMeta };
			},
		};
		const store = new DynamoDbStateStore({
			transport,
			tableName: "review-state",
			clock: () => new Date(now),
		});

		expect(
			await store.appendEvent(revisionEvent("terminal-replay")),
		).toMatchObject({
			appended: false,
			generation: 4,
			leaseVersion: 7,
			lifecycleState: "FAILED",
			recoveryEligible: true,
		});
	});

	it("reloads authoritative lease ownership after a recovery conditional race", async () => {
		let gets = 0;
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name === "GetCommand") {
					gets += 1;
					return {
						Item:
							gets === 1
								? {
										lifecycleState: "RUNNING",
										generation: 1,
										leaseVersion: 1,
										leaseExpiresAt: "2026-07-18T11:59:00.000Z",
										pendingEventCount: 1,
									}
								: {
										lifecycleState: "STARTING",
										generation: 2,
										leaseVersion: 2,
										leaseExpiresAt: "2026-07-18T12:05:00.000Z",
										pendingEventCount: 1,
									},
					};
				}
				throw {
					name: "TransactionCanceledException",
					CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
				};
			},
		};
		const store = new DynamoDbStateStore({
			transport,
			tableName: "review-state",
			clock: () => new Date(now),
		});

		expect(
			await store.recoverLease({
				request,
				generation: 1,
				leaseVersion: 1,
				remoteStatus: "FAILED",
				recoveredAt: now,
			}),
		).toEqual({
			recovered: false,
			reason: "changed",
			generation: 2,
			leaseVersion: 2,
		});
		expect(gets).toBe(2);
	});

	it("aliases cycle in beginCycle DynamoDB expressions", async () => {
		const commands: object[] = [];
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commands.push(command);
				return {};
			},
		};
		const store = new DynamoDbStateStore({
			transport,
			tableName: "review-state",
			clock: () => new Date(now),
		});
		await store.beginCycle({
			request,
			generation: 1,
			cycle: 1,
			sourceRevision: "abcdef1",
			destinationRevision: "1234567",
			configVersion: 1,
			eventWatermark: "2026-07-18T12:00:00.000Z#push-1",
			startedAt: now,
		});

		const serialized = JSON.stringify(
			(commands[0] as { input?: unknown }).input,
		);
		expect(serialized).toContain('"#cycle":"cycle"');
		expect(serialized).toContain("#cycle = :cycle");
		expect(serialized).toContain("attribute_not_exists(#cycle)");
		expect(serialized).toContain("#state = :running");
		expect(serialized).not.toContain("attribute_not_exists(cycle)");
	});

	it("encodes request-key components and canonicalizes event timestamps", async () => {
		const commands: object[] = [];
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commands.push(command);
				return {};
			},
		};
		const store = new DynamoDbStateStore({
			transport,
			tableName: "review-state",
			clock: () => new Date(now),
		});
		const keys = [
			{ provider: "a#b", repository: "c", requestId: "d" },
			{ provider: "a", repository: "b#c", requestId: "d" },
			{ provider: "a%23b", repository: "c", requestId: "d" },
		] as const;
		for (const [index, key] of keys.entries()) {
			await store.appendEvent({
				...revisionEvent(`encoded-${index}`, "2026-07-18T12:00:00.000+02:00"),
				request: key,
			});
		}
		const serialized = commands
			.filter((command) => command.constructor.name === "TransactWriteCommand")
			.map((command) => JSON.stringify((command as { input?: unknown }).input));
		const partitionKeys = serialized.map(
			(value) => value.match(/REQUEST#[^"]+/)?.[0] ?? "",
		);
		expect(new Set(partitionKeys).size).toBe(3);
		for (const partitionKey of partitionKeys) {
			expect(partitionKey).toMatch(
				/^REQUEST#v1~[A-Za-z0-9_-]{43}#v1~[A-Za-z0-9_-]{43}#v1~[A-Za-z0-9_-]{43}$/,
			);
		}
		expect(serialized[0]).toMatch(
			/EVENT#2026-07-18T10:00:00.000Z#v1~[A-Za-z0-9_-]{43}/,
		);
	});

	it("bounds maximum UTF-8 request and event identifiers in every generated key", async () => {
		const commands: object[] = [];
		let reservingFinding = false;
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commands.push(command);
				if (command.constructor.name !== "GetCommand") return {};
				const sk = (command as { input?: { Key?: { sk?: string } } }).input?.Key
					?.sk;
				return reservingFinding && sk === "META"
					? { Item: { lifecycleState: "RUNNING", generation: 1 } }
					: {};
			},
		};
		const store = new DynamoDbStateStore({
			transport,
			tableName: "review-state",
			clock: () => new Date(now),
		});
		const highByte = "界".repeat(512);
		const alternateHighByte = `${"界".repeat(511)}語`;
		const firstRequest = {
			provider: highByte,
			repository: highByte,
			requestId: highByte,
		} as const;
		const secondRequest = {
			provider: highByte,
			repository: highByte,
			requestId: alternateHighByte,
		} as const;
		const firstEventId = "😀".repeat(256);
		const secondEventId = `${"😀".repeat(255)}😁`;

		await store.appendEvent({
			...revisionEvent(firstEventId, "2026-07-18T12:00:00.000+02:00"),
			request: firstRequest,
		});
		await store.appendEvent({
			...revisionEvent(secondEventId, "2026-07-18T12:00:00.000+02:00"),
			request: secondRequest,
		});
		reservingFinding = true;
		await store.reserveFindingWrite({
			operation: "post",
			request: firstRequest,
			generation: 1,
			finding,
			fingerprint,
			idempotencyToken: "maximum-key-finding",
		});

		const transactions = commands.filter(
			(command) => command.constructor.name === "TransactWriteCommand",
		) as { input?: { TransactItems?: readonly Record<string, unknown>[] } }[];
		const serialized = transactions.map((command) =>
			JSON.stringify(command.input),
		);
		const keys = serialized.flatMap((value) =>
			[...value.matchAll(/"(?:pk|sk)":"([^"]+)"/g)].map((match) => {
				const key = match[1];
				if (key === undefined) {
					throw new Error("Expected the key pattern to include a capture");
				}
				return key;
			}),
		);
		const partitionKeys = keys.filter((key) => key.startsWith("REQUEST#"));
		const eventKeys = keys.filter((key) => key.startsWith("EVENT#"));
		const findingKeys = keys.filter((key) => key.startsWith("FINDING#"));

		expect(new Set(partitionKeys).size).toBe(2);
		expect(new Set(eventKeys).size).toBe(2);
		for (const key of partitionKeys) {
			expect(key).toMatch(
				/^REQUEST#v1~[A-Za-z0-9_-]{43}#v1~[A-Za-z0-9_-]{43}#v1~[A-Za-z0-9_-]{43}$/,
			);
			expect(Buffer.byteLength(key, "utf8")).toBeLessThanOrEqual(2048);
		}
		for (const key of eventKeys) {
			expect(key).toMatch(
				/^EVENT#2026-07-18T10:00:00\.000Z#v1~[A-Za-z0-9_-]{43}$/,
			);
			expect(Buffer.byteLength(key, "utf8")).toBeLessThanOrEqual(1024);
		}
		expect(findingKeys).toHaveLength(1);
		const findingKey = findingKeys[0];
		if (findingKey === undefined) {
			throw new Error("Expected a serialized finding key");
		}
		expect(findingKey).toBe(`FINDING#${fingerprint}`);
		expect(Buffer.byteLength(findingKey, "utf8")).toBeLessThanOrEqual(1024);

		const firstItems = transactions[0]?.input?.TransactItems as
			| readonly {
					Put?: { Item?: Readonly<Record<string, unknown>> };
			  }[]
			| undefined;
		expect(firstItems?.[0]?.Put?.Item?.eventId).toBe(firstEventId);
		expect(firstItems?.[1]?.Put?.Item).toMatchObject({
			provider: firstRequest.provider,
			repository: firstRequest.repository,
			requestId: firstRequest.requestId,
		});
	});

	it("resets generation-local metadata in terminal append transitions", async () => {
		const commands: object[] = [];
		let getCount = 0;
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commands.push(command);
				if (command.constructor.name === "GetCommand") {
					getCount += 1;
					return getCount === 1
						? {
								Item: {
									lifecycleState: "COMPLETED",
									generation: 3,
									leaseVersion: 8,
									cycle: 2,
								},
							}
						: {};
				}
				return {};
			},
		};
		const store = new DynamoDbStateStore({
			transport,
			tableName: "review-state",
			clock: () => new Date(now),
		});
		await store.appendEvent(revisionEvent("restart"));
		const transaction = commands.find(
			(command) => command.constructor.name === "TransactWriteCommand",
		) as { input?: unknown };
		const serialized = JSON.stringify(transaction.input);
		expect(serialized).toContain("generation = :nextGeneration");
		expect(serialized).toContain("#cycle");
		expect(serialized).toContain("sourceRevision");
		expect(serialized).toContain("destinationRevision");
		expect(serialized).toContain("eventWatermark");
		expect(serialized).toContain("retryExhaustion");
		expect(serialized).toContain("lastPipelineRoutingFailure");
	});

	it("only treats retained conditional cancellation reasons as contention", async () => {
		const conditional = Object.assign(new Error("conditional"), {
			name: "TransactionCanceledException",
			CancellationReasons: [
				{ Code: "ConditionalCheckFailed" },
				{ Code: "None" },
			],
		});
		let canceled = false;
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name === "TransactWriteCommand") {
					canceled = true;
					throw conditional;
				}
				const sk = (command as { input?: { Key?: { sk?: string } } }).input?.Key
					?.sk;
				if (canceled && sk === "META") {
					return { Item: { generation: 1, lifecycleState: "STARTING" } };
				}
				if (canceled && sk?.startsWith("EVENT#")) return { Item: { pk: "x" } };
				return {};
			},
		};
		const store = new DynamoDbStateStore({ transport, tableName: "state" });
		await expect(
			store.appendEvent(revisionEvent("conditional")),
		).resolves.toMatchObject({
			appended: false,
		});
	});

	it("rethrows unsafe transaction cancellation shapes from append", async () => {
		const unsafe = [
			Object.assign(new Error("missing reasons"), {
				name: "TransactionCanceledException",
			}),
			Object.assign(new Error("none only"), {
				name: "TransactionCanceledException",
				CancellationReasons: [{ Code: "None" }],
			}),
			Object.assign(new Error("standalone conditional"), {
				name: "ConditionalCheckFailedException",
			}),
			Object.assign(new Error("conflict"), {
				name: "TransactionCanceledException",
				CancellationReasons: [{ Code: "TransactionConflict" }],
			}),
			Object.assign(new Error("throttle"), {
				name: "TransactionCanceledException",
				CancellationReasons: [{ Code: "ThrottlingError" }],
			}),
			Object.assign(new Error("validation"), {
				name: "ValidationException",
			}),
		];
		for (const error of unsafe) {
			const transport: DynamoDbDocumentTransport = {
				send: async (command) => {
					if (command.constructor.name === "TransactWriteCommand") throw error;
					return {};
				},
			};
			const store = new DynamoDbStateStore({ transport, tableName: "state" });
			await expect(
				store.appendEvent(revisionEvent(error.message)),
			).rejects.toBe(error);
		}
	});

	it("rethrows transaction conflicts from reserve and recovery", async () => {
		const conflict = Object.assign(new Error("conflict"), {
			name: "TransactionCanceledException",
			CancellationReasons: [{ Code: "TransactionConflict" }],
		});
		let gets = 0;
		const reserveTransport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name === "TransactWriteCommand") throw conflict;
				gets += 1;
				return gets === 1
					? { Item: { lifecycleState: "RUNNING", generation: 1 } }
					: {};
			},
		};
		const reserveStore = new DynamoDbStateStore({
			transport: reserveTransport,
			tableName: "state",
		});
		await expect(
			reserveStore.reserveFindingWrite({
				operation: "post",
				request,
				generation: 1,
				finding,
				fingerprint,
				idempotencyToken: "conflict",
			}),
		).rejects.toBe(conflict);

		const recoveryTransport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name === "TransactWriteCommand") throw conflict;
				return {
					Item: {
						lifecycleState: "WAITING",
						generation: 1,
						leaseVersion: 1,
						leaseExpiresAt: "2026-07-18T11:00:00.000Z",
						pendingEventCount: 1,
					},
				};
			},
		};
		const recoveryStore = new DynamoDbStateStore({
			transport: recoveryTransport,
			tableName: "state",
		});
		await expect(
			recoveryStore.recoverLease({
				request,
				generation: 1,
				leaseVersion: 1,
				remoteStatus: "FAILED",
				recoveredAt: now,
			}),
		).rejects.toBe(conflict);
	});

	it("atomically requeues a claimed pipeline page on the same generation", async () => {
		const store = new InMemoryStateStore({ clock: () => new Date(now) });
		const event = revisionEvent("pipeline-requeue");
		await store.appendEvent(event);
		const claimed = await store.claimEvents(request, 1);

		const result = await store.failAndRequeueClaim({
			request,
			generation: 1,
			leaseVersion: 1,
			events: claimed.events,
			failedAt: now,
			failure: {
				type: "operational-failure",
				lifecycleState: "FAILED",
				operation: "raw secret operation",
				reason: "retry-exhausted",
				attempts: 999,
				lastError: { name: "SecretError", message: "secret message" },
			},
		});

		expect(result).toEqual({ requeued: true, leaseVersion: 2 });
		expect(store.inspectRequest(request)).toMatchObject({
			lifecycleState: "STARTING",
			generation: 1,
			leaseVersion: 2,
			leaseExpiresAt: now,
			lastPipelineRoutingFailure: {
				operation: "pipeline-route",
				attempts: 4,
				lastError: {
					name: "PipelineRoutingError",
					message: "Pipeline routing failed",
				},
			},
		});
		expect((await store.claimEvents(request, 1)).events).toEqual([event]);
	});

	it("uses one conditional transaction to requeue META and claimed event markers", async () => {
		const commands: object[] = [];
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commands.push(command);
				return {};
			},
		};
		const store = new DynamoDbStateStore({
			transport,
			tableName: "review-state",
			clock: () => new Date(now),
		});
		const events = [revisionEvent("claimed-one"), revisionEvent("claimed-two")];

		expect(
			await store.failAndRequeueClaim({
				request,
				generation: 3,
				leaseVersion: 8,
				events,
				failedAt: now,
				failure: {
					type: "operational-failure",
					lifecycleState: "FAILED",
					operation: "secret-operation",
					reason: "permanent-error",
					attempts: 99,
					lastError: { name: "Secret", message: "secret payload" },
				},
			}),
		).toEqual({ requeued: true, leaseVersion: 9 });

		await store.failAndRequeueClaim({
			request,
			generation: 3,
			leaseVersion: 8,
			events: [...events].reverse(),
			failedAt: "2026-07-18T12:00:01.000Z",
			failure: {
				type: "operational-failure",
				lifecycleState: "FAILED",
				operation: "different-secret-operation",
				reason: "permanent-error",
				attempts: 1,
				lastError: { name: "DifferentSecret", message: "different secret" },
			},
		});

		expect(commands).toHaveLength(2);
		const [transaction, retry] = commands as Array<{
			input?: {
				ClientRequestToken?: string;
				TransactItems?: readonly Record<string, unknown>[];
			};
		}>;
		expect(transaction?.constructor.name).toBe("TransactWriteCommand");
		expect(transaction?.input?.TransactItems).toHaveLength(3);
		expect(transaction?.input?.ClientRequestToken).toHaveLength(36);
		expect(retry?.input?.ClientRequestToken).toBe(
			transaction?.input?.ClientRequestToken,
		);
		const serialized = JSON.stringify(transaction?.input);
		expect(serialized).toContain(
			"generation = :generation AND leaseVersion = :leaseVersion AND #state = :running",
		);
		expect(serialized).toContain(
			"ADD pendingEventCount :claimedCount, leaseVersion :one",
		);
		expect(serialized).toContain("REMOVE claimedGeneration");
		expect(serialized).toContain("claimedGeneration = :generation");
		expect(serialized).toContain("lastPipelineRoutingFailure");
		expect(serialized).toContain('"operation":"pipeline-route"');
		expect(serialized).not.toContain("secret");
	});

	it("recognizes a committed requeue after its transaction response is lost", async () => {
		const event = revisionEvent("requeue-response-lost");
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name === "TransactWriteCommand") {
					throw new Error("response lost after commit");
				}
				const key = (command as { input?: { Key?: { sk?: string } } }).input
					?.Key;
				if (key?.sk === "META") {
					return {
						Item: {
							generation: 3,
							leaseVersion: 9,
							lifecycleState: "STARTING",
							leaseExpiresAt: now,
							pendingEventCount: 1,
						},
					};
				}
				return {
					Item: {
						eventId: event.id,
						occurredAt: event.occurredAt,
					},
				};
			},
		};
		const store = new DynamoDbStateStore({
			transport,
			tableName: "review-state",
		});

		expect(
			await store.failAndRequeueClaim({
				request,
				generation: 3,
				leaseVersion: 8,
				events: [event],
				failedAt: now,
				failure: {
					type: "operational-failure",
					lifecycleState: "FAILED",
					operation: "pipeline-route",
					reason: "retry-exhausted",
					attempts: 1,
					lastError: {
						name: "PipelineRoutingError",
						message: "Pipeline routing failed",
					},
				},
			}),
		).toEqual({ requeued: true, leaseVersion: 9 });
	});

	it("uses one ownership-conditioned transaction to recover an expired orphan claim", async () => {
		const commands: object[] = [];
		const claimed = revisionEvent("orphaned");
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commands.push(command);
				if (command.constructor.name === "GetCommand") {
					return {
						Item: {
							generation: 3,
							leaseVersion: 8,
							lifecycleState: "RUNNING",
							leaseExpiresAt: "2026-07-18T11:59:00.000Z",
							pendingEventCount: 0,
						},
					};
				}
				if (command.constructor.name === "QueryCommand") {
					return {
						Items: [
							{
								pk: "request",
								sk: "EVENT#orphaned",
								eventType: claimed.type,
								eventId: claimed.id,
								occurredAt: claimed.occurredAt,
								watermark: `${claimed.occurredAt}#${claimed.id}`,
								revision: claimed.revision,
								claimedGeneration: 3,
							},
						],
					};
				}
				return {};
			},
		};
		const store = new DynamoDbStateStore({
			transport,
			tableName: "review-state",
			clock: () => new Date(now),
		});

		expect(
			await store.recoverOrphanedPipelineClaim({
				request,
				generation: 3,
				leaseVersion: 8,
				recoveredAt: now,
			}),
		).toEqual({ recovered: true, generation: 3, leaseVersion: 9 });
		const transaction = commands.find(
			(command) => command.constructor.name === "TransactWriteCommand",
		) as { input?: { TransactItems?: readonly Record<string, unknown>[] } };
		const claimQuery = commands.find(
			(command) => command.constructor.name === "QueryCommand",
		) as { input?: { ScanIndexForward?: boolean } };
		expect(claimQuery.input?.ScanIndexForward).toBe(false);
		expect(transaction.input?.TransactItems).toHaveLength(2);
		const serialized = JSON.stringify(transaction.input);
		expect(serialized).toContain("leaseExpiresAt <= :recoveredAt");
		expect(serialized).toContain(
			"generation = :generation AND leaseVersion = :leaseVersion AND #state = :observedState",
		);
		expect(serialized).toContain(
			"ADD pendingEventCount :claimedCount, leaseVersion :one",
		);
		expect(serialized).toContain("claimedGeneration = :generation");
		expect(transaction.input?.TransactItems).toHaveLength(2);
	});

	it("searches past 500 newer unclaimed events to recover an older orphan claim", async () => {
		const commands: object[] = [];
		const claimed = revisionEvent("hidden-orphan");
		let queryPage = 0;
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commands.push(command);
				if (command.constructor.name === "GetCommand") {
					return {
						Item: {
							generation: 3,
							leaseVersion: 8,
							lifecycleState: "RUNNING",
							leaseExpiresAt: "2026-07-18T11:59:00.000Z",
							pendingEventCount: 401,
						},
					};
				}
				if (command.constructor.name === "QueryCommand") {
					queryPage += 1;
					if (queryPage <= 5) {
						return {
							Items: [],
							ScannedCount: 100,
							LastEvaluatedKey: {
								pk: "request",
								sk: `EVENT#${queryPage * 100}`,
							},
						};
					}
					return {
						Items: [
							{
								pk: "request",
								sk: "EVENT#hidden-orphan",
								eventType: claimed.type,
								eventId: claimed.id,
								occurredAt: claimed.occurredAt,
								watermark: `${claimed.occurredAt}#${claimed.id}`,
								revision: claimed.revision,
								claimedGeneration: 3,
							},
						],
					};
				}
				return {};
			},
		};
		const store = new DynamoDbStateStore({
			transport,
			tableName: "review-state",
			clock: () => new Date(now),
		});

		expect(
			await store.recoverOrphanedPipelineClaim({
				request,
				generation: 3,
				leaseVersion: 8,
				recoveredAt: now,
			}),
		).toEqual({ recovered: true, generation: 3, leaseVersion: 9 });
		expect(queryPage).toBe(6);
		expect(
			commands.filter(
				(command) => command.constructor.name === "TransactWriteCommand",
			),
		).toHaveLength(1);
	});

	it("conditionally gets, creates, and completes an immutable dispatch intent", async () => {
		const commands: object[] = [];
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commands.push(command);
				return command.constructor.name === "GetCommand" ? {} : {};
			},
		};
		const store = new DynamoDbStateStore({
			transport,
			tableName: "review-state",
			clock: () => new Date(now),
		});
		const intent = {
			request,
			generation: 3,
			dispatchIdentity: "dispatch-identity",
			status: "PENDING" as const,
			sourceRevision: "abcdef1",
			destinationRevision: "1234567",
			observedAt: now,
			eventId: "intent-event",
		};
		const ownership = { kind: "pipeline-only" as const, leaseVersion: 8 };

		expect(
			await store.getOrCreatePipelineDispatchIntent(intent, ownership),
		).toEqual(intent);
		expect(
			await store.completePipelineDispatchIntent(
				{
					...intent,
					executionId: "execution-1",
					mappingIdentity: "execution-1",
				},
				ownership,
			),
		).toEqual({ completed: true });
		const transactions = commands.filter(
			(command) => command.constructor.name === "TransactWriteCommand",
		) as { input?: { TransactItems?: readonly Record<string, unknown>[] } }[];
		expect(transactions).toHaveLength(2);
		const create = JSON.stringify(transactions[0]?.input);
		expect(create).toContain("generation = :generation");
		expect(create).toContain("leaseVersion = :leaseVersion");
		expect(create).toContain("#state = :running");
		expect(create).toContain("attribute_not_exists(pk)");
		const completeInput = transactions[1]?.input as
			| { ClientRequestToken?: string }
			| undefined;
		const complete = JSON.stringify(completeInput);
		expect(complete).toContain("sourceRevision = :sourceRevision");
		expect(complete).toContain("destinationRevision = :destinationRevision");
		expect(complete).toContain("eventId = :eventId");
		expect(complete).toContain("SET #dispatchStatus = :completed");
		expect(complete).toContain("executionId = :executionId");
		expect(complete).toContain("mappingIdentity = :mappingIdentity");
		expect(complete).not.toContain('"Delete"');
		expect(completeInput?.ClientRequestToken).toHaveLength(36);
	});

	it("recognizes a completed intent after its transaction response is lost", async () => {
		let transactionAttempted = false;
		const intent = {
			request,
			generation: 3,
			dispatchIdentity: "response-lost-intent",
			status: "PENDING" as const,
			sourceRevision: "abcdef1",
			destinationRevision: "1234567",
			observedAt: now,
			eventId: "intent-event",
		};
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				if (command.constructor.name === "TransactWriteCommand") {
					transactionAttempted = true;
					throw new Error("response lost");
				}
				return transactionAttempted
					? {
							Item: {
								...intent,
								status: "COMPLETED",
							},
						}
					: {};
			},
		};
		const store = new DynamoDbStateStore({
			transport,
			tableName: "review-state",
		});

		expect(
			await store.completePipelineDispatchIntent(intent, {
				kind: "pipeline-only",
				leaseVersion: 8,
			}),
		).toEqual({ completed: true });
	});

	it("removes non-terminal pipeline routing failure metadata on completion", async () => {
		const commands: object[] = [];
		const store = new DynamoDbStateStore({
			transport: {
				send: async (command) => {
					commands.push(command);
					return {};
				},
			},
			tableName: "review-state",
		});

		await store.complete(request, 1, { type: "clean" });

		const serialized = JSON.stringify(
			(commands[0] as { input?: unknown }).input,
		);
		expect(serialized).toContain("REMOVE");
		expect(serialized).toContain("lastPipelineRoutingFailure");
	});

	it("returns changed when the atomic claim requeue loses ownership", async () => {
		const conditional = Object.assign(new Error("conditional"), {
			name: "TransactionCanceledException",
			CancellationReasons: [
				{ Code: "ConditionalCheckFailed" },
				{ Code: "None" },
			],
		});
		const store = new DynamoDbStateStore({
			transport: { send: async () => Promise.reject(conditional) },
			tableName: "review-state",
		});

		expect(
			await store.failAndRequeueClaim({
				request,
				generation: 1,
				leaseVersion: 2,
				events: [revisionEvent("changed")],
				failedAt: now,
				failure: {
					type: "operational-failure",
					lifecycleState: "FAILED",
					operation: "pipeline-route",
					reason: "retry-exhausted",
					attempts: 1,
					lastError: {
						name: "PipelineRoutingError",
						message: "Pipeline routing failed",
					},
				},
			}),
		).toEqual({ requeued: false, reason: "changed" });
	});

	it("canonicalizes heartbeat and callback lease conditions", async () => {
		const commands: object[] = [];
		const transport: DynamoDbDocumentTransport = {
			send: async (command) => {
				commands.push(command);
				return command.constructor.name === "GetCommand"
					? {
							Item: {
								generation: 1,
								lifecycleState: "WAITING",
								pendingEventCount: 0,
							},
						}
					: {};
			},
		};
		const store = new DynamoDbStateStore({
			transport,
			tableName: "state",
			clock: () => new Date(now),
		});

		await store.heartbeat({
			request,
			generation: 1,
			leaseVersion: 1,
			heartbeatAt: "2026-07-18T14:00:10.000+02:00",
		});
		await store.registerCallback({
			request,
			generation: 1,
			leaseVersion: 1,
			callbackGeneration: 1,
			callbackId: "callback",
			lifecycleState: "WAITING",
			registeredAt: "2026-07-18T07:00:10.000-05:00",
		});

		const transactions = commands.filter(
			(command) => command.constructor.name === "TransactWriteCommand",
		) as { input?: { TransactItems?: readonly Record<string, unknown>[] } }[];
		expect(transactions).toHaveLength(2);
		const heartbeat = JSON.stringify(transactions[0]?.input);
		expect(heartbeat).toContain("leaseHeartbeatAt < :heartbeat");
		expect(heartbeat).toContain('":heartbeat":"2026-07-18T12:00:10.000Z"');
		const callback = JSON.stringify(transactions[1]?.input);
		// registerCallback no longer gates on lease validity (it establishes the
		// parked lease); it only checks generation, leaseVersion, lifecycle, and
		// callback-generation monotonicity.
		expect(callback).not.toContain("leaseExpiresAt > :heartbeat");
		expect(callback).toContain("leaseVersion = :leaseVersion");
		expect(callback).toContain('":heartbeat":"2026-07-18T12:00:10.000Z"');
	});
});
