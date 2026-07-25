import {
	mkdtempSync,
	mkdirSync,
	readFileSync as nodeReadFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CodeCommitInitLayout } from "./layout";

/**
 * Configuration for template rendering.
 */
export interface CodeCommitGeneratorConfig {
	readonly repositoryName: string;
	readonly branchName: string;
	readonly team: string;
	readonly stage: string;
	readonly autoReviewer: boolean;
	readonly modelId?: string;
	readonly awsProfile?: string;
	readonly infrastructureName?: string;
	readonly sourcePathFromStack?: string;
}

/**
 * Static file manifest for the codecommit-init template.
 */
export function getCodeCommitTemplateManifest(): { files: string[] } {
	return {
		files: [
			".gitignore",
			"package.json",
			"tsconfig.json",
			"cdk.json",
			"index.ts",
			"README.md",
			"stacks/codecommit-stack.ts",
			"tests/codecommit-stack.test.ts",
		],
	};
}

const TEMPLATE_ROOT = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"templates",
	"codecommit-init",
);

function esc(value: string): string {
	return JSON.stringify(value).slice(1, -1);
}

/**
 * Render all template files with the given config. Returns an array of
 * `{ path, content }` pairs, one per manifest entry.
 */
export function renderCodeCommitTemplateFiles(
	config: CodeCommitGeneratorConfig,
): Array<{ path: string; content: string }> {
	const manifest = getCodeCommitTemplateManifest();
	const awsProfile = config.awsProfile ?? "default";

	const infraName = config.infrastructureName ?? "infra";
	const forceIncludeProperty =
		`,\n        forceIncludePath: ${JSON.stringify(infraName)}`;

	const autoReviewProperty = config.autoReviewer
		? `,\n      autoReview: { modelId: ${JSON.stringify(config.modelId ?? "")} }`
		: "";

	const autoReviewSection = config.autoReviewer
		? "\n## Auto-review\n\nThis project deploys the Pawl durable auto-reviewer for pull requests.\n"
		: "";

	const variables: Record<string, string> = {
		repositoryName: esc(config.repositoryName),
		branchName: esc(config.branchName),
		team: esc(config.team),
		stage: esc(config.stage),
		awsProfile: esc(awsProfile),
		sourcePathFromStack: config.sourcePathFromStack ?? "..",
		forceIncludeProperty,
		autoReviewProperty,
		autoReviewSection,
	};

	const files: Array<{ path: string; content: string }> = [];
	for (const filePath of manifest.files) {
		let template = "";
		if (filePath === "stacks/codecommit-stack.ts") {
			template = renderStackTemplate(config, variables);
		} else if (filePath === "tests/codecommit-stack.test.ts") {
			template = renderTestTemplate(variables);
		} else {
			const raw = nodeReadFileSync(join(TEMPLATE_ROOT, filePath), "utf8");
			template = renderTemplate(raw, variables);
		}
		files.push({ path: filePath, content: template });
	}
	return files;
}

function renderTemplate(
	content: string,
	variables: Record<string, string>,
): string {
	let rendered = content;
	for (const [key, value] of Object.entries(variables)) {
		const pattern = new RegExp(`\\{\\{${key}\\}\\}`, "g");
		rendered = rendered.replace(pattern, value);
	}
	return rendered;
}

function renderStackTemplate(
	config: CodeCommitGeneratorConfig,
	variables: Record<string, string>,
): string {
	const repoName = JSON.stringify(config.repositoryName);
	const branchName = JSON.stringify(config.branchName);
	const sourcePathFromStack = variables.sourcePathFromStack ?? "..";
	const forceIncludeProp =
		config.infrastructureName
			? `,\n        forceIncludePath: ${JSON.stringify(config.infrastructureName)}`
			: "";
	const autoReviewProp = config.autoReviewer
		? `,\n      autoReview: { modelId: ${JSON.stringify(config.modelId ?? "")} }`
		: "";

	return `import path from "node:path";
import {
  CfnOutput,
  CodeCommit,
  type Construct,
  Stack,
} from "@pawl/cdk";

export class CodeCommitStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    const codeCommit = new CodeCommit(this, "Repository", {
      repositoryName: ${repoName},
      create: {
        sourcePath: path.resolve(import.meta.dirname, ${JSON.stringify(sourcePathFromStack)}),
        branchName: ${branchName}${forceIncludeProp},
      }${autoReviewProp},
    });
    new CfnOutput(this, "RepositoryName", { value: codeCommit.repository.repositoryName });
    new CfnOutput(this, "RepositoryCloneUrlGrc", { value: codeCommit.repository.repositoryCloneUrlGrc });
    new CfnOutput(this, "BranchName", { value: ${branchName} });
  }
}
`;
}

function renderTestTemplate(variables: Record<string, string>): string {
	const repoName = variables.repositoryName ?? "my-repo";
	return `import { describe, expect, test } from "bun:test";
import { App, Template } from "@pawl/cdk";
import { CodeCommitStack } from "../stacks/codecommit-stack";

describe("CodeCommitStack", () => {
  test("synthesizes a retained CodeCommit repository", () => {
    const app = new App();
    const stack = new CodeCommitStack(app, "TestStack");
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::CodeCommit::Repository", {
      RepositoryName: "${repoName}",
    });
    template.hasResource("AWS::CodeCommit::Repository", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });
});
`;
}

/**
 * Generate a Pawl CodeCommit project atomically.
 *
 * Writes all template files into a temporary sibling directory and renames it
 * to the final destination only after every write succeeds. On failure the
 * temporary directory is removed and the destination is left untouched.
 *
 * Never edits the source root `.gitignore` or any existing synced file.
 */
export function generateCodeCommitProject(
	layout: CodeCommitInitLayout,
	config: CodeCommitGeneratorConfig,
): void {
	const projectDir = layout.projectDir;
	const parent = dirname(projectDir);

	// Create a temporary sibling directory
	const tempDir = mkdtempSync(join(parent, ".tmp-codecommit-"));
	try {
		const files = renderCodeCommitTemplateFiles(config);
		for (const file of files) {
			const outputPath = join(tempDir, file.path);
			const fileParent = dirname(outputPath);
			mkdirSync(fileParent, { recursive: true });
			writeFileSync(outputPath, file.content, "utf8");
		}

		// Atomic rename to final destination
		renameSync(tempDir, projectDir);
	} catch (error: unknown) {
		// Clean up the temporary directory on any failure
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Best-effort cleanup
		}
		throw error;
	}
}