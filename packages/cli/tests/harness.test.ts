import { describe, expect, test } from "bun:test";
import { PawlHarness } from "../src/harness";

describe("PawlHarness", () => {
	test("scanCodebase returns structured markdown", async () => {
		const harness = new PawlHarness({
			cwd: process.cwd(),
			exec: async (cmd, args) => {
				if (cmd === "find" && args.includes("-maxdepth")) {
					return { stdout: "/pawl/package.json\n/pawl/index.ts" };
				}
				if (cmd === "cat") {
					return { stdout: '{"name":"test","version":"1.0.0"}' };
				}
				return { stdout: "" };
			},
		});
		const result = await harness.scanCodebase();
		expect(result).toContain("## Project Structure");
		expect(result).toContain("## package.json");
	});

	test("commands.plan constructs planning prompt with codebase scan", async () => {
		const harness = new PawlHarness({
			cwd: process.cwd(),
			exec: async () => ({ stdout: "" }),
		});
		const prompt = await harness.commands.plan("Use RDS");
		expect(prompt).toContain("Use RDS");
		expect(prompt).toContain("## Project Structure");
		expect(prompt).toContain("The codebase scan is already provided below");
		expect(prompt).toContain("Architecture diagram");
		expect(prompt).toContain("Mermaid");
	});

	test("commands.generate returns generation prompt", async () => {
		const harness = new PawlHarness({
			exec: async () => ({ stdout: "" }),
		});
		const prompt = await harness.commands.generate();
		expect(prompt).toContain(".pawl/plan.md");
		expect(prompt).toContain("@pawl/cdk");
	});

	test("commands.wellArchitected loads prompt file", async () => {
		const harness = new PawlHarness({
			promptsDir: new URL("../prompts", import.meta.url).pathname,
			exec: async (cmd, args) => {
				if (cmd === "cat" && args[0]?.includes("well-architected")) {
					return { stdout: "---\ndescription: test\n---\nReview this." };
				}
				return { stdout: "" };
			},
		});
		const prompt = await harness.commands.wellArchitected();
		expect(prompt).toContain("Review this.");
		// Frontmatter should be stripped
		expect(prompt).not.toContain("---");
	});

	test("commands.cost loads prompt file", async () => {
		const harness = new PawlHarness({
			promptsDir: new URL("../prompts", import.meta.url).pathname,
			exec: async (cmd, args) => {
				if (cmd === "cat" && args[0]?.includes("cost")) {
					return { stdout: "---\ndescription: cost\n---\nOptimize costs." };
				}
				return { stdout: "" };
			},
		});
		const prompt = await harness.commands.cost();
		expect(prompt).toContain("Optimize costs.");
	});

	test("loadPrompt strips YAML frontmatter", async () => {
		const harness = new PawlHarness({
			promptsDir: new URL("../prompts", import.meta.url).pathname,
			exec: async (cmd, _args) => {
				if (cmd === "cat") {
					return {
						stdout: "---\nname: test\ndescription: a test\n---\nHello world",
					};
				}
				return { stdout: "" };
			},
		});
		const result = await harness.loadPrompt("test");
		expect(result).toBe("Hello world");
	});

	test("throws when exec is not provided and no default is available", async () => {
		const harness = new PawlHarness();
		await expect(harness.loadPrompt("nonexistent")).rejects.toThrow(
			"PawlHarness: no exec function provided",
		);
	});
});
