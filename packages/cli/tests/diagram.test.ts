import { describe, expect, test } from "bun:test";
import {
	extractAllMermaidCode,
	extractMermaidCode,
	renderPlanDiagram,
} from "../src/diagram";

describe("extractMermaidCode", () => {
	test("extracts single mermaid block", () => {
		const content = `\`\`\`mermaid\ngraph TD\n  A --> B\n\`\`\``;
		const result = extractMermaidCode(content);
		expect(result).toBe("graph TD\n  A --> B");
	});

	test("returns null when no mermaid block", () => {
		const result = extractMermaidCode("no diagram here");
		expect(result).toBeNull();
	});

	test("extracts only the first block", () => {
		const content = `\`\`\`mermaid\ngraph TD\n  A --> B\n\`\`\`\n\n\`\`\`mermaid\ngraph LR\n  C --> D\n\`\`\``;
		const result = extractMermaidCode(content);
		expect(result).toBe("graph TD\n  A --> B");
	});
});

describe("extractAllMermaidCode", () => {
	test("extracts all mermaid blocks", () => {
		const content = `\`\`\`mermaid\ngraph TD\n  A --> B\n\`\`\`\n\n\`\`\`mermaid\ngraph LR\n  C --> D\n\`\`\``;
		const results = extractAllMermaidCode(content);
		expect(results).toEqual(["graph TD\n  A --> B", "graph LR\n  C --> D"]);
	});

	test("returns empty array when no mermaid block", () => {
		const results = extractAllMermaidCode("no diagram here");
		expect(results).toEqual([]);
	});
});

describe("renderPlanDiagram", () => {
	test("returns message when no .pawl/plan.md exists", async () => {
		const result = await renderPlanDiagram("/nonexistent", async () => {
			throw new Error("ENOENT");
		});
		expect(result).toContain("No .pawl/plan.md found");
	});

	test("returns message when plan has no mermaid diagram", async () => {
		const result = await renderPlanDiagram("/tmp", async () => ({
			stdout: "# Plan\n\nNo diagram",
		}));
		expect(result).toContain("No Mermaid diagram found");
	});

	test("renders diagram when plan contains mermaid", async () => {
		const plan = `# Plan\n\n\`\`\`mermaid\ngraph TD\n  A[Client] --> B[Server]\n\`\`\``;
		const result = await renderPlanDiagram("/tmp", async () => ({
			stdout: plan,
		}));
		expect(result).toContain("Client");
		expect(result).toContain("Server");
	});
});
