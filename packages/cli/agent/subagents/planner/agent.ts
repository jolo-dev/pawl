import { bedrock } from "@ai-sdk/amazon-bedrock";
import { defineAgent } from "eve";
import { z } from "zod";
import { defaultBedrockModelId } from "../../../src/bedrock-models";

/**
 * Produces the structured infrastructure plan. Declared as a subagent so the
 * planning context — a large codebase scan — stays out of the root transcript
 * and comes back as a typed result.
 */
export default defineAgent({
	description:
		"Turn a codebase scan and user notes into a structured AWS infrastructure plan.",
	model: bedrock(process.env.PAWL_BEDROCK_MODEL ?? defaultBedrockModelId()),
	modelContextWindowTokens: 200_000,
	outputSchema: z.object({
		summary: z.string(),
		services: z.array(
			z.object({ name: z.string(), justification: z.string() }),
		),
		network: z.string(),
		security: z.string(),
		observability: z.string(),
		diagram: z.string(),
		deployment: z.string(),
		filePlan: z.array(z.object({ path: z.string(), purpose: z.string() })),
	}),
});
