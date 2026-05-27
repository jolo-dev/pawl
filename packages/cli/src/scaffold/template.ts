import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScaffoldConfig, ScaffoldTestMode } from "./types";

export interface TemplateManifest {
	files: string[];
}

const TEMPLATE_ROOT = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"templates",
	"pawl-init",
);

export function getTemplateManifest(options: {
	testMode: ScaffoldTestMode;
}): TemplateManifest {
	const files = [
		"package.json",
		"cdk.json",
		"tsconfig.json",
		"README.md",
		"index.ts",
		"stacks/stack.ts",
		"src/sendWelcomeMessageHandler.ts",
		"src/messageProcessorHandler.ts",
		"tests/integration.test.ts",
	];

	if (options.testMode === "localstack") {
		files.push("local.dev.ts", "tests/localstack.setup.ts");
	}

	return { files };
}

export function renderTemplate(
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

export async function loadTemplateFile(relativePath: string): Promise<string> {
	return readFile(join(TEMPLATE_ROOT, relativePath), "utf8");
}

export async function buildTemplateFiles(
	config: ScaffoldConfig,
): Promise<Array<{ path: string; content: string }>> {
	const manifest = getTemplateManifest({ testMode: config.testMode });
	const variables = {
		projectName: config.projectName,
		projectNamePascal: toPascalCase(config.projectName),
		packageManager: config.packageManager,
		packageManagerRun: getPackageManagerRun(config.packageManager),
		packageManagerExec: getPackageManagerExec(config.packageManager),
		awsProfile: config.awsProfile,
		testMode: config.testMode,
		localstackScripts:
			config.testMode === "localstack" ? getLocalstackScripts(config) : "",
		localstackDevDeps:
			config.testMode === "localstack" ? getLocalstackDependencies() : "",
		localstackSection:
			config.testMode === "localstack" ? getLocalstackReadmeSection() : "",
	};

	const files = [];
	for (const path of manifest.files) {
		const template = await loadTemplateFile(path);
		files.push({
			path,
			content: renderTemplate(template, variables),
		});
	}
	return files;
}

function toPascalCase(input: string): string {
	return input
		.split(/[^a-zA-Z0-9]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join("");
}

function getPackageManagerRun(
	packageManager: ScaffoldConfig["packageManager"],
): string {
	switch (packageManager) {
		case "bun":
			return "bun run";
		case "pnpm":
			return "pnpm run";
		case "npm":
			return "npm run";
	}
}

function getPackageManagerExec(
	packageManager: ScaffoldConfig["packageManager"],
): string {
	switch (packageManager) {
		case "bun":
			return "bunx";
		case "pnpm":
			return "pnpm dlx";
		case "npm":
			return "npx";
	}
}

function getLocalstackScripts(config: ScaffoldConfig): string {
	const run = getPackageManagerRun(config.packageManager);
	return [
		`,\n\t\t"localstack": "docker compose -f ./node_modules/@pawl/cdk/docker-compose.yml up -d",`,
		`"bootstrap:local": "${run} localstack && AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 AWS_PROFILE=${config.awsProfile} ${getPackageManagerExec(config.packageManager)} cdk bootstrap --all",`,
		`"deploy:local": "${run} localstack && ${run} bootstrap:local && AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 AWS_PROFILE=${config.awsProfile} ${getPackageManagerExec(config.packageManager)} cdk deploy --all",`,
		`"dev:local": "${run} localstack && AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 AWS_PROFILE=${config.awsProfile} ${getPackageManagerExec(config.packageManager)} cdk watch"`,
	].join("\n\t\t");
}

function getLocalstackDependencies(): string {
	return `,
		"aws-cdk-local": "^3.0.4"`;
}

function getLocalstackReadmeSection(): string {
	return [
		"## LocalStack",
		"",
		"This scaffold includes a local development entrypoint and LocalStack helper scripts.",
		"",
		"Use `bun run dev:local` / `pnpm run dev:local` / `npm run dev:local` after starting Docker.",
	].join("\n");
}
