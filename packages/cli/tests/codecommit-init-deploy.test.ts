import { describe, expect, test } from "bun:test";
import {
	installCodeCommitProject,
	deployCodeCommitProject,
	formatDeployRetryCommand,
	type CodeCommitDeployDeps,
} from "../src/codecommit-init/deploy";

function makeThrowingDeps(): CodeCommitDeployDeps {
	return {
		exec: async () => { throw new Error("should not exec"); },
		checkCredentials: async () => { throw new Error("should not check"); },
		checkBedrockAccess: async () => { throw new Error("should not check bedrock"); },
		getProfileRegion: async () => undefined,
	};
}

describe("installCodeCommitProject", () => {
	test("runs bun install in the project directory", async () => {
		const calls: Array<{ cmd: string; args: string[]; cwd: string; env: Record<string, string> }> = [];
		await installCodeCommitProject("/tmp/my-project", {
			exec: async (cmd, args, cwd, env) => {
				calls.push({ cmd, args, cwd, env });
			},
		});
		expect(calls).toEqual([
			{ cmd: "bun", args: ["install"], cwd: "/tmp/my-project", env: {} },
		]);
	});
});

describe("deployCodeCommitProject", () => {
	test("validates credentials, checks Bedrock for auto-review, and deploys with outputs file", async () => {
		const calls: string[] = [];
		const execCalls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
		const deps: Partial<CodeCommitDeployDeps> = {
			exec: async (cmd, args, cwd) => {
				execCalls.push({ cmd, args, cwd });
				// Simulate CDK writing outputs
				const outputsFile = args[args.indexOf("--outputs-file") + 1];
				const outputs = { "TestStack": { RepositoryName: "my-repo", BranchName: "main", RepositoryCloneUrlGrc: "codecommit::grc://eu-central-1://my-repo" } };
				Bun.write(outputsFile, JSON.stringify(outputs));
			},
			checkCredentials: async () => { calls.push("credentials"); },
			checkBedrockAccess: async () => { calls.push("bedrock"); return true; },
		};

		const outputs = await deployCodeCommitProject(
			"/tmp/my-project",
			"my-profile",
			"eu-central-1",
			{ autoReviewer: true, deps },
		);
		expect(calls).toEqual(["credentials", "bedrock"]);
		expect(execCalls).toHaveLength(1);
		expect(execCalls[0]!.cmd).toBe("bunx");
		expect(execCalls[0]!.args).toContain("--require-approval");
		expect(execCalls[0]!.args).toContain("never");
		expect(outputs.RepositoryName).toBe("my-repo");
		expect(outputs.RepositoryCloneUrlGrc).toContain("codecommit::grc");
	});

	test("skips Bedrock check when auto-review is disabled", async () => {
		const calls: string[] = [];
		const deps: Partial<CodeCommitDeployDeps> = {
			exec: async (cmd, args) => {
				const outputsFile = args[args.indexOf("--outputs-file") + 1];
				Bun.write(outputsFile, JSON.stringify({ S: { RepositoryName: "repo" } }));
			},
			checkCredentials: async () => { calls.push("credentials"); },
			checkBedrockAccess: async () => { calls.push("bedrock"); return true; },
		};

		await deployCodeCommitProject("/tmp/my-project", "p", "r", { deps });
		expect(calls).toEqual(["credentials"]);
	});

	test("throws when Bedrock access is unavailable for auto-review", async () => {
		const deps: Partial<CodeCommitDeployDeps> = {
			exec: async () => {},
			checkCredentials: async () => {},
			checkBedrockAccess: async () => false,
		};

		try {
			await deployCodeCommitProject("/tmp/my-project", "p", "r", {
				autoReviewer: true,
				deps,
			});
			expect(false).toBe(true);
		} catch (e: unknown) {
			expect(e).toBeInstanceOf(Error);
			expect((e as Error).message).toContain("Bedrock");
		}
	});

	test("passes AWS_PROFILE, AWS_REGION, and AWS_DEFAULT_REGION in environment", async () => {
		let receivedEnv: Record<string, string> | undefined;
		const deps: Partial<CodeCommitDeployDeps> = {
			exec: async (cmd, args, cwd, env) => {
				receivedEnv = env;
				const outputsFile = args[args.indexOf("--outputs-file") + 1];
				Bun.write(outputsFile, JSON.stringify({ S: {} }));
			},
			checkCredentials: async () => {},
		};

		await deployCodeCommitProject("/tmp/my-project", "my-profile", "eu-central-1", { deps });
		expect(receivedEnv?.AWS_PROFILE).toBe("my-profile");
		expect(receivedEnv?.AWS_REGION).toBe("eu-central-1");
		expect(receivedEnv?.AWS_DEFAULT_REGION).toBe("eu-central-1");
	});
});

describe("formatDeployRetryCommand", () => {
	test("includes profile and region in the retry command", () => {
		const cmd = formatDeployRetryCommand("my-profile", "eu-central-1");
		expect(cmd).toContain("AWS_PROFILE=my-profile");
		expect(cmd).toContain("AWS_REGION=eu-central-1");
		expect(cmd).toContain("cdk deploy --all");
	});
});
