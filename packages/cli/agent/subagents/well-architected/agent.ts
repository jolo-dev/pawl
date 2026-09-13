import { bedrock } from "@ai-sdk/amazon-bedrock";
import { defineAgent } from "eve";
import { z } from "zod";
import { defaultBedrockModelId } from "../../../src/bedrock-models";

/**
 * Structured six-pillar review, replacing the Flue `agents/well-architected.ts`
 * workflow. The zod output schema is the same shape that workflow returned
 * through valibot.
 */
export default defineAgent({
	description:
		"Review a project against the six AWS Well-Architected pillars and report risks with priorities.",
	model: bedrock(process.env.PAWL_BEDROCK_MODEL ?? defaultBedrockModelId()),
	modelContextWindowTokens: 200_000,
	outputSchema: z.object({
		pillars: z.array(
			z.object({
				pillar: z.string(),
				currentState: z.string(),
				risks: z.array(z.string()),
				recommendations: z.array(
					z.object({
						text: z.string(),
						priority: z.enum(["high", "medium", "low"]),
					}),
				),
			}),
		),
	}),
});
