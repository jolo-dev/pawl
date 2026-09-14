import { defineAgent } from "eve";
import { z } from "zod";
import { pawlModelConfig } from "../../lib/bedrock";

/**
 * Ranks the candidate constructs a resource scan produced.
 *
 * The deterministic rules in `src/infra/suggestions.ts` already decided *what*
 * could move onto pawl; this subagent decides what is *worth* doing and says
 * why. Findings are grouped by construct because the user acts per construct,
 * not per resource.
 */
export default defineAgent({
	description:
		"Rank and explain which deployed AWS resources should move onto pawl constructs, given a resource scan report.",
	...pawlModelConfig(),
	outputSchema: z.object({
		findings: z.array(
			z.object({
				construct: z.string(),
				resourceKind: z.string(),
				/** Every resource this finding covers, so the user can find them. */
				resourceNames: z.array(z.string()),
				/** True when the project already declares these resources. */
				declaredInProject: z.boolean(),
				rationale: z.string(),
				effort: z.enum(["low", "medium", "high"]),
				risk: z.enum(["low", "medium", "high"]),
				caveat: z.string().optional(),
			}),
		),
		/**
		 * Set when the scan did not read every service. Required by the instructions
		 * whenever coverage is incomplete, so a partial read is never summarised as
		 * a clean account.
		 */
		coverageWarning: z.string().optional(),
		/** Set when the scan reported drift the user should see before migrating. */
		driftNote: z.string().optional(),
	}),
});
