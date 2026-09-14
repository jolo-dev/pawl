/**
 * The pawl terminal shell.
 *
 * Three regions, no panes: a branded header, a scrolling transcript, and one
 * input line. R10 fixed the interaction set (streaming text, tool calls,
 * approvals, questions, cancel) and R13 put the AWS preflight inside this
 * client too — both land here, in the transcript, rather than in separate panes.
 *
 * Layout is kept in a function that takes a renderer so it can be driven by
 * OpenTUI's in-memory test renderer rather than only by a real terminal.
 */

import {
	BoxRenderable,
	type CliRenderer,
	InputRenderable,
	InputRenderableEvents,
	ScrollBoxRenderable,
	TextRenderable,
} from "@opentui/core";
import { PAWL_TAGLINE, PAWL_WORDMARK, THEME } from "./theme";

/** How a line is attributed, which decides its colour. */
export type TranscriptRole = "user" | "assistant" | "notice" | "alert";

const ROLE_COLOR: Record<TranscriptRole, string> = {
	user: THEME.strong,
	assistant: THEME.body,
	notice: THEME.muted,
	// Anything asking the user to act, or warning that coverage was partial,
	// carries the brand's redline accent.
	alert: THEME.accent,
};

const ROLE_PREFIX: Record<TranscriptRole, string> = {
	user: "› ",
	assistant: "",
	notice: "· ",
	alert: "! ",
};

export interface PawlAppOptions {
	readonly renderer: CliRenderer;
	/** Called with the trimmed input when the user presses Enter. */
	readonly onSubmit?: (text: string) => void;
	/** Shown as the input's placeholder. */
	readonly placeholder?: string;
}

export interface PawlApp {
	readonly root: BoxRenderable;
	readonly transcript: ScrollBoxRenderable;
	readonly input: InputRenderable;
	/** Adds one line to the transcript and returns its renderable. */
	append(role: TranscriptRole, text: string): TextRenderable;
	/** Replaces the status line under the transcript. */
	setStatus(text: string, role?: TranscriptRole): void;
	/** Removes every transcript line, for `/clear` and `/new`. */
	clearTranscript(): void;
	/** Puts the cursor in the input, for startup and after a turn. */
	focusInput(): void;
}

export function createPawlApp(options: PawlAppOptions): PawlApp {
	const { renderer } = options;

	const root = new BoxRenderable(renderer, {
		id: "pawl-root",
		flexDirection: "column",
		width: "100%",
		height: "100%",
		backgroundColor: THEME.background,
	});

	const header = new BoxRenderable(renderer, {
		id: "pawl-header",
		flexDirection: "row",
		gap: 2,
		paddingLeft: 1,
		backgroundColor: THEME.background,
	});
	header.add(
		new TextRenderable(renderer, {
			id: "pawl-wordmark",
			content: PAWL_WORDMARK,
			fg: THEME.accent,
		}),
	);
	header.add(
		new TextRenderable(renderer, {
			id: "pawl-tagline",
			content: PAWL_TAGLINE,
			fg: THEME.muted,
		}),
	);
	root.add(header);

	const transcript = new ScrollBoxRenderable(renderer, {
		id: "pawl-transcript",
		flexGrow: 1,
		backgroundColor: THEME.background,
		paddingLeft: 1,
		stickyScroll: true,
		stickyStart: "bottom",
	});
	root.add(transcript);

	const status = new TextRenderable(renderer, {
		id: "pawl-status",
		content: "",
		fg: THEME.muted,
	});
	root.add(status);

	const input = new InputRenderable(renderer, {
		id: "pawl-input",
		placeholder: options.placeholder ?? "Ask about your AWS setup",
		backgroundColor: THEME.panel,
		textColor: THEME.body,
		focusedBackgroundColor: THEME.panel,
		focusedTextColor: THEME.strong,
		placeholderColor: THEME.muted,
	});
	root.add(input);

	const onSubmit = options.onSubmit;
	input.on(InputRenderableEvents.ENTER, () => {
		const text = input.value.trim();
		if (text.length === 0 || !onSubmit) return;
		input.value = "";
		onSubmit(text);
	});

	return {
		root,
		transcript,
		input,
		append(role, text) {
			const line = new TextRenderable(renderer, {
				content: `${ROLE_PREFIX[role]}${text}`,
				fg: ROLE_COLOR[role],
			});
			transcript.add(line);
			return line;
		},
		setStatus(text, role = "notice") {
			status.content = text;
			status.fg = ROLE_COLOR[role];
		},
		clearTranscript() {
			for (const child of [...transcript.getChildren()]) {
				transcript.remove(child);
			}
		},
		focusInput() {
			input.focus();
		},
	};
}
