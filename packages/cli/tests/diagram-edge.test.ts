import { describe, expect, test } from "bun:test";
import { extractMermaidCode } from "../src/diagram";

describe("extractMermaidCode - edge cases", () => {
	test("space before mermaid: ``` mermaid", () => {
		const content = "``` mermaid\ngraph TD\n  A --> B\n```";
		const result = extractMermaidCode(content);
		expect(result).toBe("graph TD\n  A --> B");
	});

	test("CRLF line endings", () => {
		const content = "```mermaid\r\ngraph TD\r\n  A --> B\r\n```";
		const result = extractMermaidCode(content);
		expect(result).toBe("graph TD\r\n  A --> B");
	});

	test("capital Mermaid", () => {
		const content = "```Mermaid\ngraph TD\n  A --> B\n```";
		const result = extractMermaidCode(content);
		expect(result).toBe("graph TD\n  A --> B");
	});

	test("trailing space after mermaid", () => {
		const content = "```mermaid \ngraph TD\n  A --> B\n```";
		const result = extractMermaidCode(content);
		expect(result).toBe("graph TD\n  A --> B");
	});

	test("indented code block", () => {
		const content = "  ```mermaid\n  graph TD\n    A --> B\n  ```";
		const result = extractMermaidCode(content);
		expect(result).toContain("graph TD");
	});
});
