# @pawl/agentcore

Node 22-compatible runtime wrapper for Amazon Bedrock AgentCore with Strands Agents SDK.

## Usage

```ts
import { tool, useAgentcore } from "@pawl/agentcore";
import { z } from "zod";

const currentTime = tool({
	name: "current_time",
	description: "Returns the current date and time",
	inputSchema: z.object({}),
	callback: () => new Date().toISOString(),
});

export const agentcore = useAgentcore("time-agent", {
	systemPrompt: "You are helpful.",
	tools: [currentTime],
});

if (import.meta.main) {
	await agentcore.serve();
}
```

You can also pass a prebuilt Strands agent:

```ts
import { Agent, useAgentcore } from "@pawl/agentcore";

const agent = new Agent({
	printer: false,
	tools: [],
});

export const agentcore = useAgentcore("custom-agent", { agent });
```

## Runtime Contract

- `GET /ping` returns AgentCore health status.
- `POST /invocations` accepts `{ "prompt": "..." }` or `{ "command": "..." }`.
- JSON responses return `{ "result": "..." }`.
- Requests with `Accept: text/event-stream` receive Server-Sent Events.

The runtime uses Node HTTP APIs so bundled output can run on AgentCore direct code deployment with `NODE_22`. Bun remains the local development, test, and build tool.
