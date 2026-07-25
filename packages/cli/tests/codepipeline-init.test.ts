import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCodePipelineInit } from "../src/codepipeline-init";

describe("runCodePipelineInit — non-TTY", () => {
	test("generates a pipeline project with all required flags", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-cp-"));
		try {
			const result = await runCodePipelineInit({
				argv: [
					"--source", "codecommit",
					"--source-name", "my-repo",
					"--no-autoreviewer",
					"--team", "platform",
					"--no-install",
					"--no-deploy",
				],
				cwd: dir,
				isTTY: false,
			});
			expect(result.repositoryName).toBe("my-repo");
			expect(result.autoReviewer).toBe(false);
			expect(statSync(path.join(dir, "my-repo-pipeline", "package.json")).isFile()).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("with --on-pr and --autoreviewer flags", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-cp-pr-"));
		try {
			const result = await runCodePipelineInit({
				argv: [
					"--source", "codecommit",
					"--source-name", "my-repo",
					"--on-pr",
					"--autoreviewer",
					"--model", "eu.anthropic.claude-sonnet-4-6",
					"--team", "platform",
					"--no-install",
					"--no-deploy",
				],
				cwd: dir,
				isTTY: false,
			});
			expect(result.onPullRequest).toBe(true);
			expect(result.autoReviewer).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("fails without required flags in non-TTY", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-cp-fail-"));
		try {
			try {
				await runCodePipelineInit({
					argv: ["--source", "codecommit"],
					cwd: dir,
					isTTY: false,
				});
				expect(false).toBe(true);
			} catch (e) {
				expect(e).toBeInstanceOf(Error);
			}
			expect(() => statSync(path.join(dir, "pipeline"))).toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
