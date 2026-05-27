import { describe, expect, test } from "bun:test";
import {
	validateScaffoldConfig,
	type ScaffoldConfigInput,
} from "../src/scaffold/types";

describe("validateScaffoldConfig", () => {
	test("rejects missing project name", () => {
		expect(() =>
			validateScaffoldConfig({
				projectName: "",
				packageManager: "bun",
				awsProfile: "dev",
				testMode: "none",
			} satisfies ScaffoldConfigInput),
		).toThrow(/project name/i);
	});

	test("accepts bun as package manager", () => {
		const cfg = validateScaffoldConfig({
			projectName: "my-app",
			packageManager: "bun",
			awsProfile: "dev",
			testMode: "none",
		});
		expect(cfg.packageManager).toBe("bun");
		expect(cfg.testMode).toBe("none");
	});

	test("rejects unsupported test mode", () => {
		expect(() =>
			validateScaffoldConfig({
				projectName: "my-app",
				packageManager: "bun",
				awsProfile: "dev",
				testMode: "ministack",
			} as ScaffoldConfigInput),
		).toThrow(/test mode/i);
	});
});
