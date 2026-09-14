import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createPawlApp, type PawlApp } from "../src/tui/app";
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
	setup = await createTestRenderer({ width: 60, height: 14 });
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

describe("submitting input", () => {
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
