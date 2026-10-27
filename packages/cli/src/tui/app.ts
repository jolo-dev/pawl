/**
 * The pawl terminal shell: two panes under a compact wordmark header.
 *
 * Left: the account's deployed resources, as a resource scan reports them.
 * Right: the chat transcript and one input line.
 *
 * Density guidance from the OpenTUI skill applies: no gaps between adjacent
 * panels, no unnecessary padding, information-dense over card spacing.
 */

import {
	BoxRenderable,
	type CliRenderer,
	InputRenderable,
	InputRenderableEvents,
	type RenderContext,
	ScrollBoxRenderable,
	TextRenderable,
} from "@opentui/core";
import { PAWL_ASCII_LOGO } from "./ascii-logo";
import { PAWL_TAGLINE, THEME } from "./theme";
import { createWatermarkPulse } from "./watermark-pulse";

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
	/** Animates the watermark while the agent works; idle restores its base colour. */
	setBusy(busy: boolean): void;
	clearTranscript(): void;
	updateLast(role: TranscriptRole, text: string): void;
	focusInput(): void;
	/** Replaces the resources pane, one entry per line. */
	setResources(lines: readonly ResourceLine[]): void;
	/** Marks the resources pane as loading or failed. */
	setResourcesStatus(text: string, failed?: boolean): void;
}

/** Text-only branding; the artwork lives behind the chat output. */
function brandHeader(ctx: RenderContext): BoxRenderable {
	const header = new BoxRenderable(ctx, {
		id: "pawl-header",
		height: 1,
		flexShrink: 0,
		flexDirection: "row",
		gap: 2,
		paddingLeft: 1,
		backgroundColor: THEME.background,
	});

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
		minHeight: 0,
		backgroundColor: THEME.background,
	});
	root.add(body);

	// Left: deployed resources. Bordered and titled, so each pane reads as its
	// own region rather than as two halves of one screen.
	const resources = new BoxRenderable(renderer, {
		id: "pawl-resources",
		padding: 1,
		title: "Cloudformation Stacks",
		titleColor: THEME.box,
		titleAlignment: "left",
		border: true,
		borderStyle: "single",
		borderColor: THEME.box,
		width: "38%",
		flexShrink: 0,
		height: "100%",
		backgroundColor: THEME.background,
	});
	body.add(resources);

	// Right: chat, which is the conversation and the input.
	const chat = new BoxRenderable(renderer, {
		id: "pawl-chat",
		padding: 1,
		title: "Chat with your Cloud",
		titleColor: THEME.box,
		titleAlignment: "left",
		border: true,
		borderStyle: "single",
		borderColor: THEME.box,
		flexDirection: "column",
		flexGrow: 1,
		flexBasis: 0,
		minWidth: 0,
		height: "100%",
		backgroundColor: THEME.background,
	});
	body.add(chat);

	// The artwork is outside the scrolling content, clipped to the output area.
	const output = new BoxRenderable(renderer, {
		id: "pawl-output",
		flexGrow: 1,
		flexBasis: 0,
		minHeight: 0,
		overflow: "hidden",
	});
	chat.add(output);
	const artworkRows = PAWL_ASCII_LOGO.split("\n");
	// Anchor a box so fractional pane widths round to the same cell edge as
	// the viewport. Text nodes alone round their negative left offsets down.
	const watermarkAnchor = new BoxRenderable(renderer, {
		id: "pawl-watermark-anchor",
		position: "absolute",
		right: 0,
		bottom: 0,
		width: Math.max(...artworkRows.map((row) => row.length)),
		height: artworkRows.length,
		zIndex: 0,
	});
	output.add(watermarkAnchor);
	const watermark = new TextRenderable(renderer, {
		id: "pawl-watermark",
		content: PAWL_ASCII_LOGO,
		width: "100%",
		height: "100%",
		wrapMode: "none",
		fg: THEME.watermark,
		selectable: false,
	});
	watermarkAnchor.add(watermark);
	const setBusy = createWatermarkPulse(renderer, watermark);

	const transcript = new ScrollBoxRenderable(renderer, {
		id: "pawl-transcript",
		zIndex: 1,
		rootOptions: { backgroundColor: "transparent" },
		wrapperOptions: { backgroundColor: "transparent" },
		viewportOptions: { backgroundColor: "transparent" },
		contentOptions: { backgroundColor: "transparent" },
		scrollY: true,
		scrollX: false,
		stickyScroll: true,
		stickyStart: "bottom",
		scrollbarOptions: {
			trackOptions: {
				backgroundColor: THEME.background,
				foregroundColor: THEME.box,
			},
		},
		flexGrow: 1,
		flexBasis: 0,
		minHeight: 0,
		backgroundColor: "transparent",
	});
	output.add(transcript);

	// A box keeps the fixed controls aligned with the padded output viewport.
	const composer = new BoxRenderable(renderer, {
		id: "pawl-composer",
		flexShrink: 0,
		flexDirection: "column",
		backgroundColor: THEME.background,
	});
	chat.add(composer);

	const status = new TextRenderable(renderer, {
		id: "pawl-status",
		height: 1,
		flexShrink: 0,
		content: "",
		fg: THEME.muted,
	});
	composer.add(status);

	// These controls live outside the scrolling output viewport.
	const separator = new TextRenderable(renderer, {
		id: "pawl-input-separator",
		height: 1,
		flexShrink: 0,
		content: "─",
		fg: THEME.box,
		selectable: false,
	});
	composer.add(separator);

	const input = new InputRenderable(renderer, {
		id: "pawl-input",
		width: "100%",
		flexShrink: 0,
		cursorColor: THEME.box,
		placeholder: options.placeholder ?? "Ask about your AWS setup",
		backgroundColor: THEME.background,
		textColor: THEME.body,
		focusedBackgroundColor: THEME.background,
		focusedTextColor: THEME.strong,
		placeholderColor: THEME.muted,
	});
	composer.add(input);
	// The composer's width already excludes the pane borders and padding.
	composer.on("resize", () => {
		const innerWidth = composer.width;
		input.width = innerWidth;
		status.width = innerWidth;
		separator.width = innerWidth;
		separator.content = "─".repeat(innerWidth);
	});

	const setStatus = (text: string, role: TranscriptRole = "notice"): void => {
		status.content = text;
		status.fg = ROLE_COLOR[role];
	};

	const append = (role: TranscriptRole, text: string): TextRenderable => {
		const row = new BoxRenderable(renderer, {
			backgroundColor: role === "user" ? THEME.userMessage : "transparent",
			flexShrink: 0,
		});
		const line = new TextRenderable(renderer, {
			content: formatLine(role, text),
			fg: ROLE_COLOR[role],
			// Opaque text cells also mask the art beneath spaces within a message.
			bg: role === "user" ? THEME.userMessage : THEME.background,
		});
		row.add(line);
		transcript.add(row);
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
		setBusy,
		setStatus(text, role = "notice") {
			setStatus(text, role);
		},
		clearTranscript() {
			for (const child of [...transcript.getChildren()]) {
				transcript.remove(child);
			}
		},
		updateLast(role, text) {
			const row = transcript.getChildren().at(-1);
			if (!(row instanceof BoxRenderable)) return;
			const last = row.getChildren()[0];
			if (!(last instanceof TextRenderable)) return;
			last.content = formatLine(role, text);
			last.fg = ROLE_COLOR[role];
			last.bg = role === "user" ? THEME.userMessage : THEME.background;
			row.backgroundColor = role === "user" ? THEME.userMessage : "transparent";
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
