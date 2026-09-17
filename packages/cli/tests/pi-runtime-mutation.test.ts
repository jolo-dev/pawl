import { describe, expect, test } from "bun:test";
import { createMutationCoordinator } from "../src/pi-runtime/mutation";

/**
 * Task 6 mutation coordinator: one session-wide permit shared by the root
 * and all specialists. Mutations serialize; the permit is released on every
 * exit; cancelled waiters never enter; and a parent awaiting a mutating child
 * must not hold the permit during the delegation wait.
 */

describe("serialization", () => {
	test("concurrent mutations run one at a time in FIFO order", async () => {
		const coordinator = createMutationCoordinator();
		const events: string[] = [];
		const operation = (name: string) => async () => {
			events.push(`${name}:start`);
			await Bun.sleep(5);
			events.push(`${name}:end`);
		};
		const first = coordinator.run(operation("root"));
		const second = coordinator.run(operation("child"));
		await Promise.all([first, second]);
		expect(events).toEqual([
			"root:start",
			"root:end",
			"child:start",
			"child:end",
		]);
	});

	test("the permit is released on failure and the next waiter proceeds", async () => {
		const coordinator = createMutationCoordinator();
		const events: string[] = [];
		const failing = coordinator.run(async () => {
			events.push("failing:start");
			throw new Error("mutation failed");
		});
		await expect(failing).rejects.toThrow("mutation failed");
		const next = await coordinator.run(async () => {
			expect(coordinator.held).toBe(true);
			events.push("next");
			return "done";
		});
		expect(next).toBe("done");
		expect(events).toEqual(["failing:start", "next"]);
		expect(coordinator.held).toBe(false);
	});
});

describe("cancellation", () => {
	test("a cancelled waiter never enters the permit", async () => {
		const coordinator = createMutationCoordinator();
		const cancel = new AbortController();
		let releaseHolder: (() => void) | undefined;
		const holder = coordinator.run(
			() =>
				new Promise<void>((resolve) => {
					releaseHolder = resolve;
				}),
		);
		// Give the holder time to acquire.
		await Bun.sleep(1);
		expect(coordinator.held).toBe(true);
		const waiter = coordinator.run(async () => "should never run", {
			signal: cancel.signal,
		});
		const later = coordinator.run(async () => "later");
		cancel.abort();
		await expect(waiter).rejects.toThrow();
		releaseHolder?.();
		await holder;
		// The cancelled waiter consumed nothing; the next waiter proceeds.
		expect(await later).toBe("later");
		expect(coordinator.held).toBe(false);
		expect(coordinator.queued).toBe(0);
	});

	test("an already-aborted caller never queues", async () => {
		const coordinator = createMutationCoordinator();
		const signal = AbortSignal.abort();
		await expect(
			coordinator.run(async () => "never", { signal }),
		).rejects.toThrow();
		expect(coordinator.held).toBe(false);
	});

	test("a caller aborting mid-operation releases the permit via the lease signal", async () => {
		const coordinator = createMutationCoordinator();
		const cancel = new AbortController();
		const operation = coordinator.run(
			(lease) =>
				new Promise<string>((_resolve, reject) => {
					lease.signal.addEventListener(
						"abort",
						() => reject(new Error("aborted")),
						{ once: true },
					);
				}),
			{ signal: cancel.signal },
		);
		await Bun.sleep(1);
		cancel.abort();
		await expect(operation).rejects.toThrow("aborted");
		expect(coordinator.held).toBe(false);
		const next = await coordinator.run(async () => "recovers");
		expect(next).toBe("recovers");
	});
});

describe("parent delegation", () => {
	test("a parent awaiting a mutating child does not hold the permit", async () => {
		const coordinator = createMutationCoordinator();
		const observedDuringDelegation: boolean[] = [];
		// The delegation path itself must not wrap the child in the parent's
		// permit: the parent awaits the child's own mutation directly, so the
		// permit is free until the child's executor acquires it.
		const parent = (async () => {
			observedDuringDelegation.push(coordinator.held);
			const result = await coordinator.run(async () => {
				observedDuringDelegation.push(coordinator.held);
				return "child-done";
			});
			observedDuringDelegation.push(coordinator.held);
			return result;
		})();
		expect(await parent).toBe("child-done");
		expect(observedDuringDelegation).toEqual([false, true, false]);
		expect(coordinator.held).toBe(false);
	});

	test("root and child mutations serialize across the shared coordinator", async () => {
		const coordinator = createMutationCoordinator();
		const events: string[] = [];
		const mutate = (name: string) =>
			coordinator.run(async () => {
				events.push(`${name}:start`);
				await Bun.sleep(2);
				events.push(`${name}:end`);
			});
		await Promise.all([mutate("root"), mutate("child:generate")]);
		expect(events).toEqual([
			"root:start",
			"root:end",
			"child:generate:start",
			"child:generate:end",
		]);
	});
});
