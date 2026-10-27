import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { RGBA, TextRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { createPawlApp, type PawlApp } from "../src/tui/app";
import { PAWL_ASCII_LOGO } from "../src/tui/ascii-logo";
import { createInputQueue, createTuiPrompter } from "../src/tui/prompter";
import { PAWL_TAGLINE, PAWL_WORDMARK } from "../src/tui/theme";

/**
 * OpenTUI's test renderer runs the real CliRenderer against native in-memory
 * output, so these assert what is actually drawn without touching a terminal.
 * The docs are explicit that tests own cleanup, hence the destroy in afterEach.
 */
type Setup = Awaited<ReturnType<typeof createTestRenderer>>;

let setup: Setup | undefined;
let app: PawlApp | undefined;

async function mount(options?: { onSubmit?: (text: string) => void }) {
	setup = await createTestRenderer({ width: 60, height: 18 });
	app = createPawlApp({
		renderer: setup.renderer,
		onSubmit: options?.onSubmit,
	});
	setup.renderer.root.add(app.root);
	await setup.renderOnce();
	return { setup, app };
}

function frame(): string {
	return setup?.captureCharFrame() ?? "";
}

afterEach(() => {
	setup?.renderer.destroy();
	setup = undefined;
	app = undefined;
});

describe("pawl terminal shell", () => {
	test("uses a compact text-only header instead of an image", async () => {
		const { app: shell } = await mount();
		const header = shell.root
			.getChildren()
			.find((child) => child.id === "pawl-header");
		expect(header?.height).toBe(1);
		expect(header?.getChildren().map((child) => child.id)).toEqual([
			"pawl-wordmark",
			"pawl-tagline",
		]);
	});

	test("shows the wordmark and tagline in the header", async () => {
		await mount();

		expect(frame()).toContain(PAWL_WORDMARK);
		expect(frame()).toContain(PAWL_TAGLINE);
	});

	test("starts with an empty transcript and the prompt visible", async () => {
		await mount();

		expect(frame()).toContain("Ask about your AWS setup");
		expect(app?.transcript.getChildren()).toHaveLength(0);
	});

	test("attributes transcript lines so the user and the agent are distinguishable", async () => {
		const { app: mounted } = await mount();

		mounted.append("user", "scan my account");
		mounted.append("assistant", "Twelve resources, one gap.");
		await setup?.renderOnce();

		const text = frame();
		expect(text).toContain("› scan my account");
		expect(text).toContain("Twelve resources, one gap.");
	});

	test("gives an alert its own marker so a warning is not read as chatter", async () => {
		const { app: mounted } = await mount();

		mounted.append("alert", "s3 was not read");
		await setup?.renderOnce();

		expect(frame()).toContain("! s3 was not read");
	});

	test("replaces the status line rather than appending to it", async () => {
		const { app: mounted } = await mount();

		mounted.setStatus("checking credentials");
		await setup?.renderOnce();
		mounted.setStatus("credentials valid");
		await setup?.renderOnce();

		const text = frame();
		expect(text).toContain("credentials valid");
		expect(text).not.toContain("checking credentials");
	});

	test("clears the transcript for a fresh session", async () => {
		const { app: mounted } = await mount();

		mounted.append("user", "something earlier");
		await setup?.renderOnce();
		mounted.clearTranscript();
		await setup?.renderOnce();

		expect(frame()).not.toContain("something earlier");
		expect(mounted.transcript.getChildren()).toHaveLength(0);
	});
});

describe("chat output and composer", () => {
	test("pulses gently only while busy, without restarting on streamed updates", async () => {
		const { setup: mounted, app: shell } = await mount();
		const watermark = shell.root.findDescendantById("pawl-watermark");
		if (!(watermark instanceof TextRenderable))
			throw new Error("missing watermark");
		// Keep native rendering manual and advance the registered callback deterministically.
		mounted.renderer.pause();
		const frames = spyOn(mounted.renderer, "setFrameCallback");
		try {
			const idleRequests = mounted.renderer.liveRequestCount;
			expect(watermark.fg).toEqual(RGBA.fromHex("#722f37"));
			shell.setBusy(false);
			expect(frames).not.toHaveBeenCalled();
			shell.setBusy(true);
			expect(mounted.renderer.liveRequestCount).toBe(idleRequests + 1);
			const tick = frames.mock.calls[0]?.[0];
			if (!tick) throw new Error("missing animation frame callback");
			await tick(700);
			expect(watermark.fg).toEqual(RGBA.fromHex("#62282f"));
			shell.setBusy(true);
			await tick(700);
			expect(watermark.fg).toEqual(RGBA.fromHex("#522228"));
			expect(frames).toHaveBeenCalledTimes(1);
			await tick(1400);
			expect(watermark.fg).toEqual(RGBA.fromHex("#722f37"));
			await tick(1400);
			expect(watermark.fg).toEqual(RGBA.fromHex("#522228"));
			shell.setBusy(false);
			expect(watermark.fg).toEqual(RGBA.fromHex("#722f37"));
			expect(mounted.renderer.liveRequestCount).toBe(idleRequests);
			await tick(700);
			expect(watermark.fg).toEqual(RGBA.fromHex("#722f37"));
			shell.setBusy(true);
			expect(mounted.renderer.liveRequestCount).toBe(idleRequests + 1);
			shell.setBusy(false);
		} finally {
			frames.mockRestore();
		}
	});

	test("renders changing watermark colour without moving text or changing message backgrounds", async () => {
		const { setup: mounted, app: shell } = await mount();
		mounted.renderer.pause();
		shell.append("user", "scan AWS");
		shell.append("assistant", "Ready");
		shell.input.value = "draft";
		await mounted.renderOnce();
		const original = frame();
		const watermarkSpan = () =>
			mounted
				.captureSpans()
				.lines.flatMap((row) => row.spans)
				.find((span) => span.text.includes(":"));
		expect(watermarkSpan()?.fg).toEqual(RGBA.fromHex("#722f37"));
		const frames = spyOn(mounted.renderer, "setFrameCallback");
		try {
			shell.setBusy(true);
			const tick = frames.mock.calls[0]?.[0];
			if (!tick) throw new Error("missing animation frame callback");
			await tick(1400);
			await mounted.renderOnce();
			expect(frame()).toBe(original);
			expect(watermarkSpan()?.fg).not.toEqual(RGBA.fromHex("#722f37"));
			const userSpan = mounted
				.captureSpans()
				.lines.flatMap((row) => row.spans)
				.find((span) => span.text.includes("scan AWS"));
			expect(userSpan?.bg).toEqual(RGBA.fromHex("#262626"));
			shell.setBusy(false);
			await mounted.renderOnce();
			expect(watermarkSpan()?.fg).toEqual(RGBA.fromHex("#722f37"));
		} finally {
			frames.mockRestore();
		}
	});

	test("releases animation ownership when the shell or renderer is destroyed", async () => {
		const { setup: mounted, app: shell } = await mount();
		mounted.renderer.pause();
		const removeFrame = spyOn(mounted.renderer, "removeFrameCallback");
		try {
			shell.setBusy(true);
			shell.root.destroyRecursively();
			expect(mounted.renderer.liveRequestCount).toBe(0);
			expect(removeFrame).toHaveBeenCalledTimes(1);
			shell.setBusy(true);
			expect(mounted.renderer.liveRequestCount).toBe(0);
			const replacement = createPawlApp({ renderer: mounted.renderer });
			mounted.renderer.root.add(replacement.root);
			replacement.setBusy(true);
			mounted.renderer.destroy();
			expect(removeFrame).toHaveBeenCalledTimes(2);
			expect(() => replacement.setBusy(true)).not.toThrow();
		} finally {
			removeFrame.mockRestore();
		}
	});

	test("anchors the wine-coloured ASCII art bottom-right, cropping it inside the output viewport", async () => {
		const { setup: mounted, app: shell } = await mount();
		const watermark =
			shell.transcript.parent?.findDescendantById("pawl-watermark");
		expect(watermark).toBeInstanceOf(TextRenderable);
		if (!(watermark instanceof TextRenderable))
			throw new Error("missing watermark");
		expect(watermark.selectable).toBe(false);
		expect(watermark.fg).toEqual(RGBA.fromHex("#722F37"));
		const artwork = PAWL_ASCII_LOGO.split("\n");
		for (const [width, height] of [
			[200, 60],
			[60, 18],
			[80, 24],
		] as const) {
			mounted.resize(width, height);
			await mounted.flush();
			const viewport = shell.transcript.viewport;
			expect(watermark.x + watermark.width).toBe(viewport.x + viewport.width);
			expect(watermark.y + watermark.height).toBe(viewport.y + viewport.height);
			const rows = frame().split("\n");
			for (let y = 0; y < rows.length; y++) {
				const row = rows[y] ?? "";
				if (y >= viewport.y && y < viewport.y + viewport.height) {
					expect(row.slice(viewport.x, viewport.x + viewport.width)).toBe(
						Array.from(
							{ length: viewport.width },
							(_, x) =>
								artwork[y - watermark.y]?.[viewport.x + x - watermark.x] ?? " ",
						).join(""),
					);
					expect(
						row.slice(0, viewport.x) + row.slice(viewport.x + viewport.width),
					).not.toMatch(/[:~]/);
				} else expect(row).not.toMatch(/[:~]/);
			}
		}
	});

	test("keeps the watermark stationary under scrolling text and masks it beneath grey user rows", async () => {
		const { setup: mounted, app: shell } = await mount();
		mounted.resize(120, 30);
		await mounted.flush();
		const viewport = shell.transcript.viewport;
		const artworkRow = (y: number) =>
			frame()
				.split("\n")
				[viewport.y + y]?.slice(viewport.x + 20, viewport.x + viewport.width)
				.trimEnd();
		const original = artworkRow(0);
		expect(original).toContain("::::");
		for (let i = 0; i < 50; i++) shell.append("assistant", `message ${i}`);
		await mounted.flush();
		expect(artworkRow(0)).toBe(original);
		const inputY = shell.input.y;
		shell.transcript.scrollTo(0);
		await mounted.flush();
		expect(frame()).toContain("message 0");
		expect(artworkRow(0)).toBe(original);
		expect(shell.input.y).toBe(inputY);
		shell.clearTranscript();
		shell.append("user", "scan AWS");
		await mounted.flush();
		expect(artworkRow(0)?.trim()).toBe("");
		shell.updateLast("assistant", "Ready");
		await mounted.flush();
		expect(artworkRow(0)).toBe(original);
		shell.clearTranscript();
		await mounted.flush();
		expect(artworkRow(0)).toBe(original);
	});

	test("pads the bordered panes by one cell at every width without introducing panel gaps", async () => {
		const { setup: mounted, app: shell } = await mount();
		const body = shell.root
			.getChildren()
			.find((child) => child.id === "pawl-body");
		const resources = body
			?.getChildren()
			.find((child) => child.id === "pawl-resources");
		const chat = body?.getChildren().find((child) => child.id === "pawl-chat");
		if (!resources || !chat) throw new Error("missing panes");
		shell.setResources([{ text: "AWS resources", kind: "resource" }]);
		const resource = resources.getChildren()[0];
		if (!resource) throw new Error("missing resource row");
		for (const [width, height, padding] of [
			[100, 30, 1],
			[200, 50, 1],
		] as const) {
			mounted.resize(width, height);
			await mounted.flush();
			expect(resources.x + resources.width).toBe(chat.x);
			expect(resource.x - resources.x).toBe(1 + padding);
			expect(resource.y - resources.y).toBe(1 + padding);
			expect(shell.transcript.x - chat.x).toBe(1 + padding);
			expect(shell.transcript.y - chat.y).toBe(1 + padding);
			expect(shell.input.width).toBe(chat.width - 2 - 2 * padding);
			expect(chat.y + chat.height - shell.input.y - 1).toBe(1 + padding);
			const paneTop = mounted.captureSpans().lines[resources.y];
			expect(paneTop?.spans.every((span) => span.bg.intent === "default")).toBe(
				true,
			);
		}
	});

	test("draws a full-width separator immediately above the fixed input", async () => {
		const { setup: mounted, app: shell } = await mount();
		for (const [width, height] of [
			[80, 24],
			[60, 14],
		] as const) {
			mounted.resize(width, height);
			await mounted.flush();
			const separator = frame().split("\n")[shell.input.y - 1];
			expect(
				separator?.slice(shell.input.x, shell.input.x + shell.input.width),
			).toBe("─".repeat(shell.input.width));
			expect(shell.transcript.y + shell.transcript.height).toBeLessThan(
				shell.input.y - 1,
			);
		}
	});

	test("scrolls only output and pauses auto-follow while reading earlier messages", async () => {
		const { setup: mounted, app: shell } = await mount();
		mounted.resize(80, 24);
		shell.focusInput();
		shell.input.value = "draft stays here";
		for (let i = 0; i < 50; i++) shell.append("assistant", `message ${i}`);
		await mounted.flush();
		expect(frame()).toContain("message 49");
		expect(frame()).not.toContain("message 0 ");
		// The scrollbar track must not paint an opaque strip either.
		expect(
			mounted
				.captureSpans()
				.lines.slice(1)
				.every((row) =>
					row.spans.every((span) => span.bg.intent === "default"),
				),
		).toBe(true);
		const bottom = shell.transcript.scrollTop;
		expect(bottom).toBeGreaterThan(0);
		const inputY = shell.input.y;
		const { viewport } = shell.transcript;
		await mounted.mockMouse.scroll(viewport.x + 1, viewport.y + 1, "up");
		await mounted.flush();
		const readingPosition = shell.transcript.scrollTop;
		expect(readingPosition).toBeLessThan(bottom);
		shell.append("assistant", "message 50");
		await mounted.flush();
		expect(shell.transcript.scrollTop).toBe(readingPosition);
		await mounted.mockMouse.scroll(shell.input.x + 1, inputY, "up");
		await mounted.flush();
		expect(shell.transcript.scrollTop).toBe(readingPosition);
		expect(shell.input.y).toBe(inputY);
		expect(shell.input.value).toBe("draft stays here");
		expect(frame()).toContain("draft stays here");
		// Reaching the bottom re-enables following new output.
		shell.transcript.scrollTo(shell.transcript.scrollHeight);
		shell.append("assistant", "message 51");
		await mounted.flush();
		expect(frame()).toContain("message 51");
	});

	test("updates streaming text within its row and resets the background on a role change", async () => {
		const { setup: mounted, app: shell } = await mount();
		const line = shell.append("user", "scan AWS");
		shell.updateLast("assistant", "Scanning AWS now");
		await mounted.flush();
		expect(shell.transcript.getChildren()).toHaveLength(1);
		expect(frame()).toContain("Scanning AWS now");
		expect(frame()).not.toContain("› scan AWS");
		const span = mounted
			.captureSpans()
			.lines[line.y]?.spans.find((span) => span.text.includes("Scanning AWS"));
		expect(span?.bg).toEqual(RGBA.defaultBackground());
	});

	test("keeps grey user rows while replies and the editor inherit the terminal background", async () => {
		const { setup: mounted, app: shell } = await mount();
		const user = shell.append("user", "scan AWS");
		const reply = shell.append("assistant", "Ready");
		await mounted.flush();
		const rows = mounted.captureSpans().lines;
		const userSpan = rows[user.y]?.spans.find((span) =>
			span.text.includes("scan AWS"),
		);
		expect(userSpan?.bg).toEqual(RGBA.fromHex("#262626"));
		expect(userSpan?.width).toBe(shell.transcript.viewport.width);
		expect(
			rows[reply.y]?.spans.find((span) => span.text.includes("Ready"))?.bg,
		).toEqual(RGBA.defaultBackground());
		expect(
			rows[shell.input.y]?.spans.find((span) => span.text.includes("Ask about"))
				?.bg,
		).toEqual(RGBA.defaultBackground());
	});
});

describe("the pre-flight inside the shell", () => {
	test("draws the options and accepts a numbered answer", async () => {
		const queue = createInputQueue();
		const { setup: mounted, app: mountedApp } = await mount({
			onSubmit: (text) => queue.submit(text),
		});
		const prompter = createTuiPrompter({
			app: mountedApp,
			input: queue,
		});

		const selection = prompter.select({
			id: "profile",
			message: "Select an AWS profile",
			options: [
				{ value: "dev", label: "dev" },
				{ value: "prod", label: "prod" },
			],
		});
		await mounted.renderOnce();

		// The prompt is a transcript line, so it survives in scrollback alongside
		// the rest of the session.
		expect(frame()).toContain("Select an AWS profile");
		expect(frame()).toContain("1) dev");
		expect(frame()).toContain("2) prod");

		mountedApp.input.value = "2";
		mountedApp.input.submit();

		expect(await selection).toBe("prod");
	});

	test("shows progress on the status line while AWS calls run", async () => {
		const queue = createInputQueue();
		const { setup: mounted, app: mountedApp } = await mount({
			onSubmit: (text) => queue.submit(text),
		});
		const prompter = createTuiPrompter({ app: mountedApp, input: queue });

		prompter.status("Checking credentials");
		await mounted.renderOnce();

		expect(frame()).toContain("Checking credentials");
	});
});

describe("submitting input", () => {
	test("keeps a full-width editor below a long transcript on resize", async () => {
		const { setup: mounted, app: shell } = await mount();
		const chat = shell.input.parent?.parent;
		expect(chat?.id).toBe("pawl-chat");
		if (!chat) throw new Error("input has no chat parent");
		for (let index = 0; index < 50; index++) {
			shell.append("assistant", `Resource ${index}: ${"details ".repeat(20)}`);
		}
		shell.focusInput();
		for (const [width, height] of [
			[80, 24],
			[60, 14],
		] as const) {
			mounted.resize(width, height);
			await mounted.flush();
			expect(shell.input.width).toBe(shell.transcript.width);
			expect(shell.input.x).toBe(shell.transcript.x);
			expect(shell.input.x + shell.input.width).toBeLessThan(
				chat.x + chat.width,
			);
			expect(shell.input.height).toBe(1);
			expect(shell.input.y).toBeLessThanOrEqual(chat.y + chat.height - 2);
			expect(shell.input.y).toBeLessThan(height - 1);
			expect(frame()).toContain("Ask about your AWS setup");
		}
	});

	test("supports keyboard editing, paste and Enter through the focused editor", async () => {
		const submitted: string[] = [];
		const { setup: mounted, app: shell } = await mount({
			onSubmit: (text) => submitted.push(text),
		});
		shell.focusInput();
		await mounted.mockInput.typeText("scna");
		mounted.mockInput.pressBackspace();
		mounted.mockInput.pressBackspace();
		await mounted.mockInput.typeText("an");
		mounted.mockInput.pasteBracketedText(" my AWS account");
		await mounted.renderOnce();
		expect(shell.input.value).toBe("scan my AWS account");
		mounted.mockInput.pressEnter();
		expect(submitted).toEqual(["scan my AWS account"]);
		expect(shell.input.value).toBe("");
	});
	test("hands the trimmed text to the submit handler and empties the input", async () => {
		const submitted: string[] = [];
		const { app: mounted } = await mount({
			onSubmit: (text) => submitted.push(text),
		});

		mounted.input.value = "  plan my infra  ";
		mounted.input.submit();
		await setup?.renderOnce();

		expect(submitted).toEqual(["plan my infra"]);
		expect(mounted.input.value).toBe("");
	});

	test("ignores an empty submission so a stray Enter is not a turn", async () => {
		const submitted: string[] = [];
		const { app: mounted } = await mount({
			onSubmit: (text) => submitted.push(text),
		});

		mounted.input.value = "   ";
		mounted.input.submit();
		await setup?.renderOnce();

		expect(submitted).toEqual([]);
	});
});
