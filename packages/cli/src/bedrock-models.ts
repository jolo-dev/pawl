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
const SCOPES = ["us", "eu", "global", "apac"] as const;

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
