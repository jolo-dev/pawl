/**
 * The pawl terminal shell: two panes under a logo header.
 *
 * Left: the account's deployed resources, as a resource scan reports them.
 * Right: the chat transcript and one input line.
 *
 * Density guidance from the OpenTUI skill applies: no gaps between adjacent
 * panels, no unnecessary padding, information-dense over card spacing.
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
	TextRenderable,
} from "@opentui/core";
import { PAWL_TAGLINE, THEME } from "./theme";

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

const LOGO_PATH = fileURLToPath(
	new URL("../../docs/src/assets/pawl-logo-no-text.png", import.meta.url),
);

export function logoSource(): string | undefined {
	return existsSync(LOGO_PATH) ? LOGO_PATH : undefined;
}

export interface ChoiceOption {
	readonly value: string;
	readonly label: string;
	readonly description?: string;
}

export interface PawlAppOptions {
	readonly renderer: CliRenderer;
	readonly onSubmit?: (text: string) => void;
	readonly placeholder?: string;
}

export interface ResourceLine {
	readonly text: string;
	readonly kind: "service" | "resource" | "empty" | "error";
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
	/** Replaces the resources pane, one entry per line. */
	setResources(lines: readonly ResourceLine[]): void;
	/** Marks the resources pane as loading or failed. */
	setResourcesStatus(text: string, failed?: boolean): void;
}

/** The logo as Unicode blocks, which needs no Kitty or Sixel support. */
function brandHeader(ctx: RenderContext): BoxRenderable {
	const header = new BoxRenderable(ctx, {
		id: "pawl-header",
		flexDirection: "row",
		gap: 2,
		paddingLeft: 1,
		backgroundColor: THEME.background,
	});

	const logo = new ImageRenderable(ctx, {
		id: "pawl-logo",
		source: LOGO_PATH,
		width: 12,
		height: 6,
		fit: "fit",
		protocol: "blocks",
		onError: () => {},
	});
	header.add(logo);

	header.add(
		new TextRenderable(ctx, {
			id: "pawl-wordmark",
			content: "pawl",
			fg: THEME.accent,
		}),
	);
	header.add(
		new TextRenderable(ctx, {
			id: "pawl-tagline",
			content: THEME.muted ? PAWL_TAGLINE : PAWL_TAGLINE,
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

	const body = new BoxRenderable(renderer, {
		id: "pawl-body",
		flexDirection: "row",
		flexGrow: 1,
		backgroundColor: THEME.background,
	});
	root.add(body);

	// Left: deployed resources. Bordered and titled, so each pane reads as its
	// own region rather than as two halves of one screen.
	const resources = new BoxRenderable(renderer, {
		id: "pawl-resources",
		title: "Cloudformation Stacks",
		titleColor: THEME.box,
		titleAlignment: "left",
		border: true,
		borderStyle: "single",
		borderColor: THEME.box,
		width: "38%",
		height: "100%",
		backgroundColor: THEME.background,
		paddingLeft: 1,
	});
	body.add(resources);

	// Right: chat, which is the conversation and the input.
	const chat = new BoxRenderable(renderer, {
		id: "pawl-chat",
		title: "Chat with your Cloud",
		titleColor: THEME.box,
		titleAlignment: "left",
		border: true,
		borderStyle: "single",
		borderColor: THEME.box,
		flexDirection: "column",
		flexGrow: 1,
		height: "100%",
		backgroundColor: THEME.background,
		paddingLeft: 1,
	});
	body.add(chat);

	const transcript = new ScrollBoxRenderable(renderer, {
		id: "pawl-transcript",
		flexGrow: 1,
		backgroundColor: THEME.background,
	});
	chat.add(transcript);

	const status = new TextRenderable(renderer, {
		id: "pawl-status",
		content: "",
		fg: THEME.muted,
	});
	chat.add(status);

	const input = new InputRenderable(renderer, {
		id: "pawl-input",
		placeholder: options.placeholder ?? "Ask about your AWS setup",
		backgroundColor: THEME.background,
		textColor: THEME.body,
		focusedBackgroundColor: THEME.background,
		focusedTextColor: THEME.strong,
		placeholderColor: THEME.muted,
	});
	chat.add(input);

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
		setResources(lines) {
			for (const child of [...resources.getChildren()]) {
				resources.remove(child);
			}
			for (const line of lines) {
				resources.add(
					new TextRenderable(renderer, {
						content: line.text,
						fg:
							line.kind === "service"
								? THEME.accent
								: line.kind === "empty"
									? THEME.muted
									: line.kind === "resource"
										? THEME.body
										: THEME.accent,
					}),
				);
			}
		},
		setResourcesStatus(text, failed = false) {
			for (const child of [...resources.getChildren()]) {
				resources.remove(child);
			}
			resources.add(
				new TextRenderable(renderer, {
					content: text,
					fg: failed ? THEME.accent : THEME.muted,
				}),
			);
		},
	};
}
