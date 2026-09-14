/**
 * The pawl terminal shell.
 *
 * Three regions: a logo header, a scrolling transcript, and one input line. When
 * the pre-flight needs a choice it opens a select above the input and closes it
 * again, so a question and its answer stay in the transcript instead of in a
 * widget that scrolls away.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	BoxRenderable,
	type CliRenderer,
	ImageRenderable,
	InputRenderable,
	InputRenderableEvents,
	type RenderContext,
	ScrollBoxRenderable,
	SelectRenderable,
	SelectRenderableEvents,
	TextRenderable,
} from "@opentui/core";
import { PAWL_TAGLINE, PAWL_WORDMARK, THEME } from "./theme";

/** How a line is attributed, which decides its colour and marker. */
export type TranscriptRole =
	| "user"
	| "assistant"
	| "reasoning"
	| "tool"
	| "notice"
	| "alert";

const ROLE_COLOR: Record<TranscriptRole, string> = {
	user: THEME.strong,
	assistant: THEME.body,
	reasoning: THEME.muted,
	tool: THEME.muted,
	notice: THEME.muted,
	// Anything asking the user to act, or warning that coverage was partial,
	// carries the brand's redline accent.
	alert: THEME.accent,
};

const ROLE_PREFIX: Record<TranscriptRole, string> = {
	user: "› ",
	assistant: "",
	reasoning: "∴ ",
	tool: "⚙ ",
	notice: "· ",
	alert: "! ",
};

export function formatLine(role: TranscriptRole, text: string): string {
	return `${ROLE_PREFIX[role]}${text}`;
}

export function roleColor(role: TranscriptRole): string {
	return ROLE_COLOR[role];
}

/**
 * The logo, resolved from the documentation assets.
 *
 * Rendered with the Unicode-block protocol, which is the ASCII conversion: it
 * needs no Kitty or Sixel support, so it works in any terminal. Absent only when
 * the assets are not installed alongside the client, in which case the shell
 * falls back to the wordmark.
 */
const LOGO_PATH = fileURLToPath(
	new URL("../../docs/src/assets/pawl-logo-no-text.png", import.meta.url),
);

export function hasLogo(): boolean {
	return existsSync(LOGO_PATH);
}

/** The logo as cells, or undefined when it is unavailable. */
export function logoSource(): string | undefined {
	return hasLogo() ? LOGO_PATH : undefined;
}

/** A select option, mirroring what a widget and the prompter both need. */
export interface ChoiceOption {
	readonly value: string;
	readonly label: string;
	readonly description?: string;
}

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
	append(role: TranscriptRole, text: string): TextRenderable;
	setStatus(text: string, role?: TranscriptRole): void;
	clearTranscript(): void;
	updateLast(role: TranscriptRole, text: string): void;
	focusInput(): void;
	/**
	 * Opens a select over the input and resolves with the chosen value, or null
	 * when the user cancelled. The options stay visible until it closes, so the
	 * question and its answer remain in the transcript.
	 */
	promptSelect(options: {
		readonly message: string;
		readonly choices: readonly ChoiceOption[];
		readonly allowBack?: boolean;
	}): Promise<string | null>;
}

function brandHeader(ctx: RenderContext): BoxRenderable {
	const header = new BoxRenderable(ctx, {
		id: "pawl-header",
		flexDirection: "row",
		gap: 2,
		paddingLeft: 1,
		backgroundColor: THEME.background,
	});

	if (hasLogo()) {
		const image = new ImageRenderable(ctx, {
			id: "pawl-logo",
			source: LOGO_PATH,
			// Two cells per text row keeps the pawl proportions roughly square.
			width: 14,
			height: 7,
			fit: "fit",
			// The ASCII conversion: Unicode blocks, so it renders in any terminal
			// without Kitty or Sixel support.
			protocol: "blocks",
			onError: () => {},
		});
		header.add(image);
	}

	header.add(
		new TextRenderable(ctx, {
			id: "pawl-wordmark",
			content: PAWL_WORDMARK,
			fg: THEME.accent,
		}),
	);
	header.add(
		new TextRenderable(ctx, {
			id: "pawl-tagline",
			content: PAWL_TAGLINE,
			fg: THEME.muted,
		}),
	);
	return header;
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

	root.add(brandHeader(renderer));

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

	const setStatus = (text: string, role: TranscriptRole = "notice"): void => {
		status.content = text;
		status.fg = ROLE_COLOR[role];
	};

	const append = (role: TranscriptRole, text: string): TextRenderable => {
		const line = new TextRenderable(renderer, {
			content: formatLine(role, text),
			fg: ROLE_COLOR[role],
		});
		transcript.add(line);
		return line;
	};

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
		append,
		setStatus(text, role = "notice") {
			setStatus(text, role);
		},
		clearTranscript() {
			for (const child of [...transcript.getChildren()]) {
				transcript.remove(child);
			}
		},
		updateLast(role, text) {
			const last = transcript.getChildren().at(-1);
			if (!(last instanceof TextRenderable)) return;
			last.content = formatLine(role, text);
			last.fg = ROLE_COLOR[role];
		},
		focusInput() {
			input.focus();
		},
		promptSelect({ message, choices }) {
			return new Promise<string | null>((resolve) => {
				append("notice", message);

				const select = new SelectRenderable(renderer, {
					id: "pawl-select",
					options: choices.map((choice) => ({
						name: choice.label,
						description: choice.description ?? "",
						value: choice.value,
					})),
					backgroundColor: THEME.background,
					textColor: THEME.body,
					focusedBackgroundColor: THEME.panel,
					focusedTextColor: THEME.strong,
					selectedBackgroundColor: THEME.accent,
					selectedTextColor: THEME.background,
					showDescription: false,
					showSelectionIndicator: true,
				});

				root.add(select);
				select.focus();
				setStatus(message);

				let settled = false;
				const finish = (value: string | null): void => {
					if (settled) return;
					settled = true;
					root.remove(select);
					select.destroy();
					input.focus();
					resolve(value);
				};

				select.on(SelectRenderableEvents.ITEM_SELECTED, () => {
					const selected = select.getSelectedOption();
					const value =
						typeof selected?.value === "string" ? selected.value : null;
					if (value === null) {
						append("alert", "Nothing selected.");
						return;
					}
					finish(value);
				});
			});
		},
	};
}
