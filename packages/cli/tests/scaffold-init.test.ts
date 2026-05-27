import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runPawlInit } from "../src/scaffold";

describe("runPawlInit", () => {
	test("returns a validated scaffold config from prompt answers", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-init-run-"));
		const calls: string[] = [];
		const cfg = await runPawlInit({
			cwd: dir,
			deps: {
				listProfiles: async () => ["dev", "prod"],
				promptProjectName: async () => {
					calls.push("projectName");
					return "my-app";
				},
				promptPackageManager: async () => {
					calls.push("packageManager");
					return "bun";
				},
				promptAwsProfile: async (profiles) => {
					calls.push(`awsProfile:${profiles.join(",")}`);
					return "dev";
				},
				promptTestMode: async () => {
					calls.push("testMode");
					return "localstack";
				},
			},
		});

		expect(cfg).toMatchObject({
			projectName: "my-app",
			packageManager: "bun",
			awsProfile: "dev",
			testMode: "localstack",
			projectDir: path.join(dir, "my-app"),
		});
		expect(calls).toEqual([
			"projectName",
			"packageManager",
			"awsProfile:dev,prod",
			"testMode",
		]);
	});

	test("refuses to run when target project directory is not empty", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-init-blocked-"));
		const projectDir = path.join(dir, "my-app");
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(path.join(projectDir, "README.md"), "existing file");

		const promptCalls: string[] = [];
		await expect(
			runPawlInit({
				cwd: dir,
				overrides: {
					projectName: "my-app",
				},
				deps: {
					listProfiles: async () => ["dev"],
					promptProjectName: async () => {
						promptCalls.push("projectName");
						return "should-not-run";
					},
					promptPackageManager: async () => {
						promptCalls.push("packageManager");
						return "bun";
					},
					promptAwsProfile: async () => {
						promptCalls.push("awsProfile");
						return "dev";
					},
					promptTestMode: async () => {
						promptCalls.push("testMode");
						return "none";
					},
				},
			}),
		).rejects.toThrow(/not empty/i);

		expect(promptCalls).toEqual([]);
	});
});
