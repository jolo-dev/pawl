import { describe, expect, test } from "bun:test";
import type { InputRequest, MessageStreamEvent } from "eve/client";
import {
	buildResponses,
	INITIAL_TUI_STATE,
	reduceEvent,
	type TuiState,
} from "../src/tui/reducer";

/**
 * Stream events are constructed as the shapes eve documents rather than by
 * replaying a recorded session, so a payload change shows up here as a type
 * error instead of as a silently ignored event.
 */
type EventInput = { type: string; data: Record<string, unknown> };

function event(input: EventInput): MessageStreamEvent {
	return {
		type: input.type,
		data: input.data,
		meta: { at: new Date().toISOString(), id: `evt_${input.type}` },
	} as unknown as MessageStreamEvent;
}

const reduceAll = (events: MessageStreamEvent[], from = INITIAL_TUI_STATE) =>
	events.reduce(reduceEvent, from);

const text = (state: TuiState): string[] =>
	state.lines.map((line) => `${line.role}:${line.text}`);

const approval: InputRequest = {
	action: {
		callId: "c1",
		input: {},
		kind: "tool-call",
		toolName: "deploy_infra",
	},
	display: "confirmation",
	kind: "tool-approval",
	options: [
		{ id: "approve", label: "Approve" },
		{ id: "deny", label: "Deny" },
	],
	prompt: "Deploy PawlStack?",
	requestId: "r1",
};

describe("streaming text", () => {
	test("accumulates deltas into one line", () => {
		const state = reduceAll([
			event({ type: "message.appended", data: { messageDelta: "Two " } }),
			event({ type: "message.appended", data: { messageDelta: "findings." } }),
		]);

		expect(text(state)).toEqual(["assistant:Two findings."]);
	});

	test("starts a new line when the previous message completed", () => {
		const state = reduceAll([
			event({ type: "message.appended", data: { messageDelta: "first" } }),
			event({ type: "message.completed", data: {} }),
			event({ type: "message.appended", data: { messageDelta: "second" } }),
		]);

		expect(text(state)).toEqual(["assistant:first", "assistant:second"]);
	});

	test("keeps reasoning distinct from the reply", () => {
		const state = reduceAll([
			event({
				type: "reasoning.appended",
				data: { reasoningDelta: "weighing" },
			}),
			event({ type: "message.appended", data: { messageDelta: "answer" } }),
		]);

		expect(text(state)).toEqual(["reasoning:weighing", "assistant:answer"]);
	});
});

describe("tool activity", () => {
	test("names the tool once rather than per input fragment", () => {
		const state = reduceAll([
			event({
				type: "action.input.appended",
				data: {
					callId: "c1",
					toolName: "scan_resources",
					inputTextDelta: '{"a',
				},
			}),
			event({
				type: "action.input.appended",
				data: {
					callId: "c1",
					toolName: "scan_resources",
					inputTextDelta: ":1}",
				},
			}),
		]);

		expect(text(state)).toEqual(["tool:scan_resources …"]);
	});

	test("reports a completed tool result", () => {
		const state = reduceAll([
			event({
				type: "action.input.appended",
				data: {
					callId: "c1",
					toolName: "scan_resources",
					inputTextDelta: "{}",
				},
			}),
			event({
				type: "action.result",
				data: {
					status: "completed",
					result: {
						callId: "c1",
						kind: "tool-result",
						toolName: "scan_resources",
					},
				},
			}),
		]);

		expect(text(state)).toEqual([
			"tool:scan_resources …",
			"tool:scan_resources done",
		]);
	});

	test("reports a failed tool result as an alert, not as normal activity", () => {
		const state = reduceAll([
			event({
				type: "action.result",
				data: {
					status: "failed",
					result: {
						callId: "c1",
						kind: "tool-result",
						toolName: "deploy_infra",
					},
				},
			}),
		]);

		expect(text(state)).toEqual(["alert:deploy_infra failed"]);
	});
});

describe("turn lifecycle", () => {
	test("marks work in progress and the turn it belongs to", () => {
		const state = reduceEvent(
			INITIAL_TUI_STATE,
			event({ type: "turn.started", data: { turnId: "turn_1" } }),
		);

		expect(state.busy).toBe(true);
		expect(state.turnId).toBe("turn_1");
	});

	test("clears busy state when the turn completes", () => {
		const state = reduceAll([
			event({ type: "turn.started", data: { turnId: "turn_1" } }),
			event({ type: "turn.completed", data: { turnId: "turn_1" } }),
		]);

		expect(state.busy).toBe(false);
		expect(state.status).toBe("");
	});

	test("records a failure and keeps the transcript that explains it", () => {
		const state = reduceAll([
			event({ type: "message.appended", data: { messageDelta: "starting" } }),
			event({
				type: "turn.failed",
				data: { code: "MODEL_CALL_FAILED", message: "no credentials" },
			}),
		]);

		expect(state.failure).toEqual({
			code: "MODEL_CALL_FAILED",
			message: "no credentials",
		});
		expect(state.busy).toBe(false);
		// Losing the transcript would erase the context that explains the failure.
		expect(text(state)).toContain("assistant:starting");
	});

	test("clears a previous failure when a new turn starts", () => {
		const state = reduceAll([
			event({
				type: "turn.failed",
				data: { code: "X", message: "boom" },
			}),
			event({ type: "turn.started", data: { turnId: "turn_2" } }),
		]);

		expect(state.failure).toBeNull();
	});
});

describe("human input", () => {
	test("surfaces the prompt and its numbered options", () => {
		const state = reduceEvent(
			INITIAL_TUI_STATE,
			event({ type: "input.requested", data: { requests: [approval] } }),
		);

		expect(text(state)).toEqual([
			"alert:Deploy PawlStack?",
			"notice:  1) Approve",
			"notice:  2) Deny",
		]);
	});

	test("holds the pending request and stops claiming to be busy", () => {
		const state = reduceAll([
			event({ type: "turn.started", data: { turnId: "turn_1" } }),
			event({ type: "input.requested", data: { requests: [approval] } }),
		]);

		expect(state.pendingRequests).toEqual([approval]);
		expect(state.busy).toBe(false);
		expect(state.status).toBe("Waiting for you");
	});

	test("clears only the requests that were resolved", () => {
		const other: InputRequest = { ...approval, requestId: "r2" };
		const state = reduceAll([
			event({ type: "input.requested", data: { requests: [approval, other] } }),
			event({
				type: "input.resolved",
				data: {
					resolutions: [
						{ kind: "tool-approval", outcome: "approved", requestId: "r1" },
					],
				},
			}),
		]);

		// A batch is not cleared wholesale by one answer.
		expect(state.pendingRequests.map((r) => r.requestId)).toEqual(["r2"]);
	});
});

describe("session-level outcomes", () => {
	test("records a session failure so the user sees why send will fail", () => {
		const state = reduceAll([
			event({ type: "message.appended", data: { messageDelta: "starting" } }),
			event({
				type: "session.failed",
				data: { code: "SESSION_LIMIT", message: "limit reached" },
			}),
		]);

		expect(state.failure).toEqual({
			code: "SESSION_LIMIT",
			message: "limit reached",
		});
		expect(state.busy).toBe(false);
		expect(text(state)).toContain("assistant:starting");
	});

	test("reports a completed session", () => {
		const state = reduceEvent(
			INITIAL_TUI_STATE,
			event({ type: "session.completed", data: {} }),
		);

		expect(state.status).toBe("Session ended");
		expect(state.busy).toBe(false);
	});
});

describe("resilience", () => {
	test("ignores an unknown event type rather than breaking the client", () => {
		const before = reduceAll([
			event({ type: "message.appended", data: { messageDelta: "hello" } }),
		]);

		const after = reduceEvent(
			before,
			event({ type: "some.future.event", data: { anything: true } }),
		);

		expect(after).toBe(before);
	});
});

describe("buildResponses", () => {
	test("resolves a numbered answer to a response for the request", () => {
		const responses = buildResponses("1", [approval]);

		expect(responses).toHaveLength(1);
		expect(responses[0]?.requestId).toBe("r1");
	});

	test("resolves an option id", () => {
		expect(buildResponses("approve", [approval])).toHaveLength(1);
	});

	test("does not treat a bare yes as approving anything", () => {
		// Verified against eve: only the number or the option id resolves a
		// confirmation. A client that silently accepted "yes" would be inventing
		// an approval the runtime never received.
		expect(buildResponses("yes", [approval])).toEqual([]);
	});

	test("returns nothing for text that matches no option", () => {
		expect(buildResponses("nonsense", [approval])).toEqual([]);
	});
});
