import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { listProfiles } from "../aws-credentials";
import { assertEmptyTargetDir } from "./filesystem";
import {
	promptAwsProfile,
	promptExtraTags,
	promptInstallNow,
	promptLocalstackSecretPath,
	promptPackageManager,
	promptProjectName,
	promptStage,
	promptTeam,
	promptTestMode,
} from "./prompts";
import { buildTemplateFiles } from "./template";
import {
	type ScaffoldInitOverrides,
	type ScaffoldInitResult,
	type ScaffoldPackageManager,
	type ScaffoldProjectConfig,
	type ScaffoldStage,
	type ScaffoldTestMode,
	validateScaffoldConfig,
} from "./types";

export interface PawlInitDeps {
	listProfiles: () => Promise<string[]>;
	promptProjectName: () => Promise<string>;
	promptPackageManager: () => Promise<ScaffoldPackageManager>;
	promptAwsProfile: (profiles: string[]) => Promise<string>;
	promptTestMode: () => Promise<ScaffoldTestMode>;
	promptTeam: () => Promise<string>;
	promptStage: () => Promise<ScaffoldStage>;
	promptExtraTags: () => Promise<Record<string, string>>;
	promptLocalstackSecretPath: () => Promise<string>;
	promptInstallNow: () => Promise<boolean>;
	assertEmptyTargetDir: (targetDir: string) => Promise<void>;
}

export interface ScaffoldInstallDeps {
	exec: (command: string, args: string[], cwd: string) => Promise<void>;
}

const defaultDeps: PawlInitDeps = {
	listProfiles,
	promptProjectName,
	promptPackageManager,
	promptAwsProfile,
	promptTestMode,
	promptTeam,
	promptStage,
	promptExtraTags,
	promptLocalstackSecretPath,
	promptInstallNow,
	assertEmptyTargetDir,
};

const defaultInstallDeps: ScaffoldInstallDeps = {
	exec: runCommand,
};

export async function runPawlInit(options: {
	cwd: string;
	overrides?: ScaffoldInitOverrides;
	deps?: Partial<PawlInitDeps>;
}): Promise<ScaffoldInitResult> {
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
	const team = options.overrides?.team ?? (await deps.promptTeam());
	const stage = options.overrides?.stage ?? (await deps.promptStage());
	const tags = options.overrides?.tags ?? (await deps.promptExtraTags());
	const localstackSecretPath =
		options.overrides?.localstackSecretPath ??
		(testMode === "localstack"
			? await deps.promptLocalstackSecretPath()
			: undefined);
	const installNow = await deps.promptInstallNow();

	const config = validateScaffoldConfig({
		projectName,
		packageManager,
		awsProfile,
		testMode,
		team,
		stage,
		tags,
		localstackSecretPath,
	});

	return {
		...config,
		cwd: options.cwd,
		projectDir,
		installNow,
	};
}

export async function installScaffoldDependencies(
	config: ScaffoldProjectConfig,
	deps?: Partial<ScaffoldInstallDeps>,
): Promise<void> {
	const effectiveDeps = {
		...defaultInstallDeps,
		...deps,
	} satisfies ScaffoldInstallDeps;

	await effectiveDeps.exec(
		config.packageManager,
		["install"],
		config.projectDir,
	);
}

async function runCommand(
	command: string,
	args: string[],
	cwd: string,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			shell: false,
			stdio: "inherit",
		});
		child.once("error", reject);
		child.once("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(
				new Error(`${command} ${args.join(" ")} exited with code ${code}`),
			);
		});
	});
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
	promptExtraTags,
	promptInstallNow,
	promptLocalstackSecretPath,
	promptPackageManager,
	promptProjectName,
	promptStage,
	promptTeam,
	promptTestMode,
} from "./prompts";
export {
	type ScaffoldConfig,
	type ScaffoldInitOverrides,
	type ScaffoldInitResult,
	type ScaffoldPackageManager,
	type ScaffoldStage,
	type ScaffoldTestMode,
	validateScaffoldConfig,
} from "./types";
