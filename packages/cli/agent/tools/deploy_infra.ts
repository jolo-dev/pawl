import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { runCdkDeploy } from "../../src/deploy/diff";
import { createHostExec } from "../../src/host-exec";
import { projectDir } from "../../src/project-dir";

/** Deploy output can run to thousands of lines; keep what the model needs. */
const MAX_OUTPUT_CHARS = 4000;

export const deployInfraInputSchema = z.object({
	stack: z
		.string()
		.optional()
		.describe("CloudFormation stack name. Omit to deploy every stack."),
});

/**
 * The mutating half of deploying, and the first tool in pawl that changes real
 * infrastructure.
 *
 * `always()` is deliberate rather than `once()`: this is not idempotent in the
 * sense a human cares about, and a later call can carry a different change set.
 * Approval happens here, in eve, because the underlying exec has no TTY — cdk's
 * own `--require-approval` prompt would hang the turn, which is why
 * `runCdkDeploy` passes `never`.
 *
 * A policy could skip the prompt when `cdk diff` is empty, but that means
 * shelling out to a full synth while evaluating approval. Deploying nothing is a
 * fast no-op, so the prompt stays unconditional.
 */
export default defineTool({
	description:
		"Deploy the synthesized CDK app to AWS with `cdk deploy`. This changes real infrastructure. Always call deploy_preview first and get the user's agreement to that change set before calling this.",
	inputSchema: deployInfraInputSchema,
	approval: always(),
	async execute({ stack }) {
		const cwd = projectDir();
		const output = await runCdkDeploy({
			cwd,
			exec: createHostExec(cwd),
			stack,
		});
		return {
			stack: stack ?? "all stacks",
			// Tail-biased: the end of cdk output carries the outcome.
			output:
				output.length > MAX_OUTPUT_CHARS
					? `…(truncated)\n${output.slice(-MAX_OUTPUT_CHARS)}`
					: output,
		};
	},
});
