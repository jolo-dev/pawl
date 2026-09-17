import { createHash } from "node:crypto";
import { z } from "zod";
import { APPROVAL_TIMEOUT_MS, type PolicyDependencies } from "./policy";

export { APPROVAL_TIMEOUT_MS };

/**
 * Abortable approval broker for one session.
 *
 * An approval is bound to run/request/tool-call ids, canonical tool
 * arguments, the plan/artifact digest, the project directory and the checked
 * AWS identity. A surfaced question never implies authorization: the broker
 * only issues a one-use grant after an explicit approve answer, and the grant
 * must be consumed at the actual executor/write boundary after revalidating
 * the binding. Grants live in memory only — they are never persisted and a
 * restart revokes them, so restart-recovered approvals cannot execute.
 *
 * Decisions are requested before acquiring the mutation permit; a denial,
 * expiry, cancellation or invalid request settles the wait with no grant so
 * the affected operation stops.
 */

const identitySchema = z.strictObject({
	accountId: z.string().regex(/^\d{12}$/),
	region: z.string().min(1),
});

export const ApprovalBindingSchema = z.strictObject({
	runId: z.string().min(1),
	toolCallId: z.string().min(1),
	toolName: z.string().min(1),
	/** Canonical (schema-parsed) tool input. Must be JSON-serializable. */
	input: z.unknown(),
	/** Digest of the approved plan/preview artifact material. */
	planDigest: z.string().min(1),
	projectDir: z.string().min(1),
	/** Checked execution identity at request time. */
	identity: identitySchema,
	/** False (e.g. a truncated preview) immediately fails the request. */
	previewComplete: z.boolean(),
});

export interface ApprovalBinding {
	readonly runId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly input: unknown;
	readonly planDigest: string;
	readonly projectDir: string;
	readonly identity: { readonly accountId: string; readonly region: string };
	readonly previewComplete: boolean;
}

/** Deterministic JSON with sorted object keys for canonical argument hashing. */
export function stableStringify(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "boolean" || typeof value === "number") {
		return JSON.stringify(value);
	}
	if (typeof value === "string") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries
			.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
			.join(",")}}`;
	}
	throw new Error(`Value is not JSON-serializable: ${typeof value}`);
}

/** SHA-256 digest over the full binding, including canonical arguments. */
export function approvalBindingDigest(binding: ApprovalBinding): string {
	return createHash("sha256").update(stableStringify(binding)).digest("hex");
}

export const APPROVAL_QUESTION_OPTIONS = [
	{ id: "approve", label: "Approve" },
	{ id: "deny", label: "Deny" },
] as const;

export interface ApprovalQuestion {
	readonly requestId: string;
	readonly prompt: string;
	readonly options: readonly { readonly id: string; readonly label: string }[];
}

export type GrantConsumption =
	| { readonly ok: true }
	| {
			readonly ok: false;
			readonly reason: "consumed" | "expired" | "mismatch" | "revoked";
			readonly message: string;
	  };

export interface ApprovalGrant {
	readonly requestId: string;
	readonly digest: string;
	/**
	 * Consume at the actual executor/write boundary with the binding
	 * reconstructed from current inputs. One use; any changed dimension
	 * (arguments, digest, project, identity, tool call) fails closed.
	 */
	consume(binding: ApprovalBinding): GrantConsumption;
}

export type ApprovalOutcome =
	| { readonly granted: true; readonly grant: ApprovalGrant }
	| {
			readonly granted: false;
			readonly reason: "denied" | "expired" | "cancelled" | "invalid";
			readonly message: string;
	  };

export interface ApprovalBrokerOptions {
	readonly now?: () => number;
	readonly timeoutMs?: number;
	readonly scheduleTimeout?: PolicyDependencies["scheduleTimeout"];
	/** Parent run/context signal: aborting it settles every pending request. */
	readonly signal?: AbortSignal;
	/** Surfaces the question to the UI; answering is a separate act. */
	readonly onRequest?: (question: ApprovalQuestion) => void;
}

interface GrantState {
	readonly requestId: string;
	readonly digest: string;
	readonly expiresAt: number;
	consumed: boolean;
	revoked: boolean;
}

interface PendingRequest {
	readonly requestId: string;
	readonly digest: string;
	readonly expiresAt: number;
	readonly settle: (outcome: ApprovalOutcome) => void;
	readonly clearTimer: () => void;
}

function rejection(
	reason: Extract<ApprovalOutcome, { granted: false }>["reason"],
	message: string,
): ApprovalOutcome {
	return { granted: false, reason, message };
}

export class ApprovalBroker {
	private readonly now: () => number;
	private readonly timeoutMs: number;
	private readonly scheduleTimeout: PolicyDependencies["scheduleTimeout"];
	private readonly onRequest: (question: ApprovalQuestion) => void;
	private readonly parentSignal: AbortSignal | undefined;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly grants = new Map<string, GrantState>();
	private counter = 0;
	private restarted = false;
	private readonly abortHandler: (() => void) | undefined;

	constructor(options: ApprovalBrokerOptions = {}) {
		this.now = options.now ?? Date.now;
		this.timeoutMs = options.timeoutMs ?? APPROVAL_TIMEOUT_MS;
		this.scheduleTimeout =
			options.scheduleTimeout ??
			((handler, ms) => {
				const timer = setTimeout(handler, ms);
				return () => clearTimeout(timer);
			});
		this.onRequest = options.onRequest ?? (() => {});
		this.parentSignal = options.signal;
		if (this.parentSignal) {
			if (this.parentSignal.aborted) {
				this.restarted = true; // a dead context approves nothing
			} else {
				this.abortHandler = () => {
					for (const request of [...this.pending.values()]) {
						this.settle(
							request.requestId,
							rejection("cancelled", "The parent run was cancelled"),
						);
					}
				};
				this.parentSignal.addEventListener("abort", this.abortHandler, {
					once: true,
				});
			}
		}
	}

	/** Number of live pending requests. */
	get pendingCount(): number {
		return this.pending.size;
	}

	/**
	 * Requests a fresh decision. Resolves with a one-use grant only after an
	 * explicit approve answer; every other path fails closed.
	 */
	request(rawBinding: ApprovalBinding): Promise<ApprovalOutcome> {
		const parsed = ApprovalBindingSchema.safeParse(rawBinding);
		const serializable = (() => {
			try {
				stableStringify(rawBinding.input);
				return true;
			} catch {
				return false;
			}
		})();
		if (
			!parsed.success ||
			!serializable ||
			!("input" in rawBinding) ||
			rawBinding.input === undefined
		) {
			return Promise.resolve(
				rejection(
					"invalid",
					"Approval binding was invalid; refusing to surface a request",
				),
			);
		}
		const binding = parsed.data;
		if (!binding.previewComplete) {
			return Promise.resolve(
				rejection(
					"invalid",
					"The preview is truncated or incomplete; deploy approval is disabled until a complete view is available",
				),
			);
		}
		if (this.restarted) {
			return Promise.resolve(
				rejection(
					"cancelled",
					"The session restarted; a new approval must be requested",
				),
			);
		}
		const digest = approvalBindingDigest(binding);
		this.counter += 1;
		const requestId = `approval_${this.counter}`;
		const expiresAt = this.now() + this.timeoutMs;
		return new Promise<ApprovalOutcome>((resolve) => {
			const clearTimer = this.scheduleTimeout(() => {
				this.settle(
					requestId,
					rejection("expired", "The approval request expired unanswered"),
				);
			}, this.timeoutMs);
			this.pending.set(requestId, {
				requestId,
				digest,
				expiresAt,
				settle: resolve,
				clearTimer,
			});
			this.onRequest({
				requestId,
				prompt: `Allow ${binding.toolName} (${binding.toolCallId}) on ${binding.identity.accountId} in ${binding.identity.region}?`,
				options: APPROVAL_QUESTION_OPTIONS,
			});
		});
	}

	/**
	 * Delivers a one-use answer for a live request. Stale, duplicate and
	 * unknown answers reject; a text answer is a denial, never an approval.
	 */
	async answer(answer: {
		requestId: string;
		choice:
			| { readonly kind: "option"; readonly value: string }
			| { readonly kind: "text"; readonly value: string };
	}): Promise<void> {
		const request = this.pending.get(answer.requestId);
		if (!request) {
			throw new Error(
				`Approval request ${answer.requestId} is unknown, stale or already resolved`,
			);
		}
		if (answer.choice.kind === "option" && answer.choice.value === "approve") {
			const state: GrantState = {
				requestId: answer.requestId,
				digest: request.digest,
				expiresAt: request.expiresAt,
				consumed: false,
				revoked: false,
			};
			this.grants.set(answer.requestId, state);
			this.settle(answer.requestId, {
				granted: true,
				grant: this.grantOf(state),
			});
			return;
		}
		this.settle(
			answer.requestId,
			rejection(
				"denied",
				"The approval was denied or was not an explicit approve answer",
			),
		);
	}

	/**
	 * Simulates/propagates a session restart: pending requests settle as
	 * cancelled and every outstanding grant is revoked. Grants are never
	 * persisted, so nothing survives a restart.
	 */
	restart(): void {
		this.restarted = true;
		for (const request of [...this.pending.values()]) {
			this.settle(
				request.requestId,
				rejection("cancelled", "The session restarted"),
			);
		}
		for (const state of this.grants.values()) {
			state.revoked = true;
		}
	}

	private grantOf(state: GrantState): ApprovalGrant {
		return {
			requestId: state.requestId,
			digest: state.digest,
			consume: (binding: ApprovalBinding): GrantConsumption => {
				if (state.revoked) {
					return {
						ok: false,
						reason: "revoked",
						message:
							"The approval was revoked by a session restart; it is never persisted",
					};
				}
				if (state.consumed) {
					return {
						ok: false,
						reason: "consumed",
						message:
							"The approval grant was already consumed; approvals are one-use",
					};
				}
				if (this.now() >= state.expiresAt) {
					return {
						ok: false,
						reason: "expired",
						message: "The approval grant expired before it was consumed",
					};
				}
				const parsed = ApprovalBindingSchema.safeParse(binding);
				if (!parsed.success) {
					return {
						ok: false,
						reason: "mismatch",
						message: "The consumption binding was invalid",
					};
				}
				if (approvalBindingDigest(parsed.data) !== state.digest) {
					return {
						ok: false,
						reason: "mismatch",
						message:
							"The binding at the write boundary differs from the approved binding (arguments, digest, project, identity or tool call changed)",
					};
				}
				state.consumed = true;
				return { ok: true };
			},
		};
	}

	private settle(requestId: string, outcome: ApprovalOutcome): void {
		const request = this.pending.get(requestId);
		if (!request) return;
		this.pending.delete(requestId);
		request.clearTimer();
		request.settle(outcome);
	}
}
