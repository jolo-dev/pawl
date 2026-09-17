import { describe, expect, test } from "bun:test";
import type {
	PawlConversationEvent,
	PawlInputRequest,
} from "../src/pi-runtime/conversation";
import {
	INITIAL_CONVERSATION_STATE,
	type PawlConversationState,
	pushNotice,
	reduceConversationEvent,
	reduceConversationEvents,
} from "../src/pi-runtime/reducer";

/**
 * The Pawl reducer mirrors the current Eve-era reducer's shape (see
 * tests/tui-reducer.test.ts) but consumes only Pawl-owned conversation events;
 * no Eve or Pi type is imported here. Vendor events that fail schema parsing
 * degrade to "ignored" instead of becoming approval requests.
 */

function event(input: PawlConversationEvent): PawlConversationEvent {
	return input;
}

const approval: PawlInputRequest = {
	requestId: "r1",
	prompt: "Deploy PawlStack?",
	options: [
		{ id: "approve", label: "Approve" },
		{ id: "deny", label: "Deny" },
	],
};

const freeform: PawlInputRequest = {
	requestId: "q1",
	prompt: "What should the stack be named?",
	options: [],
};

const reduce = (
	events: PawlConversationEvent[],
	from = INITIAL_CONVERSATION_STATE,
): PawlConversationState => reduceConversationEvents(from, events);

const text = (state: PawlConversationState): string[] =>
	state.lines.map((line) => `${line.role}:${line.text}`);

describe("streaming text", () => {
	test("accumulates deltas into one open line", () => {
		const state = reduce([
			{ type: "run_started", runId: "run_1" },
			{ type: "text_delta", runId: "run_1", delta: "Two " },
			{ type: "text_delta", runId: "run_1", delta: "findings." },
		]);

		expect(text(state)).toEqual(["assistant:Two findings."]);
		expect(state.lines[0]?.open).toBe(true);
	});

	test("closes the line at a message boundary and starts a new one", () => {
		const state = reduce([
			{ type: "run_started", runId: "run_1" },
			{ type: "text_delta", runId: "run_1", delta: "first" },
			{ type: "message_end", runId: "run_1" },
			{ type: "text_delta", runId: "run_1", delta: "second" },
		]);

		expect(text(state)).toEqual(["assistant:first", "assistant:second"]);
		expect(state.lines[0]?.open).toBe(false);
	});

	test("keeps reasoning distinct from the reply", () => {
		const state = reduce([
			{ type: "run_started", runId: "run_1" },
			{ type: "reasoning_delta", runId: "run_1", delta: "weighing" },
			{ type: "text_delta", runId: "run_1", delta: "answer" },
		]);

		expect(text(state)).toEqual(["reasoning:weighing", "assistant:answer"]);
	});
});

describe("tool activity", () => {
	test("names the tool once and streams progress into that line", () => {
		const state = reduce([
			{ type: "run_started", runId: "run_1" },
			{
				type: "tool_started",
				runId: "run_1",
				toolCallId: "c1",
				toolName: "scan_resources",
			},
			{
				type: "tool_update",
				runId: "run_1",
				toolCallId: "c1",
				text: "scan_resources: 3 stacks",
			},
		]);

		expect(text(state)).toEqual(["tool:scan_resources: 3 stacks"]);
		expect(state.lines[0]?.open).toBe(true);
	});

	test("reports a completed tool result and closes the line", () => {
		const state = reduce([
			{ type: "run_started", runId: "run_1" },
			{
				type: "tool_started",
				runId: "run_1",
				toolCallId: "c1",
				toolName: "scan_resources",
			},
			{
				type: "tool_result",
				runId: "run_1",
				toolCallId: "c1",
				toolName: "scan_resources",
				status: "completed",
			},
		]);

		expect(text(state)).toEqual([
			"tool:scan_resources …",
			"tool:scan_resources done",
		]);
		expect(state.lines[1]?.open).toBe(false);
	});

	test("reports a failed tool result as an alert", () => {
		const state = reduce([
			{ type: "run_started", runId: "run_1" },
			{
				type: "tool_started",
				runId: "run_1",
				toolCallId: "c1",
				toolName: "deploy_infra",
			},
			{
				type: "tool_result",
				runId: "run_1",
				toolCallId: "c1",
				toolName: "deploy_infra",
				status: "error",
			},
		]);

		expect(text(state)).toEqual([
			"tool:deploy_infra …",
			"alert:deploy_infra failed",
		]);
	});

	test("ignores a duplicate result for the same tool call", () => {
		const once = reduce([
			{ type: "run_started", runId: "run_1" },
			{
				type: "tool_started",
				runId: "run_1",
				toolCallId: "c1",
				toolName: "scan_resources",
			},
			{
				type: "tool_result",
				runId: "run_1",
				toolCallId: "c1",
				toolName: "scan_resources",
				status: "completed",
			},
		]);
		const twice = reduceConversationEvent(
			once,
			event({
				type: "tool_result",
				runId: "run_1",
				toolCallId: "c1",
				toolName: "scan_resources",
				status: "completed",
			}),
		);

		expect(twice).toBe(once);
	});
});

describe("input requests", () => {
	test("surfaces the prompt and its numbered options without ending the run", () => {
		const state = reduce([
			{ type: "run_started", runId: "run_1" },
			{ type: "input_requested", runId: "run_1", request: approval },
		]);

		expect(text(state)).toEqual([
			"alert:Deploy PawlStack?",
			"notice:  1) Approve",
			"notice:  2) Deny",
		]);
		expect(state.pendingRequests).toEqual([
			{ runId: "run_1", request: approval },
		]);
		expect(state.awaitingInput).toBe(true);
		expect(state.status).toBe("Waiting for you");
		// An input request is not the end of the run: the agent is still waiting.
		expect(state.busy).toBe(true);
	});

	test("a freeform request renders its prompt without numbered options", () => {
		const state = reduce([
			{ type: "run_started", runId: "run_1" },
			{ type: "input_requested", runId: "run_1", request: freeform },
		]);

		expect(text(state)).toEqual(["alert:What should the stack be named?"]);
		expect(state.awaitingInput).toBe(true);
	});

	test("resolves exactly the answered request in a batch", () => {
		const other: PawlInputRequest = { ...approval, requestId: "r2" };
		const state = reduce([
			{ type: "run_started", runId: "run_1" },
			{ type: "input_requested", runId: "run_1", request: approval },
			{ type: "input_requested", runId: "run_1", request: other },
			{ type: "input_resolved", runId: "run_1", requestId: "r1" },
		]);

		expect(state.pendingRequests.map((p) => p.request.requestId)).toEqual([
			"r2",
		]);
		expect(state.awaitingInput).toBe(true);
	});

	test("returns to working status once every request is resolved", () => {
		const state = reduce([
			{ type: "run_started", runId: "run_1" },
			{ type: "input_requested", runId: "run_1", request: approval },
			{ type: "input_resolved", runId: "run_1", requestId: "r1" },
		]);

		expect(state.pendingRequests).toEqual([]);
		expect(state.awaitingInput).toBe(false);
		expect(state.status).toBe("Working");
		expect(state.busy).toBe(true);
	});

	test("ignores late requests for a settled run", () => {
		const settled = reduce([
			{ type: "run_started", runId: "run_1" },
			{ type: "run_terminal", runId: "run_1", outcome: "cancelled" },
		]);
		const after = reduceConversationEvent(
			settled,
			event({
				type: "input_requested",
				runId: "run_1",
				request: approval,
			}),
		);

		expect(after).toBe(settled);
		expect(after.pendingRequests).toEqual([]);
	});
});

describe("run boundaries", () => {
	test("marks a run active and clears the previous failure", () => {
		const state = reduce([
			{
				type: "run_terminal",
				runId: "run_0",
				outcome: "failed",
				code: "MODEL_CALL_FAILED",
				message: "boom",
			},
			{ type: "run_started", runId: "run_1" },
		]);

		expect(state.activeRunIds).toEqual(["run_1"]);
		expect(state.busy).toBe(true);
		expect(state.failure).toBeNull();
	});

	test("settles a run exactly once", () => {
		const state = reduce([
			{ type: "run_started", runId: "run_1" },
			{ type: "run_terminal", runId: "run_1", outcome: "completed" },
			{ type: "run_terminal", runId: "run_1", outcome: "completed" },
		]);

		expect(state.settledRunIds).toEqual(["run_1"]);
		expect(state.activeRunIds).toEqual([]);
		expect(state.busy).toBe(false);
	});

	test("records a failure and keeps the transcript", () => {
		const state = reduce([
			{ type: "run_started", runId: "run_1" },
			{ type: "text_delta", runId: "run_1", delta: "starting" },
			{
				type: "run_terminal",
				runId: "run_1",
				outcome: "failed",
				code: "MODEL_CALL_FAILED",
				message: "no credentials",
			},
		]);

		expect(state.failure).toEqual({
			code: "MODEL_CALL_FAILED",
			message: "no credentials",
		});
		expect(state.busy).toBe(false);
		expect(state.status).toBe("MODEL_CALL_FAILED");
		expect(text(state)).toContain("assistant:starting");
	});

	test("a failed run settles its own pending requests", () => {
		const state = reduce([
			{ type: "run_started", runId: "run_1" },
			{ type: "input_requested", runId: "run_1", request: approval },
			{
				type: "run_terminal",
				runId: "run_1",
				outcome: "failed",
				code: "LIMIT",
				message: "limit reached",
			},
		]);

		expect(state.pendingRequests).toEqual([]);
		expect(state.awaitingInput).toBe(false);
	});

	test("ignores late stream events for a settled run", () => {
		const settled = reduce([
			{ type: "run_started", runId: "run_1" },
			{ type: "run_terminal", runId: "run_1", outcome: "completed" },
		]);
		const after = reduceConversationEvents(settled, [
			{ type: "text_delta", runId: "run_1", delta: "late" },
			{
				type: "tool_result",
				runId: "run_1",
				toolCallId: "c9",
				status: "error",
			},
			{ type: "run_terminal", runId: "run_1", outcome: "failed" },
		]);

		expect(after).toBe(settled);
	});
});

describe("user messages and the queue", () => {
	test("echoes accepted input once and tracks busy submissions", () => {
		const state = reduce([
			{ type: "run_started", runId: "run_1" },
			{ type: "user_message", runId: "run_2", text: "and scan", queued: true },
		]);

		expect(text(state)).toEqual(["user:and scan"]);
		expect(state.queuedPrompts).toEqual([{ runId: "run_2", text: "and scan" }]);
	});

	test("discards a queued prompt visibly when the run is dropped", () => {
		const state = reduce([
			{ type: "run_started", runId: "run_1" },
			{ type: "user_message", runId: "run_2", text: "and scan", queued: true },
			{ type: "prompt_discarded", runId: "run_2" },
			{ type: "run_terminal", runId: "run_1", outcome: "cancelled" },
		]);

		expect(state.queuedPrompts).toEqual([]);
		expect(text(state)).toContain("notice:Discarded queued prompt: and scan");
		expect(state.busy).toBe(false);
	});

	test("an ignored prompt discard leaves the state unchanged", () => {
		const before = reduce([{ type: "run_started", runId: "run_1" }]);
		const after = reduceConversationEvent(
			before,
			event({
				type: "prompt_discarded",
				runId: "run_9",
			}),
		);

		expect(after).toBe(before);
	});
});

describe("resilience", () => {
	test("unknown vendor events are ignored, never approvals", () => {
		const before = reduce([
			{ type: "run_started", runId: "run_1" },
			{ type: "text_delta", runId: "run_1", delta: "hello" },
		]);

		const after = reduceConversationEvent(before, {
			type: "vendor.something.new",
			data: { request: { prompt: "Approve everything?" } },
		});

		expect(after).toBe(before);
	});
});

describe("pushNotice", () => {
	test("appends a closed driver notice line", () => {
		const state = pushNotice(INITIAL_CONVERSATION_STATE, {
			role: "notice",
			text: "That choice was already answered.",
		});

		expect(text(state)).toEqual(["notice:That choice was already answered."]);
		expect(state.lines[0]?.open).toBe(false);
	});
});
