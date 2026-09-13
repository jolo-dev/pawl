import { defineTool } from "eve/tools";
import { z } from "zod";
import { createPawlHarness } from "../../src/host-exec";

export default defineTool({
	description:
		"Run an AWS Well-Architected Framework review of the current project across all six pillars.",
	inputSchema: z.object({}),
	async execute() {
		return createPawlHarness().commands.wellArchitected();
	},
});
