import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeScaffoldProject } from "../src/scaffold";

describe("writeScaffoldProject", () => {
	test("writes rendered files for localstack mode", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-write-localstack-"));
		await writeScaffoldProject({
			cwd: dir,
			projectName: "my-app",
			packageManager: "bun",
			awsProfile: "dev",
			testMode: "localstack",
		});

		expect(readFileSync(path.join(dir, "package.json"), "utf8")).toContain(
			'"name": "my-app"',
		);
		expect(readFileSync(path.join(dir, "cdk.json"), "utf8")).toContain(
			'"awsProfile": "dev"',
		);
		expect(readFileSync(path.join(dir, "local.dev.ts"), "utf8")).toContain(
			"defineStacks",
		);
		expect(
			readFileSync(path.join(dir, "tests", "localstack.setup.ts"), "utf8"),
		).toContain("createLocalstackSetup");
	});

	test("omits LocalStack-only files in none mode", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-write-none-"));
		await writeScaffoldProject({
			cwd: dir,
			projectName: "my-app",
			packageManager: "pnpm",
			awsProfile: "dev",
			testMode: "none",
		});

		expect(() =>
			readFileSync(path.join(dir, "local.dev.ts"), "utf8"),
		).toThrow();
		expect(() =>
			readFileSync(path.join(dir, "tests", "localstack.setup.ts"), "utf8"),
		).toThrow();
		expect(readFileSync(path.join(dir, "README.md"), "utf8")).toContain(
			"my-app",
		);
	});
});
