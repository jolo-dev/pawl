import { defineAgent } from "eve";
import { pawlModelConfig } from "./lib/bedrock";

/**
 * pawl runs on AWS Bedrock through a direct AI SDK provider instance rather
 * than an AI Gateway model id. See `lib/bedrock.ts` for the credential wiring,
 * the reasoning configuration, and the context-window resolution.
 */
export default defineAgent({
	...pawlModelConfig(),
});
