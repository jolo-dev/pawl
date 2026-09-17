/**
 * Session-wide mutation coordinator.
 *
 * One exclusive permit serializes mutating operations across the root agent
 * and every specialist child — not merely Pi's per-agent sequential tool
 * setting. Callers request their approval decision before acquiring the
 * permit, acquire around the actual mutation execution, and the permit is
 * released on every exit path. Cancelled waiters never enter, and a parent
 * awaiting a mutating child must not hold the permit across the delegation
 * wait (the child's executor acquires it directly).
 */

export interface MutationLease {
	/** The caller's signal; long mutations must honor it and settle. */
	readonly signal: AbortSignal;
}

export interface MutationRunOptions {
	readonly signal?: AbortSignal;
	/** Diagnostic owner label (for example "root" or "child:generator"). */
	readonly owner?: string;
}

export interface MutationCoordinator {
	/**
	 * Runs the operation while holding the exclusive permit. Rejections from
	 * the operation and from a cancelled wait propagate; the permit is always
	 * released.
	 */
	run<T>(
		operation: (lease: MutationLease) => Promise<T>,
		options?: MutationRunOptions,
	): Promise<T>;
	readonly held: boolean;
	readonly queued: number;
}

interface Waiter {
	readonly signal: AbortSignal | undefined;
	readonly start: (lease: MutationLease) => void;
	readonly fail: (reason: unknown) => void;
	/** Guards against a double settle (abort listener vs pump). */
	readonly settled: { value: boolean };
	/** Drops the waiter promptly when its signal aborts while queued. */
	readonly onAbort: () => void;
}

function cancellationReason(signal: AbortSignal | undefined): unknown {
	return signal?.reason ?? new Error("The mutation wait was cancelled");
}

export function createMutationCoordinator(): MutationCoordinator {
	let held = false;
	const queue: Waiter[] = [];

	const isCancelled = (signal: AbortSignal | undefined): boolean =>
		signal?.aborted === true;

	const detach = (waiter: Waiter) => {
		waiter.signal?.removeEventListener("abort", waiter.onAbort);
	};

	const pump = () => {
		while (!held && queue.length > 0) {
			const waiter = queue[0];
			if (!waiter) return;
			if (isCancelled(waiter.signal)) {
				// Cancelled waiters are dropped without ever entering.
				queue.shift();
				detach(waiter);
				waiter.fail(cancellationReason(waiter.signal));
				continue;
			}
			held = true;
			queue.shift();
			detach(waiter);
			const leaseSignal = waiter.signal ?? new AbortController().signal;
			waiter.start({ signal: leaseSignal });
			return;
		}
	};

	const coordinator: MutationCoordinator = {
		get held() {
			return held;
		},
		get queued() {
			return queue.length;
		},
		run<T>(
			operation: (lease: MutationLease) => Promise<T>,
			options: MutationRunOptions = {},
		): Promise<T> {
			const signal = options.signal;
			if (isCancelled(signal)) {
				return Promise.reject(cancellationReason(signal));
			}
			return new Promise<T>((resolve, reject) => {
				const settled = { value: false };
				const waiter: Waiter = {
					signal,
					settled,
					start: (lease) => {
						// Release on every exit path before settling the caller.
						void (async () => {
							try {
								resolve(await operation(lease));
							} catch (error) {
								reject(error);
							} finally {
								held = false;
								pump();
							}
						})();
					},
					fail: (reason) => {
						if (settled.value) return;
						settled.value = true;
						reject(reason);
					},
					onAbort: () => {
						if (settled.value) return;
						const index = queue.indexOf(waiter);
						if (index >= 0) queue.splice(index, 1);
						// fail owns the settled flag and the reject.
						waiter.fail(cancellationReason(waiter.signal));
					},
				};
				if (signal) {
					signal.addEventListener("abort", waiter.onAbort, { once: true });
				}
				queue.push(waiter);
				pump();
			});
		},
	};
	return coordinator;
}
