export type AgentInvocationResult = {
	lastMessage?: unknown;
};

export function getTextResult(result: AgentInvocationResult): string {
	const lastMessage = result.lastMessage;
	if (typeof lastMessage === "string") return lastMessage;
	if (!isRecord(lastMessage)) return "";

	const content = lastMessage.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	return content
		.map((block) => {
			if (typeof block === "string") return block;
			if (!isRecord(block)) return "";
			return typeof block.text === "string" ? block.text : "";
		})
		.filter(Boolean)
		.join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
