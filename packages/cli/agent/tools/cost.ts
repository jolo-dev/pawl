import { defineTool } from "eve/tools";
import { z } from "zod";
import { createPawlHarness } from "../../src/host-exec";

export default defineTool({
	description:
		"Analyze the current project for AWS cost-optimization opportunities and return concrete recommendations.",
	inputSchema: z.object({}),
	async execute() {
		return createPawlHarness().commands.cost();
	},
});
