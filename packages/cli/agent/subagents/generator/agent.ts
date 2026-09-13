import { defineAgent } from "eve";
import { PAWL_CONTEXT_WINDOW_TOKENS, pawlModel } from "../../lib/bedrock";

/**
 * Writes CDK infrastructure code from an approved plan, in its own context so
 * the root transcript stays readable.
 */
export default defineAgent({
	description: "Generate CDK infrastructure code from an approved pawl plan.",
	model: pawlModel(),
	modelContextWindowTokens: PAWL_CONTEXT_WINDOW_TOKENS,
});
