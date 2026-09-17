import type { Context } from "@earendil-works/pi-ai";
import { z } from "zod";

/**
 * Finite runtime policy for one accepted user prompt.
 *
 * The plan's fixed proof defaults live here. The policy object is created per
 * accepted prompt and shared by the root agent and every specialist child, so
 * budgets and the run deadline are shared counters, never independent child
 * counters. Checks are atomic reservations made immediately before a model
 * request or tool execution starts; exhaustion rejects instead of throwing
 * from Pi hooks (whose contract forbids rejection), aborts the shared
 * cancellation signal and lets the runtime surface a normal terminal/error
 * outcome. A fresh explicit prompt creates a new policy; an input answer or an
 * automatic follow-up iteration must reuse the prompt's policy.
 */

// ---- Fixed proof defaults (approved plan table) ----

/** Model calls per accepted prompt, including failed/dispatched requests. */
export const MAX_MODEL_CALLS_PER_PROMPT = 32;
/** Tool executions per prompt, counted immediately before execution. */
export const MAX_TOOL_EXECUTIONS_PER_PROMPT = 64;
/** Run wall clock, including approval waits and all children. */
export const RUN_DEADLINE_MS = 15 * 60_000;
/** Model request budget, including credential preparation and streaming. */
export const MODEL_REQUEST_TIMEOUT_MS = 120_000;
/** Host command budget; never longer than the remaining run budget. */
export const HOST_COMMAND_TIMEOUT_MS = 120_000;
export const HOST_GRACEFUL_CLEANUP_MS = 2_000;
export const HOST_REAP_TIMEOUT_MS = 3_000;
export const APPROVAL_TIMEOUT_MS = 5 * 60_000;
export const MAX_CONCURRENT_SPECIALISTS = 2;
/** Tool result budget with an explicit truncation marker. */
export const TOOL_RESULT_MAX_BYTES = 16 * 1024;
/**
 * Explicit truncation marker for oversized tool results. The total byte count
 * is included so a truncated preview is never mistaken for a complete view.
 */
export const truncationMarker = (totalBytes: number): string =>
	`\n[pawl: truncated — ${totalBytes} UTF-8 bytes exceeded the ${TOOL_RESULT_MAX_BYTES}-byte tool-result limit; request the complete output before approving a deploy]`;
/** Model output tokens per call. */
export const MAX_OUTPUT_TOKENS = 4096;
export const CONTEXT_SAFETY_RESERVE_MIN = 2048;
export const CONTEXT_ESTIMATE_OVERHEAD_UNITS = 1024;

/** Actionable context-limit outcome, also used for provider context rejections. */
export const CONTEXT_LIMIT_CODE = "context_limit";

export type PolicyRejectionCode =
	| "model_call_budget"
	| "tool_execution_budget"
	| "run_deadline"
	| typeof CONTEXT_LIMIT_CODE;

export interface PolicyRejection {
	readonly code: PolicyRejectionCode;
	readonly message: string;
}

export type PolicyDecision =
	| { readonly allowed: true }
	| ({ readonly allowed: false } & PolicyRejection);

export class PolicyExhaustedError extends Error {
	readonly code: PolicyRejectionCode;

	constructor(rejection: PolicyRejection) {
		super(rejection.message);
		this.name = "PolicyExhaustedError";
		this.code = rejection.code;
	}
}

// ---- Injected time ----

export interface PolicyDependencies {
	readonly now: () => number;
	readonly scheduleTimeout: (handler: () => void, ms: number) => () => void;
}

const defaultDependencies: PolicyDependencies = {
	now: Date.now,
	scheduleTimeout: (handler, ms) => {
		const timer = setTimeout(handler, ms);
		return () => clearTimeout(timer);
	},
};

// ---- Context estimation (admission heuristic, not a token count) ----

/**
 * Conservative admission estimate: UTF-8 bytes of the system prompt, full
 * model messages and tool schemas, plus fixed overhead units. Text/tool
 * conversations are supported; image inputs and unknown opaque payload forms
 * without a safe accounting rule are unsupported. Recognized
 * reasoning/signature strings are preserved and counted with the message.
 */
export type ContextAdmission =
	| { readonly supported: true; readonly estimateUnits: number }
	| { readonly supported: false; readonly reason: string };

function byteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

/**
 * Walks one content item and fails closed on forms without a safe accounting
 * rule. Text, thinking (with signatures) and tool calls are supported; image
 * inputs and unknown shapes are not. String content is already counted by
 * serializing the whole message.
 */
function contentIsSupported(item: unknown): boolean {
	if (typeof item !== "object" || item === null) return false;
	const kind = (item as { type?: unknown }).type;
	return kind === "text" || kind === "thinking" || kind === "toolCall";
}

const messageContentSchema = z.union([z.string(), z.array(z.unknown())]);

function messageIsSupported(message: unknown): boolean {
	if (typeof message !== "object" || message === null) return false;
	const role = (message as { role?: unknown }).role;
	if (role !== "user" && role !== "assistant" && role !== "toolResult") {
		return false;
	}
	const parsed = messageContentSchema.safeParse(
		(message as { content?: unknown }).content,
	);
	if (!parsed.success) return false;
	if (typeof parsed.data === "string") return true;
	return parsed.data.every(contentIsSupported);
}

export function estimateContext(context: Context): ContextAdmission {
	let units = byteLength(context.systemPrompt ?? "");
	for (const message of context.messages) {
		if (!messageIsSupported(message)) {
			return {
				supported: false,
				reason:
					"Context contains an image input or unknown opaque payload form without a safe accounting rule; unsupported in this proof",
			};
		}
		try {
			units += byteLength(JSON.stringify(message));
		} catch {
			return {
				supported: false,
				reason:
					"Context message is not JSON-serializable; unsupported in this proof",
			};
		}
	}
	try {
		for (const tool of context.tools ?? []) {
			units += byteLength(
				JSON.stringify({
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters,
				}),
			);
		}
	} catch {
		return {
			supported: false,
			reason: "Tool schema is not JSON-serializable; unsupported in this proof",
		};
	}
	return {
		supported: true,
		estimateUnits: units + CONTEXT_ESTIMATE_OVERHEAD_UNITS,
	};
}

export function outputTokenCap(model: { maxTokens: number }): number {
	return Math.min(model.maxTokens, MAX_OUTPUT_TOKENS);
}

export function safetyReserveFor(contextWindow: number): number {
	return Math.max(CONTEXT_SAFETY_RESERVE_MIN, Math.ceil(contextWindow * 0.1));
}

// ---- Policy object ----

const modelSchema = z.strictObject({
	contextWindow: z.number().int().positive(),
	maxTokens: z.number().int().positive(),
});

export interface RuntimePolicyOptions {
	readonly modelCalls?: number;
	readonly toolExecutions?: number;
	readonly runDeadlineMs?: number;
	readonly onExhausted?: (rejection: PolicyRejection) => void;
	readonly dependencies?: Partial<PolicyDependencies>;
}

export interface RuntimePolicy {
	/** Shared cancellation signal, aborted on any terminal exhaustion. */
	readonly signal: AbortSignal;
	/** Absolute deadline in injected-clock milliseconds. */
	readonly deadlineAt: number;
	modelCallsUsed(): number;
	toolExecutionsUsed(): number;
	remainingMs(): number;
	/** Atomic reservation before every model request, including the first. */
	checkBeforeModel(input: {
		model: { contextWindow: number; maxTokens: number };
		context: Context;
	}): PolicyDecision;
	/** Atomic reservation immediately before every tool execution. */
	checkBeforeTool(toolName: string): PolicyDecision;
	/** Model request timeout, capped by the remaining run budget. */
	modelRequestTimeoutMs(): number;
	/** Host command timeout, never longer than the remaining run budget. */
	hostCommandTimeoutMs(): number;
	dispose(): void;
}

export function createRuntimePolicy(
	options: RuntimePolicyOptions = {},
): RuntimePolicy {
	const dependencies: PolicyDependencies = {
		...defaultDependencies,
		...options.dependencies,
	};
	const maxModelCalls = options.modelCalls ?? MAX_MODEL_CALLS_PER_PROMPT;
	const maxToolExecutions =
		options.toolExecutions ?? MAX_TOOL_EXECUTIONS_PER_PROMPT;
	const runDeadlineMs = options.runDeadlineMs ?? RUN_DEADLINE_MS;
	const deadlineAt = dependencies.now() + runDeadlineMs;

	let modelCalls = 0;
	let toolExecutions = 0;
	let exhausted = false;
	let storedRejection: PolicyRejection | undefined;
	const cancellation = new AbortController();

	const clearDeadline = dependencies.scheduleTimeout(() => {
		exhaust({
			code: "run_deadline",
			message: `Run exceeded its ${Math.round(runDeadlineMs / 1000)}s wall-clock budget; starting no further model calls or tool executions`,
		});
	}, runDeadlineMs);

	const exhaust = (rejection: PolicyRejection): PolicyDecision => {
		if (!exhausted) {
			exhausted = true;
			storedRejection = rejection;
			cancellation.abort(new PolicyExhaustedError(rejection));
			options.onExhausted?.(rejection);
		}
		// Cross-kind exhaustion: once any budget/deadline/context limit is spent,
		// every further check refuses with the stored reason at the policy layer
		// instead of relying on the shared aborted signal at the wiring layer.
		return { allowed: false, ...(storedRejection ?? rejection) };
	};

	const deadlineRejection = (): PolicyRejection => ({
		code: "run_deadline",
		message:
			"Run deadline has passed; no further model calls or tool executions may start",
	});

	const policy: RuntimePolicy = {
		signal: cancellation.signal,
		deadlineAt,

		modelCallsUsed: () => modelCalls,
		toolExecutionsUsed: () => toolExecutions,

		remainingMs: () => Math.max(0, deadlineAt - dependencies.now()),

		checkBeforeModel(input): PolicyDecision {
			if (exhausted && storedRejection) {
				return { allowed: false, ...storedRejection };
			}
			const model = modelSchema.safeParse(input.model);
			if (!model.success) {
				return exhaust({
					code: CONTEXT_LIMIT_CODE,
					message: "Model admission input was invalid; refusing to guess",
				});
			}
			if (dependencies.now() >= deadlineAt) {
				return exhaust(deadlineRejection());
			}
			if (modelCalls >= maxModelCalls) {
				return exhaust({
					code: "model_call_budget",
					message: `Model call budget exhausted (${modelCalls} of ${maxModelCalls} used across root and specialists); no further model requests may start`,
				});
			}
			// estimateContext fails closed on unsupported message content itself.
			const admission = estimateContext(input.context);
			if (!admission.supported) {
				return exhaust({
					code: CONTEXT_LIMIT_CODE,
					message: admission.reason,
				});
			}
			const reserve =
				outputTokenCap(model.data) + safetyReserveFor(model.data.contextWindow);
			if (admission.estimateUnits + reserve > model.data.contextWindow) {
				return exhaust({
					code: CONTEXT_LIMIT_CODE,
					message: `Context admission exceeded: estimated ${admission.estimateUnits} units plus ${reserve} output/safety reserve does not fit the ${model.data.contextWindow}-unit context window; history is never trimmed to pass this check`,
				});
			}
			// Atomic reservation: granted means one dispatched request, even if it
			// later fails, is counted.
			modelCalls += 1;
			return { allowed: true };
		},

		checkBeforeTool(toolName): PolicyDecision {
			if (exhausted && storedRejection) {
				return { allowed: false, ...storedRejection };
			}
			if (dependencies.now() >= deadlineAt) {
				return exhaust(deadlineRejection());
			}
			if (toolExecutions >= maxToolExecutions) {
				return exhaust({
					code: "tool_execution_budget",
					message: `Tool execution budget exhausted (${toolExecutions} of ${maxToolExecutions} used across root and specialists); ${toolName} may not start`,
				});
			}
			toolExecutions += 1;
			return { allowed: true };
		},

		modelRequestTimeoutMs: () =>
			Math.min(MODEL_REQUEST_TIMEOUT_MS, policy.remainingMs()),

		hostCommandTimeoutMs: () =>
			Math.min(HOST_COMMAND_TIMEOUT_MS, policy.remainingMs()),

		dispose: () => {
			clearDeadline();
		},
	};
	return policy;
}

// ---- Tool result truncation ----

export interface TruncatedToolResult {
	/** The possibly truncated text, at most TOOL_RESULT_MAX_BYTES UTF-8 bytes. */
	readonly text: string;
	readonly truncated: boolean;
	/** Original UTF-8 byte length before truncation. */
	readonly totalBytes: number;
}

/**
 * Bounds one tool result to 16 KiB UTF-8 with an explicit truncation marker,
 * never splitting a multibyte character. A truncated preview disables deploy
 * approval until a complete view is available (enforced through the approval
 * binding's `previewComplete` flag).
 */
export function truncateToolResult(text: string): TruncatedToolResult {
	const totalBytes = byteLength(text);
	if (totalBytes <= TOOL_RESULT_MAX_BYTES) {
		return { text, truncated: false, totalBytes };
	}
	const marker = truncationMarker(totalBytes);
	const markerBytes = byteLength(marker);
	const budget = TOOL_RESULT_MAX_BYTES - markerBytes;
	let cut = budget;
	while (
		cut > 0 &&
		(byteLength(text.slice(0, cut)) > budget ||
			(() => {
				// A low surrogate AT the cut means its high surrogate sits at
				// cut-1: the pair would be split, so the cut moves back one.
				const code = text.charCodeAt(cut);
				return code >= 0xdc00 && code <= 0xdfff;
			})())
	) {
		cut -= 1;
	}
	const shown = text.slice(0, cut);
	const resultText = `${shown}${marker}`;
	if (byteLength(resultText) > TOOL_RESULT_MAX_BYTES) {
		throw new Error("Truncation marker exceeded the tool result budget");
	}
	return { text: resultText, truncated: true, totalBytes };
}
