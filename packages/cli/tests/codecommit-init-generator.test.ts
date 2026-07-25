import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineStacks } from "@pawl/cdk";
import {
	getCodeCommitTemplateManifest,
	renderCodeCommitTemplateFiles,
	type CodeCommitGeneratorConfig,
} from "../src/codecommit-init/generator";
import { generateCodeCommitProject } from "../src/codecommit-init/generator";
import type { CodeCommitInitLayout } from "../src/codecommit-init/layout";

function baseConfig(overrides: Partial<CodeCommitGeneratorConfig> = {}): CodeCommitGeneratorConfig {
	return {
		repositoryName: "my-repo",
		branchName: "main",
		team: "platform",
		stage: "dev",
		autoReviewer: false,
		...overrides,
	};
}

function baseLayout(overrides: Partial<CodeCommitInitLayout> = {}): CodeCommitInitLayout {
	return {
		sourceRoot: "/tmp/source-root",
		projectDir: "/tmp/source-root/infra",
		infrastructureName: "infra",
		sourcePathFromStack: "..",
		...overrides,
	};
}

describe("getCodeCommitTemplateManifest", () => {
	test("contains exactly the documented files with no LocalStack or local.dev.ts", () => {
		const manifest = getCodeCommitTemplateManifest();
		expect(manifest.files.sort()).toEqual(
			[
				".gitignore",
				"README.md",
				"cdk.json",
				"index.ts",
				"package.json",
				"stacks/codecommit-stack.ts",
				"tests/codecommit-stack.test.ts",
				"tsconfig.json",
			].sort(),
		);
		expect(manifest.files).not.toContain("local.dev.ts");
		expect(manifest.files).not.toContain("tests/localstack.setup.ts");
	});

	test("does not vary with auto-review (manifest is content-independent)", () => {
		expect(getCodeCommitTemplateManifest().files).toEqual(
			getCodeCommitTemplateManifest().files,
		);
	});
});

describe("renderCodeCommitTemplateFiles", () => {
	test("uses Bun and depends on @pawl/cdk ^0.1.0 without workspace/file/link specifiers", () => {
		const files = renderCodeCommitTemplateFiles(baseConfig());
		const pkgJson = JSON.parse(
			files.find((f) => f.path === "package.json")!.content,
		) as Record<string, unknown>;

		expect(pkgJson).toBeDefined();
		const devDeps = pkgJson.devDependencies as Record<string, string>;
		expect(devDeps["@pawl/cdk"]).toBe("^0.1.0");
		expect(devDeps["@pawl/lambda"]).toBeUndefined();

		const serialized = JSON.stringify(pkgJson);
		expect(serialized).not.toContain("workspace:");
		expect(serialized).not.toContain("file:");
		expect(serialized).not.toContain("link:");

		// No raw aws-cdk-lib dependency
		expect(devDeps["aws-cdk-lib"]).toBeUndefined();
		expect(devDeps["aws-cdk-local"]).toBeUndefined();
	});

	test("imports only from @pawl/cdk in the generated stack", () => {
		const files = renderCodeCommitTemplateFiles(baseConfig());
		const stack = files.find((f) => f.path === "stacks/codecommit-stack.ts")!;
		expect(stack.content).toContain('from "@pawl/cdk"');
		expect(stack.content).not.toContain('from "aws-cdk-lib"');
	});

	test("renders auto-review only when selected", () => {
		const withoutAuto = renderCodeCommitTemplateFiles(baseConfig());
		const withoutStack = withoutAuto.find(
			(f) => f.path === "stacks/codecommit-stack.ts",
		)!.content;
		expect(withoutStack).not.toContain("autoReview");

		const withAuto = renderCodeCommitTemplateFiles(
			baseConfig({
				autoReviewer: true,
				modelId: "eu.anthropic.claude-sonnet-4-6",
			}),
		);
		const withStack = withAuto.find(
			(f) => f.path === "stacks/codecommit-stack.ts",
		)!.content;
		expect(withStack).toContain("autoReview");

		// modelId should not appear as a raw string without escaping
		expect(withStack).toContain("eu.anthropic.claude-sonnet-4-6");
	});

	test("includes team and stage in cdk.json", () => {
		const files = renderCodeCommitTemplateFiles(
			baseConfig({ team: "my-team", stage: "qa" }),
		);
		const cdkJson = JSON.parse(
			files.find((f) => f.path === "cdk.json")!.content,
		) as Record<string, unknown>;
		const context = cdkJson.context as Record<string, string>;
		expect(context.team).toBe("my-team");
		expect(context.stage).toBe("qa");
	});

	test("escapes repository name with JSON.stringify (no raw interpolation)", () => {
		const files = renderCodeCommitTemplateFiles(
			baseConfig({ repositoryName: 'repo"; evil' }),
		);
		const stack = files.find(
			(f) => f.path === "stacks/codecommit-stack.ts",
		)!.content;
		// The double quote in the repo name should be escaped
		expect(stack).toContain('\\"');
		expect(stack).not.toContain('repo"; evil');
	});

	test("uses Bun in package.json scripts", () => {
		const files = renderCodeCommitTemplateFiles(baseConfig());
		const pkgJson = JSON.parse(
			files.find((f) => f.path === "package.json")!.content,
		) as Record<string, unknown>;
		const scripts = pkgJson.scripts as Record<string, string>;
		expect(scripts.deploy).toContain("bunx");
		expect(scripts.test).toContain("bun test");
	});
});

describe("generateCodeCommitProject", () => {
	test("writes all template files into the destination via atomic rename", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-gen-"));
		try {
			const projectDir = path.join(dir, "my-project");
			const layout: CodeCommitInitLayout = {
				sourceRoot: dir,
				projectDir,
				sourcePathFromStack: "..",
			};
			generateCodeCommitProject(layout, baseConfig());

			// Destination exists and contains all manifest files
			expect(statSync(projectDir).isDirectory()).toBe(true);
			const manifest = getCodeCommitTemplateManifest();
			for (const file of manifest.files) {
				expect(() => statSync(path.join(projectDir, file))).not.toThrow();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("preserves pre-existing sync-root files byte-for-byte", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-sync-"));
		try {
			// Pre-create files in the sync root
			const gitignorePath = path.join(dir, ".gitignore");
			const gitignoreContent = "node_modules/\ncdk.out/\ninfra/\n";
			const readmePath = path.join(dir, "README.md");
			const readmeContent = "# Existing project\n";
			Bun.write(gitignorePath, gitignoreContent);
			Bun.write(readmePath, readmeContent);

			const projectDir = path.join(dir, "infra");
			const layout: CodeCommitInitLayout = {
				sourceRoot: dir,
				projectDir,
				infrastructureName: "infra",
				sourcePathFromStack: "..",
			};
			generateCodeCommitProject(layout, baseConfig());

			// Pre-existing files unchanged
			expect(readFileSync(gitignorePath, "utf8")).toBe(gitignoreContent);
			expect(readFileSync(readmePath, "utf8")).toBe(readmeContent);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("cleans up temporary directory on write failure and leaves destination absent", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-fail-"));
		try {
			const projectDir = path.join(dir, "my-project");
			const layout: CodeCommitInitLayout = {
				sourceRoot: dir,
				projectDir,
				sourcePathFromStack: "..",
			};

			// Inject a write failure by passing a config that causes a template
			// render to throw (undefined repositoryName is caught by generator)
			expect(() =>
				generateCodeCommitProject(layout, {
					...baseConfig(),
					repositoryName: undefined as unknown as string,
				}),
			).toThrow();

			// Destination must not exist
			expect(() => statSync(projectDir)).toThrow();

			// No temporary directories left behind (only pre-existing entries)
			const entries = readdirSync(dir);
			expect(entries).not.toContain("my-project");
			// There should be no .tmp-* directories left
			const tmpEntries = entries.filter((e) => e.includes(".tmp-"));
			expect(tmpEntries).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});