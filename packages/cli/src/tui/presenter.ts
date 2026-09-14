/**
 * Renders reducer state into the shell.
 *
 * The reducer produces a whole transcript each time; the presenter only sends
 * the difference, because re-creating every rendered line on each stream delta
 * would be quadratic on a long conversation. Two operations cover every case:
 * a new line is appended, and a line that is still open is rewritten in place as
 * its deltas arrive.
 */

import type { TranscriptRole } from "./app";
import type { TuiState } from "./reducer";

/** The smallest part of the shell the presenter needs. */
export interface PresenterTarget {
	append(role: TranscriptRole, text: string): unknown;
	updateLast(role: TranscriptRole, text: string): void;
	setStatus(text: string, role?: TranscriptRole): void;
	clearTranscript(): void;
}

export interface Presenter {
	present(state: TuiState): void;
	/** Drops the rendered-line count, for a cleared transcript. */
	reset(): void;
}

export function createPresenter(target: PresenterTarget): Presenter {
	let rendered = 0;
	let lastSignature: string | null = null;

	const signatureOf = (state: TuiState): string | null => {
		const last = state.lines.at(-1);
		return last ? `${last.role}\u0000${last.text}` : null;
	};

	return {
		present(state) {
			for (let index = rendered; index < state.lines.length; index++) {
				const line = state.lines[index];
				if (!line) continue;
				target.append(line.role, line.text);
			}

			const last = state.lines.at(-1);
			const signature = signatureOf(state);
			// An unchanged line count means the trailing line grew rather than a new
			// line appearing. Comparing the text as well keeps an unrelated event
			// (a step boundary, say) from rewriting the line for no reason.
			if (
				last &&
				state.lines.length === rendered &&
				rendered > 0 &&
				signature !== lastSignature
			) {
				target.updateLast(last.role, last.text);
			}

			rendered = state.lines.length;
			lastSignature = signature;
			// A failure takes the accent colour, so it is not read as ordinary
			// status text.
			target.setStatus(state.status, state.failure ? "alert" : "notice");
		},

		reset() {
			rendered = 0;
			lastSignature = null;
			target.clearTranscript();
		},
	};
}
