import type { CodeCommitInitFlags } from "./config";
import {
	validateCodeCommitInitConfig,
	validateCodeCommitInitCoreConfig,
	type ValidatedCodeCommitInitConfig,
} from "./config";
import { parseCodeCommitInitArgs } from "./cli";
import type { CodeCommitInitLayout } from "./layout";
import { resolveCodeCommitInitLayout } from "./layout";
import {
	generateCodeCommitProject,
	type CodeCommitGeneratorConfig,
} from "./generator";
import {
	runCodeCommitSourcePreflight,
	formatPreflightError,
} from "./source-preflight";
import {
	installCodeCommitProject,
	deployCodeCommitProject,
	formatDeployRetryCommand,
	type CodeCommitDeployDeps,
} from "./deploy";
import {
	defaultPromptDeps,
	resolveCorePrompts,
	resolvePostConfirmPrompts,
	type CodeCommitInitPromptDeps,
} from "./prompts";

export interface CodeCommitInitResult {
	readonly repositoryName: string;
	readonly branchName: string;
	readonly projectDir: string;
	readonly sourceRoot: string;
	readonly install: boolean;
	readonly deploy: boolean;
	readonly autoReviewer: boolean;
	readonly cloneUrlGrc?: string;
	readonly region?: string;
	readonly preflight?: {
		readonly fileCount: number;
		readonly totalBytes: number;
		readonly archiveBytes: number;
	};
	readonly deployOutput?: {
		readonly repositoryName: string;
		readonly branchName: string;
		readonly region: string;
		readonly cloneUrlGrc: string;
		readonly autoReviewer: boolean;
	};
}

export interface CodeCommitInitDeps {
	readonly prompts: CodeCommitInitPromptDeps;
	readonly install: (projectDir: string) => Promise<void>;
	readonly deploy: (
		projectDir: string,
		profile: string,
		region: string,
	) => Promise<Record<string, string>>;
}

export const defaultCodeCommitInitDeps: CodeCommitInitDeps = {
	prompts: defaultPromptDeps,
	install: async () => {
		throw new Error("Install not implemented in this context");
	},
	deploy: async () => {
		throw new Error("Deploy not implemented in this context");
	},
};

/**
 * Orchestrate the full `pawl init codecommit` pipeline.
 *
 * TTY pipeline:
 * 1. parse flags
 * 2. prompt core project choices
 * 3. validate core config and resolve layout
 * 4. render summary and prompt confirmation
 * 5. resolve install (honor supplied flag or prompt); when false, deploy=false
 * 6. when install true, resolve deploy (honor or prompt); when deploy true, honor/prompt profile then region
 * 7. validate complete config
 * 8. atomic generation → preflight → optional installation → final preflight → optional deployment
 *
 * Non-TTY has no prompts: parse all required flags, validate complete config, resolve layout, continue.
 */
export async function runCodeCommitInit(options: {
	readonly argv: string[];
	readonly cwd: string;
	readonly isTTY: boolean;
	readonly deps?: Partial<CodeCommitInitDeps>;
}): Promise<CodeCommitInitResult> {
	const deps: CodeCommitInitDeps = {
		...defaultCodeCommitInitDeps,
		...options.deps,
	};

	const parseResult = parseCodeCommitInitArgs(options.argv);
	if ("kind" in parseResult) {
		throw new Error(parseResult.text);
	}
	const rawFlags: CodeCommitInitFlags = parseResult;

	let flags: CodeCommitInitFlags;
	let layout: CodeCommitInitLayout;

	if (options.isTTY) {
		// Phase 1: core prompts
		const corePrompted = await resolveCorePrompts(deps.prompts);
		const mergedFlags: CodeCommitInitFlags = {
			...rawFlags,
			...corePrompted,
		};
		const coreConfig = validateCodeCommitInitCoreConfig(mergedFlags);

		// Phase 2: layout resolution
		const tempComplete: ValidatedCodeCommitInitConfig = {
			...coreConfig,
			install: coreConfig.install ?? false,
			deploy: coreConfig.deploy ?? false,
		};
		layout = await resolveCodeCommitInitLayout(options.cwd, tempComplete);

		// Phase 3: confirmation
		const summary = formatSummary(coreConfig, layout);
		const confirmed = await deps.prompts.promptConfirm(summary);
		if (!confirmed) {
			throw new Error("CodeCommit init cancelled");
		}

		// Phase 4: post-confirmation prompts
		const postConfirm = await resolvePostConfirmPrompts(deps.prompts, coreConfig);
		flags = {
			...mergedFlags,
			...(postConfirm.install === true ? { install: true as const } : { noInstall: true as const }),
			...(postConfirm.deploy === true
				? { deploy: true as const }
				: { noDeploy: true as const }),
			...(postConfirm.awsProfile === undefined
				? {}
				: { awsProfile: postConfirm.awsProfile }),
			...(postConfirm.region === undefined
				? {}
				: { region: postConfirm.region }),
		};
	} else {
		flags = rawFlags;
	}

	const config = validateCodeCommitInitConfig(flags);
	if (!options.isTTY) {
		layout = await resolveCodeCommitInitLayout(options.cwd, config);
	}

	// Phase 5: atomic generation
	const generatorConfig: CodeCommitGeneratorConfig = {
		repositoryName: config.repositoryName,
		branchName: config.branchName,
		team: config.team,
		stage: config.stage,
		autoReviewer: config.autoReviewer,
		...(config.modelId === undefined ? {} : { modelId: config.modelId }),
		...(config.awsProfile === undefined ? {} : { awsProfile: config.awsProfile }),
		...(layout.infrastructureName === undefined
			? {}
			: { infrastructureName: layout.infrastructureName }),
		sourcePathFromStack: layout.sourcePathFromStack,
	};
	generateCodeCommitProject(layout, generatorConfig);

	// Phase 6: preflight
	let preflight: CodeCommitInitResult["preflight"];
	if (config.syncPath !== undefined) {
		try {
			preflight = runCodeCommitSourcePreflight({
				sourcePath: layout.sourceRoot,
				forceIncludePath: layout.infrastructureName,
			});
		} catch (error: unknown) {
			throw new Error(
				`Source preflight failed: ${formatPreflightError(error)}`,
			);
		}
	}

	// Phase 7: optional installation
	if (config.install) {
		await deps.install(layout.projectDir);
	}

	// Phase 8: final preflight after installation
	if (config.syncPath !== undefined && config.install) {
		try {
			preflight = runCodeCommitSourcePreflight({
				sourcePath: layout.sourceRoot,
				forceIncludePath: layout.infrastructureName,
			});
		} catch (error: unknown) {
			throw new Error(
				`Source preflight after install failed: ${formatPreflightError(error)}`,
			);
		}
	}

	// Phase 9: optional deployment
	let deployOutput: CodeCommitInitResult["deployOutput"];
	if (config.deploy && config.awsProfile && config.region) {
		const outputs = await deps.deploy(
			layout.projectDir,
			config.awsProfile,
			config.region,
			{ autoReviewer: config.autoReviewer },
		);
		deployOutput = {
			repositoryName: outputs.RepositoryName ?? config.repositoryName,
			branchName: outputs.BranchName ?? config.branchName,
			region: config.region,
			cloneUrlGrc: outputs.RepositoryCloneUrlGrc ?? "",
			autoReviewer: config.autoReviewer,
		};
	}

	return {
		repositoryName: config.repositoryName,
		branchName: config.branchName,
		projectDir: layout.projectDir,
		sourceRoot: layout.sourceRoot,
		install: config.install,
		deploy: config.deploy,
		autoReviewer: config.autoReviewer,
		...(preflight === undefined ? {} : { preflight }),
		...(deployOutput === undefined ? {} : { deployOutput }),
		...(config.region === undefined ? {} : { region: config.region }),
	};
}

function formatSummary(
	core: { repositoryName: string; branchName: string; team: string; stage: string; autoReviewer: boolean; syncPath?: string; noSync?: true; directory?: string },
	layout: CodeCommitInitLayout,
): string {
	const mode = core.syncPath !== undefined ? "sync" : "new project";
	const review = core.autoReviewer ? "with auto-review" : "repository only";
	return `Create ${core.repositoryName} (${mode}, ${review}) in ${layout.projectDir}?`;
}

/**
 * Print the result of a CodeCommit init run for the CLI entrypoint.
 */
export function printCodeCommitInitResult(result: CodeCommitInitResult): string {
	const lines: string[] = [
		`Created CodeCommit project "${result.repositoryName}" in ${result.projectDir}`,
		`  Branch: ${result.branchName}`,
		`  Auto-review: ${result.autoReviewer ? "enabled" : "disabled"}`,
	];
	if (result.preflight) {
		lines.push(
			`  Source: ${result.preflight.fileCount} files, ${result.preflight.totalBytes} bytes, ${result.preflight.archiveBytes} ZIP bytes`,
		);
	}
	if (result.deployOutput) {
		lines.push(
			`  Deployed: ${result.deployOutput.region}`,
			`  Clone URL (GRC): ${result.deployOutput.cloneUrlGrc}`,
		);
	}
	if (!result.install) {
		lines.push(`  Next: cd ${result.projectDir} && bun install`);
	}
	if (!result.deploy) {
		lines.push(`  Deploy: AWS_PROFILE=<profile> AWS_REGION=<region> bunx cdk deploy --all`);
	}
	lines.push(
		"  Warning: CDK initial seeding is not ongoing synchronization.",
	);
	return lines.join("\n");
}
