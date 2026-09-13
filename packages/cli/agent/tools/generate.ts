import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { createPawlHarness } from "../../src/host-exec";

export default defineTool({
	description:
		"Generate CDK infrastructure code from the approved .pawl/plan.md. Only call this after the user has approved the plan.",
	inputSchema: z.object({}),
	// Writing infrastructure files is the point of no return in the pawl
	// workflow, so it always needs an explicit human decision.
	approval: always(),
	async execute() {
		return createPawlHarness().commands.generate();
	},
});
