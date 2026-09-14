import { defineTool } from "eve/tools";
import { z } from "zod";
import {
	buildDeployDecision,
	describeDeployDecision,
	runCdkDiff,
} from "../../src/deploy/diff";
import { createHostExec } from "../../src/host-exec";
import { projectDir } from "../../src/project-dir";

export const deployPreviewInputSchema = z.object({
	stack: z
		.string()
		.optional()
		.describe("CloudFormation stack name. Omit to preview every stack."),
});

/**
 * The read-only half of deploying.
 *
 * It exists as its own tool because the diff has to reach the human *before*
 * they approve: anything computed inside the deploy tool runs after approval,
 * which would leave them agreeing to a change set they never saw.
 */
export default defineTool({
	description:
		"Show what `cdk deploy` would change, as a cdk diff of the synthesized app against the deployed stacks. Read-only: this tool changes nothing. Call it before deploy_infra and show the result to the user, because it is the change set they are being asked to approve.",
	inputSchema: deployPreviewInputSchema,
	async execute({ stack }) {
		const cwd = projectDir();
		const diff = await runCdkDiff({
			cwd,
			exec: createHostExec(cwd),
			stack,
		});
		return describeDeployDecision(buildDeployDecision({ diff, stack }));
	},
});
