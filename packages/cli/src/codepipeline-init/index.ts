import {
	deployCodeCommitProject,
	installCodeCommitProject,
} from "../codecommit-init/deploy";
import { parseCodePipelineInitArgs } from "./cli";
import {
	type CodePipelineGeneratorConfig,
	generateCodePipelineProject,
} from "./generator";
import { resolveCodePipelineInitLayout } from "./layout";

export interface CodePipelineInitResult {
	readonly repositoryName: string;
	readonly projectDir: string;
	readonly install: boolean;
	readonly deploy: boolean;
	readonly onPullRequest: boolean;
	readonly autoReviewer: boolean;
}

export async function runCodePipelineInit(options: {
	readonly argv: string[];
	readonly cwd: string;
	readonly isTTY: boolean;
}): Promise<CodePipelineInitResult> {
	const parseResult = parseCodePipelineInitArgs(options.argv);
	if ("kind" in parseResult) {
		throw new Error(parseResult.text);
	}
	const flags = parseResult;

	if (flags.source !== undefined && flags.source !== "codecommit") {
		throw new Error(
			`Unsupported --source "${flags.source}"; expected "codecommit"`,
		);
	}

	// Non-TTY: validate required flags
	if (!options.isTTY) {
		if (!flags.source) throw new Error("--source is required in non-TTY mode");
		if (!flags.sourceName)
			throw new Error("--source-name is required in non-TTY mode");
		if (!flags.team) throw new Error("--team is required in non-TTY mode");
		if (flags.autoReviewer === undefined && flags.noAutoReviewer === undefined)
			throw new Error(
				"Exactly one of --autoreviewer/--no-autoreviewer is required",
			);
		if (flags.install === undefined && flags.noInstall === undefined)
			throw new Error("Exactly one of --install/--no-install is required");
		if (flags.deploy === undefined && flags.noDeploy === undefined)
			throw new Error("Exactly one of --deploy/--no-deploy is required");
		if (flags.autoReviewer === true && !flags.modelId)
			throw new Error("--model is required with --autoreviewer");
	}

	const repositoryName = flags.sourceName ?? "my-repo";
	const branchName = flags.sourceBranch ?? "main";
	const onPullRequest = flags.onPullRequest === true;
	const autoReviewer = flags.autoReviewer === true;
	const team = flags.team ?? "platform";
	const stage = flags.stage ?? "dev";
	const install = flags.install === true;
	const deploy = flags.deploy === true;

	// Resolve layout
	const layout = await resolveCodePipelineInitLayout(
		options.cwd,
		repositoryName,
	);

	// Generate project
	const generatorConfig: CodePipelineGeneratorConfig = {
		sourceName: repositoryName,
		sourceBranch: branchName,
		onPullRequest,
		autoReviewer,
		...(flags.modelId === undefined ? {} : { modelId: flags.modelId }),
		team,
		stage,
		...(flags.awsProfile === undefined ? {} : { awsProfile: flags.awsProfile }),
	};
	generateCodePipelineProject(layout, generatorConfig);

	// Optional install
	if (install) {
		await installCodeCommitProject(layout.projectDir);
	}

	// Optional deploy
	if (deploy && flags.awsProfile && flags.region) {
		await deployCodeCommitProject(
			layout.projectDir,
			flags.awsProfile,
			flags.region,
			{
				autoReviewer,
			},
		);
	}

	return {
		repositoryName,
		projectDir: layout.projectDir,
		install,
		deploy,
		onPullRequest,
		autoReviewer,
	};
}

export function printCodePipelineInitResult(
	result: CodePipelineInitResult,
): string {
	const lines: string[] = [
		`Created CodePipeline project for "${result.repositoryName}" in ${result.projectDir}`,
		`  Trigger: ${result.onPullRequest ? "PR-gated" : "push"}`,
		`  Auto-review: ${result.autoReviewer ? "enabled" : "disabled"}`,
	];
	if (!result.install) {
		lines.push(`  Next: cd ${result.projectDir} && bun install`);
	}
	if (!result.deploy) {
		lines.push(
			`  Deploy: AWS_PROFILE=<profile> AWS_REGION=<region> bunx cdk deploy --all`,
		);
	}
	return lines.join("\n");
}
