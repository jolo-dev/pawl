import { describe, expect, it } from "bun:test";
import type { AddressInfo } from "node:net";
import { Agent, tool, useAgentcore } from "../index";

type FakeAgentResult = {
	lastMessage?: {
		content?: Array<{ text?: string }>;
	};
};

class FakeAgent {
	readonly prompts: string[] = [];
	readonly streamPrompts: string[] = [];

	async invoke(prompt: string): Promise<FakeAgentResult> {
		this.prompts.push(prompt);
		return {
			lastMessage: {
				content: [{ text: `response:${prompt}` }],
			},
		};
	}

	async *stream(prompt: string): AsyncGenerator<unknown, FakeAgentResult> {
		this.streamPrompts.push(prompt);
		yield { type: "modelStreamUpdateEvent", text: `chunk:${prompt}` };
		return {
			lastMessage: {
				content: [{ text: `streamed:${prompt}` }],
			},
		};
	}
}

describe("useAgentcore", () => {
	it("creates an internal Strands agent when no prebuilt agent is provided", () => {
		const currentTime = tool({
			name: "current_time",
			description: "Returns the current date and time",
			callback: () => new Date(0).toISOString(),
		});

		const agentcore = useAgentcore("time-agent", {
			tools: [currentTime],
		});

		expect(agentcore.agent).toBeInstanceOf(Agent);
	});

	it("uses a prebuilt agent for JSON invocations", async () => {
		const agent = new FakeAgent();
		const agentcore = useAgentcore("test-agent", { agent });

		const response = await agentcore.fetch(
			new Request("http://localhost/invocations", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ prompt: "hello" }),
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ result: "response:hello" });
		expect(agent.prompts).toEqual(["hello"]);
	});

	it("uses command and default prompt fallbacks", async () => {
		const agent = new FakeAgent();
		const agentcore = useAgentcore("test-agent", { agent });

		await agentcore.fetch(
			new Request("http://localhost/invocations", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ command: "run" }),
			}),
		);
		await agentcore.fetch(
			new Request("http://localhost/invocations", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			}),
		);

		expect(agent.prompts).toEqual(["run", "No prompt provided"]);
	});

	it("returns healthy ping responses", async () => {
		const agentcore = useAgentcore("test-agent", { agent: new FakeAgent() });

		const response = await agentcore.fetch(
			new Request("http://localhost/ping"),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			status: "Healthy",
			time_of_last_update: expect.any(Number),
		});
	});

	it("returns JSON errors for failed invocations", async () => {
		const agent = {
			async invoke(): Promise<FakeAgentResult> {
				throw new Error("boom");
			},
		};
		const agentcore = useAgentcore("test-agent", { agent });

		const response = await agentcore.fetch(
			new Request("http://localhost/invocations", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ prompt: "hello" }),
			}),
		);

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "boom" });
	});

	it("streams Strands events and a final normalized result as SSE", async () => {
		const agent = new FakeAgent();
		const agentcore = useAgentcore("test-agent", { agent });

		const response = await agentcore.fetch(
			new Request("http://localhost/invocations", {
				method: "POST",
				headers: {
					accept: "text/event-stream",
					"content-type": "application/json",
				},
				body: JSON.stringify({ prompt: "hello" }),
			}),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/event-stream");
		expect(await response.text()).toContain(
			'data: {"type":"done","result":"streamed:hello"}',
		);
		expect(agent.streamPrompts).toEqual(["hello"]);
	});

	it("serves requests through a Node HTTP server", async () => {
		const agentcore = useAgentcore("test-agent", { agent: new FakeAgent() });
		const server = await agentcore.serve({ host: "127.0.0.1", port: 0 });
		const address = server.address() as AddressInfo;

		try {
			const response = await fetch(`http://127.0.0.1:${address.port}/ping`);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				status: "Healthy",
				time_of_last_update: expect.any(Number),
			});
		} finally {
			await agentcore.close();
		}
	});
});
