import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { listProfiles } from "../aws-credentials";
import { assertEmptyTargetDir } from "./filesystem";
import {
	promptAwsProfile,
	promptPackageManager,
	promptProjectName,
	promptTestMode,
} from "./prompts";
import { buildTemplateFiles } from "./template";
import {
	type ScaffoldConfig,
	type ScaffoldPackageManager,
	type ScaffoldProjectConfig,
	type ScaffoldTestMode,
	validateScaffoldConfig,
} from "./types";

export interface PawlInitDeps {
	listProfiles: () => Promise<string[]>;
	promptProjectName: () => Promise<string>;
	promptPackageManager: () => Promise<ScaffoldPackageManager>;
	promptAwsProfile: (profiles: string[]) => Promise<string>;
	promptTestMode: () => Promise<ScaffoldTestMode>;
	assertEmptyTargetDir: (targetDir: string) => Promise<void>;
}

const defaultDeps: PawlInitDeps = {
	listProfiles,
	promptProjectName,
	promptPackageManager,
	promptAwsProfile,
	promptTestMode,
	assertEmptyTargetDir,
};

export async function runPawlInit(options: {
	cwd: string;
	deps?: Partial<PawlInitDeps>;
}): Promise<ScaffoldConfig> {
	const deps = { ...defaultDeps, ...options.deps } satisfies PawlInitDeps;
	await deps.assertEmptyTargetDir(options.cwd);
	const profiles = await deps.listProfiles();
	const projectName = await deps.promptProjectName();
	const packageManager = await deps.promptPackageManager();
	const awsProfile = await deps.promptAwsProfile(profiles);
	const testMode = await deps.promptTestMode();

	return validateScaffoldConfig({
		projectName,
		packageManager,
		awsProfile,
		testMode,
	});
}

export async function writeScaffoldProject(
	config: ScaffoldProjectConfig,
): Promise<string[]> {
	const files = await buildTemplateFiles(config);
	const written: string[] = [];
	for (const file of files) {
		const outputPath = join(config.cwd, file.path);
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, file.content, "utf8");
		written.push(outputPath);
	}
	return written;
}

export {
	promptAwsProfile,
	promptPackageManager,
	promptProjectName,
	promptTestMode,
} from "./prompts";
export {
	type ScaffoldConfig,
	type ScaffoldPackageManager,
	type ScaffoldTestMode,
	validateScaffoldConfig,
} from "./types";
