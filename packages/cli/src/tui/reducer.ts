/**
 * The event reducer: a conversation's worth of stream events into renderable state.
 *
 * Pure, and deliberately ignorant of the renderer. This is the piece that makes
 * approvals reachable — until a request can be surfaced and answered, the agent
 * cannot get past a gated tool call, which means `deploy_infra` cannot run at all.
 *
 * Only the events the UI acts on are handled. Anything unrecognised passes
 * through unchanged, so a new eve event type degrades to "ignored" rather than
 * breaking the client.
 *
 * Answering uses eve's own `resolveTextToResponses` rather than hand-building the
 * response payload: the wire shape is eve's contract to keep, not ours.
 */

import {
	type InputRequest,
	type MessageStreamEvent,
	resolveTextToResponses,
} from "eve/client";
import type { TranscriptRole } from "./app";

export interface TuiLine {
	readonly role: TranscriptRole;
	readonly text: string;
	/** True while more deltas may still arrive for this line. */
	readonly open: boolean;
}

export interface TuiFailure {
	readonly code: string;
	readonly message: string;
}

export interface TuiState {
	readonly lines: readonly TuiLine[];
	readonly status: string;
	readonly busy: boolean;
	readonly turnId: string | null;
	/** Requests the user must answer before the turn can continue. */
	readonly pendingRequests: readonly InputRequest[];
	readonly failure: TuiFailure | null;
}

export const INITIAL_TUI_STATE: TuiState = {
	lines: [],
	status: "",
	busy: false,
	turnId: null,
	pendingRequests: [],
	failure: null,
};

/** Appends to the trailing line when it is open and has the same role. */
function appendDelta(
	lines: readonly TuiLine[],
	role: TranscriptRole,
	delta: string,
): TuiLine[] {
	const last = lines.at(-1);
	if (last?.open && last.role === role) {
		return [...lines.slice(0, -1), { ...last, text: last.text + delta }];
	}
	return [...lines, { role, text: delta, open: true }];
}

function closeOpen(lines: readonly TuiLine[]): TuiLine[] {
	const last = lines.at(-1);
	if (!last?.open) return [...lines];
	return [...lines.slice(0, -1), { ...last, open: false }];
}

function push(
	lines: readonly TuiLine[],
	role: TranscriptRole,
	text: string,
): TuiLine[] {
	return [...closeOpen(lines), { role, text, open: false }];
}

/** Describes a tool result without reading fields the union may not carry. */
function describeActionResult(
	result: unknown,
	status: string,
): { readonly role: TranscriptRole; readonly text: string } {
	const record = result as { kind?: string; toolName?: string } | undefined;
	const name = record?.toolName ?? record?.kind ?? "tool";
	if (status === "failed" || status === "rejected") {
		return { role: "alert", text: `${name} ${status}` };
	}
	return { role: "tool", text: `${name} done` };
}

export function reduceEvent(
	state: TuiState,
	event: MessageStreamEvent,
): TuiState {
	switch (event.type) {
		case "message.appended":
			return {
				...state,
				lines: appendDelta(state.lines, "assistant", event.data.messageDelta),
			};

		case "reasoning.appended":
			return {
				...state,
				lines: appendDelta(state.lines, "reasoning", event.data.reasoningDelta),
			};

		case "message.completed":
		case "reasoning.completed":
			return { ...state, lines: closeOpen(state.lines) };

		case "action.input.appended": {
			const last = state.lines.at(-1);
			// The input streams as JSON fragments; show that a tool is running
			// rather than the fragments themselves.
			if (last?.open && last.role === "tool") return state;
			return {
				...state,
				lines: appendDelta(state.lines, "tool", `${event.data.toolName} …`),
			};
		}

		case "action.result": {
			const described = describeActionResult(
				event.data.result,
				event.data.status,
			);
			return {
				...state,
				lines: push(state.lines, described.role, described.text),
			};
		}

		case "input.requested": {
			const requests = event.data.requests;
			let lines = state.lines;
			for (const request of requests) {
				lines = push(lines, "alert", request.prompt);
				for (const [index, option] of (request.options ?? []).entries()) {
					lines = push(lines, "notice", `  ${index + 1}) ${option.label}`);
				}
			}
			return {
				...state,
				lines,
				pendingRequests: requests,
				busy: false,
				status: "Waiting for you",
			};
		}

		case "input.resolved": {
			// Clear only what was resolved, so a batch cannot be cleared by one answer.
			const resolved = new Set(
				event.data.resolutions.map((resolution) => resolution.requestId),
			);
			return {
				...state,
				pendingRequests: state.pendingRequests.filter(
					(request) => !resolved.has(request.requestId),
				),
			};
		}

		case "turn.started":
			return {
				...state,
				busy: true,
				turnId: event.data.turnId,
				failure: null,
				status: "Working",
			};

		case "turn.completed":
		case "turn.cancelled":
			return {
				...state,
				busy: false,
				lines: closeOpen(state.lines),
				status: "",
			};

		case "turn.failed":
			return {
				...state,
				busy: false,
				lines: closeOpen(state.lines),
				failure: { code: event.data.code, message: event.data.message },
				// The transcript is deliberately kept: losing it would erase the
				// context that explains the failure.
				status: event.data.code,
			};

		case "session.waiting":
			return { ...state, busy: false, status: "Waiting" };

		default:
			return state;
	}
}

/** Folds a batch of events, for a caller that is not rendering each one. */
export function reduceEvents(
	state: TuiState,
	events: readonly MessageStreamEvent[],
): TuiState {
	return events.reduce(reduceEvent, state);
}

/**
 * The payload that answers the pending requests.
 *
 * Delegates to eve so the wire shape stays eve's contract. Text that resolves to
 * nothing (an unrecognised answer) yields no responses, which the caller must
 * treat as "not an answer" rather than as approval.
 */
export function buildResponses(
	text: string,
	requests: readonly InputRequest[],
): ReturnType<typeof resolveTextToResponses> {
	return resolveTextToResponses(text, requests);
}
