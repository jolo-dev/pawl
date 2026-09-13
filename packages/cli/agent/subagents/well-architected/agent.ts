import { defineAgent } from "eve";
import { z } from "zod";
import { pawlModelConfig } from "../../lib/bedrock";

/**
 * Structured six-pillar review, replacing the Flue `agents/well-architected.ts`
 * workflow. The zod output schema is the same shape that workflow returned
 * through valibot.
 */
export default defineAgent({
	description:
		"Review a project against the six AWS Well-Architected pillars and report risks with priorities.",
	...pawlModelConfig(),
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
