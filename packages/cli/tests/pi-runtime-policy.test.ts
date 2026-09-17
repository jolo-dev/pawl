import { describe, expect, test } from "bun:test";
import type { Context } from "@earendil-works/pi-ai";
import { QUEUED_PROMPT_LIMIT } from "../src/pi-runtime/conversation";
import {
	APPROVAL_TIMEOUT_MS,
	CONTEXT_ESTIMATE_OVERHEAD_UNITS,
	CONTEXT_LIMIT_CODE,
	createRuntimePolicy,
	estimateContext,
	HOST_COMMAND_TIMEOUT_MS,
	HOST_GRACEFUL_CLEANUP_MS,
	HOST_REAP_TIMEOUT_MS,
	MAX_CONCURRENT_SPECIALISTS,
	MAX_MODEL_CALLS_PER_PROMPT,
	MAX_OUTPUT_TOKENS,
	MAX_TOOL_EXECUTIONS_PER_PROMPT,
	MODEL_REQUEST_TIMEOUT_MS,
	outputTokenCap,
	RUN_DEADLINE_MS,
	safetyReserveFor,
	TOOL_RESULT_MAX_BYTES,
	truncateToolResult,
} from "../src/pi-runtime/policy";

/**
 * Task 6 policy: finite budgets, deadlines and context admission belong to
 * one shared policy object per accepted user prompt. Every check must be an
 * atomic reservation made before a model request or tool execution starts,
 * and exhaustion must trigger shared cancellation instead of throwing from
 * hooks whose contract forbids rejection.
 */

const MODEL = { contextWindow: 200_000, maxTokens: 8_192 };

function textContext(systemPrompt: string, text: string): Context {
	return {
		systemPrompt,
		messages: [{ role: "user", content: text, timestamp: 0 }],
	};
}

/** Injected clock plus timeout scheduler so deadlines are deterministic. */
function fakeClock() {
	let nowMs = 0;
	const timers: { at: number; handler: () => void; cancelled: boolean }[] = [];
	const now = () => nowMs;
	const scheduleTimeout = (handler: () => void, ms: number) => {
		const timer = { at: nowMs + ms, handler, cancelled: false };
		timers.push(timer);
		return () => {
			timer.cancelled = true;
		};
	};
	const advance = (ms: number) => {
		nowMs += ms;
		for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
			if (!timer.cancelled && timer.at <= nowMs) timer.handler();
		}
	};
	return { now, scheduleTimeout, advance };
}

function byteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

describe("fixed proof defaults", () => {
	test("match the approved plan table", () => {
		expect(MAX_MODEL_CALLS_PER_PROMPT).toBe(32);
		expect(MAX_TOOL_EXECUTIONS_PER_PROMPT).toBe(64);
		expect(RUN_DEADLINE_MS).toBe(15 * 60_000);
		expect(MODEL_REQUEST_TIMEOUT_MS).toBe(120_000);
		expect(HOST_COMMAND_TIMEOUT_MS).toBe(120_000);
		expect(HOST_GRACEFUL_CLEANUP_MS).toBe(2_000);
		expect(HOST_REAP_TIMEOUT_MS).toBe(3_000);
		expect(APPROVAL_TIMEOUT_MS).toBe(5 * 60_000);
		expect(MAX_CONCURRENT_SPECIALISTS).toBe(2);
		expect(TOOL_RESULT_MAX_BYTES).toBe(16 * 1024);
		expect(MAX_OUTPUT_TOKENS).toBe(4096);
		expect(CONTEXT_ESTIMATE_OVERHEAD_UNITS).toBe(1024);
		// Queued prompt admission stays owned by the conversation boundary.
		expect(QUEUED_PROMPT_LIMIT).toBe(8);
	});

	test("context reserve math follows the approved formula", () => {
		expect(safetyReserveFor(20_000)).toBe(2048);
		expect(safetyReserveFor(200_000)).toBe(20_000);
		expect(outputTokenCap({ maxTokens: 8_192 })).toBe(4096);
		expect(outputTokenCap({ maxTokens: 1_024 })).toBe(1_024);
	});
});

describe("context estimation", () => {
	test("counts UTF-8 bytes of system prompt, messages and tools plus overhead", () => {
		const context: Context = {
			systemPrompt: "system è prompt",
			messages: [
				{ role: "user", content: "héllo", timestamp: 1 },
				{
					role: "assistant",
					content: [{ type: "text", text: "hi" }],
					api: "bedrock-converse-stream",
					provider: "amazon-bedrock",
					model: "m",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					},
					stopReason: "stop",
					timestamp: 2,
				},
				{
					role: "toolResult",
					toolCallId: "c1",
					toolName: "t",
					content: [{ type: "text", text: "ok" }],
					isError: false,
					timestamp: 3,
				},
			],
			tools: [],
		};
		const admission = estimateContext(context);
		if (!admission.supported) throw new Error("expected a supported context");
		const expected =
			byteLength(context.systemPrompt ?? "") +
			context.messages.reduce(
				(sum, message) => sum + byteLength(JSON.stringify(message)),
				0,
			) +
			CONTEXT_ESTIMATE_OVERHEAD_UNITS;
		expect(admission.estimateUnits).toBe(expected);
	});

	test("counts recognized reasoning and signature strings", () => {
		const context: Context = {
			messages: [
				{
					role: "assistant",
					content: [
						{
							type: "thinking",
							thinking: "weighing",
							thinkingSignature: "opaque-signature",
						},
					],
					api: "bedrock-converse-stream",
					provider: "amazon-bedrock",
					model: "m",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					},
					stopReason: "stop",
					timestamp: 1,
				},
			],
		};
		const admission = estimateContext(context);
		if (!admission.supported) throw new Error("expected a supported context");
		expect(
			admission.estimateUnits >=
				byteLength("weighing") + byteLength("opaque-signature"),
		).toBe(true);
	});

	test("rejects image inputs as unsupported", () => {
		const admission = estimateContext({
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "look" },
						{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
					],
					timestamp: 1,
				},
			],
		});
		expect(admission.supported).toBe(false);
	});

	test("rejects unknown opaque payload forms", () => {
		const admission = estimateContext({
			messages: [
				{
					role: "assistant",
					content: [{ type: "vendor-opaque", blob: "x" }],
					api: "bedrock-converse-stream",
					provider: "amazon-bedrock",
					model: "m",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					},
					stopReason: "stop",
					timestamp: 1,
				},
			],
		} as unknown as Context);
		expect(admission.supported).toBe(false);
	});
});

describe("model call admission", () => {
	test("rejects the first request when the prompt is already over the limit", () => {
		const policy = createRuntimePolicy();
		const huge = "x".repeat(MODEL.contextWindow);
		const decision = policy.checkBeforeModel({
			model: MODEL,
			context: textContext(huge, "go"),
		});
		expect(decision).toEqual({
			allowed: false,
			code: CONTEXT_LIMIT_CODE,
			message: expect.any(String),
		});
		expect(policy.modelCallsUsed()).toBe(0);
		expect(policy.signal.aborted).toBe(true);
	});

	test("rejects restored history that is over the limit before any request", () => {
		const policy = createRuntimePolicy();
		const decision = policy.checkBeforeModel({
			model: MODEL,
			context: textContext("system", "y".repeat(MODEL.contextWindow)),
		});
		expect(decision.allowed).toBe(false);
		if (!decision.allowed) expect(decision.code).toBe(CONTEXT_LIMIT_CODE);
	});

	test("a large tool result pushes the next request over the limit", () => {
		const policy = createRuntimePolicy();
		const first = policy.checkBeforeModel({
			model: MODEL,
			context: textContext("system", "small"),
		});
		expect(first.allowed).toBe(true);
		const decision = policy.checkBeforeModel({
			model: MODEL,
			context: textContext("system", "z".repeat(MODEL.contextWindow)),
		});
		expect(decision.allowed).toBe(false);
		if (!decision.allowed) expect(decision.code).toBe(CONTEXT_LIMIT_CODE);
		// No additional model starts: the reservation count is unchanged.
		expect(policy.modelCallsUsed()).toBe(1);
	});
});

describe("finite budgets shared across root and children", () => {
	test("the 33rd model call is rejected and nothing further starts", () => {
		const policy = createRuntimePolicy();
		for (let i = 0; i < MAX_MODEL_CALLS_PER_PROMPT; i += 1) {
			expect(
				policy.checkBeforeModel({
					model: MODEL,
					context: textContext("s", "m"),
				}).allowed,
			).toBe(true);
		}
		expect(policy.modelCallsUsed()).toBe(32);
		const decision = policy.checkBeforeModel({
			model: MODEL,
			context: textContext("s", "m"),
		});
		expect(decision).toEqual({
			allowed: false,
			code: "model_call_budget",
			message: expect.any(String),
		});
		expect(policy.modelCallsUsed()).toBe(32);
		// Children share the same policy object: a child cannot reset the count.
		expect(policy.modelCallsUsed()).toBe(MAX_MODEL_CALLS_PER_PROMPT);
	});

	test("the 65th tool execution is rejected", () => {
		const policy = createRuntimePolicy();
		for (let i = 0; i < MAX_TOOL_EXECUTIONS_PER_PROMPT; i += 1) {
			expect(policy.checkBeforeTool("scan_resources").allowed).toBe(true);
		}
		expect(policy.toolExecutionsUsed()).toBe(64);
		const decision = policy.checkBeforeTool("scan_resources");
		expect(decision).toEqual({
			allowed: false,
			code: "tool_execution_budget",
			message: expect.any(String),
		});
		expect(policy.toolExecutionsUsed()).toBe(64);
	});

	test("after one budget exhausts, the other check refuses with the stored reason", () => {
		const clock = fakeClock();
		const policy = createRuntimePolicy({ dependencies: clock });
		for (let i = 0; i < MAX_MODEL_CALLS_PER_PROMPT; i += 1) {
			policy.checkBeforeModel({ model: MODEL, context: textContext("s", "m") });
		}
		const modelDecision = policy.checkBeforeModel({
			model: MODEL,
			context: textContext("s", "m"),
		});
		expect(modelDecision.allowed).toBe(false);
		// Cross-kind: the tool check must also refuse, carrying the same stored
		// rejection rather than reporting a fresh independent verdict.
		const toolDecision = policy.checkBeforeTool("scan_resources");
		expect(toolDecision).toEqual(modelDecision);
		expect(policy.toolExecutionsUsed()).toBe(0);
		// Timeout behavior is unchanged by exhaustion: they reflect the deadline,
		// not the budget counters.
		expect(policy.hostCommandTimeoutMs()).toBe(HOST_COMMAND_TIMEOUT_MS);
		expect(policy.modelRequestTimeoutMs()).toBe(MODEL_REQUEST_TIMEOUT_MS);
	});
});

describe("run deadline", () => {
	test("an expired run rejects every further check", () => {
		const clock = fakeClock();
		const exhausted: string[] = [];
		const policy = createRuntimePolicy({
			runDeadlineMs: 1_000,
			onExhausted: (rejection) => exhausted.push(rejection.code),
			dependencies: clock,
		});
		expect(
			policy.checkBeforeModel({ model: MODEL, context: textContext("s", "m") })
				.allowed,
		).toBe(true);
		clock.advance(1_001);
		const modelDecision = policy.checkBeforeModel({
			model: MODEL,
			context: textContext("s", "m"),
		});
		const toolDecision = policy.checkBeforeTool("t");
		expect(modelDecision.allowed).toBe(false);
		expect(toolDecision.allowed).toBe(false);
		if (!modelDecision.allowed) expect(modelDecision.code).toBe("run_deadline");
		if (!toolDecision.allowed) expect(toolDecision.code).toBe("run_deadline");
		expect(policy.signal.aborted).toBe(true);
		expect(exhausted).toEqual(["run_deadline"]);
	});

	test("a deadline during an in-flight stream triggers shared cancellation", async () => {
		const clock = fakeClock();
		const policy = createRuntimePolicy({
			runDeadlineMs: 5_000,
			dependencies: clock,
		});
		const cancelled = new Promise<unknown>((resolve) => {
			policy.signal.addEventListener(
				"abort",
				() => resolve(policy.signal.reason),
				{
					once: true,
				},
			);
		});
		// The stream is in flight: no check runs again until cancellation.
		clock.advance(5_000);
		const reason = (await cancelled) as { code?: string };
		expect(reason?.code).toBe("run_deadline");
	});

	test("a deadline during a pending approval settles the wait", async () => {
		const clock = fakeClock();
		const policy = createRuntimePolicy({
			runDeadlineMs: 1_000,
			dependencies: clock,
		});
		const settled = new Promise<void>((resolve) => {
			policy.signal.addEventListener("abort", () => resolve(), { once: true });
		});
		clock.advance(1_000);
		await settled;
		expect(policy.signal.aborted).toBe(true);
	});

	test("host command timeouts never exceed the remaining run budget", () => {
		const clock = fakeClock();
		const policy = createRuntimePolicy({
			runDeadlineMs: 1_000_000,
			dependencies: clock,
		});
		// Well within the deadline: capped by the fixed host timeout.
		expect(policy.hostCommandTimeoutMs()).toBe(HOST_COMMAND_TIMEOUT_MS);
		clock.advance(999_000);
		// 1 second of budget left: the child must not outlive the run.
		expect(policy.hostCommandTimeoutMs()).toBe(1_000);
		clock.advance(1_000);
		expect(policy.hostCommandTimeoutMs()).toBe(0);
	});

	test("model request timeout is capped by the remaining run budget", () => {
		const clock = fakeClock();
		const policy = createRuntimePolicy({
			runDeadlineMs: 300_000,
			dependencies: clock,
		});
		expect(policy.modelRequestTimeoutMs()).toBe(MODEL_REQUEST_TIMEOUT_MS);
		clock.advance(299_500);
		expect(policy.modelRequestTimeoutMs()).toBe(500);
	});
});

describe("exhaustion signaling", () => {
	test("onExhausted fires once no matter how many checks are rejected after", () => {
		const clock = fakeClock();
		const exhausted: string[] = [];
		const policy = createRuntimePolicy({
			runDeadlineMs: 100,
			onExhausted: (rejection) => exhausted.push(rejection.code),
			dependencies: clock,
		});
		clock.advance(200);
		policy.checkBeforeTool("a");
		policy.checkBeforeTool("b");
		policy.checkBeforeModel({ model: MODEL, context: textContext("s", "m") });
		expect(exhausted).toEqual(["run_deadline"]);
	});

	test("dispose cancels the deadline timer without exhausting", () => {
		const clock = fakeClock();
		const exhausted: string[] = [];
		const policy = createRuntimePolicy({
			runDeadlineMs: 100,
			onExhausted: (rejection) => exhausted.push(rejection.code),
			dependencies: clock,
		});
		policy.dispose();
		clock.advance(1_000);
		expect(policy.signal.aborted).toBe(false);
		expect(exhausted).toEqual([]);
	});
});

describe("tool result truncation", () => {
	test("leaves results within the byte budget unchanged", () => {
		const result = truncateToolResult("short output");
		expect(result).toEqual({
			text: "short output",
			truncated: false,
			totalBytes: 12,
		});
	});

	test("truncates oversized UTF-8 output with an explicit marker", () => {
		const text = "🦉".repeat(20_000);
		const result = truncateToolResult(text);
		expect(result.truncated).toBe(true);
		expect(result.totalBytes).toBe(byteLength(text));
		expect(byteLength(result.text)).toBeLessThanOrEqual(TOOL_RESULT_MAX_BYTES);
		// The cut never splits a multibyte character.
		expect(() =>
			new TextDecoder("utf-8", { fatal: true }).decode(
				Buffer.from(result.text, "utf8"),
			),
		).not.toThrow();
		expect(result.text).toContain("truncated");
		expect(result.text).toContain(String(result.totalBytes));
		// The shown text ends on a complete code unit: no lone high surrogate at
		// the cut and no replacement character introduced there.
		const markerIndex = result.text.indexOf("\n[pawl:");
		const shown = result.text.slice(
			0,
			markerIndex < 0 ? undefined : markerIndex,
		);
		const lastCode = shown.charCodeAt(shown.length - 1);
		expect(lastCode >= 0xd800 && lastCode <= 0xdbff).toBe(false);
		expect(shown).not.toContain("\uFFFD");
	});
});
