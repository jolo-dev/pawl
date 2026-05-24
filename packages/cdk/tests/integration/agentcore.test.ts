import { tmpdir } from "node:os";
import path from "node:path";
import { AgentCore, stacks } from "@pawl/cdk";
import {
	createLocalStackSetup,
	type LocalStackSetup,
} from "./localstack.setup";

const runtimeName = "foo_dev_TestAgent_agentcore";
const assetPath = path.join(tmpdir(), "pawl-agentcore-integ-asset");

const foo = function AgentCoreStack() {
	new AgentCore("TestAgent", {
		assetPath,
		description: "Integration test AgentCore runtime",
		environmentVariables: {
			POWERTOOLS_SERVICE_NAME: "agentcore-integ-test",
		},
	});
};

if (!stacks(foo)) {
	const { $ } = await import("bun");
	const { beforeAll, describe, expect, it } = await import("bun:test");

	describe("integ:agentcore", () => {
		beforeAll(async () => {
			const build = await Bun.build({
				entrypoints: [
					new URL("./agentcore/index.ts", import.meta.url).pathname,
				],
				format: "esm",
				outdir: assetPath,
				target: "node",
			});
			if (!build.success) {
				throw new AggregateError(build.logs, "Failed to build AgentCore asset");
			}
		});

		const ls = createLocalStackSetup({
			appFile: import.meta.path,
			stack: foo,
			timeout: 180_000,
		});

		it("should respond to ping and invocations through LocalStack", async () => {
			const runtime = await getAgentRuntime(ls, runtimeName);
			expect(runtime.status).toBe("READY");

			const ping = await fetch(
				`${ls.endpoint}/runtimes/${encodeURIComponent(runtime.agentRuntimeArn)}/ping?qualifier=DEFAULT`,
				{
					headers: {
						accept: "application/json",
						"x-amzn-bedrock-agentcore-runtime-session-id": createSessionId(),
					},
				},
			);
			expect(ping.status).toBe(200);
			expect(await ping.json()).toMatchObject({ status: "Healthy" });

			const invocation = await invokeAgentRuntime(ls, runtime.agentRuntimeArn, {
				prompt: "hello",
			});

			expect(invocation.metadata.statusCode).toBe(200);
			expect(invocation.response).toEqual({ result: "response:hello" });
		});
	});

	async function getAgentRuntime(
		ls: LocalStackSetup,
		name: string,
	): Promise<AgentRuntimeSummary> {
		const response = await awsJson<ListAgentRuntimesResponse>(
			ls,
			$`aws bedrock-agentcore-control list-agent-runtimes --endpoint-url ${ls.endpoint} --region us-east-1 --output json`,
		);
		const runtime = response.agentRuntimes.find(
			(agentRuntime) => agentRuntime.agentRuntimeName === name,
		);
		if (!runtime) throw new Error(`AgentCore runtime not found: ${name}`);
		return runtime;
	}

	async function invokeAgentRuntime(
		ls: LocalStackSetup,
		agentRuntimeArn: string,
		payload: Record<string, unknown>,
	): Promise<InvokeAgentRuntimeResult> {
		const outputFile = `/tmp/pawl-agentcore-${crypto.randomUUID()}.json`;
		const metadata = await awsJson<InvokeAgentRuntimeMetadata>(
			ls,
			$`aws bedrock-agentcore invoke-agent-runtime --endpoint-url ${ls.endpoint} --region us-east-1 --agent-runtime-arn ${agentRuntimeArn} --qualifier DEFAULT --runtime-session-id ${createSessionId()} --content-type application/json --accept application/json --payload ${JSON.stringify(payload)} --cli-binary-format raw-in-base64-out --output json ${outputFile}`,
		);
		return {
			metadata,
			response: await Bun.file(outputFile).json(),
		};
	}

	async function awsJson<T>(
		ls: LocalStackSetup,
		command: ReturnType<typeof $>,
	): Promise<T> {
		const output = await command
			.env({
				...ls.env,
				AWS_PAGER: "",
			})
			.text();
		return JSON.parse(output) as T;
	}

	function createSessionId(): string {
		return `session-${crypto.randomUUID()}`;
	}
}

interface AgentRuntimeSummary {
	agentRuntimeArn: string;
	agentRuntimeName: string;
	status: string;
}

interface ListAgentRuntimesResponse {
	agentRuntimes: AgentRuntimeSummary[];
}

interface InvokeAgentRuntimeMetadata {
	statusCode: number;
}

interface InvokeAgentRuntimeResult {
	metadata: InvokeAgentRuntimeMetadata;
	response: unknown;
}
