/**
 * Driving one session: turn events into state, and input into an action.
 *
 * Two decisions live here, and both are the kind that fail silently if wrong.
 *
 * Input routing: while a request is pending the user is answering *it*, not
 * sending a new turn. Text that resolves nothing must be reported as unresolved
 * rather than falling through to `send`, or a user could believe they approved
 * a deploy when they actually started an unrelated turn.
 *
 * Turn boundaries: eve exports `isCurrentTurnBoundaryEvent` for exactly this, so
 * the client does not invent its own notion of "the turn ended".
 */

import {
	ClientError,
	type InputResponse,
	isCurrentTurnBoundaryEvent,
	type MessageStreamEvent,
} from "eve/client";
import type { PawlSession } from "./client";
import type { InputQueue } from "./prompter";
import {
	buildResponses,
	INITIAL_TUI_STATE,
	reduceEvent,
	type TuiState,
} from "./reducer";

/** What a submitted line means, given the conversation's current state. */
export type InputAction =
	| { readonly kind: "send"; readonly text: string }
	| { readonly kind: "respond"; readonly responses: readonly InputResponse[] }
	| { readonly kind: "unresolved"; readonly text: string };

/**
 * Route a submitted line.
 *
 * With no pending request it is a new turn. With one pending it is an answer, and
 * an answer that matches no option is reported so the client can say so instead
 * of appearing to ignore the user.
 */
export function routeInput(text: string, state: TuiState): InputAction {
	const trimmed = text.trim();
	if (state.pendingRequests.length === 0) {
		return { kind: "send", text: trimmed };
	}

	const responses = buildResponses(trimmed, state.pendingRequests);
	if (responses.length === 0) {
		return { kind: "unresolved", text: trimmed };
	}
	return { kind: "respond", responses: [...responses] };
}

export interface SessionView {
	present(state: TuiState): void;
	/** A message for the user that is not part of the agent's output. */
	alert(text: string): void;
}

export interface SessionDriverOptions {
	readonly session: PawlSession;
	readonly view: SessionView;
	readonly input: InputQueue;
	readonly state?: TuiState | undefined;
	/**
	 * Stop after this many exchanges. Only tests set it; a real client runs until
	 * the user leaves.
	 */
	readonly maxTurns?: number | undefined;
}

/**
 * Consume the session's stream, presenting every event, until the turn reaches
 * a boundary.
 *
 * Breaking out of `events()` abandons that iterator and the handle keeps its
 * cursor, so the next turn resumes from where this one stopped.
 *
 * **Only eve's boundary ends the loop.** An earlier version also broke on
 * `turn.completed`, on the theory that a turn could end without the session
 * parking and hang the client. A live run showed the theory was wrong and the
 * workaround harmful: the stream emits `turn.completed` and *then*
 * `session.waiting`, so breaking early leaves that boundary queued, and the next
 * turn's `consumeTurn` breaks on it immediately without ever reading the new
 * turn's events. The client appears to do nothing after its first message.
 */
export async function consumeTurn(
	session: PawlSession,
	view: SessionView,
	state: TuiState,
): Promise<TuiState> {
	let current = state;
	for await (const event of session.events()) {
		current = reduceEvent(current, event as MessageStreamEvent);
		view.present(current);
		if (isCurrentTurnBoundaryEvent(event)) break;
	}
	return current;
}

/**
 * Run the conversation: consume the opening turn, then read input and act on it,
 * until the stream ends or the turn budget is spent.
 */
export async function runInteractiveSession(
	options: SessionDriverOptions,
): Promise<TuiState> {
	const { session, view, input } = options;
	let state = options.state ?? INITIAL_TUI_STATE;

	const limit = options.maxTurns ?? Number.POSITIVE_INFINITY;
	let turns = 0;

	while (turns < limit) {
		state = await consumeTurn(session, view, state);
		turns++;
		if (turns >= limit) break;

		const text = (await input.next()).trim();
		if (text.length === 0) continue;

		let action: InputAction;
		try {
			action = routeInput(text, state);
		} catch {
			continue;
		}
		if (action.kind === "unresolved") {
			// Saying so matters: silence here reads as a lost answer, and the user's
			// next attempt may be to approve something else.
			view.alert(
				`That did not match any pending option. Reply with a number or an option id.`,
			);
			continue;
		}

		if (action.kind === "respond") {
			try {
				await session.respond(action.responses);
			} catch (error: unknown) {
				if (error instanceof ClientError && error.status === 409) {
					view.alert("This session has ended. Start pawl again for a new one.");
					return state;
				}
				view.alert(error instanceof Error ? error.message : String(error));
			}
		} else {
			// Echoed locally for immediate feedback and kept in state, because the
			// transcript IS the conversation history. The reducer ignores
			// `message.received` so the echo is not duplicated when the server
			// reports the same message back.
			state = {
				...state,
				lines: [
					...state.lines,
					{ role: "user", text: action.text, open: false },
				],
			};
			view.present(state);
			try {
				await session.send(action.text);
			} catch (error: unknown) {
				// A 409 means the session reached a terminal state server-side —
				// most often `session.failed` — so the conversation cannot go on.
				// Report it and stop rather than crash or spin on a dead session.
				const message = error instanceof Error ? error.message : String(error);
				const terminal =
					error instanceof ClientError &&
					(error.status === 409 || error.code === "session_not_active");
				view.alert(
					terminal
						? "This session has ended and cannot accept messages. Start pawl again for a new one."
						: message,
				);
				if (terminal) return state;
			}
		}
	}

	return state;
}
