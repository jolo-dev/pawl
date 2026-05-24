import { z } from "zod";

const invocationRequestSchema = z
	.object({
		prompt: z.string().optional(),
		command: z.string().optional(),
	})
	.passthrough();

export async function getInvocationPrompt(request: Request): Promise<string> {
	const body = await request.json().catch(() => ({}));
	const input = invocationRequestSchema.parse(body);

	return input.prompt ?? input.command ?? "No prompt provided";
}
