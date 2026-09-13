import { defineAgent } from "eve";
import { pawlModelConfig } from "../../lib/bedrock";

/**
 * Writes CDK infrastructure code from an approved plan, in its own context so
 * the root transcript stays readable.
 */
export default defineAgent({
	description: "Generate CDK infrastructure code from an approved pawl plan.",
	...pawlModelConfig(),
});
