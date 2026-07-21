import { describe, expect, test } from "bun:test";
import { runPawlInit } from "../src/scaffold";
import { parseInitArgs } from "../src/scaffold/cli";

describe("parseInitArgs", () => {
	test("parses init flags", () => {
		const parsed = parseInitArgs([
			"init",
			"--name",
			"foo",
			"--package-manager",
			"pnpm",
			"--aws-profile",
			"dev",
			"--test-mode",
			"localstack",
			"--team",
			"my-team",
			"--stage",
			"qa",
			"--tag",
			"env=staging",
			"--tag",
			"owner=platform",
			"--localstack-secret-path",
			"/localstack/token",
		]);

		expect(parsed).toEqual({
			projectName: "foo",
			packageManager: "pnpm",
			awsProfile: "dev",
			testMode: "localstack",
			team: "my-team",
			stage: "qa",
			tags: { env: "staging", owner: "platform" },
			localstackSecretPath: "/localstack/token",
		});
	});
});

describe("runPawlInit overrides", () => {
	test("skips prompts when overrides are provided", async () => {
		const calls: string[] = [];
		const cfg = await runPawlInit({
			cwd: "/tmp",
			overrides: {
				projectName: "foo",
				packageManager: "bun",
				awsProfile: "dev",
				testMode: "none",
				team: "my-team",
				stage: "qa",
				tags: { env: "staging" },
				localstackSecretPath: "/localstack/token",
			},
			deps: {
				assertEmptyTargetDir: async () => undefined,
				listProfiles: async () => {
					calls.push("listProfiles");
					return ["dev"];
				},
				promptProjectName: async () => {
					calls.push("projectName");
					return "should-not-be-used";
				},
				promptPackageManager: async () => {
					calls.push("packageManager");
					return "npm";
				},
				promptAwsProfile: async () => {
					calls.push("awsProfile");
					return "should-not-be-used";
				},
				promptTestMode: async () => {
					calls.push("testMode");
					return "localstack";
				},
				promptTeam: async () => {
					calls.push("team");
					return "should-not-be-used";
				},
				promptStage: async () => {
					calls.push("stage");
					return "dev";
				},
				promptExtraTags: async () => {
					calls.push("extraTags");
					return { other: "value" };
				},
				promptInstallNow: async () => {
					calls.push("installNow");
					return true;
				},
			},
		});

		expect(cfg).toMatchObject({
			projectName: "foo",
			packageManager: "bun",
			awsProfile: "dev",
			testMode: "none",
			team: "my-team",
			stage: "qa",
			tags: { env: "staging" },
			localstackSecretPath: "/localstack/token",
			installNow: true,
		});
		expect(calls).toEqual(["installNow"]);
	});
});
