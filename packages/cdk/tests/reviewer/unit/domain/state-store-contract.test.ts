import { expect, it } from "bun:test";
import type {
	CallbackRegistration,
	PipelineDispatchIntent,
} from "../../../../src/reviewer/ports/state-store";
import { InMemoryStateStore } from "../../fakes/in-memory-state-store";

const common = {
	request: {
		provider: "codecommit",
		repository: "orders",
		requestId: "42",
	},
	generation: 2,
	callbackGeneration: 3,
	callbackId: "callback-4",
	registeredAt: "2026-07-18T12:00:00.000Z",
	leaseVersion: 7,
} as const;

const waitingRegistration = {
	...common,
	lifecycleState: "WAITING",
} as const satisfies CallbackRegistration;

const blockedRegistration = {
	...common,
	lifecycleState: "BLOCKED_LIMIT",
	blockedLimit: {
		reason: "max-diff-bytes",
		observed: 1_500_000,
		maximum: 1_000_000,
	},
} as const satisfies CallbackRegistration;

const acceptsCallbackRegistration = (_input: CallbackRegistration): void => {};

// @ts-expect-error BLOCKED_LIMIT must include its trusted limit detail.
acceptsCallbackRegistration({ ...common, lifecycleState: "BLOCKED_LIMIT" });

it("models conditional WAITING and BLOCKED_LIMIT callback transitions", () => {
	expect(waitingRegistration.lifecycleState).toBe("WAITING");
	expect(blockedRegistration.lifecycleState).toBe("BLOCKED_LIMIT");
	expect(blockedRegistration.blockedLimit.reason).toBe("max-diff-bytes");
});

it("fake heartbeat renews only active matching leases", async () => {
	const request = {
		provider: "codecommit",
		repository: "orders",
		requestId: "42",
	} as const;
	const clock = () => new Date("2026-07-18T12:00:00.000Z");
	const store = new InMemoryStateStore({ clock });
	await store.appendEvent({
		id: "event",
		type: "request-opened",
		request,
		occurredAt: "2026-07-18T12:00:00.000Z",
	});
	expect(
		await store.heartbeat({
			request,
			generation: 1,
			leaseVersion: 1,
			heartbeatAt: "2026-07-18T12:00:00.000Z",
		}),
	).toEqual({ renewed: false, reason: "stale" });
	await store.recordExecution(request, 1, "arn:execution");
	expect(
		await store.heartbeat({
			request,
			generation: 1,
			leaseVersion: 1,
			heartbeatAt: "2026-07-18T12:00:01.000Z",
		}),
	).toEqual({ renewed: true, leaseVersion: 2 });
	await store.claimEvents(request, 1);
	await store.complete(request, 1, { type: "clean" });
	expect(
		await store.heartbeat({
			request,
			generation: 1,
			leaseVersion: 1,
			heartbeatAt: "2026-07-18T12:00:02.000Z",
		}),
	).toEqual({ renewed: false, reason: "stale" });
});

it("requires the exact current lease version after heartbeat and recovery", async () => {
	const request = {
		provider: "codecommit",
		repository: "orders",
		requestId: "lease-version",
	} as const;
	const clock = { value: new Date("2026-07-18T12:00:00.000Z") };
	const store = new InMemoryStateStore({
		clock: () => clock.value,
		leaseDurationSeconds: 60,
	});
	await store.appendEvent({
		id: "event",
		type: "request-opened",
		request,
		occurredAt: clock.value.toISOString(),
	});
	await store.recordExecution(request, 1, "arn:execution");
	expect(
		await store.heartbeat({
			request,
			generation: 1,
			leaseVersion: 1,
			heartbeatAt: "2026-07-18T12:00:01.000Z",
		}),
	).toEqual({ renewed: true, leaseVersion: 2 });
	expect(
		await store.registerCallback({
			request,
			generation: 1,
			callbackGeneration: 1,
			callbackId: "heartbeat-callback",
			registeredAt: "2026-07-18T12:00:02.000Z",
			leaseVersion: 1,
			lifecycleState: "WAITING",
		}),
	).toEqual({ registered: false, reason: "state-changed" });
	expect(
		await store.registerCallback({
			request,
			generation: 1,
			callbackGeneration: 1,
			callbackId: "heartbeat-callback",
			registeredAt: "2026-07-18T12:00:02.000Z",
			leaseVersion: 2,
			lifecycleState: "WAITING",
		}),
	).toMatchObject({ registered: true });

	await store.clearCallback({ request, generation: 1, callbackGeneration: 1 });
	await store.appendEvent({
		id: "event-2",
		type: "request-opened",
		request,
		occurredAt: "2026-07-18T12:00:03.000Z",
	});
	clock.value = new Date("2026-07-18T12:02:00.000Z");
	const recovery = await store.recoverLease({
		request,
		generation: 1,
		leaseVersion: 2,
		remoteStatus: "FAILED",
		recoveredAt: clock.value.toISOString(),
	});
	expect(recovery).toEqual({
		recovered: true,
		generation: 2,
		shouldStart: true,
		leaseVersion: 3,
	});
	if (!recovery.recovered) throw new Error("expected recovery");
	await store.recordExecution(request, recovery.generation, "arn:execution:2");
	expect(
		await store.registerCallback({
			request,
			generation: recovery.generation,
			callbackGeneration: 2,
			callbackId: "recovered-callback",
			registeredAt: "2026-07-18T12:02:01.000Z",
			leaseVersion: 2,
			lifecycleState: "WAITING",
		}),
	).toEqual({ registered: false, reason: "state-changed" });
	expect(
		await store.registerCallback({
			request,
			generation: recovery.generation,
			callbackGeneration: 2,
			callbackId: "recovered-callback",
			registeredAt: "2026-07-18T12:02:01.000Z",
			leaseVersion: recovery.leaseVersion,
			lifecycleState: "WAITING",
		}),
	).toMatchObject({ registered: true });
});

it("recovers an expired pipeline-only orphan claim on the same generation", async () => {
	const clock = { value: new Date("2026-07-18T12:00:00.000Z") };
	const store = new InMemoryStateStore({
		clock: () => clock.value,
		leaseDurationSeconds: 60,
	});
	const request = { ...common.request, requestId: "orphan" };
	const event = {
		id: "orphan-event",
		type: "revision-updated" as const,
		request,
		occurredAt: clock.value.toISOString(),
		revision: "abcdef1",
	};
	await store.appendEvent(event);
	await store.claimEvents(request, 1);

	expect(
		await store.recoverOrphanedPipelineClaim({
			request,
			generation: 1,
			leaseVersion: 1,
			recoveredAt: clock.value.toISOString(),
		}),
	).toEqual({ recovered: false, reason: "active" });
	clock.value = new Date("2026-07-18T12:01:01.000Z");
	expect(
		await store.recoverOrphanedPipelineClaim({
			request,
			generation: 1,
			leaseVersion: 1,
			recoveredAt: clock.value.toISOString(),
		}),
	).toEqual({ recovered: true, generation: 1, leaseVersion: 2 });
	expect(store.inspectRequest(request)).toMatchObject({
		lifecycleState: "STARTING",
		generation: 1,
		leaseVersion: 2,
		leaseExpiresAt: clock.value.toISOString(),
		pendingEventCount: 1,
	});
});

it("gets or creates one immutable pipeline dispatch intent and clears it exactly", async () => {
	const store = new InMemoryStateStore({
		clock: () => new Date("2026-07-18T12:00:00.000Z"),
	});
	const request = { ...common.request, requestId: "dispatch-intent" };
	await store.appendEvent({
		id: "intent-event",
		type: "revision-updated",
		request,
		occurredAt: "2026-07-18T12:00:00.000Z",
		revision: "abcdef1",
	});
	await store.claimEvents(request, 1);
	const first = {
		request,
		generation: 1,
		sourceRevision: "abcdef1",
		destinationRevision: "1234567",
		observedAt: "2026-07-18T12:00:00.000Z",
		eventId: "intent-event",
	} satisfies PipelineDispatchIntent;
	const changed = {
		...first,
		sourceRevision: "bcdef12",
		destinationRevision: "2345678",
	};

	expect(await store.getOrCreatePipelineDispatchIntent(first, 1)).toEqual(
		first,
	);
	expect(await store.getOrCreatePipelineDispatchIntent(changed, 1)).toEqual(
		first,
	);
	expect(await store.getPipelineDispatchIntent(request, 1)).toEqual(first);
	expect(await store.completePipelineDispatchIntent(changed, 1)).toEqual({
		completed: false,
		reason: "changed",
	});
	expect(await store.completePipelineDispatchIntent(first, 1)).toEqual({
		completed: true,
	});
	expect(await store.getPipelineDispatchIntent(request, 1)).toBeUndefined();
});

it("canonicalizes lease instants and never moves a heartbeat backward", async () => {
	const request = {
		provider: "codecommit",
		repository: "orders",
		requestId: "43",
	} as const;
	const store = new InMemoryStateStore({
		clock: () => new Date("2026-07-18T12:00:00.000Z"),
	});
	await store.appendEvent({
		id: "event",
		type: "request-opened",
		request,
		occurredAt: "2026-07-18T12:00:00.000Z",
	});
	await store.recordExecution(request, 1, "arn:execution");

	expect(
		await store.heartbeat({
			request,
			generation: 1,
			leaseVersion: 1,
			heartbeatAt: "2026-07-18T14:00:10.000+02:00",
		}),
	).toEqual({ renewed: true, leaseVersion: 2 });
	expect(store.inspectRequest(request)?.leaseHeartbeatAt).toBe(
		"2026-07-18T12:00:10.000Z",
	);

	expect(
		await store.registerCallback({
			...common,
			request,
			generation: 1,
			leaseVersion: 2,
			lifecycleState: "WAITING",
			registeredAt: "2026-07-18T12:00:05.000Z",
		}),
	).toEqual({ registered: false, reason: "state-changed" });
	expect(store.inspectRequest(request)?.leaseHeartbeatAt).toBe(
		"2026-07-18T12:00:10.000Z",
	);

	expect(
		await store.heartbeat({
			request,
			generation: 1,
			leaseVersion: 2,
			heartbeatAt: "2026-07-18T07:00:10.000-05:00",
		}),
	).toEqual({ renewed: false, reason: "stale" });
	expect(
		await store.registerCallback({
			...common,
			request,
			generation: 1,
			leaseVersion: 2,
			callbackGeneration: 1,
			lifecycleState: "WAITING",
			registeredAt: "2026-07-18T13:00:10.000+01:00",
		}),
	).toMatchObject({ registered: true });
	expect(store.inspectRequest(request)?.leaseHeartbeatAt).toBe(
		"2026-07-18T12:00:10.000Z",
	);
});
