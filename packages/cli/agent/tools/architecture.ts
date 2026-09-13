import { defineTool } from "eve/tools";
import { z } from "zod";
import { renderPlanDiagram } from "../../src/diagram";
import { createHostExec } from "../../src/host-exec";

export default defineTool({
	description:
		"Render the Mermaid architecture diagram from .pawl/plan.md as ASCII art for the terminal.",
	inputSchema: z.object({}),
	async execute() {
		const cwd = process.cwd();
		return renderPlanDiagram(cwd, createHostExec(cwd));
	},
});
