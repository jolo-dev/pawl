import { listProfiles } from "../aws-credentials";
import {
	promptAwsProfile,
	promptPackageManager,
	promptProjectName,
	promptTestMode,
} from "./prompts";
import { assertEmptyTargetDir } from "./filesystem";
import {
	type ScaffoldConfig,
	type ScaffoldPackageManager,
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

export {
	promptAwsProfile,
	promptPackageManager,
	promptProjectName,
	promptTestMode,
} from "./prompts";
export {
	validateScaffoldConfig,
	type ScaffoldConfig,
	type ScaffoldPackageManager,
	type ScaffoldTestMode,
} from "./types";
