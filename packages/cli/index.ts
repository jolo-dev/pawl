import { intro, log, outro, select, spinner, text } from "@clack/prompts";
import { getModels } from "@mariozechner/pi-ai";
import {
	AuthStorage,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	InteractiveMode,
	ModelRegistry,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import { parseKnownFiles } from "@smithy/shared-ini-file-loader";
import {
	checkBedrockAccess,
	checkCredentials,
	isSSOTokenValid,
	listProfiles,
	ssoLogin,
} from "./src/aws-credentials";

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

	const prov = baseId.split(".")[0]!;
	if (!groups.has(baseId)) {
		groups.set(baseId, {
			baseName: m.name.replace(/ \((US|EU|Global)\)$/, ""),
			provider: prov,
			variants: new Map(),
		});
	}
	groups.get(baseId)!.variants.set(scope, m);
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
		const group = groups.get(modelChoice)!;
		const scopes = [...group.variants.keys()];
		if (scopes.length === 1) {
			scope = scopes[0]!;
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
const regionPrefix = region.startsWith("eu-") ? "eu." : region.startsWith("ap-") ? "ap." : "us.";
for (const m of allModels) {
	if (!m.id.startsWith("us.") && !m.id.startsWith("eu.") && !m.id.startsWith("global.")) {
		m.id = `${regionPrefix}${m.id}`;
	}
}

const model = groups.get(modelChoice)!.variants.get(scope)!;

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
const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);

const createRuntime: CreateAgentSessionRuntimeFactory = async ({
	cwd,
	sessionManager,
	sessionStartEvent,
}) => {
	const services = await createAgentSessionServices({ cwd });
	return {
		...(await createAgentSessionFromServices({
			services,
			sessionManager,
			sessionStartEvent,
			model,
			authStorage,
			modelRegistry,
		})),
		services,
		diagnostics: services.diagnostics,
	};
};

const runtime = await createAgentSessionRuntime(createRuntime, {
	cwd: process.cwd(),
	agentDir: getAgentDir(),
	sessionManager: SessionManager.create(process.cwd()),
});

const mode = new InteractiveMode(runtime, {
	initialMessage: `[pawl-cli] Connected — profile: ${profile} | region: ${region} | model: ${model.name}`,
});
await mode.run();
