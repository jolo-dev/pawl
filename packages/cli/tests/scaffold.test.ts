import { describe, expect, test } from "bun:test";
import {
	type ScaffoldConfigInput,
	validateScaffoldConfig,
} from "../src/scaffold/types";

describe("validateScaffoldConfig", () => {
	test("rejects missing project name", () => {
		expect(() =>
			validateScaffoldConfig({
				projectName: "",
				packageManager: "bun",
				awsProfile: "dev",
				testMode: "none",
				team: "my-team",
				stage: "dev",
			} satisfies ScaffoldConfigInput),
		).toThrow(/project name/i);
	});

	test("accepts bun as package manager", () => {
		const cfg = validateScaffoldConfig({
			projectName: "my-app",
			packageManager: "bun",
			awsProfile: "dev",
			testMode: "none",
			team: "my-team",
			stage: "dev",
		});
		expect(cfg.packageManager).toBe("bun");
		expect(cfg.testMode).toBe("none");
		expect(cfg.team).toBe("my-team");
		expect(cfg.stage).toBe("dev");
	});

	test("rejects unsupported test mode", () => {
		expect(() =>
			validateScaffoldConfig({
				projectName: "my-app",
				packageManager: "bun",
				awsProfile: "dev",
				testMode: "ministack",
				team: "my-team",
				stage: "dev",
			} as ScaffoldConfigInput),
		).toThrow(/test mode/i);
	});

	test("rejects empty team name", () => {
		expect(() =>
			validateScaffoldConfig({
				projectName: "my-app",
				packageManager: "bun",
				awsProfile: "dev",
				testMode: "none",
				team: "",
				stage: "dev",
			} satisfies ScaffoldConfigInput),
		).toThrow(/team/i);
	});

	test("rejects unsupported stage", () => {
		expect(() =>
			validateScaffoldConfig({
				projectName: "my-app",
				packageManager: "bun",
				awsProfile: "dev",
				testMode: "none",
				team: "my-team",
				stage: "staging",
			} as ScaffoldConfigInput),
		).toThrow(/stage/i);
	});

	test("requires localstack secret path when test mode is localstack", () => {
		expect(() =>
			validateScaffoldConfig({
				projectName: "my-app",
				packageManager: "bun",
				awsProfile: "dev",
				testMode: "localstack",
				team: "my-team",
				stage: "dev",
			} satisfies ScaffoldConfigInput),
		).toThrow(/localstack.*secret.*path/i);
	});

	test("accepts localstack secret path with localstack mode", () => {
		const cfg = validateScaffoldConfig({
			projectName: "my-app",
			packageManager: "bun",
			awsProfile: "dev",
			testMode: "localstack",
			team: "my-team",
			stage: "dev",
			localstackSecretPath: "/localstack/token",
		} satisfies ScaffoldConfigInput);
		expect(cfg.localstackSecretPath).toBe("/localstack/token");
	});
});
