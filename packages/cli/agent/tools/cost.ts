import { defineTool } from "eve/tools";
import { z } from "zod";
import { createHostExec, createPawlHarness } from "../../src/host-exec";
import {
	COST_DATA_LIMITATION,
	collectReviewScanContext,
	composeAccountSection,
} from "../../src/infra/review-context";
import { projectDir } from "../../src/project-dir";

export const costInputSchema = z.object({
	scanAccount: z
		.boolean()
		.optional()
		.describe(
			"Read the AWS account and include it in the analysis. Defaults to true. When the account cannot be read the analysis says so and continues from the project's code alone.",
		),
});

/**
 * Cost analysis, with the billing gap stated rather than implied.
 *
 * The account scan shows what exists, which is what cost advice needs, but pawl
 * does not call the Cost Explorer API — so every figure is an estimate from
 * resource configuration and the prompt says so explicitly.
 */
export default defineTool({
	description:
		"Analyze the current project for AWS cost-optimization opportunities, comparing the project's code with the resources actually deployed in the account. Returns estimates derived from resource configuration, not measured spend: pawl has no billing data.",
	inputSchema: costInputSchema,
	async execute({ scanAccount }) {
		const cwd = projectDir();
		const base = await createPawlHarness(cwd).commands.cost();
		const context = await collectReviewScanContext({
			cwd,
			region: process.env.AWS_REGION ?? "us-east-1",
			exec: createHostExec(cwd),
			scanAccount,
		});
		return [
			base,
			"---",
			COST_DATA_LIMITATION,
			composeAccountSection(context),
		].join("\n\n");
	},
});
