import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { RGBA } from "@opentui/core";
import {
	DESIGN_TOKEN_NAMES,
	PAWL_COLORS,
	PAWL_TAGLINE,
	PAWL_WORDMARK,
	THEME,
} from "../src/tui/theme";

const DESIGN_MD = join(import.meta.dir, "../../../docs/DESIGN.md");

/** Pull the `colors:` block out of the design system's YAML frontmatter. */
function designColors(frontmatter: string): Record<string, string> {
	const block = frontmatter.split(/^colors:$/m)[1];
	if (!block) throw new Error("docs/DESIGN.md has no colors block");
	const colours: Record<string, string> = {};
	for (const line of block.split("\n")) {
		const match = /^\s{2}([a-z-]+):\s*"(#[0-9a-fA-F]{6})"\s*$/.exec(line);
		if (!match) continue;
		const [, name, value] = match;
		if (name && value) colours[name] = value.toLowerCase();
	}
	return colours;
}

describe("brand tokens", () => {
	test("every token matches docs/DESIGN.md", async () => {
		const frontmatter =
			(await Bun.file(DESIGN_MD).text()).split("---")[1] ?? "";
		const canonical = designColors(frontmatter);

		expect(Object.keys(canonical).length).toBeGreaterThan(0);
		for (const [name, tokenName] of Object.entries(DESIGN_TOKEN_NAMES)) {
			const expected = canonical[tokenName];
			if (expected === undefined) {
				throw new Error(`docs/DESIGN.md defines no "${tokenName}"`);
			}
			// A mismatch means the docs palette moved and the TUI did not.
			expect(PAWL_COLORS[name as keyof typeof PAWL_COLORS].toLowerCase()).toBe(
				expected,
			);
		}
	});

	test("does not invent tokens the design system lacks", async () => {
		const frontmatter =
			(await Bun.file(DESIGN_MD).text()).split("---")[1] ?? "";
		const canonical = designColors(frontmatter);

		for (const tokenName of Object.values(DESIGN_TOKEN_NAMES)) {
			expect(canonical[tokenName]).toBeDefined();
		}
	});

	test("semantic colours are hex literals or terminal-default colours", () => {
		for (const value of Object.values(THEME)) {
			if (typeof value === "string")
				expect(/^#[0-9a-f]{6}$/.test(value)).toBe(true);
			else expect(value.intent).toBe("default");
		}
	});

	test("uses the requested blue for panel borders and titles", () => {
		expect(THEME.box).toBe("#8dbee1");
	});

	test("inherits the terminal background while retaining white text and grey user rows", () => {
		expect(THEME.background).toEqual(RGBA.defaultBackground());
		expect(THEME.panel).toEqual(RGBA.defaultBackground());
		expect(THEME.code).toEqual(RGBA.defaultBackground());
		expect(THEME.userMessage).toBe("#262626");
		expect(THEME.body).toBe("#ffffff");
	});

	test("carries the product name and tagline from PRODUCT.md", () => {
		expect(PAWL_WORDMARK).toBe("pawl");
		expect(PAWL_TAGLINE).toBe("Proficient AWS Library");
	});
});
