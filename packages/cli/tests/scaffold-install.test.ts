import { describe, expect, test } from "bun:test";
import { installScaffoldDependencies } from "../src/scaffold";

describe("installScaffoldDependencies", () => {
	test("runs bun install for bun projects", async () => {
		const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];

		await installScaffoldDependencies(
			{
				cwd: "/tmp",
				projectDir: "/tmp/my-app",
				packageManager: "bun",
				projectName: "my-app",
				awsProfile: "dev",
				testMode: "none",
			},
			{
				exec: async (cmd, args, cwd) => {
					calls.push({ cmd, args, cwd });
				},
			},
		);

		expect(calls).toEqual([
			{ cmd: "bun", args: ["install"], cwd: "/tmp/my-app" },
		]);
	});
});
