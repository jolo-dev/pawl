import { describe, expect, test } from "bun:test";
import {
	buildEveEnv,
	defaultAppRoot,
	eveDevCommand,
	resolveEveBin,
	resolveEveRuntime,
} from "../src/launch";

describe("launch", () => {
	test("buildEveEnv carries the resolved AWS settings and project dir", () => {
		const env = buildEveEnv({
			profile: "prod",
			region: "eu-central-1",
			modelId: "eu.anthropic.claude-sonnet-4-6",
			projectDir: "/work/app",
			base: { PATH: "/bin" },
		});
		expect(env.AWS_PROFILE).toBe("prod");
		expect(env.AWS_REGION).toBe("eu-central-1");
		expect(env.PAWL_BEDROCK_MODEL).toBe("eu.anthropic.claude-sonnet-4-6");
		expect(env.PAWL_PROJECT_DIR).toBe("/work/app");
		expect(env.PATH).toBe("/bin");
	});

	test("launches eve with Node, because its server cannot run under Bun", () => {
		const { command, args } = eveDevCommand();

		// Verified live: under Bun, eve binds and answers on some routes and then
		// fails its worker init with "[crossws] Using Node.js adapter in an
		// incompatible environment", so a health check can pass against a runtime
		// that cannot serve a turn.
		if (process.versions.bun) {
			expect(command).not.toBe(process.execPath);
			expect(command.endsWith("node")).toBe(true);
		} else {
			expect(command).toBe(process.execPath);
		}
		expect(args[0]).toBe(resolveEveBin());
		expect(args.slice(1)).toEqual(["dev"]);
	});

	test("resolveEveRuntime keeps the current runtime when it already is Node", () => {
		const runtime = resolveEveRuntime();

		expect(runtime.length).toBeGreaterThan(0);
		if (!process.versions.bun) expect(runtime).toBe(process.execPath);
	});

	test("resolveEveBin points at an existing file", async () => {
		expect(await Bun.file(resolveEveBin()).exists()).toBe(true);
	});

	test("the app root owns the agent directory", async () => {
		const agentDir = `${defaultAppRoot()}/agent`;
		expect(await Bun.file(`${agentDir}/agent.ts`).exists()).toBe(true);
	});
});
