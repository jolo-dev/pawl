import { defineAgent } from "eve";
import { PAWL_CONTEXT_WINDOW_TOKENS, pawlModel } from "./lib/bedrock";

/**
 * pawl runs on AWS Bedrock through a direct AI SDK provider instance rather
 * than an AI Gateway model id. See `lib/bedrock.ts` for the credential wiring.
 *
 * Bedrock models are not in the AI Gateway catalog, so eve cannot look the
 * context window up and we must set it explicitly.
 */
export default defineAgent({
	model: pawlModel(),
	modelContextWindowTokens: PAWL_CONTEXT_WINDOW_TOKENS,
	reasoning: "medium",
});
