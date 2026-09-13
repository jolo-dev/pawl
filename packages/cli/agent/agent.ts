import { bedrock } from "@ai-sdk/amazon-bedrock";
import { defineAgent } from "eve";
import { defaultBedrockModelId } from "../src/bedrock-models";

/**
 * pawl runs on AWS Bedrock, so the model is a direct AI SDK provider instance
 * rather than an AI Gateway id.
 *
 * The launcher resolves `PAWL_BEDROCK_MODEL` from the interactive picker and
 * passes it through the environment. The fallback keeps `eve dev` usable on
 * its own, using the same region-aware inference-profile prefix the picker
 * would have produced.
 *
 * Bedrock models are not in the AI Gateway catalog, so eve cannot look the
 * context window up and we must set it explicitly.
 */
export default defineAgent({
	model: bedrock(process.env.PAWL_BEDROCK_MODEL ?? defaultBedrockModelId()),
	modelContextWindowTokens: 200_000,
	reasoning: "medium",
});
