import { defineTool } from "eve/tools";
import { z } from "zod";
import { createPawlHarness } from "../../src/host-exec";

export default defineTool({
	description:
		"Analyze the current project and produce an AWS infrastructure plan. This is the first phase of the pawl workflow: always call it before generating infrastructure code, and wait for the user to approve the plan before calling generate.",
	inputSchema: z.object({
		notes: z
			.string()
			.optional()
			.describe("Extra requirements from the user to fold into the plan."),
	}),
	async execute({ notes }) {
		return createPawlHarness().commands.plan(notes);
	},
});
