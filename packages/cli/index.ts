import { intro, log, outro, select, spinner, text } from "@clack/prompts";
import { parseKnownFiles } from "@smithy/core/config";
import {
	checkBedrockAccess,
	checkCredentials,
	isSSOTokenValid,
	listProfiles,
	ssoLogin,
} from "./src/aws-credentials";
import {
	type BedrockModelGroup,
	listBedrockModelGroups,
} from "./src/bedrock-models";
import {
	printCodeCommitInitResult,
	runCodeCommitInit,
} from "./src/codecommit-init";
import {
	printCodePipelineInitResult,
	runCodePipelineInit,
} from "./src/codepipeline-init";
import { launchEveDev } from "./src/launch";
import {
	installScaffoldDependencies,
	runPawlInit,
	writeScaffoldProject,
} from "./src/scaffold";
import { parseInitArgs } from "./src/scaffold/cli";

const argv = process.argv.slice(2);

// Dispatch codecommit subcommand before generic init
if (argv[0] === "init" && argv[1] === "codecommit") {
	try {
		const result = await runCodeCommitInit({
			argv: argv.slice(2),
			cwd: process.cwd(),
			isTTY: process.stdin.isTTY === true && process.stdout.isTTY === true,
		});
		console.log(printCodeCommitInitResult(result));
		process.exit(0);
	} catch (error: unknown) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

// Dispatch codepipeline subcommand before generic init
if (argv[0] === "init" && argv[1] === "codepipeline") {
	try {
		const result = await runCodePipelineInit({
			argv: argv.slice(2),
			cwd: process.cwd(),
			isTTY: process.stdin.isTTY === true && process.stdout.isTTY === true,
		});
		console.log(printCodePipelineInitResult(result));
		process.exit(0);
	} catch (error: unknown) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

if (argv[0] === "init") {
	const overrides = parseInitArgs(argv);
	const config = await runPawlInit({
		cwd: process.cwd(),
		overrides,
	});
	const written = await writeScaffoldProject(config);
	if (config.installNow) {
		console.log("Installing dependencies...");
		await installScaffoldDependencies(config);
		console.log("Dependencies installed.");
	}
	console.log(
		`Created pawl project "${config.projectName}" in ${config.projectDir} with ${written.length} files.`,
	);
	process.exit(0);
}

intro(
	"🐾 pawl — your AI agent for deploying, reviewing & optimizing cloud infrastructure",
);

// 1. Select AWS profile
const profiles = await listProfiles();
const profile = await select({
	message: "Select an AWS profile",
	options: profiles.map((p) => ({ value: p, label: p })),
});
if (typeof profile !== "string") process.exit(0);

// 2. Check credentials validity
const spin = spinner();
spin.start("Checking credentials...");

const allProfiles = await parseKnownFiles({});
const isSSO = !!allProfiles[profile]?.sso_session;
let valid = false;

if (isSSO) {
	valid = await isSSOTokenValid(profile);
} else {
	try {
		await checkCredentials(profile);
		valid = true;
	} catch {
		valid = false;
	}
}

if (valid) {
	spin.stop("Credentials valid ✓");
} else if (isSSO) {
	spin.stop("SSO token expired, logging in...");
	await ssoLogin(profile);
	log.success("SSO login complete");
} else {
	spin.stop("Credentials invalid for non-SSO profile");
	process.exit(1);
}

process.env.AWS_PROFILE = profile;

// 3. Select model — provider → model → scope, from the live Bedrock catalog
const region = await text({
	message: "AWS region",
	initialValue: allProfiles[profile]?.region || "us-east-1",
	validate: (v) => (!v ? "Region is required" : undefined),
});
if (typeof region !== "string") process.exit(0);
process.env.AWS_REGION = region;

const catalogSpin = spinner();
catalogSpin.start("Loading Bedrock models...");
let groups: BedrockModelGroup[];
try {
	groups = await listBedrockModelGroups(profile, region);
} catch (error: unknown) {
	catalogSpin.stop("Could not list Bedrock models");
	log.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
if (groups.length === 0) {
	catalogSpin.stop("No text models available for this profile/region");
	process.exit(1);
}
catalogSpin.stop(`Found ${groups.length} Bedrock models ✓`);

const BACK = Symbol("back");
const providers = [...new Set(groups.map((g) => g.provider))].sort();

let provider = "";
let modelChoice = "";
let modelId = "";

let step: "provider" | "model" | "scope" = "provider";
while (true) {
	if (step === "provider") {
		const p = await select<string | symbol>({
			message: "Select provider",
			options: providers.map((value) => ({
				value,
				label: value.charAt(0).toUpperCase() + value.slice(1),
			})),
		});
		if (typeof p !== "string") process.exit(0);
		provider = p;
		step = "model";
	} else if (step === "model") {
		const providerModels = groups.filter((g) => g.provider === provider);
		const choice = await select<string | symbol>({
			message: "Select model",
			options: [
				{ value: BACK, label: "← Back" },
				...providerModels.map((g) => ({ value: g.baseId, label: g.name })),
			],
		});
		if (typeof choice === "symbol" && choice === BACK) {
			step = "provider";
			continue;
		}
		if (typeof choice !== "string") process.exit(0);
		modelChoice = choice;
		step = "scope";
	} else {
		const group = groups.find((g) => g.baseId === modelChoice);
		if (!group || group.scopes.length === 0) {
			step = "model";
			continue;
		}
		if (group.scopes.length === 1 && group.scopes[0]) {
			modelId = group.scopes[0];
			break;
		}
		const scope = await select<string | symbol>({
			message: "Select inference profile scope",
			options: [
				{ value: BACK, label: "← Back" },
				...group.scopes.map((id) => ({ value: id, label: id })),
			],
		});
		if (typeof scope === "symbol" && scope === BACK) {
			step = "model";
			continue;
		}
		if (typeof scope !== "string") process.exit(0);
		modelId = scope;
		break;
	}
}

// Verify Bedrock access
const b = spinner();
b.start("Checking Bedrock access...");
const hasBedrock = await checkBedrockAccess(profile, region);
if (hasBedrock) {
	b.stop("Bedrock access confirmed ✓");
} else {
	b.stop("No Bedrock access for this profile/region");
	process.exit(1);
}

outro(
	`Starting eve — profile: ${profile} | region: ${region} | model: ${modelId}`,
);

// 4. Hand off to the eve terminal UI, pinned to the directory pawl was run from
process.exit(
	await launchEveDev({
		profile,
		region,
		modelId,
		projectDir: process.cwd(),
	}),
);
