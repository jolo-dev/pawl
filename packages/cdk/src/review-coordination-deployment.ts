import { z } from "zod";

/** Safe deployment phases for adding CodePipeline review coordination. */
export const ReviewCoordinationDeploymentPhaseSchema = z.enum([
	"prepareGsi1",
	"prepareGsi2",
	"active",
]);

export type ReviewCoordinationDeploymentPhase = z.infer<
	typeof ReviewCoordinationDeploymentPhaseSchema
>;

/**
 * State-table preparation and runtime activation for review coordination.
 *
 * Preparation phases intentionally cannot carry runtime configuration. Only
 * the active phase creates the bridge and reconciler runtime resources.
 */
export const ReviewCoordinationDeploymentSchema = z.discriminatedUnion(
	"phase",
	[
		z.object({ phase: z.literal("prepareGsi1") }).strict(),
		z.object({ phase: z.literal("prepareGsi2") }).strict(),
		z
			.object({
				phase: z.literal("active"),
				reviewActionTimeoutMinutes: z.number().int().min(5).max(1_380),
			})
			.strict(),
	],
);

export type ReviewCoordinationDeployment = Readonly<
	z.infer<typeof ReviewCoordinationDeploymentSchema>
>;
