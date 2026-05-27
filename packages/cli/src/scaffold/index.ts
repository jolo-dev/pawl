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
	type ScaffoldInitOverrides,
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
	overrides?: ScaffoldInitOverrides;
	deps?: Partial<PawlInitDeps>;
}): Promise<ScaffoldProjectConfig> {
	const deps = { ...defaultDeps, ...options.deps } satisfies PawlInitDeps;

	const projectName =
		options.overrides?.projectName ?? (await deps.promptProjectName());
	const projectDir = join(options.cwd, projectName);
	await deps.assertEmptyTargetDir(projectDir);

	const packageManager =
		options.overrides?.packageManager ?? (await deps.promptPackageManager());
	const awsProfile =
		options.overrides?.awsProfile ??
		(await deps.promptAwsProfile(await deps.listProfiles()));
	const testMode = options.overrides?.testMode ?? (await deps.promptTestMode());

	const config = validateScaffoldConfig({
		projectName,
		packageManager,
		awsProfile,
		testMode,
	});

	return {
		...config,
		cwd: options.cwd,
		projectDir,
	};
}

export async function writeScaffoldProject(
	config: ScaffoldProjectConfig,
): Promise<string[]> {
	const files = await buildTemplateFiles(config);
	const written: string[] = [];
	for (const file of files) {
		const outputPath = join(config.projectDir, file.path);
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
	type ScaffoldInitOverrides,
	type ScaffoldPackageManager,
	type ScaffoldTestMode,
	validateScaffoldConfig,
} from "./types";
