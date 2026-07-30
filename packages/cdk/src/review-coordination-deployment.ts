import { z } from "zod";

/**
 * Migration-safe deployment phases for adding CodePipeline review
 * coordination to an existing DynamoDB state table.
 *
 * ## Phased migration (existing tables with data)
 *
 * Deploy phases in strict order. **Wait until the previous index reports
 * `ACTIVE`** before deploying the next phase. DynamoDB index backfill can
 * take minutes to hours depending on table size.
 *
 *   1. `prepareGsi1`  — creates GSI1 on the state table
 *      → Wait until GSI1 is ACTIVE before deploying prepareGsi2.
 *   2. `prepareGsi2`  — creates GSI2 on the state table
 *      → Wait until GSI2 is ACTIVE before deploying active.
 *   3. `active`       — activates the bridge, reconciler, and pipeline
 *                        variables that drive in-pipeline AI review
 *
 * ## Fresh stacks (no existing table)
 *
 * When deploying against a new stack with no existing data, the phased
 * migration is unnecessary. **Deploy `active` directly** — all indexes
 * are created in a single CloudFormation operation with no backfill risk.
 *
 * ## Background
 *
 * The nested prep flow (`prepareGsi1` → `prepareGsi2`) provisions indexes
 * without creating any runtime resources. This lets CloudFormation
 * complete potentially long index-backfill operations before the active
 * phase deploys the bridge Lambda and pipeline actions that depend on
 * those indexes.
 */
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
