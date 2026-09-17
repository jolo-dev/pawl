import {
	type PawlConversationEvent,
	type PawlInputRequest,
	parseConversationEvent,
} from "./conversation";

/**
 * A pure reducer from Pawl-owned conversation events into renderable state.
 * Modeled on the existing TUI reducer (tests/tui-reducer.test.ts) but without
 * importing any Eve or Pi type: unknown or malformed events degrade to
 * "ignored" rather than becoming approval requests or breaking the client.
 *
 * Run semantics: an input request does not end a run (busy stays on while the
 * agent waits for the answer); exactly one terminal event per run settles it,
 * and late events for a settled run are dropped.
 */

export type PawlTranscriptRole =
	| "user"
	| "assistant"
	| "reasoning"
	| "tool"
	| "alert"
	| "notice";

export interface PawlLine {
	readonly role: PawlTranscriptRole;
	readonly text: string;
	/** True while more deltas may still arrive for this line. */
	readonly open: boolean;
}

export interface PawlPendingRequest {
	readonly runId: string;
	readonly request: PawlInputRequest;
}

export interface PawlQueuedPrompt {
	readonly runId: string;
	readonly text: string;
}

export interface PawlFailure {
	readonly code: string;
	readonly message: string;
}

export interface PawlConversationState {
	readonly lines: readonly PawlLine[];
	readonly status: string;
	/** A run is active or prompts are queued — input-request is not idle. */
	readonly busy: boolean;
	readonly awaitingInput: boolean;
	readonly activeRunIds: readonly string[];
	readonly queuedPrompts: readonly PawlQueuedPrompt[];
	readonly pendingRequests: readonly PawlPendingRequest[];
	/** Runs that produced a terminal event; their late events are dropped. */
	readonly settledRunIds: readonly string[];
	/** Tool calls whose result was already folded in; duplicates are ignored. */
	readonly settledToolCallIds: readonly string[];
	readonly failure: PawlFailure | null;
}

export const INITIAL_CONVERSATION_STATE: PawlConversationState = {
	lines: [],
	status: "",
	busy: false,
	awaitingInput: false,
	activeRunIds: [],
	queuedPrompts: [],
	pendingRequests: [],
	settledRunIds: [],
	settledToolCallIds: [],
	failure: null,
};

/** Appends to the trailing line when it is open and has the same role. */
function appendDelta(
	lines: readonly PawlLine[],
	role: PawlTranscriptRole,
	delta: string,
): PawlLine[] {
	const last = lines.at(-1);
	if (last?.open && last.role === role) {
		return [...lines.slice(0, -1), { ...last, text: last.text + delta }];
	}
	return [...lines, { role, text: delta, open: true }];
}

function closeOpen(lines: readonly PawlLine[]): PawlLine[] {
	const last = lines.at(-1);
	if (!last?.open) return [...lines];
	return [...lines.slice(0, -1), { ...last, open: false }];
}

function push(
	lines: readonly PawlLine[],
	role: PawlTranscriptRole,
	text: string,
): PawlLine[] {
	return [...closeOpen(lines), { role, text, open: false }];
}

function withoutRun(runIds: readonly string[], runId: string): string[] {
	return runIds.filter((id) => id !== runId);
}

function isBusy(state: PawlConversationState): boolean {
	return state.activeRunIds.length > 0 || state.queuedPrompts.length > 0;
}

/**
 * Driver-generated transcript feedback (routing rejections, discard notices).
 * Conversation events stay in `reduceConversationEvent`; the driver may only
 * add closed lines with this helper.
 */
export function pushNotice(
	state: PawlConversationState,
	notice: { role: "notice" | "alert"; text: string },
): PawlConversationState {
	return { ...state, lines: push(state.lines, notice.role, notice.text) };
}

export function reduceConversationEvent(
	state: PawlConversationState,
	event: unknown,
): PawlConversationState {
	const parsed = parseConversationEvent(event);
	if (!parsed) return state;
	const knownRun = state.activeRunIds.includes(parsed.runId);

	switch (parsed.type) {
		case "user_message": {
			const queuedPrompts = parsed.queued
				? state.queuedPrompts.some((entry) => entry.runId === parsed.runId)
					? state.queuedPrompts
					: [...state.queuedPrompts, { runId: parsed.runId, text: parsed.text }]
				: state.queuedPrompts;
			return {
				...state,
				lines: push(state.lines, "user", parsed.text),
				queuedPrompts,
				busy: isBusy({ ...state, queuedPrompts }),
			};
		}

		case "run_started": {
			if (!knownRun && !state.settledRunIds.includes(parsed.runId)) {
				return {
					...state,
					activeRunIds: [...state.activeRunIds, parsed.runId],
					busy: true,
					status: "Working",
					failure: null,
				};
			}
			return state;
		}

		case "text_delta":
			return knownRun
				? {
						...state,
						lines: appendDelta(state.lines, "assistant", parsed.delta),
					}
				: state;

		case "reasoning_delta":
			return knownRun
				? {
						...state,
						lines: appendDelta(state.lines, "reasoning", parsed.delta),
					}
				: state;

		case "message_end":
			return knownRun ? { ...state, lines: closeOpen(state.lines) } : state;

		case "tool_started":
			return knownRun
				? {
						...state,
						lines: [
							...closeOpen(state.lines),
							{
								role: "tool",
								text: `${parsed.toolName} …`,
								open: true,
							},
						],
					}
				: state;

		case "tool_update": {
			if (!knownRun) return state;
			const last = state.lines.at(-1);
			// The update carries the full current progress text for the open call.
			if (last?.open && last.role === "tool") {
				return {
					...state,
					lines: [...state.lines.slice(0, -1), { ...last, text: parsed.text }],
				};
			}
			return {
				...state,
				lines: push(state.lines, "tool", parsed.text),
			};
		}

		case "tool_result": {
			if (!knownRun || state.settledToolCallIds.includes(parsed.toolCallId)) {
				return state;
			}
			const name = parsed.toolName ?? parsed.toolCallId;
			const lines = push(
				state.lines,
				parsed.status === "error" ? "alert" : "tool",
				`${name} ${parsed.status === "error" ? "failed" : "done"}`,
			);
			return {
				...state,
				lines,
				settledToolCallIds: [...state.settledToolCallIds, parsed.toolCallId],
			};
		}

		case "input_requested": {
			// Late requests for a settled or unknown run never surface.
			if (
				!knownRun ||
				state.pendingRequests.some(
					(entry) => entry.request.requestId === parsed.request.requestId,
				)
			) {
				return state;
			}
			let lines = push(state.lines, "alert", parsed.request.prompt);
			parsed.request.options.forEach((option, index) => {
				lines = push(lines, "notice", `  ${index + 1}) ${option.label}`);
			});
			const pendingRequests = [
				...state.pendingRequests,
				{ runId: parsed.runId, request: parsed.request },
			];
			return {
				...state,
				lines,
				pendingRequests,
				awaitingInput: true,
				status: "Waiting for you",
				busy: isBusy(state),
			};
		}

		case "input_resolved": {
			const pendingRequests = state.pendingRequests.filter(
				(entry) => entry.request.requestId !== parsed.requestId,
			);
			// Idempotent: an already-resolved request never clears the batch.
			if (pendingRequests.length === state.pendingRequests.length) {
				return state;
			}
			return {
				...state,
				pendingRequests,
				awaitingInput: pendingRequests.length > 0,
				status:
					pendingRequests.length === 0 && state.activeRunIds.length > 0
						? "Working"
						: state.status,
			};
		}

		case "prompt_discarded": {
			const discarded = state.queuedPrompts.find(
				(entry) => entry.runId === parsed.runId,
			);
			if (!discarded) return state;
			const queuedPrompts = state.queuedPrompts.filter(
				(entry) => entry.runId !== parsed.runId,
			);
			return {
				...state,
				queuedPrompts,
				lines: push(
					state.lines,
					"notice",
					`Discarded queued prompt: ${discarded.text}`,
				),
				busy: isBusy({ ...state, queuedPrompts }),
			};
		}

		case "run_terminal": {
			if (state.settledRunIds.includes(parsed.runId)) return state;
			const pendingRequests = state.pendingRequests.filter(
				(entry) => entry.runId !== parsed.runId,
			);
			const activeRunIds = withoutRun(state.activeRunIds, parsed.runId);
			const next: PawlConversationState = {
				...state,
				activeRunIds,
				settledRunIds: [...state.settledRunIds, parsed.runId],
				pendingRequests,
				failure:
					parsed.outcome === "failed"
						? {
								code: parsed.code ?? "RUN_FAILED",
								message: parsed.message ?? "",
							}
						: state.failure,
			};
			return {
				...next,
				awaitingInput: pendingRequests.length > 0,
				busy: isBusy(next),
				status:
					parsed.outcome === "failed"
						? (parsed.code ?? "RUN_FAILED")
						: isBusy(next)
							? "Working"
							: "",
			};
		}
	}
}

/** Folds a batch of events, for a caller that is not rendering each one. */
export function reduceConversationEvents(
	state: PawlConversationState,
	events: readonly PawlConversationEvent[],
): PawlConversationState {
	return events.reduce(reduceConversationEvent, state);
}
