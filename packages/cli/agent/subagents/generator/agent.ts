import { bedrock } from "@ai-sdk/amazon-bedrock";
import { defineAgent } from "eve";
import { defaultBedrockModelId } from "../../../src/bedrock-models";

/**
 * Writes CDK infrastructure code from an approved plan, in its own context so
 * the root transcript stays readable.
 */
export default defineAgent({
	description: "Generate CDK infrastructure code from an approved pawl plan.",
	model: bedrock(process.env.PAWL_BEDROCK_MODEL ?? defaultBedrockModelId()),
	modelContextWindowTokens: 200_000,
});
