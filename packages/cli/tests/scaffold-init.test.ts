import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
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
		});
		expect(calls).toEqual([
			"projectName",
			"packageManager",
			"awsProfile:dev,prod",
			"testMode",
		]);
	});

	test("refuses to run when target directory is not empty", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-init-blocked-"));
		writeFileSync(path.join(dir, "README.md"), "existing file");

		const promptCalls: string[] = [];
		await expect(
			runPawlInit({
				cwd: dir,
				deps: {
					listProfiles: async () => ["dev"],
					promptProjectName: async () => {
						promptCalls.push("projectName");
						return "my-app";
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
