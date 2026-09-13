import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { projectDir } from "../src/project-dir";

describe("projectDir", () => {
	test("prefers PAWL_PROJECT_DIR", () => {
		expect(projectDir({ PAWL_PROJECT_DIR: "/work/app" })).toBe("/work/app");
	});

	test("falls back to the process working directory", () => {
		expect(projectDir({})).toBe(process.cwd());
	});

	test("ignores a blank PAWL_PROJECT_DIR", () => {
		expect(projectDir({ PAWL_PROJECT_DIR: "   " })).toBe(process.cwd());
	});

	test("the tools resolve the project through this seam", async () => {
		const toolSource = await Bun.file(
			join(import.meta.dir, "../agent/tools/architecture.ts"),
		).text();
		expect(toolSource).toContain("projectDir()");
	});
});
