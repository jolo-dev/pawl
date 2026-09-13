import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import {
	contextWindowForModel,
	DEFAULT_BEDROCK_MODEL_ID,
	splitScope,
} from "../../src/bedrock-models";

/**
 * Reasoning effort pawl asks for. Bedrock maps it per provider.
 */
const REASONING_EFFORT = "medium" as const;

/**
 * pawl's Bedrock model configuration, shared by the root agent and every
 * subagent.
 *
 * Two provider quirks are handled here so the agents stay declarative:
 *
 * 1. `@ai-sdk/amazon-bedrock` does **not** use the AWS SDK credential chain. It
 *    looks only at `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or explicit
 *    options) and otherwise fails SigV4 signing. pawl's whole auth model is
 *    profile-based — the launcher resolves a profile, runs the SSO device flow
 *    if needed, and exports `AWS_PROFILE` — so `fromNodeProviderChain()` is
 *    wired in explicitly. It resolves environment credentials, `~/.aws/config`
 *    profiles, the SSO token cache, web identity, ECS, and IMDS, and is
 *    consulted per request so a refreshed SSO token is picked up live.
 * 2. The generic `reasoning` setting is only translated correctly for Anthropic
 *    models. For anything else the provider emits
 *    `reasoningConfig: { maxReasoningEffort }` without the
 *    `type: "enabled"` Bedrock requires, and the request is rejected with
 *    "maxReasoningEffort is only allowed when type is 'enabled'". Supplying the
 *    complete config as a provider option fixes it, because the provider spreads
 *    authored options over its own value.
 *
 * Model id and context window come from one read of the environment, so the two
 * can never disagree.
 */
export function pawlModelConfig() {
	const region = process.env.AWS_REGION ?? "us-east-1";
	const modelId =
		process.env.PAWL_BEDROCK_MODEL?.trim() || DEFAULT_BEDROCK_MODEL_ID;
	const { baseId } = splitScope(modelId);
	const isAnthropic = baseId.startsWith("anthropic.");

	return {
		model: createAmazonBedrock({
			region,
			credentialProvider: fromNodeProviderChain(),
		})(modelId),
		modelContextWindowTokens: contextWindowForModel(
			modelId,
			process.env.PAWL_CONTEXT_WINDOW_TOKENS,
		),
		reasoning: REASONING_EFFORT,
		...(isAnthropic
			? {}
			: {
					modelOptions: {
						providerOptions: {
							amazonBedrock: {
								reasoningConfig: {
									type: "enabled",
									maxReasoningEffort: REASONING_EFFORT,
								},
							},
						},
					},
				}),
	};
}
