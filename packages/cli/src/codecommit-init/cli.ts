import { parseArgs } from "node:util";
import type { CodeCommitInitFlags } from "./config";

export interface CodeCommitInitHelpResult {
	readonly kind: "help";
	readonly text: string;
}

export type CodeCommitInitParseResult =
	| CodeCommitInitFlags
	| CodeCommitInitHelpResult;

const options = {
	name: { type: "string" },
	sync: { type: "string" },
	"no-sync": { type: "boolean" },
	directory: { type: "string" },
	branch: { type: "string" },
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

/** Parse only the arguments belonging to `pawl init codecommit`. */
export function parseCodeCommitInitArgs(
	argv: readonly string[],
): CodeCommitInitParseResult {
	const commandArgs =
		argv[0] === "init" && argv[1] === "codecommit" ? argv.slice(2) : [...argv];
	const parsed = parseArgs({
		args: commandArgs,
		options,
		strict: true,
		allowPositionals: false,
		tokens: true,
	});

	const counts = new Map<string, number>();
	for (const token of parsed.tokens) {
		if (token.kind !== "option") continue;
		counts.set(token.name, (counts.get(token.name) ?? 0) + 1);
	}
	const repeatedOptions = [...counts.entries()]
		.filter(([, count]) => count > 1)
		.map(([name]) => `--${name}`);

	if (parsed.values.help === true) {
		return { kind: "help", text: formatCodeCommitInitHelp() };
	}

	return {
		...(parsed.values.name === undefined
			? {}
			: { repositoryName: parsed.values.name }),
		...(parsed.values.sync === undefined
			? {}
			: { syncPath: parsed.values.sync }),
		...(parsed.values["no-sync"] === true ? { noSync: true as const } : {}),
		...(parsed.values.directory === undefined
			? {}
			: { directory: parsed.values.directory }),
		...(parsed.values.branch === undefined
			? {}
			: { branchName: parsed.values.branch }),
		...(parsed.values.autoreviewer === true
			? { autoReviewer: true as const }
			: {}),
		...(parsed.values["no-autoreviewer"] === true
			? { noAutoReviewer: true as const }
			: {}),
		...(parsed.values.model === undefined
			? {}
			: { modelId: parsed.values.model }),
		...(parsed.values.team === undefined ? {} : { team: parsed.values.team }),
		...(parsed.values.stage === undefined
			? {}
			: { stage: parsed.values.stage }),
		...(parsed.values.install === true ? { install: true as const } : {}),
		...(parsed.values["no-install"] === true
			? { noInstall: true as const }
			: {}),
		...(parsed.values.deploy === true ? { deploy: true as const } : {}),
		...(parsed.values["no-deploy"] === true ? { noDeploy: true as const } : {}),
		...(parsed.values["aws-profile"] === undefined
			? {}
			: { awsProfile: parsed.values["aws-profile"] }),
		...(parsed.values.region === undefined
			? {}
			: { region: parsed.values.region }),
		...(repeatedOptions.length === 0 ? {} : { repeatedOptions }),
	};
}

export function formatCodeCommitInitHelp(): string {
	return `Usage: pawl init codecommit [options]

Create a Pawl CDK project for an initially seeded CodeCommit repository.

Options:
  --name <name>              CodeCommit repository name
  --sync <path>              Seed from an existing source path (use . for cwd)
  --no-sync                  Create a new project without existing source
  --directory <name>         Infrastructure directory or no-sync output path
  --branch <name>            Initial branch (default: main)
  --autoreviewer             Enable the durable Anthropic auto-reviewer
  --no-autoreviewer          Disable the auto-reviewer
  --model <model-id>         Anthropic Bedrock model ID for auto-review
  --team <name>              Owning team tag
  --stage <dev|qa|prod>       Deployment stage (default: dev)
  --install                  Install generated project dependencies
  --no-install               Do not install dependencies
  --deploy                   Deploy after installation
  --no-deploy                Do not deploy
  --aws-profile <profile>    AWS profile used for deployment
  --region <region>          AWS region used for deployment
  --help                     Show this help without prompting or writing files

Non-TTY use requires --name, exactly one of --sync/--no-sync,
--autoreviewer/--no-autoreviewer, --team, --install/--no-install, and
--deploy/--no-deploy. --model is required only with --autoreviewer. Deployment
requires --install, --aws-profile, and --region.

Warning: source files are uploaded only as the repository's initial seed.
Later local edits are not automatically synchronized to CodeCommit.`;
}
