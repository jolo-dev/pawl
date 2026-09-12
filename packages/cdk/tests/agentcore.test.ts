import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Duration } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import type { Construct } from "constructs";
import { AgentCore } from "../src/agentcore";
import { Stack } from "../src/stack";
import { createTestApp } from "./utils";

class AgentCoreTestStack extends Stack {
	constructor(scope: Construct, id: string, assetPath: string) {
		super(scope, id);

		new AgentCore(this, "TimeAgent", {
			assetPath,
			environmentVariables: {
				POWERTOOLS_SERVICE_NAME: "time-agent",
			},
			lifecycleConfiguration: {
				idleRuntimeSessionTimeout: Duration.minutes(5),
				maxLifetime: Duration.hours(1),
			},
		});
	}
}

describe("AgentCore", () => {
	let fixtureRoot: string;
	let assetPath: string;
	let stack: AgentCoreTestStack;
	let template: Template;

	beforeAll(() => {
		fixtureRoot = mkdtempSync(path.join(tmpdir(), "pawl-agentcore-unit-"));
		assetPath = path.join(fixtureRoot, ".pawl", "agentcore");
		mkdirSync(assetPath, { recursive: true });
		writeFileSync(path.join(assetPath, "index.js"), "export {};\n");
		stack = new AgentCoreTestStack(
			createTestApp(),
			"AgentCoreTestStack",
			assetPath,
		);
		template = Template.fromStack(stack);
	});

	afterAll(() => {
		if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
	});

	test("uses the default built agent asset directory", () => {
		// A subprocess keeps the default relative asset path independent of the
		// developer's build output without changing the test runner's cwd.
		const result = Bun.spawnSync(
			[
				process.execPath,
				"-e",
				`import { AgentCore } from ${JSON.stringify(path.join(import.meta.dir, "../src/agentcore.ts"))};
			import { Stack } from ${JSON.stringify(path.join(import.meta.dir, "../src/stack.ts"))};
			import { createTestApp } from ${JSON.stringify(path.join(import.meta.dir, "utils.ts"))};
			const app = createTestApp();
			const agent = new AgentCore(new Stack(app, "DefaultAssetStack"), "Agent");
			app.synth();
			console.log(agent.assetPath);`,
			],
			{ cwd: fixtureRoot, stdout: "pipe", stderr: "pipe" },
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString().trim()).toBe(".pawl/agentcore");
	});

	test("creates a Node 22 HTTP AgentCore runtime from a code asset", () => {
		template.hasResourceProperties("AWS::BedrockAgentCore::Runtime", {
			AgentRuntimeName: "foo_bar_TimeAgent_agentcore",
			EnvironmentVariables: {
				POWERTOOLS_SERVICE_NAME: "time-agent",
			},
			LifecycleConfiguration: {
				IdleRuntimeSessionTimeout: 300,
				MaxLifetime: 3600,
			},
			NetworkConfiguration: {
				NetworkMode: "PUBLIC",
			},
			ProtocolConfiguration: "HTTP",
			AgentRuntimeArtifact: {
				CodeConfiguration: {
					EntryPoint: ["index.js"],
					Runtime: "NODE_22",
				},
			},
		});
	});

	test("creates a default runtime endpoint", () => {
		template.hasResourceProperties("AWS::BedrockAgentCore::RuntimeEndpoint", {
			Name: "DEFAULT",
		});
	});

	test("creates an execution role for AgentCore", () => {
		template.hasResourceProperties("AWS::IAM::Role", {
			AssumeRolePolicyDocument: {
				Statement: [
					{
						Action: "sts:AssumeRole",
						Effect: "Allow",
						Principal: {
							Service: "bedrock-agentcore.amazonaws.com",
						},
					},
				],
			},
		});
	});

	test("exposes construct attributes", () => {
		const agentCore = stack.node.findChild("TimeAgent") as AgentCore;

		expect(agentCore.runtimeArn).toBe(agentCore.runtime.agentRuntimeArn);
		expect(agentCore.runtimeId).toBe(agentCore.runtime.agentRuntimeId);
		expect(agentCore.endpointArn).toBe(
			agentCore.endpoint.agentRuntimeEndpointArn,
		);
	});

	test("supports a custom built agent asset directory", () => {
		class CustomAssetStack extends Stack {
			constructor(scope: Construct, id: string) {
				super(scope, id);

				new AgentCore(this, "CustomAgent", {
					assetPath,
				});
			}
		}

		const customStack = new CustomAssetStack(
			createTestApp(),
			"CustomAssetStack",
		);
		const agentCore = customStack.node.findChild("CustomAgent") as AgentCore;

		expect(agentCore.assetPath).toBe(assetPath);
		Template.fromStack(customStack).resourceCountIs(
			"AWS::BedrockAgentCore::Runtime",
			1,
		);
	});
});
