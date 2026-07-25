import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCodeCommitInit } from "../src/codecommit-init";
import type { CodeCommitInitPromptDeps } from "../src/codecommit-init/prompts";

function makeThrowingPrompts(): CodeCommitInitPromptDeps {
	const throwFn = async (): Promise<never> => {
		throw new Error("Prompt should not be called in non-TTY mode");
	};
	return {
		promptRepositoryName: throwFn,
		promptSyncExisting: throwFn as never,
		promptSyncPath: throwFn,
		promptDirectory: throwFn as never,
		promptBranch: throwFn,
		promptTeam: throwFn,
		promptStage: throwFn as never,
		promptAutoReviewer: throwFn as never,
		promptModelId: throwFn,
		promptConfirm: throwFn as never,
		promptInstall: throwFn as never,
		promptDeploy: throwFn as never,
		promptAwsProfile: throwFn as never,
		promptRegion: throwFn,
		listProfiles: throwFn,
		getProfileRegion: throwFn,
	};
}

const fullNonTTYArgs = [
	"--name", "my-repo",
	"--no-sync",
	"--no-autoreviewer",
	"--team", "platform",
	"--no-install",
	"--no-deploy",
];

describe("runCodeCommitInit — non-TTY", () => {
	test("fully flagged non-TTY never prompts and generates the project", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-orch-"));
		try {
			const result = await runCodeCommitInit({
				argv: fullNonTTYArgs,
				cwd: dir,
				isTTY: false,
				deps: {
					prompts: makeThrowingPrompts(),
					install: async () => { throw new Error("should not install"); },
					deploy: async () => { throw new Error("should not deploy"); },
				},
			});
			expect(result.repositoryName).toBe("my-repo");
			expect(result.install).toBe(false);
			expect(result.deploy).toBe(false);
			expect(statSync(path.join(dir, "my-repo", "package.json")).isFile()).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("incomplete non-TTY fails before filesystem writes", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-orch-fail-"));
		try {
			try {
				await runCodeCommitInit({
					argv: ["--name", "my-repo", "--no-sync", "--no-autoreviewer"],
					cwd: dir,
					isTTY: false,
					deps: { prompts: makeThrowingPrompts() },
				});
				expect(false).toBe(true); // should have thrown
			} catch (e: unknown) {
				expect(e).toBeInstanceOf(Error);
			}

			// No project directory created
			expect(() => statSync(path.join(dir, "my-repo"))).toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("sync mode generates infra child and runs preflight", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-orch-sync-"));
		try {
			// Create a source file in the sync root
			writeFileSync(path.join(dir, "README.md"), "# Existing project\n");
			writeFileSync(path.join(dir, ".gitignore"), "infra/\n");

			const result = await runCodeCommitInit({
				argv: [
					"--name", "my-repo",
					"--sync", ".",
					"--no-autoreviewer",
					"--team", "platform",
					"--no-install",
					"--no-deploy",
				],
				cwd: dir,
				isTTY: false,
				deps: { prompts: makeThrowingPrompts() },
			});
			expect(result.repositoryName).toBe("my-repo");
			expect(result.preflight).toBeDefined();
			expect(result.preflight!.fileCount).toBeGreaterThan(0);
			// Pre-existing files unchanged
			expect(statSync(path.join(dir, "README.md")).isFile()).toBe(true);
			// Generated infra exists
			expect(statSync(path.join(dir, "infra", "package.json")).isFile()).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("runCodeCommitInit — TTY", () => {
	test("prompts in order, validates core, confirms, then generates", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-orch-tty-"));
		try {
			const order: string[] = [];
			const prompts: CodeCommitInitPromptDeps = {
				promptRepositoryName: async () => { order.push("repo"); return "tty-repo"; },
				promptSyncExisting: async () => { order.push("syncExisting"); return false; },
				promptSyncPath: async () => { order.push("syncPath"); return "."; },
				promptDirectory: async () => { order.push("directory"); return undefined; },
				promptBranch: async () => { order.push("branch"); return "main"; },
				promptTeam: async () => { order.push("team"); return "platform"; },
				promptStage: async () => { order.push("stage"); return "dev" as const; },
				promptAutoReviewer: async () => { order.push("auto"); return false; },
				promptModelId: async () => { order.push("model"); return ""; },
				promptConfirm: async () => { order.push("confirm"); return true; },
				promptInstall: async () => { order.push("install"); return false; },
				promptDeploy: async () => { order.push("deploy"); return false; },
				promptAwsProfile: async () => { order.push("profile"); return "dev"; },
				promptRegion: async () => { order.push("region"); return "eu-central-1"; },
				listProfiles: async () => ["dev"],
				getProfileRegion: async () => "eu-central-1",
			};
			const result = await runCodeCommitInit({
				argv: [],
				cwd: dir,
				isTTY: true,
				deps: {
					prompts,
					install: async () => { throw new Error("should not install"); },
					deploy: async () => { throw new Error("should not deploy"); },
				},
			});
			// Core prompts happen before confirm
			expect(order.indexOf("repo")).toBeLessThan(order.indexOf("confirm"));
			expect(order.indexOf("confirm")).toBeLessThan(order.indexOf("install"));
			expect(result.repositoryName).toBe("tty-repo");
			expect(result.install).toBe(false);
			expect(statSync(path.join(dir, "tty-repo", "package.json")).isFile()).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
