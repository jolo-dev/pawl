import {
	BedrockClient,
	ListFoundationModelsCommand,
	ListInferenceProfilesCommand,
} from "@aws-sdk/client-bedrock";
import { fromIni } from "@aws-sdk/credential-providers";

/** Minimal shape the picker needs from a Bedrock foundation model. */
export interface FoundationModelLike {
	modelId?: string | undefined;
	modelName?: string | undefined;
	providerName?: string | undefined;
	inputModalities?: string[] | undefined;
	outputModalities?: string[] | undefined;
}

/** Minimal shape the picker needs from a Bedrock inference profile. */
export interface InferenceProfileLike {
	inferenceProfileId?: string | undefined;
}

export interface BedrockModelGroup {
	/** Foundation model id without any inference-profile prefix. */
	baseId: string;
	/** Provider slug, e.g. `anthropic`. */
	provider: string;
	/** Human-readable model name. */
	name: string;
	/**
	 * Selectable model ids for this base model: every inference profile that
	 * targets it, or the bare base id when the model needs no profile.
	 */
	scopes: string[];
}

/** Cross-region inference-profile prefixes recognised by Bedrock. */
const SCOPES = ["us", "eu", "global", "apac", "jp"] as const;

/**
 * Default model for runs that skip the launcher.
 *
 * The launcher normally sets `PAWL_BEDROCK_MODEL` from the live catalog. This
 * keeps a bare `eve dev` runnable. It is a literal inference-profile id rather
 * than a region-derived one: the available prefixes differ per model (Nova 2
 * Lite, for example, has no `apac.` profile), so deriving a prefix from the
 * region can produce an id Bedrock does not offer.
 */
export const DEFAULT_BEDROCK_MODEL_ID = "eu.amazon.nova-2-lite-v1:0";

/**
 * Context window for a model, in tokens.
 *
 * Bedrock models are not in the AI Gateway catalog, so eve cannot look this up
 * and guessing high is dangerous: eve compacts at 90% of this number, so an
 * over-estimate lets a turn overflow the provider. Unknown models therefore
 * fall back to the smallest window we ship support for. `PAWL_CONTEXT_WINDOW_TOKENS`
 * overrides it for models we have never seen.
 */
const CONTEXT_WINDOWS: Record<string, number> = {
	"amazon.nova-2-lite-v1:0": 1_000_000,
	"anthropic.claude-opus-4-8": 200_000,
	"anthropic.claude-sonnet-4-6": 200_000,
	"anthropic.claude-haiku-4-5": 200_000,
};

const CONTEXT_WINDOW_FALLBACK = 200_000;

/** Resolve the context window for a model id, honouring an explicit override. */
export function contextWindowForModel(
	modelId: string,
	override?: string,
): number {
	const explicit = override?.trim();
	if (explicit) {
		const parsed = Number(explicit);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	const { baseId } = splitScope(modelId);
	return CONTEXT_WINDOWS[baseId] ?? CONTEXT_WINDOW_FALLBACK;
}

/** Strip a leading `<scope>.` inference-profile prefix, returning the scope. */
export function splitScope(modelId: string): {
	scope: string | null;
	baseId: string;
} {
	for (const scope of SCOPES) {
		const prefix = `${scope}.`;
		if (modelId.startsWith(prefix)) {
			return { scope, baseId: modelId.slice(prefix.length) };
		}
	}
	return { scope: null, baseId: modelId };
}

/**
 * Group foundation models with the inference profiles that expose them.
 *
 * Text-output filtering matches what the launcher previously took from pi-ai's
 * `amazon-bedrock` catalog.
 */
export function groupBedrockModels(
	models: FoundationModelLike[],
	profiles: InferenceProfileLike[],
): BedrockModelGroup[] {
	const scopesByBase = new Map<string, string[]>();
	for (const profile of profiles) {
		const id = profile.inferenceProfileId;
		if (!id) continue;
		const { baseId } = splitScope(id);
		const scopes = scopesByBase.get(baseId) ?? [];
		scopes.push(id);
		scopesByBase.set(baseId, scopes);
	}

	const groups: BedrockModelGroup[] = [];
	for (const model of models) {
		const baseId = model.modelId;
		if (!baseId) continue;
		const outputs = model.outputModalities ?? [];
		if (!outputs.includes("TEXT")) continue;
		const provider = baseId.split(".")[0] ?? "unknown";
		const scopes = scopesByBase.get(baseId);
		groups.push({
			baseId,
			provider,
			name: model.modelName ?? baseId,
			scopes: scopes && scopes.length > 0 ? scopes : [baseId],
		});
	}
	return groups.sort((a, b) => a.baseId.localeCompare(b.baseId));
}

/**
 * Anthropic Claude families pawl offers in its picker.
 *
 * A static list rather than a live Bedrock catalog: `promptModelId` runs
 * during `codecommit-init` before an AWS profile or region is committed, so
 * Bedrock cannot be queried yet. Users can still enter any id that
 * `AnthropicModelIdSchema` accepts.
 */
export const ANTHROPIC_CLAUDE_FAMILIES = [
	{ baseId: "anthropic.claude-opus-4-8", label: "Claude Opus 4.8" },
	{ baseId: "anthropic.claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
	{ baseId: "anthropic.claude-haiku-4-5", label: "Claude Haiku 4.5" },
] as const;

/** Cross-region inference-profile prefixes a Claude family can be invoked through. */
export const INFERENCE_PROFILE_SCOPES = ["us", "eu", "apac", "global"] as const;

/** Build the full model id for a family invoked through a cross-region profile. */
export function inferenceProfileModelId(
	familyBaseId: string,
	scope: string,
): string {
	return `${scope}.${familyBaseId}`;
}

/** Fetch and group the Bedrock catalog for a profile/region. */
export async function listBedrockModelGroups(
	profile: string,
	region: string,
): Promise<BedrockModelGroup[]> {
	const client = new BedrockClient({
		profile,
		region,
		credentials: fromIni({ profile }),
	});
	const [models, profiles] = await Promise.all([
		client.send(new ListFoundationModelsCommand({ byOutputModality: "TEXT" })),
		client.send(new ListInferenceProfilesCommand({})).catch(() => ({
			inferenceProfileSummaries: [],
		})),
	]);
	return groupBedrockModels(
		models.modelSummaries ?? [],
		profiles.inferenceProfileSummaries ?? [],
	);
}
