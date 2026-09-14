import { defineTool } from "eve/tools";
import { z } from "zod";
import { createHostExec, createPawlHarness } from "../../src/host-exec";
import {
	collectReviewScanContext,
	composeAccountSection,
} from "../../src/infra/review-context";
import { projectDir } from "../../src/project-dir";

export const wellArchitectedInputSchema = z.object({
	scanAccount: z
		.boolean()
		.optional()
		.describe(
			"Read the AWS account and include it in the review. Defaults to true. When the account cannot be read the review says so and continues from the project's code alone.",
		),
});

/**
 * Six-pillar review, now able to observe the account.
 *
 * Before this, the review loaded a prompt file and gathered nothing, so its
 * findings were inferences about a codebase rather than observations about
 * deployed resources.
 */
export default defineTool({
	description:
		"Run an AWS Well-Architected Framework review of the current project across all six pillars, comparing the project's code with the resources actually deployed in the account. Reports which services the scan could not read, because a partial read is never a clean bill of health.",
	inputSchema: wellArchitectedInputSchema,
	async execute({ scanAccount }) {
		const cwd = projectDir();
		const base = await createPawlHarness(cwd).commands.wellArchitected();
		const context = await collectReviewScanContext({
			cwd,
			region: process.env.AWS_REGION ?? "us-east-1",
			exec: createHostExec(cwd),
			scanAccount,
		});
		return `${base}\n\n---\n\n${composeAccountSection(context)}`;
	},
});
