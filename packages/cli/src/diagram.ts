import { renderMermaidASCII } from "beautiful-mermaid";

const MERMAID_REGEX = /```[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)```/gi;

/** Extract the first mermaid code block from a string. Returns null if none found. */
export function extractMermaidCode(content: string): string | null {
	MERMAID_REGEX.lastIndex = 0;
	const match = MERMAID_REGEX.exec(content);
	return match?.[1]?.trim() ?? null;
}

/** Extract all mermaid code blocks from a string. */
export function extractAllMermaidCode(content: string): string[] {
	const results: string[] = [];
	const localRegex = /```[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)```/gi;
	let m: RegExpExecArray | null;
	m = localRegex.exec(content);
	while (m !== null) {
		if (m[1]) results.push(m[1].trim());
		m = localRegex.exec(content);
	}
	return results;
}

/** Render a mermaid diagram as ASCII art for terminal display. */
export function renderMermaidToTerminal(mermaidCode: string): string {
	try {
		const ascii = renderMermaidASCII(mermaidCode);
		return ascii;
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		return `⚠ Could not render diagram: ${message}`;
	}
}

/** Read .pawl/plan.md from cwd, extract mermaid diagram(s), render as ASCII. */
export async function renderPlanDiagram(
	cwd: string,
	exec: (cmd: string, args: string[]) => Promise<{ stdout: string }>,
): Promise<string> {
	try {
		const { stdout } = await exec("cat", [`${cwd}/.pawl/plan.md`]);
		const code = extractMermaidCode(stdout);
		if (!code) {
			return (
				"No Mermaid diagram found in .pawl/plan.md.\n\n" +
				"The agent may not have included a Mermaid diagram in the plan. " +
				"Ask the agent to add one, then run /architecture again."
			);
		}
		return renderMermaidToTerminal(code);
	} catch {
		return "No .pawl/plan.md found. Run /plan first to generate an infrastructure plan.";
	}
}
