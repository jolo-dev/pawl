import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCodePipelineInit } from "../src/codepipeline-init";
import { parseCodePipelineInitArgs } from "../src/codepipeline-init/cli";

const requiredArgs = [
	"--source",
	"codecommit",
	"--source-name",
	"my-repo",
	"--no-autoreviewer",
	"--team",
	"platform",
	"--no-install",
	"--no-deploy",
];

describe("runCodePipelineInit — non-TTY", () => {
	test("accepts CodeCommit and retains team and deployment stage context", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-cp-"));
		try {
			const result = await runCodePipelineInit({
				argv: [...requiredArgs, "--stage", "qa"],
				cwd: dir,
				isTTY: false,
			});
			const projectDir = path.join(dir, "my-repo-pipeline");
			const cdkJson = JSON.parse(
				readFileSync(path.join(projectDir, "cdk.json"), "utf8"),
			) as { context: Record<string, string> };

			expect(result.repositoryName).toBe("my-repo");
			expect(result.autoReviewer).toBe(false);
			expect(statSync(path.join(projectDir, "package.json")).isFile()).toBe(
				true,
			);
			expect(cdkJson.context).toEqual({ team: "platform", stage: "qa" });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("rejects unsupported sources before resolving the project layout", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-cp-source-"));
		const missingCwd = path.join(dir, "missing");
		try {
			await expect(
				runCodePipelineInit({
					argv: requiredArgs.map((arg) =>
						arg === "codecommit" ? "github" : arg,
					),
					cwd: missingCwd,
					isTTY: false,
				}),
			).rejects.toThrow(/source.*codecommit/i);
			expect(() => statSync(missingCwd)).toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("rejects the removed --pipeline-stage option", () => {
		expect(() =>
			parseCodePipelineInitArgs([
				...requiredArgs,
				"--pipeline-stage",
				"Approval:approval",
			]),
		).toThrow(/pipeline-stage/);
	});

	test("with --on-pr and --autoreviewer flags", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-cp-pr-"));
		try {
			const result = await runCodePipelineInit({
				argv: [
					"--source",
					"codecommit",
					"--source-name",
					"my-repo",
					"--on-pr",
					"--autoreviewer",
					"--model",
					"eu.anthropic.claude-sonnet-4-6",
					"--team",
					"platform",
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
			await expect(
				runCodePipelineInit({
					argv: ["--source", "codecommit"],
					cwd: dir,
					isTTY: false,
				}),
			).rejects.toBeInstanceOf(Error);
			expect(() => statSync(path.join(dir, "pipeline"))).toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
