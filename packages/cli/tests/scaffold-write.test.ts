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
			projectDir: path.join(dir, "my-app"),
			projectName: "my-app",
			packageManager: "bun",
			awsProfile: "dev",
			testMode: "localstack",
			team: "my-team",
			stage: "dev",
			tags: {},
			localstackSecretPath: "/localstack/token",
		});

		const projectDir = path.join(dir, "my-app");
		const packageJson = readFileSync(
			path.join(projectDir, "package.json"),
			"utf8",
		);
		expect(packageJson).toContain('"name": "my-app"');
		expect(packageJson).not.toContain('"tsx": "^4.19.2"');
		expect(readFileSync(path.join(projectDir, "cdk.json"), "utf8")).toContain(
			'"awsProfile": "dev"',
		);
		expect(
			readFileSync(path.join(projectDir, "local.dev.ts"), "utf8"),
		).toContain("defineStacks");
		expect(
			readFileSync(
				path.join(projectDir, "tests", "localstack.setup.ts"),
				"utf8",
			),
		).toContain("createLocalstackSetup");
	});

	test("keeps tsx for pnpm package.json", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-write-pnpm-"));
		await writeScaffoldProject({
			cwd: dir,
			projectDir: path.join(dir, "my-app"),
			projectName: "my-app",
			packageManager: "pnpm",
			awsProfile: "dev",
			testMode: "none",
			team: "my-team",
			stage: "dev",
			tags: {},
		});

		const packageJson = readFileSync(
			path.join(dir, "my-app", "package.json"),
			"utf8",
		);
		expect(packageJson).toContain('"tsx": "^4.19.2"');
	});

	test("omits LocalStack-only files in none mode", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-write-none-"));
		await writeScaffoldProject({
			cwd: dir,
			projectDir: path.join(dir, "my-app"),
			projectName: "my-app",
			packageManager: "pnpm",
			awsProfile: "dev",
			testMode: "none",
			team: "my-team",
			stage: "dev",
			tags: {},
		});

		const projectDir = path.join(dir, "my-app");
		expect(() =>
			readFileSync(path.join(projectDir, "local.dev.ts"), "utf8"),
		).toThrow();
		expect(() =>
			readFileSync(
				path.join(projectDir, "tests", "localstack.setup.ts"),
				"utf8",
			),
		).toThrow();
		expect(readFileSync(path.join(projectDir, "README.md"), "utf8")).toContain(
			"my-app",
		);
	});
});
