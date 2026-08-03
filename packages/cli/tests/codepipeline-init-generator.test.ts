import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import {
	type CodePipelineGeneratorConfig,
	generateCodePipelineProject,
	renderCodePipelineTemplateFiles,
} from "../src/codepipeline-init/generator";
import type { CodePipelineInitLayout } from "../src/codepipeline-init/layout";

const repositoryRoot = path.resolve(import.meta.dir, "../../..");

function baseConfig(
	overrides: Partial<CodePipelineGeneratorConfig> = {},
): CodePipelineGeneratorConfig {
	return {
		sourceName: "my-repo",
		sourceBranch: "main",
		onPullRequest: false,
		autoReviewer: false,
		team: "platform",
		stage: "dev",
		...overrides,
	};
}

function renderedStack(config: CodePipelineGeneratorConfig): string {
	const stack = renderCodePipelineTemplateFiles(config).find(
		(file) => file.path === "stacks/codepipeline-stack.ts",
	);
	if (stack === undefined) throw new Error("Generated stack is missing");
	return stack.content;
}

async function synthesizeGeneratedProject(projectDir: string): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
}> {
	const child = Bun.spawn(["bunx", "cdk", "synth"], {
		cwd: projectDir,
		env: { ...process.env, LOCAL: "1" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = new Response(child.stdout).text();
	const stderr = new Response(child.stderr).text();
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		child.kill();
	}, 60_000);

	try {
		const exitCode = await child.exited;
		const [stdoutText, stderrText] = await Promise.all([stdout, stderr]);
		if (timedOut) {
			throw new Error(
				`Generated project synth timed out after 60000ms: ${stderrText}`,
			);
		}
		return { exitCode, stdout: stdoutText, stderr: stderrText };
	} finally {
		clearTimeout(timeout);
	}
}

describe("renderCodePipelineTemplateFiles", () => {
	test("emits a fluent imported CodeCommit source and Approval stage", () => {
		const stack = renderedStack(baseConfig());

		expect(stack).toContain('new CodePipeline(this, "Pipeline", {');
		expect(stack).toContain(`.source({
        origin: "codecommit",
        create: false,
        repositoryName: "my-repo",
        branchName: "main",
      })`);
		expect(stack).toContain(`.stage({
        name: "Approval",
        actions: [
          {
            name: "Approve",
            type: "approval",
            description: "Approve pipeline execution",
          },
        ],
      });`);
		expect(stack).not.toContain("Repository");
		expect(stack).not.toContain("source:");
		expect(stack).not.toContain("stages:");
		expect(stack).not.toContain("autoReview:");
	});

	test("emits onPullRequest and autoReviewer only when selected", () => {
		const withoutOptions = renderedStack(baseConfig());
		expect(withoutOptions).not.toContain("onPullRequest:");
		expect(withoutOptions).not.toContain("autoReviewer:");

		const withOptions = renderedStack(
			baseConfig({
				onPullRequest: true,
				autoReviewer: true,
				modelId: "eu.anthropic.claude-sonnet-4-6",
			}),
		);
		expect(withOptions).toContain("onPullRequest: true");
		expect(withOptions).toContain(
			'autoReviewer: { modelId: "eu.anthropic.claude-sonnet-4-6" }',
		);
		expect(withOptions).not.toContain("autoReview:");
	});
});

describe("generateCodePipelineProject", () => {
	test("the generated project synthesizes with the local workspace package", async () => {
		const hostDir = mkdtempSync(
			path.join(repositoryRoot, ".tmp-codepipeline-test-"),
		);
		const projectDir = path.join(hostDir, "generated-pipeline");
		const layout: CodePipelineInitLayout = { projectDir };

		try {
			generateCodePipelineProject(layout, baseConfig());
			const result = await synthesizeGeneratedProject(projectDir);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).not.toContain("Error");
			expect(result.stdout).toContain("CodePipelineStack");
			expect(statSync(path.join(projectDir, "cdk.out")).isDirectory()).toBe(
				true,
			);
		} finally {
			rmSync(hostDir, { recursive: true, force: true });
		}
	});
});
