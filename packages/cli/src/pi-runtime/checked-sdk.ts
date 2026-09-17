import type { HttpHandlerOptions } from "@smithy/core/protocols";
import type { CredentialLease, CredentialSnapshot } from "./execution-context";

export interface SdkExecutionContext {
	readonly region: string;
	readonly signal: AbortSignal;
	checkedCredentials(signal?: AbortSignal): Promise<CredentialSnapshot>;
	credentialLease(
		snapshot: CredentialSnapshot,
		signal?: AbortSignal,
	): CredentialLease;
	/** Scan scopes must not turn a security refusal into optional-tag coverage. */
	onCredentialRefusal?(error: unknown): void;
}
export interface CheckedSdkConfiguration {
	readonly region: string;
	readonly credentials: () => Promise<CredentialSnapshot>;
	readonly ignoreConfiguredEndpointUrls: true;
}
type LegacySignal = Exclude<
	HttpHandlerOptions["abortSignal"],
	AbortSignal | undefined
>;
const legacyListeners = new WeakMap<
	LegacySignal,
	{
		listeners: Set<() => void>;
		original: LegacySignal["onabort"];
		handler: (...args: unknown[]) => void;
	}
>();

function listenForAbort(
	signal: HttpHandlerOptions["abortSignal"],
	abort: () => void,
): () => void {
	if (!signal) return () => {};
	if (signal.aborted) abort();
	if (signal instanceof AbortSignal) {
		signal.addEventListener("abort", abort, { once: true });
		return () => signal.removeEventListener("abort", abort);
	}
	// Legacy SDK signals have one onabort slot rather than addEventListener.
	// Share its bridge so concurrent command cleanup cannot restore dead listeners.
	let bridge = legacyListeners.get(signal);
	if (!bridge) {
		const listeners = new Set<() => void>();
		const original = signal.onabort;
		const handler = (...args: unknown[]) => {
			try {
				if (typeof original === "function")
					Reflect.apply(original, signal, args);
			} finally {
				for (const listener of listeners) listener();
			}
		};
		bridge = { listeners, original, handler };
		legacyListeners.set(signal, bridge);
		signal.onabort = handler;
	}
	const current = bridge;
	current.listeners.add(abort);
	return () => {
		current.listeners.delete(abort);
		if (current.listeners.size === 0) {
			if (signal.onabort === current.handler) signal.onabort = current.original;
			legacyListeners.delete(signal);
		}
	};
}

/** Every command owns its client and frozen signing snapshot. The service-local
 * installer uses public deserialize middleware to guard every transport attempt. */
export function createCheckedSdkExecutor<C extends { destroy(): void }>(
	context: SdkExecutionContext,
	factory: (config: CheckedSdkConfiguration) => C,
	installGuard: (client: C, guard: () => Promise<void>) => void,
	operationSignal?: AbortSignal,
) {
	return async function execute<T>(
		operation: (client: C, signal: AbortSignal) => Promise<T>,
		sdkSignal?: HttpHandlerOptions["abortSignal"],
	): Promise<T> {
		const controller = new AbortController();
		const onAbort = () =>
			controller.abort(new DOMException("SDK operation aborted", "AbortError"));
		const removeListener = listenForAbort(sdkSignal, onAbort);
		const signal = AbortSignal.any([
			context.signal,
			controller.signal,
			...(operationSignal ? [operationSignal] : []),
		]);
		let client: C | undefined;
		let lease: CredentialLease | undefined;
		const leaseAborted = () =>
			context.onCredentialRefusal?.(lease?.signal.reason);
		try {
			signal.throwIfAborted();
			const check = async () => {
				try {
					return await context.checkedCredentials(signal);
				} catch (error) {
					context.onCredentialRefusal?.(error);
					throw error;
				}
			};
			const snapshot = await check();
			signal.throwIfAborted();
			try {
				lease = context.credentialLease(snapshot, signal);
			} catch (error) {
				context.onCredentialRefusal?.(error);
				throw error;
			}
			const commandLease = lease;
			commandLease.signal.addEventListener("abort", leaseAborted, {
				once: true,
			});
			client = factory({
				region: context.region,
				credentials: async () => snapshot,
				ignoreConfiguredEndpointUrls: true,
			});
			installGuard(client, async () => {
				try {
					commandLease.validate();
				} catch (error) {
					context.onCredentialRefusal?.(error);
					throw error;
				}
			});
			const result = await operation(client, commandLease.signal);
			commandLease.validate();
			return result;
		} finally {
			removeListener();
			lease?.signal.removeEventListener("abort", leaseAborted);
			lease?.dispose();
			client?.destroy();
		}
	};
}
