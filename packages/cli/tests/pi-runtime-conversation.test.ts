import { describe, expect, test } from "bun:test";
import {
	type PawlAnswer,
	PawlAnswerSchema,
	type PawlConversationEvent,
	PawlConversationEventSchema,
	type PawlInputRequest,
	parseConversationEvent,
	QUEUED_PROMPT_LIMIT,
} from "../src/pi-runtime/conversation";

/**
 * The conversation boundary is Pawl-owned: every event and answer is a Zod
 * schema so a vendor shape can only enter the UI through an explicitly defined
 * variant. Eve and Pi unions must never leak through this file, which is why
 * unknown shapes must fail closed instead of being coerced into requests.
 */

const freeformQuestion: PawlInputRequest = {
	requestId: "q1",
	prompt: "What should the stack be named?",
	options: [],
};

const approval: PawlInputRequest = {
	requestId: "r1",
	prompt: "Deploy PawlStack?",
	options: [
		{ id: "approve", label: "Approve" },
		{ id: "deny", label: "Deny" },
	],
};

const events: PawlConversationEvent[] = [
	{ type: "user_message", runId: "run_1", text: "deploy now", queued: false },
	{ type: "user_message", runId: "run_2", text: "and scan", queued: true },
	{ type: "run_started", runId: "run_1" },
	{ type: "text_delta", runId: "run_1", delta: "Working…" },
	{ type: "reasoning_delta", runId: "run_1", delta: "weighing" },
	{ type: "message_end", runId: "run_1" },
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
		text: "scanning 3 stacks",
	},
	{
		type: "tool_result",
		runId: "run_1",
		toolCallId: "c1",
		toolName: "scan_resources",
		status: "completed",
	},
	{
		type: "tool_result",
		runId: "run_1",
		toolCallId: "c2",
		toolName: "deploy_infra",
		status: "error",
		text: "denied",
	},
	{ type: "input_requested", runId: "run_1", request: approval },
	{ type: "input_requested", runId: "run_1", request: freeformQuestion },
	{ type: "input_resolved", runId: "run_1", requestId: "r1" },
	{ type: "prompt_discarded", runId: "run_2" },
	{ type: "run_terminal", runId: "run_1", outcome: "completed" },
	{
		type: "run_terminal",
		runId: "run_3",
		outcome: "failed",
		code: "MODEL_CALL_FAILED",
		message: "no credentials",
	},
	{ type: "run_terminal", runId: "run_4", outcome: "cancelled" },
];

describe("event schemas", () => {
	test.each(
		events.map((event) => [event.type, event] as const),
	)("parses %s", (_type, event) => {
		const parsed = PawlConversationEventSchema.parse(event);
		expect(parsed).toEqual(event);
	});

	test("rejects extra keys on a known event", () => {
		expect(
			parseConversationEvent({
				type: "text_delta",
				runId: "run_1",
				delta: "x",
				extra: true,
			}),
		).toBeNull();
	});

	test("rejects malformed request payloads", () => {
		expect(
			parseConversationEvent({
				type: "input_requested",
				runId: "run_1",
				request: { prompt: "Deploy?", options: [{ id: "a", label: "A" }] },
			}),
		).toBeNull();
	});
});

describe("unknown vendor events", () => {
	test("are never parsed into approval requests", () => {
		// Eve-shaped event: the runtime must drop it, not translate it.
		expect(
			parseConversationEvent({
				type: "input.requested",
				data: { requests: [{ ...approval, kind: "tool-approval" }] },
			}),
		).toBeNull();
		// Pi-shaped event: also dropped.
		expect(
			parseConversationEvent({
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", delta: "x" },
			}),
		).toBeNull();
		expect(
			parseConversationEvent({ type: "vendor.something.new", data: {} }),
		).toBeNull();
	});
});

describe("answer schema", () => {
	test("accepts an option answer", () => {
		const answer: PawlAnswer = {
			requestId: "r1",
			choice: { kind: "option", value: "approve" },
		};
		expect(PawlAnswerSchema.parse(answer)).toEqual(answer);
	});

	test("accepts a freeform answer", () => {
		expect(
			PawlAnswerSchema.parse({
				requestId: "q1",
				choice: { kind: "text", value: "PawlStack" },
			}),
		).toEqual({
			requestId: "q1",
			choice: { kind: "text", value: "PawlStack" },
		});
	});

	test("rejects answers without a request id or with an unknown kind", () => {
		expect(
			PawlAnswerSchema.safeParse({
				choice: { kind: "option", value: "approve" },
			}).success,
		).toBe(false);
		expect(
			PawlAnswerSchema.safeParse({
				requestId: "r1",
				choice: { kind: "guess", value: "approve" },
			}).success,
		).toBe(false);
	});
});

test("queued prompt limit matches the proof default", () => {
	expect(QUEUED_PROMPT_LIMIT).toBe(8);
});
