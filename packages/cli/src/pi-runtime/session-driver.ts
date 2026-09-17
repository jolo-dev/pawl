import {
	type PawlAnswer,
	type PawlConversation,
	parseConversationEvent,
} from "./conversation";
import {
	INITIAL_CONVERSATION_STATE,
	type PawlConversationState,
	type PawlPendingRequest,
	pushNotice,
	reduceConversationEvent,
} from "./reducer";

/**
 * Routes user input and conversation events into the owned reducer.
 *
 * Concurrency contract: the event subscription consumes the conversation's
 * events and user input concurrently. It never waits for a run to settle
 * before answering an approval that blocks the agent — an input request is not
 * the end of a run (see tests/pi-runtime-session-driver.test.ts, promise
 * barrier). Routing is conservative while a run is active: text that does not
 * resolve a pending request is never silently turned into an approval, and
 * while a request is pending unmatched text is a visible rejection rather than
 * a new prompt.
 */

export interface PawlSessionDriverOptions {
	/** Called with the reduced state after every change. */
	readonly onState?: (state: PawlConversationState) => void;
}

export interface PawlSessionDriver {
	readonly state: PawlConversationState;
	/** Routes the text as an answer while a request is pending, else as input. */
	submit(text: string): Promise<void>;
	/** Cancels the active run (queued prompts are discarded by the conversation). */
	cancel(): Promise<void>;
	dispose(): Promise<void>;
}

/** Resolves typed text to an answer for the first pending request it matches. */
export function resolveTextToAnswer(
	text: string,
	pending: readonly PawlPendingRequest[],
): { answer: PawlAnswer; pending: PawlPendingRequest } | null {
	for (const entry of pending) {
		const request = entry.request;
		// A request without options is freeform: any non-empty text answers it.
		if (request.options.length === 0) {
			if (text.trim().length > 0) {
				return {
					pending: entry,
					answer: {
						requestId: request.requestId,
						choice: { kind: "text", value: text },
					},
				};
			}
			continue;
		}
		const trimmed = text.trim();
		if (/^\d+$/.test(trimmed)) {
			const option = request.options[Number.parseInt(trimmed, 10) - 1];
			if (option) {
				return {
					pending: entry,
					answer: {
						requestId: request.requestId,
						choice: { kind: "option", value: option.id },
					},
				};
			}
			continue;
		}
		const option = request.options.find(
			(candidate) => candidate.id === trimmed,
		);
		if (option) {
			return {
				pending: entry,
				answer: {
					requestId: request.requestId,
					choice: { kind: "option", value: option.id },
				},
			};
		}
	}
	return null;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function createSessionDriver(
	conversation: PawlConversation,
	options: PawlSessionDriverOptions = {},
): PawlSessionDriver {
	let state = INITIAL_CONVERSATION_STATE;
	let disposed = false;
	/** Set at cancel() until the cancelled work settles: answers are blocked. */
	let cancelling = false;
	/** Requests that left the pending set during an active run, by run id. */
	const settledRequests = new Map<string, PawlPendingRequest>();

	const emit = () => {
		options.onState?.(state);
	};

	/** Applies one event; tracks requests that left the pending set. */
	const applyEvent = (event: unknown) => {
		const before = state;
		const parsed = parseConversationEvent(event);
		if (!parsed) return; // Unknown vendor events are ignored entirely.
		state = reduceConversationEvent(state, parsed);
		if (before !== state) {
			const pendingIds = new Set(
				state.pendingRequests.map((entry) => entry.request.requestId),
			);
			for (const entry of before.pendingRequests) {
				if (!pendingIds.has(entry.request.requestId)) {
					settledRequests.set(entry.request.requestId, entry);
				}
			}
		}
		if (parsed.type === "run_terminal") {
			// Settled requests of a settled run no longer trap fresh input.
			for (const [requestId, entry] of settledRequests) {
				if (entry.runId === parsed.runId) settledRequests.delete(requestId);
			}
		}
		if (cancelling && state.activeRunIds.length === 0) {
			cancelling = false;
		}
		emit();
	};

	// The subscription starts immediately (before any send) and runs
	// concurrently with submit(); it never gates answers behind run settlement.
	void (async () => {
		try {
			for await (const event of conversation.events()) {
				applyEvent(event);
			}
		} catch (error) {
			if (disposed) return;
			state = {
				...state,
				busy: false,
				status: "CONVERSATION_FAILED",
				failure: { code: "CONVERSATION_FAILED", message: errorText(error) },
			};
			emit();
		}
	})();

	const driver: PawlSessionDriver = {
		get state() {
			return state;
		},

		async submit(text: string): Promise<void> {
			if (disposed) {
				state = pushNotice(state, {
					role: "notice",
					text: "The conversation is closed.",
				});
				emit();
				return;
			}
			if (text.trim().length === 0) return; // Whitespace is never a prompt.
			if (cancelling) {
				state = pushNotice(state, {
					role: "notice",
					text: "Cancelling is in progress — input is ignored.",
				});
				emit();
				return;
			}

			const pending = state.pendingRequests;
			const resolved = resolveTextToAnswer(text, pending);
			if (resolved) {
				try {
					await conversation.answer(resolved.answer);
				} catch (error) {
					state = pushNotice(state, {
						role: "alert",
						text: `The answer was not accepted: ${errorText(error)}`,
					});
					emit();
					return;
				}
				// Reduce locally; the conversation's own input_resolved event is
				// idempotent in the reducer.
				applyEvent({
					type: "input_resolved",
					runId: resolved.pending.runId,
					requestId: resolved.answer.requestId,
				});
				return;
			}

			// While a run is active, text matching an already-answered request
			// is stale/duplicate — never a new prompt or a second answer.
			if (pending.length > 0 || state.activeRunIds.length > 0) {
				const stale = resolveTextToAnswer(text, [...settledRequests.values()]);
				if (stale) {
					state = pushNotice(state, {
						role: "notice",
						text: `That answer was already handled — "${text}" is not a new prompt while the run is active.`,
					});
					emit();
					return;
				}
			}
			if (pending.length > 0) {
				// Bare unmatched text must not silently become an approval or a
				// new prompt while a request is pending.
				state = pushNotice(state, {
					role: "notice",
					text: `Not a valid answer for "${pending[0]?.request.prompt}" — reply with the number or option id shown.`,
				});
				emit();
				return;
			}

			try {
				await conversation.send(text);
			} catch (error) {
				state = pushNotice(state, {
					role: "alert",
					text: `The message was not accepted: ${errorText(error)}`,
				});
				emit();
			}
		},

		async cancel(): Promise<void> {
			if (disposed) {
				state = pushNotice(state, {
					role: "notice",
					text: "The conversation is closed.",
				});
				emit();
				return;
			}
			cancelling = true;
			try {
				await conversation.cancel();
			} finally {
				emit();
			}
		},

		async dispose(): Promise<void> {
			if (disposed) return;
			disposed = true;
			await conversation.dispose();
			emit();
		},
	};

	return driver;
}
