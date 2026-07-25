import { parseArgs } from "node:util";

export interface CodePipelineInitFlags {
	readonly source?: string;
	readonly sourceName?: string;
	readonly sourceBranch?: string;
	readonly pipelineStage?: readonly string[];
	readonly onPullRequest?: true;
	readonly autoReviewer?: true;
	readonly noAutoReviewer?: true;
	readonly modelId?: string;
	readonly team?: string;
	readonly stage?: string;
	readonly install?: true;
	readonly noInstall?: true;
	readonly deploy?: true;
	readonly noDeploy?: true;
	readonly awsProfile?: string;
	readonly region?: string;
	readonly help?: true;
}

export interface CodePipelineInitHelpResult {
	readonly kind: "help";
	readonly text: string;
}

export type CodePipelineInitParseResult =
	| CodePipelineInitFlags
	| CodePipelineInitHelpResult;

const options = {
	source: { type: "string" },
	"source-name": { type: "string" },
	"source-branch": { type: "string" },
	"pipeline-stage": { type: "string", multiple: true },
	"on-pr": { type: "boolean" },
	"on-pull-request": { type: "boolean" },
	autoreviewer: { type: "boolean" },
	"no-autoreviewer": { type: "boolean" },
	model: { type: "string" },
	team: { type: "string" },
	stage: { type: "string" },
	install: { type: "boolean" },
	"no-install": { type: "boolean" },
	deploy: { type: "boolean" },
	"no-deploy": { type: "boolean" },
	"aws-profile": { type: "string" },
	region: { type: "string" },
	help: { type: "boolean" },
} as const;

export function parseCodePipelineInitArgs(
	argv: readonly string[],
): CodePipelineInitParseResult {
	const commandArgs =
		argv[0] === "init" && argv[1] === "codepipeline" ? argv.slice(2) : [...argv];
	const parsed = parseArgs({
		args: commandArgs,
		options,
		strict: true,
		allowPositionals: false,
	});

	if (parsed.values.help === true) {
		return { kind: "help", text: formatCodePipelineInitHelp() };
	}

	const onPr = parsed.values["on-pr"] === true || parsed.values["on-pull-request"] === true;

	return {
		...(parsed.values.source === undefined ? {} : { source: parsed.values.source }),
		...(parsed.values["source-name"] === undefined
			? {}
			: { sourceName: parsed.values["source-name"] }),
		...(parsed.values["source-branch"] === undefined
			? {}
			: { sourceBranch: parsed.values["source-branch"] }),
		...(parsed.values["pipeline-stage"] === undefined
			? {}
			: { pipelineStage: parsed.values["pipeline-stage"] }),
		...(onPr ? { onPullRequest: true as const } : {}),
		...(parsed.values.autoreviewer === true ? { autoReviewer: true as const } : {}),
		...(parsed.values["no-autoreviewer"] === true
			? { noAutoReviewer: true as const }
			: {}),
		...(parsed.values.model === undefined ? {} : { modelId: parsed.values.model }),
		...(parsed.values.team === undefined ? {} : { team: parsed.values.team }),
		...(parsed.values.stage === undefined ? {} : { stage: parsed.values.stage }),
		...(parsed.values.install === true ? { install: true as const } : {}),
		...(parsed.values["no-install"] === true ? { noInstall: true as const } : {}),
		...(parsed.values.deploy === true ? { deploy: true as const } : {}),
		...(parsed.values["no-deploy"] === true ? { noDeploy: true as const } : {}),
		...(parsed.values["aws-profile"] === undefined
			? {}
			: { awsProfile: parsed.values["aws-profile"] }),
		...(parsed.values.region === undefined ? {} : { region: parsed.values.region }),
	};
}

export function formatCodePipelineInitHelp(): string {
	return `Usage: pawl init codepipeline [options]

Create a Pawl CDK project with a CodePipeline CI/CD pipeline.

Options:
  --source <type>              Source type: codecommit (required)
  --source-name <name>         CodeCommit repository name (import existing)
  --source-branch <name>       Source branch (default: main)
  --pipeline-stage <spec>      Repeatable. Pipeline stage action.
  --on-pr / --on-pull-request  PR-gated mode: trigger on PR events only
  --autoreviewer               Enable durable auto-review
  --no-autoreviewer            Disable auto-review
  --model <model-id>           Anthropic Bedrock model ID for auto-review
  --team <name>                Owning team tag
  --stage <dev|qa|prod>        Deployment stage (default: dev)
  --install                    Install generated project dependencies
  --no-install                 Do not install dependencies
  --deploy                     Deploy after installation
  --no-deploy                  Do not deploy
  --aws-profile <profile>      AWS profile used for deployment
  --region <region>            AWS region used for deployment
  --help                       Show this help

Non-TTY use requires --source, --source-name, --team, exactly one of
--autoreviewer/--no-autoreviewer, --install/--no-install, and
--deploy/--no-deploy. --model is required with --autoreviewer. Deployment
requires --install, --aws-profile, and --region.`;
}
