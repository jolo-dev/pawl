import { describe, expect, test } from "bun:test";
import path from "node:path";
import { Duration } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import type { Construct } from "constructs";
import { AgentCore } from "../src/agentcore";
import { Stack } from "../src/stack";
import { createTestApp } from "./utils";

class AgentCoreTestStack extends Stack {
	constructor(scope: Construct, id: string) {
		super(scope, id);

		new AgentCore(this, "TimeAgent", {
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
	const stack = new AgentCoreTestStack(createTestApp(), "AgentCoreTestStack");
	const template = Template.fromStack(stack);

	test("uses the default built agent asset directory", () => {
		const agentCore = stack.node.findChild("TimeAgent") as AgentCore;

		expect(agentCore.assetPath).toBe(".pawl/agentcore");
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
					assetPath: path.join(__dirname, "agentcore"),
				});
			}
		}

		const customStack = new CustomAssetStack(
			createTestApp(),
			"CustomAssetStack",
		);
		const agentCore = customStack.node.findChild("CustomAgent") as AgentCore;

		expect(agentCore.assetPath).toBe(path.join(__dirname, "agentcore"));
	});
});
