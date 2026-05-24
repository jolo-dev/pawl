import { type AgentInvocationResult, getTextResult } from "./text-result";
import type { AgentLike } from "./use-agentcore";

export function createSseResponse(agent: AgentLike, prompt: string): Response {
	if (!agent.stream) {
		return Response.json(
			{ error: "Agent does not support streaming" },
			{ status: 500 },
		);
	}

	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				const stream = agent.stream?.(prompt);
				if (!stream) throw new Error("Agent does not support streaming");

				let next = await stream.next();
				while (!next.done) {
					controller.enqueue(encoder.encode(formatSseEvent(next.value)));
					next = await stream.next();
				}

				const result = next.value;
				controller.enqueue(
					encoder.encode(
						formatSseEvent({ type: "done", result: getTextResult(result) }),
					),
				);
				controller.close();
			} catch (error) {
				controller.enqueue(
					encoder.encode(
						formatSseEvent({ type: "error", error: getErrorMessage(error) }),
					),
				);
				controller.close();
			}
		},
	});

	return new Response(body, {
		headers: {
			"cache-control": "no-cache",
			"content-type": "text/event-stream",
			connection: "keep-alive",
		},
	});
}

function formatSseEvent(event: unknown): string {
	return `data: ${JSON.stringify(event)}\n\n`;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export type { AgentInvocationResult };
