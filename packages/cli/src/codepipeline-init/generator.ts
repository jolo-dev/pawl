import {
	mkdirSync,
	mkdtempSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { CodePipelineInitLayout } from "./layout";

export interface CodePipelineGeneratorConfig {
	readonly sourceName: string;
	readonly sourceBranch: string;
	readonly onPullRequest: boolean;
	readonly autoReviewer: boolean;
	readonly modelId?: string;
	readonly team: string;
	readonly stage: string;
	readonly awsProfile?: string;
}

export function getCodePipelineTemplateManifest(): { files: string[] } {
	return {
		files: [
			".gitignore",
			"package.json",
			"tsconfig.json",
			"cdk.json",
			"index.ts",
			"README.md",
			"stacks/codepipeline-stack.ts",
			"tests/codepipeline-stack.test.ts",
		],
	};
}

export function renderCodePipelineTemplateFiles(
	config: CodePipelineGeneratorConfig,
): Array<{ path: string; content: string }> {
	const manifest = getCodePipelineTemplateManifest();
	const files: Array<{ path: string; content: string }> = [];

	for (const filePath of manifest.files) {
		let content = "";
		if (filePath === "stacks/codepipeline-stack.ts") {
			content = renderStack(config);
		} else if (filePath === "tests/codepipeline-stack.test.ts") {
			content = renderTest();
		} else if (filePath === "package.json") {
			content = renderPackageJson(config);
		} else if (filePath === "tsconfig.json") {
			content = renderTsconfig();
		} else if (filePath === "cdk.json") {
			content = renderCdkJson(config);
		} else if (filePath === "index.ts") {
			content = renderIndex();
		} else if (filePath === ".gitignore") {
			content =
				"node_modules/\ncdk.out/\ndist/\n.env\n.env.*\n!.env.example\n.DS_Store\n";
		} else if (filePath === "README.md") {
			content = renderReadme(config);
		}
		files.push({ path: filePath, content });
	}
	return files;
}

function renderStack(config: CodePipelineGeneratorConfig): string {
	const onPullRequest = config.onPullRequest
		? "\n      onPullRequest: true,"
		: "";
	const autoReviewer = config.autoReviewer
		? `\n      autoReviewer: { modelId: ${JSON.stringify(config.modelId ?? "")} },`
		: "";

	return `import {
  CodePipeline,
  type Construct,
  Stack,
} from "@pawl/cdk";

export class CodePipelineStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    new CodePipeline(this, "Pipeline", {${onPullRequest}${autoReviewer}
    })
      .source({
        origin: "codecommit",
        create: false,
        repositoryName: ${JSON.stringify(config.sourceName)},
        branchName: ${JSON.stringify(config.sourceBranch)},
      })
      .stage({
        name: "Approval",
        actions: [
          {
            name: "Approve",
            type: "approval",
            description: "Approve pipeline execution",
          },
        ],
      });
  }
}
`;
}

function renderTest(): string {
	return `import { describe, expect, test } from "bun:test";
import { App, Template } from "@pawl/cdk";
import { CodePipelineStack } from "../stacks/codepipeline-stack";

describe("CodePipelineStack", () => {
  test("synthesizes a CodePipeline", () => {
    const app = new App();
    const stack = new CodePipelineStack(app, "TestStack");
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::CodePipeline::Pipeline", {});
  });
});
`;
}

function renderPackageJson(config: CodePipelineGeneratorConfig): string {
	return JSON.stringify(
		{
			name: `${config.sourceName}-pipeline`,
			version: "1.0.0",
			type: "module",
			description: "A Pawl CodePipeline project",
			scripts: {
				deploy: `AWS_PROFILE=${config.awsProfile ?? "default"} bunx cdk deploy --all`,
				remove: `AWS_PROFILE=${config.awsProfile ?? "default"} bunx cdk destroy --all`,
				synth: "bunx cdk synth",
				test: "bun test",
			},
			devDependencies: {
				"@pawl/cdk": "^0.1.0",
				"@types/bun": "^1.3.14",
				"aws-cdk": "^2.1124.1",
				typescript: "^5.9.3",
			},
		},
		null,
		"\t",
	);
}

function renderTsconfig(): string {
	return JSON.stringify(
		{
			compilerOptions: {
				target: "ES2022",
				module: "ESNext",
				moduleResolution: "bundler",
				strict: true,
				esModuleInterop: true,
				skipLibCheck: true,
				forceConsistentCasingInFileNames: true,
				resolveJsonModule: true,
				types: ["bun"],
			},
			include: ["index.ts", "stacks/**/*.ts", "tests/**/*.ts"],
		},
		null,
		"\t",
	);
}

function renderCdkJson(config: CodePipelineGeneratorConfig): string {
	return JSON.stringify(
		{
			app: "bun ./index.ts",
			context: {
				team: config.team,
				stage: config.stage,
			},
		},
		null,
		"\t",
	);
}

function renderIndex(): string {
	return `import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineStacks } from "@pawl/cdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const stacksDir = path.join(__dirname, "stacks");
const stacksToDefine = [] as Array<unknown>;
for (const stackDef of fs.readdirSync(stacksDir)) {
  const stack = await import(\`\${stacksDir}/\${stackDef}\`);
  for (const key in stack) {
    if (typeof stack[key] === "function") {
      stacksToDefine.push(stack[key]);
    }
  }
}
defineStacks(...(stacksToDefine as never[]));
`;
}

function renderReadme(config: CodePipelineGeneratorConfig): string {
	return `# ${config.sourceName}-pipeline

A Pawl CodePipeline CI/CD project for the CodeCommit repository "${config.sourceName}".

## Deploy

\`\`\`bash
bun install
AWS_PROFILE=<profile> AWS_REGION=<region> bunx cdk deploy --all
\`\`\`

## Pipeline structure

- **Source:** CodeCommit repository "${config.sourceName}", branch "${config.sourceBranch}"
- **Trigger:** ${config.onPullRequest ? "PR-gated (starts on pull request events)" : "Push-triggered (starts on branch pushes)"}
${config.autoReviewer ? `- **Auto-review:** Enabled with model ${config.modelId ?? ""}\n` : ""}
`;
}

export function generateCodePipelineProject(
	layout: CodePipelineInitLayout,
	config: CodePipelineGeneratorConfig,
): void {
	const projectDir = layout.projectDir;
	const parent = dirname(projectDir);
	const tempDir = mkdtempSync(join(parent, ".tmp-codepipeline-"));
	try {
		const files = renderCodePipelineTemplateFiles(config);
		for (const file of files) {
			const outputPath = join(tempDir, file.path);
			mkdirSync(dirname(outputPath), { recursive: true });
			writeFileSync(outputPath, file.content, "utf8");
		}
		renameSync(tempDir, projectDir);
	} catch (error: unknown) {
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Best-effort cleanup
		}
		throw error;
	}
}
