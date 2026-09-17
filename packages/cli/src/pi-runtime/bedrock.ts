import type {
	AssistantMessage,
	Context,
	Model,
	ProviderEnv,
	ThinkingBudgets,
	ThinkingLevel,
} from "@earendil-works/pi-ai";
import { bedrockProviderModule } from "@earendil-works/pi-ai/bedrock-provider";
import { amazonBedrockProvider } from "@earendil-works/pi-ai/providers/amazon-bedrock";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { z } from "zod";
import { BEDROCK_CHAT_CATALOG } from "../bedrock-catalog";
import type { CredentialSnapshot, ExecutionContext } from "./execution-context";

/**
 * Early Bedrock authentication and stream feasibility gate.
 *
 * This module calls the public pi-ai `bedrockProviderModule.stream` directly
 * with a trusted allowlist of options. Checked Task 3 credentials are resolved
 * per request and supplied through non-empty provider-scoped env values, so the
 * SDK's explicit credential object wins over any ambient profile or key. Pi
 * registry auth, login and default stores are never used; `Models.streamSimple`
 * is never called, so no ambient credential resolution or token-budget
 * adjustment happens behind our back.
 */

export type BedrockStreamErrorCode =
	| "unsupported-model"
	| "ambient-credential"
	| "rejected-option";

export class BedrockStreamError extends Error {
	readonly code: BedrockStreamErrorCode;

	constructor(code: BedrockStreamErrorCode, message: string) {
		super(message);
		this.name = "BedrockStreamError";
		this.code = code;
	}
}

/**
 * Cross-region inference-profile scopes Pawl recognises. Mirrors
 * `SCOPES` in `src/bedrock-models.ts`, which is not imported here to keep the
 * runtime import graph free of the Bedrock control-plane client.
 */
const INFERENCE_PROFILE_SCOPES = ["us", "eu", "global", "apac", "jp"] as const;
type ScopePrefix = (typeof INFERENCE_PROFILE_SCOPES)[number];

function splitScope(modelId: string): {
	scope: ScopePrefix | null;
	baseId: string;
} {
	for (const scope of INFERENCE_PROFILE_SCOPES) {
		const prefix = `${scope}.`;
		if (modelId.startsWith(prefix)) {
			return { scope, baseId: modelId.slice(prefix.length) };
		}
	}
	return { scope: null, baseId: modelId };
}

const STANDARD_BEDROCK_RUNTIME_URL =
	/^https:\/\/bedrock-runtime(?:-fips)?\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?\/?$/;

/**
 * Require complete context/output metadata and a standard runtime endpoint.
 * Absent metadata is an actionable unsupported-model result, not a guess.
 */
export function assertCompleteModelMetadata(
	model: Model<"bedrock-converse-stream">,
	selectedId: string,
): Model<"bedrock-converse-stream"> {
	if (!(model.contextWindow > 0) || !(model.maxTokens > 0)) {
		throw new BedrockStreamError(
			"unsupported-model",
			`Model ${selectedId} has no complete context/output metadata; unsupported in this proof`,
		);
	}
	if (model.baseUrl && !STANDARD_BEDROCK_RUNTIME_URL.test(model.baseUrl)) {
		throw new BedrockStreamError(
			"unsupported-model",
			`Model ${selectedId} targets a custom endpoint; custom endpoints are not supported in this proof`,
		);
	}
	return model;
}

/**
 * Resolve the exact selected model id against the live-approved Pawl chat
 * catalog and the installed pi-ai Bedrock provider catalog. Catalog base
 * metadata may be cloned with the exact selected inference-profile id, but
 * invocation must never substitute the base id.
 */
export function resolveApprovedBedrockModel(
	selectedId: string,
	selectedRegion: string,
): Model<"bedrock-converse-stream"> {
	if (typeof selectedId !== "string" || selectedId.trim() === "") {
		throw new BedrockStreamError(
			"unsupported-model",
			"A selected Bedrock model id is required",
		);
	}
	const id = selectedId.trim();
	const arnRegion =
		/^arn:[a-z0-9-]+:bedrock:([a-z0-9-]+):/i.exec(id)?.[1] ?? undefined;
	if (arnRegion !== undefined && arnRegion !== selectedRegion) {
		throw new BedrockStreamError(
			"unsupported-model",
			`Model ${id} is bound to region ${arnRegion}, which conflicts with the selected region ${selectedRegion}`,
		);
	}
	const { baseId } = splitScope(id);
	if (BEDROCK_CHAT_CATALOG[baseId] === undefined) {
		throw new BedrockStreamError(
			"unsupported-model",
			`Model ${id} is not in the Pawl approved chat catalog`,
		);
	}
	const catalog = amazonBedrockProvider().getModels();
	const exact = catalog.find((candidate) => candidate.id === id);
	if (exact) return assertCompleteModelMetadata(exact, id);
	const base = catalog.find((candidate) => candidate.id === baseId);
	if (!base) {
		throw new BedrockStreamError(
			"unsupported-model",
			`Model ${id} has no pi-ai catalog metadata; unsupported in this proof`,
		);
	}
	// Clone the base metadata under the exact selected id; the caller's id is
	// the only id that may be invoked.
	return assertCompleteModelMetadata({ ...base, id }, id);
}

/** Only medium reasoning is proven in this stage. */
export type ApprovedReasoningLevel = "off" | "medium";

export const MEDIUM_THINKING_BUDGET = 8192;

const ADAPTIVE_THINKING_MATCHERS = [
	"opus-4-6",
	"opus-4-7",
	"opus-4-8",
	"opus-5",
	"sonnet-4-6",
	"sonnet-5",
	"fable-5",
] as const;

function adaptiveCandidates(model: { id: string; name: string }): string[] {
	return [model.id, model.name].flatMap((value) => {
		const lower = value.toLowerCase();
		return [lower, lower.replace(/[\s_.:]+/g, "-")];
	});
}

function isClaudeModel(model: { id: string; name: string }): boolean {
	const id = model.id.toLowerCase();
	const name = model.name.toLowerCase();
	return (
		id.includes("anthropic.claude") ||
		id.includes("anthropic/claude") ||
		name.includes("anthropic.claude") ||
		name.includes("anthropic/claude") ||
		name.includes("claude")
	);
}

function isAdaptiveThinkingModel(model: { id: string; name: string }): boolean {
	const candidates = adaptiveCandidates(model);
	return candidates.some((candidate) =>
		ADAPTIVE_THINKING_MATCHERS.some((matcher) => candidate.includes(matcher)),
	);
}

export interface BedrockReasoningPlan {
	readonly reasoning: ThinkingLevel | undefined;
	readonly thinkingBudgets: ThinkingBudgets | undefined;
	/** Nova 2 Lite Converse reasoning configuration; never sent to other families. */
	readonly novaReasoningConfig:
		| { readonly type: "enabled"; readonly maxReasoningEffort: "medium" }
		| undefined;
	/** Explicit output cap, always larger than any thinking budget. */
	readonly maxTokens: number;
}

/**
 * Plan medium reasoning per model family. Unknown reasoning behavior fails
 * closed; it is never guessed from catalog `reasoning: true` alone.
 */
export function planBedrockReasoning(
	model: Model<"bedrock-converse-stream">,
	level: ApprovedReasoningLevel,
): BedrockReasoningPlan {
	if (level === "off") {
		return Object.freeze({
			reasoning: undefined,
			thinkingBudgets: undefined,
			novaReasoningConfig: undefined,
			maxTokens: model.maxTokens,
		});
	}
	const nova = splitScope(model.id).baseId === "amazon.nova-2-lite-v1:0";
	const claude = isClaudeModel(model);
	if (!nova && !claude) {
		throw new BedrockStreamError(
			"unsupported-model",
			`Reasoning behavior is unknown for ${model.id}; refusing to guess from catalog metadata`,
		);
	}
	if (nova) {
		return Object.freeze({
			reasoning: undefined,
			thinkingBudgets: undefined,
			novaReasoningConfig: Object.freeze({
				type: "enabled" as const,
				maxReasoningEffort: "medium" as const,
			}),
			maxTokens: model.maxTokens,
		});
	}
	if (isAdaptiveThinkingModel(model)) {
		return Object.freeze({
			reasoning: "medium" as const,
			thinkingBudgets: undefined,
			novaReasoningConfig: undefined,
			maxTokens: model.maxTokens,
		});
	}
	if (!(model.maxTokens > MEDIUM_THINKING_BUDGET)) {
		throw new BedrockStreamError(
			"unsupported-model",
			`Claude medium reasoning needs an output cap above the ${MEDIUM_THINKING_BUDGET}-token thinking budget; ${model.id} caps output at ${model.maxTokens} tokens, so this combination is unsupported`,
		);
	}
	return Object.freeze({
		reasoning: "medium" as const,
		thinkingBudgets: Object.freeze({ medium: MEDIUM_THINKING_BUDGET }),
		novaReasoningConfig: undefined,
		maxTokens: model.maxTokens,
	});
}

// Deliberately not strict: the payload also carries messages, system and
// tool config. Only model identity and the absence of provider-specific
// reasoning fields are verified here.
const payloadModelSchema = (exactId: string) =>
	z.object({
		modelId: z.literal(exactId),
		additionalModelRequestFields: z.undefined(),
	});

const claudeAdaptiveFieldsSchema = z.object({
	thinking: z.object({ type: z.literal("adaptive") }),
	output_config: z.object({ effort: z.literal("medium") }),
});

const claudeBudgetFieldsSchema = z.object({
	thinking: z.object({
		type: z.literal("enabled"),
		budget_tokens: z.literal(MEDIUM_THINKING_BUDGET),
	}),
});

/**
 * Schema-checked payload hook. It verifies request shape and model identity
 * only — signing identity is proven by the checked snapshot plus the observed
 * SDK credential configuration. Nova receives only the Nova reasoningConfig
 * mapping; Claude keeps Pi's family-aware anthropic fields.
 */
function payloadGuard(exactId: string, plan: BedrockReasoningPlan) {
	const baseSchema = z.object({ modelId: z.literal(exactId) });
	return (payload: unknown): unknown | undefined => {
		if (!baseSchema.safeParse(payload).success) {
			throw new BedrockStreamError(
				"unsupported-model",
				`Bedrock request payload did not carry the exact selected model id ${exactId}`,
			);
		}
		if (plan.novaReasoningConfig) {
			if (!payloadModelSchema(exactId).safeParse(payload).success) {
				throw new BedrockStreamError(
					"unsupported-model",
					`Nova request payload must not carry provider-specific reasoning fields for ${exactId}`,
				);
			}
			return {
				...(payload as Record<string, unknown>),
				additionalModelRequestFields: {
					reasoningConfig: { ...plan.novaReasoningConfig },
				},
			};
		}
		if (plan.reasoning !== undefined) {
			const fields = (payload as { additionalModelRequestFields?: unknown })
				.additionalModelRequestFields;
			const verified =
				plan.thinkingBudgets === undefined
					? claudeAdaptiveFieldsSchema.safeParse(fields)
					: claudeBudgetFieldsSchema.safeParse(fields);
			if (!verified.success) {
				throw new BedrockStreamError(
					"unsupported-model",
					`Pi's Claude reasoning mapping did not match the approved medium plan for ${exactId}`,
				);
			}
		}
		return undefined;
	};
}

function ambientNonEmpty(name: string): string | undefined {
	const value = process.env[name];
	return value !== undefined && value.trim() !== "" ? value : undefined;
}

/** Fail closed before calling the provider. Empty overrides are not a fix:
 * the installed scoped-env lookup falls through to process.env on empty. */
function assertAmbientCredentialsSafe(snapshot: CredentialSnapshot): void {
	if (ambientNonEmpty("AWS_BEARER_TOKEN_BEDROCK")) {
		throw new BedrockStreamError(
			"ambient-credential",
			"A non-empty ambient AWS_BEARER_TOKEN_BEDROCK exists; bearer authentication is not part of this proof",
		);
	}
	if (
		snapshot.sessionToken === undefined &&
		ambientNonEmpty("AWS_SESSION_TOKEN")
	) {
		throw new BedrockStreamError(
			"ambient-credential",
			"Selected credentials have no session token while an ambient AWS_SESSION_TOKEN exists; refusing to mix credential sources",
		);
	}
	// Verified installed behavior: the SDK client built by pi's provider honors
	// ambient endpoint environment variables at request time even with explicit
	// credentials and region. Such redirection is a custom endpoint.
	for (const name of [
		"AWS_ENDPOINT_URL",
		"AWS_ENDPOINT_URL_BEDROCK_RUNTIME",
		"AWS_ENDPOINT_URL_BEDROCK",
	]) {
		if (ambientNonEmpty(name)) {
			throw new BedrockStreamError(
				"ambient-credential",
				`A non-empty ambient ${name} would redirect Bedrock requests away from the standard regional endpoint; custom endpoints are not supported in this proof`,
			);
		}
	}
}

function buildScopedEnv(
	snapshot: CredentialSnapshot,
	selectedRegion: string,
): ProviderEnv {
	const env: Record<string, string> = {
		AWS_ACCESS_KEY_ID: snapshot.accessKeyId,
		AWS_SECRET_ACCESS_KEY: snapshot.secretAccessKey,
		AWS_REGION: selectedRegion,
		AWS_DEFAULT_REGION: selectedRegion,
		// The selected profile was already resolved and checked by the execution
		// context; re-supplying it would re-enable independent SDK resolution.
		AWS_BEDROCK_SKIP_AUTH: "0",
	};
	if (snapshot.sessionToken !== undefined) {
		env.AWS_SESSION_TOKEN = snapshot.sessionToken;
	}
	for (const [name, value] of Object.entries(env)) {
		if (value === "") {
			throw new BedrockStreamError(
				"ambient-credential",
				`Scoped ${name} is empty and would fall through to an ambient value`,
			);
		}
	}
	return Object.freeze(env);
}

function failureMessage(
	modelId: string,
	cause: string,
	stopReason: "error" | "aborted",
): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "bedrock-converse-stream",
		provider: "amazon-bedrock",
		model: modelId,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason,
		errorMessage: cause,
		timestamp: Date.now(),
	};
}

const callerOptionsSchema = z.strictObject({
	signal: z.instanceof(AbortSignal).optional(),
});

export interface BedrockModelStreamOptions {
	readonly signal?: AbortSignal | undefined;
}

export type BedrockModelStreamFn = (
	model: Model<"bedrock-converse-stream">,
	context: Context,
	options?: BedrockModelStreamOptions,
) => ReturnType<typeof createAssistantMessageEventStream>;

export interface CreateBedrockModelStreamOptions {
	readonly reasoning?: ApprovedReasoningLevel;
}

/**
 * Build the controlled Bedrock stream function for one execution context.
 *
 * Every request: revalidate the caller options, resolve the exact approved
 * model, obtain a freshly checked credential snapshot, fail closed on ambient
 * bearer/session-token conflicts, and stream through the public provider
 * module with only trusted options. Preparation failures are encoded as a
 * final assistant message on an AssistantMessageEventStream; the returned
 * stream never rejects, and no failed model request is retried here.
 */
export function createBedrockModelStream(
	context: ExecutionContext,
	options: CreateBedrockModelStreamOptions = {},
): BedrockModelStreamFn {
	const reasoningLevel: ApprovedReasoningLevel = options.reasoning ?? "off";
	const streamFn: BedrockModelStreamFn = (model, piContext, callerOptions) => {
		const stream = createAssistantMessageEventStream();
		let signal: AbortSignal | undefined;
		let callerSignal: AbortSignal | undefined;
		void (async () => {
			try {
				const caller = callerOptionsSchema.safeParse(callerOptions ?? {});
				if (!caller.success) {
					throw new BedrockStreamError(
						"rejected-option",
						`Caller supplied uncontrolled Bedrock stream options (${Object.keys(callerOptions ?? {}).join(", ")}); only an abort signal is accepted`,
					);
				}
				signal = AbortSignal.any(
					caller.data.signal
						? [context.signal, caller.data.signal]
						: [context.signal],
				);
				callerSignal = caller.data.signal;
				signal.throwIfAborted();
				const approved = resolveApprovedBedrockModel(model.id, context.region);
				if (
					model.baseUrl &&
					!STANDARD_BEDROCK_RUNTIME_URL.test(model.baseUrl)
				) {
					throw new BedrockStreamError(
						"rejected-option",
						`Caller supplied a custom endpoint for ${model.id}; custom endpoints are not supported in this proof`,
					);
				}
				const plan = planBedrockReasoning(approved, reasoningLevel);
				const snapshot = await context.checkedCredentials(signal);
				assertAmbientCredentialsSafe(snapshot);
				const upstream = bedrockProviderModule.stream(approved, piContext, {
					region: context.region,
					env: buildScopedEnv(snapshot, context.region),
					signal,
					maxTokens: plan.maxTokens,
					...(plan.reasoning === undefined
						? {}
						: { reasoning: plan.reasoning }),
					...(plan.thinkingBudgets === undefined
						? {}
						: { thinkingBudgets: plan.thinkingBudgets }),
					onPayload: payloadGuard(approved.id, plan),
				});
				for await (const event of upstream) {
					stream.push(event);
				}
				stream.end();
			} catch (error) {
				const cause = error instanceof Error ? error.message : String(error);
				// Only a caller cancellation is an abort. Context invalidation (for
				// example an identity change) is an error the message explains.
				const stopReason = callerSignal?.aborted ? "aborted" : "error";
				stream.push({
					type: "error",
					reason: stopReason,
					error: failureMessage(model.id, cause, stopReason),
				});
				stream.end();
			}
		})();
		return stream;
	};
	return Object.freeze(streamFn);
}
