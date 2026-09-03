import { createAwsCodeCommitService } from "@pawl/codecommit";
import { runCodeCommitRepositoriesCommand } from "./src/codecommit-repositories/entrypoint";

const argv = process.argv.slice(2);

if (argv[0] === "codecommit" && argv[1] === "repositories") {
	const exitCode = await runCodeCommitRepositoriesCommand({
		argv: argv.slice(2),
		service: createAwsCodeCommitService(),
		stderr: (message) => console.error(message),
		stdout: (message) => console.log(message),
	});
	process.exit(exitCode);
}

// Dispatch codecommit subcommand before generic init
if (argv[0] === "init" && argv[1] === "codecommit") {
	try {
		const { printCodeCommitInitResult, runCodeCommitInit } = await import(
			"./src/codecommit-init"
		);
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
		const { printCodePipelineInitResult, runCodePipelineInit } = await import(
			"./src/codepipeline-init"
		);
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
	const { installScaffoldDependencies, runPawlInit, writeScaffoldProject } =
		await import("./src/scaffold");
	const { parseInitArgs } = await import("./src/scaffold/cli");
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

const { intro, log, outro, select, spinner, text } = await import(
	"@clack/prompts"
);
const { getModels } = await import("@earendil-works/pi-ai");
const { parseKnownFiles } = await import("@smithy/shared-ini-file-loader");
const {
	checkBedrockAccess,
	checkCredentials,
	isSSOTokenValid,
	listProfiles,
	ssoLogin,
} = await import("./src/aws-credentials");
const { startAgent } = await import("./src/infra-agent");

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

// 3. Select model — provider → model → scope → region
const allModels = getModels("amazon-bedrock");

// Group models by base name: strip us./eu./global. prefix to find variants
type Scope = "us" | "eu" | "global" | "amazon" | "base";

type ModelEntry = (typeof allModels)[number];
interface ModelGroup {
	baseName: string;
	provider: string;
	variants: Map<Scope, ModelEntry>;
}

const groups = new Map<string, ModelGroup>();
for (const m of allModels) {
	let scope: Scope | null = null;
	let baseId = m.id;
	for (const p of ["us.", "eu.", "global."]) {
		if (m.id.startsWith(p)) {
			scope = p.slice(0, -1) as Scope;
			baseId = m.id.slice(p.length);
			break;
		}
	}
	if (!scope && m.id.startsWith("amazon.")) {
		scope = "amazon";
		baseId = m.id;
	}
	if (!scope) scope = "base";

	const prov = baseId.split(".")[0];
	if (!groups.has(baseId) && prov) {
		groups.set(baseId, {
			baseName: m.name.replace(/ \((US|EU|Global)\)$/, ""),
			provider: prov,
			variants: new Map(),
		});
	}
	const group = groups.get(baseId);
	if (group) group.variants.set(scope, m);
}

// Build provider list
const BACK = Symbol("back");
const providers = [
	...new Set([...groups.values()].map((g) => g.provider)),
].sort();

let provider = "";
let modelChoice = "";
let scope: Scope = "base";

let step: "provider" | "model" | "scope" = "provider";
while (true) {
	if (step === "provider") {
		const p = await select({
			message: "Select provider",
			options: providers.map((p) => ({
				value: p,
				label: p.charAt(0).toUpperCase() + p.slice(1),
			})),
		});
		if (typeof p !== "string") process.exit(0);
		provider = p;
		step = "model";
	} else if (step === "model") {
		const providerModels = [...groups.entries()].filter(
			([, g]) => g.provider === provider,
		);
		const mc = await select<string | symbol>({
			message: "Select model",
			options: [
				{ value: BACK, label: "← Back" },
				...providerModels.map(([baseId, g]) => ({
					value: baseId,
					label: `${g.baseName} — ${[...g.variants.keys()].join(", ")}`,
				})),
			],
		});
		if (typeof mc === "symbol" && mc === BACK) {
			step = "provider";
			continue;
		}
		if (typeof mc !== "string") process.exit(0);
		modelChoice = mc;
		step = "scope";
	} else {
		const group = groups.get(modelChoice);
		if (!group) {
			step = "model";
			continue;
		}
		const scopes = [...group.variants.keys()];
		if (scopes.length === 1 && scopes[0]) {
			scope = scopes[0];
			break;
		}
		const sc = await select<string | symbol>({
			message: "Select scope",
			options: [
				{ value: BACK, label: "← Back" },
				...scopes.map((s) => ({ value: s as string, label: s.toUpperCase() })),
			],
		});
		if (typeof sc === "symbol" && sc === BACK) {
			step = "model";
			continue;
		}
		if (typeof sc !== "string") process.exit(0);
		scope = sc as Scope;
		break;
	}
}

// Pick region
const region = await text({
	message: "AWS region",
	initialValue: allProfiles[profile]?.region || "us-east-1",
	validate: (v) => (!v ? "Region is required" : undefined),
});
if (typeof region !== "string") process.exit(0);
process.env.AWS_REGION = region;

// Patch all base model IDs with region-appropriate inference profile prefix
const regionPrefix = region.startsWith("eu-")
	? "eu."
	: region.startsWith("ap-")
		? "ap."
		: "us.";
for (const m of allModels) {
	if (
		!m.id.startsWith("us.") &&
		!m.id.startsWith("eu.") &&
		!m.id.startsWith("global.")
	) {
		m.id = `${regionPrefix}${m.id}`;
	}
}

const model = groups.get(modelChoice)?.variants.get(scope);
if (!model) {
	log.error("Could not resolve model");
	process.exit(1);
}

// Verify Bedrock access
const b = spinner();
b.start("Checking Bedrock access...");
const hasBedrock = await checkBedrockAccess(profile);
if (hasBedrock) {
	b.stop("Bedrock access confirmed ✓");
} else {
	b.stop("No Bedrock access for this profile/region");
	process.exit(1);
}

outro(
	`Starting — profile: ${profile} | region: ${region} | model: ${model.name} (${model.id})`,
);

// 6. Start pi-coding-agent interactive TUI
await startAgent(
	model,
	`[pawl-cli] Connected — profile: ${profile} | region: ${region} | model: ${model.name}`,
);
