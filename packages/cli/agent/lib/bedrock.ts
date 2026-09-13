import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { defaultBedrockModelId } from "../../src/bedrock-models";

/**
 * pawl's Bedrock model, shared by the root agent and every subagent.
 *
 * `@ai-sdk/amazon-bedrock` does **not** use the AWS SDK credential chain: it
 * looks only at `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or explicit
 * options) and otherwise fails SigV4 signing. pawl's whole auth model is
 * profile-based — the launcher resolves a profile, runs the SSO device flow if
 * needed, and exports `AWS_PROFILE` — so the chain has to be wired in
 * explicitly.
 *
 * `fromNodeProviderChain()` resolves environment credentials, `~/.aws/config`
 * profiles, the SSO token cache, web identity, ECS, and IMDS. It is consulted
 * per request, so a refreshed SSO token is picked up without a restart.
 *
 * Region and model id come from the launcher. The fallbacks keep a bare
 * `eve dev` usable on its own.
 */
export function pawlModel() {
	const region = process.env.AWS_REGION ?? "us-east-1";
	const modelId =
		process.env.PAWL_BEDROCK_MODEL ?? defaultBedrockModelId(region);

	return createAmazonBedrock({
		region,
		credentialProvider: fromNodeProviderChain(),
	})(modelId);
}

/** Context window override; Bedrock models are not in the AI Gateway catalog. */
export const PAWL_CONTEXT_WINDOW_TOKENS = 200_000;
