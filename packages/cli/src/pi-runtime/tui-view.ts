import type { PawlApp, TranscriptRole } from "../tui/app";
import type { PawlConversationState, PawlLine } from "./reducer";

/**
 * The narrow sink adapter between the Pawl-owned reduced conversation state
 * (Task 5) and the existing OpenTUI shell (`src/tui/app.ts`, clean baseline).
 *
 * It owns only translation: reduced lines are diffed into app append/update
 * calls, the reduced status is projected onto the status line, and the owned
 * busy state is forwarded through an optional callback (the clean app has no
 * busy seam of its own). No Pi/Eve event type is imported here and no owned
 * state is cast to anything: unknown shapes fail at the type boundary.
 */

/** A line of recovered history rendered before any live conversation event. */
export interface RestoredLine {
	readonly role: TranscriptRole;
	readonly text: string;
}

export interface TuiViewOptions {
	readonly app: PawlApp;
	/** Called with the owned busy state whenever it changes. */
	readonly onBusy?: (busy: boolean) => void;
}

export interface PawlTuiView {
	/** Applies one reduced conversation state to the app. */
	apply(state: PawlConversationState): void;
	/** Renders recovered history (closed lines) before any live event. */
	restore(lines: readonly RestoredLine[]): void;
}

const lineRole = (line: PawlLine): TranscriptRole => line.role;

export function createTuiView(options: TuiViewOptions): PawlTuiView {
	const { app, onBusy } = options;
	/** Number of state-driven lines materialized in the transcript. */
	let rendered = 0;
	/** The trailing rendered line, reconciled while it streams. */
	let trailing: {
		readonly role: TranscriptRole;
		readonly text: string;
	} | null = null;
	/** Last busy value forwarded, so the callback fires on change only. */
	let lastBusy: boolean = false;

	const apply = (state: PawlConversationState): void => {
		const lines = state.lines;
		for (let index = rendered; index < lines.length; index += 1) {
			const line = lines[index];
			if (!line) continue;
			app.append(lineRole(line), line.text);
		}
		rendered = lines.length;
		const last = lines.at(-1);
		const nextTrailing =
			last === undefined ? null : { role: lineRole(last), text: last.text };
		if (
			nextTrailing !== null &&
			rendered > 0 &&
			(trailing === null ||
				trailing.text !== nextTrailing.text ||
				trailing.role !== nextTrailing.role)
		) {
			app.updateLast(nextTrailing.role, nextTrailing.text);
		}
		trailing = nextTrailing;

		app.setStatus(state.status, state.failure === null ? "notice" : "alert");
		if (state.busy !== lastBusy) {
			lastBusy = state.busy;
			onBusy?.(state.busy);
		}
	};

	const restore = (lines: readonly RestoredLine[]): void => {
		for (const line of lines) {
			app.append(line.role, line.text);
		}
		// Restored lines are transcript-only scrollback: state-driven rendering
		// starts from zero so later appends never reconcile into restored text.
		rendered = 0;
		trailing = null;
	};

	return { apply, restore };
}
