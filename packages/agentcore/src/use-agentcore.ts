import { createServer, type IncomingMessage, type Server } from "node:http";
import { Agent } from "@strands-agents/sdk";
import { getInvocationPrompt } from "./request-schema";
import { createSseResponse } from "./sse";
import { type AgentInvocationResult, getTextResult } from "./text-result";

type StrandsAgentOptions = ConstructorParameters<typeof Agent>[0];

export interface AgentLike {
	invoke(prompt: string): Promise<AgentInvocationResult>;
	stream?(prompt: string): AsyncGenerator<unknown, AgentInvocationResult>;
}

export type UseAgentcoreOptions =
	| ({ agent: AgentLike } & Partial<StrandsAgentOptions>)
	| ({ agent?: undefined } & StrandsAgentOptions);

export interface ServeOptions {
	host?: string;
	port?: number;
}

export interface AgentcoreRuntime {
	readonly agent: AgentLike;
	fetch(request: Request): Promise<Response>;
	serve(options?: ServeOptions): Promise<Server>;
	close(): Promise<void>;
}

export function useAgentcore(
	serviceName: string,
	options: UseAgentcoreOptions,
): AgentcoreRuntime {
	const agent = options.agent ?? createAgent(options);
	let server: Server | undefined;

	const runtime: AgentcoreRuntime = {
		agent,
		async fetch(request) {
			return handleRequest(agent, request);
		},
		async serve({ host = "0.0.0.0", port = 8080 } = {}) {
			server = createServer(async (request, response) => {
				const body = await readRequestBody(request);
				const url = `http://${request.headers.host ?? `${host}:${port}`}${request.url ?? "/"}`;
				const webRequest = new Request(url, {
					body: canHaveBody(request.method) ? body : undefined,
					headers: getRequestHeaders(request),
					method: request.method,
				});
				const webResponse = await runtime.fetch(webRequest);

				response.writeHead(
					webResponse.status,
					Object.fromEntries(webResponse.headers.entries()),
				);
				if (webResponse.body) {
					for await (const chunk of webResponse.body) response.write(chunk);
				}
				response.end();
			});

			await new Promise<void>((resolve) => server?.listen(port, host, resolve));
			console.log(`${serviceName} listening on port ${port}`);
			return server;
		},
		async close() {
			if (!server) return;
			await new Promise<void>((resolve, reject) => {
				server?.close((error) => (error ? reject(error) : resolve()));
			});
			server = undefined;
		},
	};

	return runtime;
}

async function handleRequest(
	agent: AgentLike,
	request: Request,
): Promise<Response> {
	const url = new URL(request.url);

	if (request.method === "GET" && url.pathname === "/ping") {
		return Response.json({
			status: "Healthy",
			time_of_last_update: Math.floor(Date.now() / 1000),
		});
	}

	if (request.method !== "POST" || url.pathname !== "/invocations") {
		return Response.json({ error: "Not found" }, { status: 404 });
	}

	try {
		const prompt = await getInvocationPrompt(request);
		if (acceptsSse(request)) return createSseResponse(agent, prompt);

		const result = await agent.invoke(prompt);
		return Response.json({ result: getTextResult(result) });
	} catch (error) {
		return Response.json({ error: getErrorMessage(error) }, { status: 500 });
	}
}

function createAgent(options: StrandsAgentOptions): AgentLike {
	return new Agent({ ...options, printer: false }) as unknown as AgentLike;
}

function acceptsSse(request: Request): boolean {
	return request.headers.get("accept")?.includes("text/event-stream") ?? false;
}

async function readRequestBody(
	request: IncomingMessage,
): Promise<Uint8Array | undefined> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of request) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}
	return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function getRequestHeaders(request: IncomingMessage): Headers {
	const headers = new Headers();
	for (const [key, value] of Object.entries(request.headers)) {
		if (typeof value === "string") headers.set(key, value);
		if (Array.isArray(value)) headers.set(key, value.join(", "));
	}
	return headers;
}

function canHaveBody(method: string | undefined): boolean {
	return method !== "GET" && method !== "HEAD";
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
