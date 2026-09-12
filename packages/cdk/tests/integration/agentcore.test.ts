import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentCore, App, Stack, Template } from "@pawl/cdk";
import { $ } from "bun";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";

const nodeImage = "public.ecr.aws/lambda/nodejs:22";
const docker = (...args: string[]) => $`docker ${args}`.quiet();

async function removeOwnedContainer(name: string): Promise<void> {
	const result = await docker("rm", "--force", name).nothrow();
	if (result.exitCode === 0) return;
	const error = result.stderr.toString().trim();
	if (
		[
			`Error response from daemon: No such container: ${name}`,
			`Error: No such container: ${name}`,
		].includes(error)
	)
		return;
	throw new Error(`Failed to remove test container ${name}: ${error}`);
}

// LocalStack does not implement AgentCore's control plane. Validate the CDK
// configuration and run its actual bundled HTTP asset on Node 22 instead.
// This is not an AWS deployment/end-to-end control-plane test.
describe("integ:agentcore asset contract", () => {
	let assetPath: string;

	beforeAll(async () => {
		assetPath = await mkdtemp(path.join(tmpdir(), "pawl-agentcore-integ-"));
		const build = await Bun.build({
			entrypoints: [new URL("./agentcore/index.ts", import.meta.url).pathname],
			format: "esm",
			// Strands' S3 storage is optional and unused by this injected agent.
			external: ["@aws-sdk/client-s3"],
			outdir: assetPath,
			target: "node",
		});
		if (!build.success) {
			throw new AggregateError(build.logs, "Failed to build AgentCore asset");
		}
		await Bun.write(
			path.join(assetPath, "package.json"),
			'{"type":"module"}\n',
		);
	});

	afterAll(async () => {
		if (assetPath) await rm(assetPath, { recursive: true, force: true });
	});

	it("synthesizes the bundled asset as a Node 22 HTTP runtime and linked default endpoint", () => {
		const app = new App({ context: { stage: "dev", team: "foo" } });
		const stack = new Stack(app, "AgentCoreStack");
		const agent = new AgentCore(stack, "TestAgent", {
			assetPath,
			description: "Integration test AgentCore runtime",
			environmentVariables: { POWERTOOLS_SERVICE_NAME: "agentcore-integ-test" },
		});
		const template = Template.fromStack(stack);
		template.resourceCountIs("AWS::BedrockAgentCore::Runtime", 1);
		template.resourceCountIs("AWS::BedrockAgentCore::RuntimeEndpoint", 1);
		template.hasResourceProperties("AWS::BedrockAgentCore::Runtime", {
			AgentRuntimeName: "foo_dev_TestAgent_agentcore",
			ProtocolConfiguration: "HTTP",
			NetworkConfiguration: { NetworkMode: "PUBLIC" },
			EnvironmentVariables: { POWERTOOLS_SERVICE_NAME: "agentcore-integ-test" },
			AgentRuntimeArtifact: {
				CodeConfiguration: { EntryPoint: ["index.js"], Runtime: "NODE_22" },
			},
		});
		template.hasResourceProperties("AWS::BedrockAgentCore::RuntimeEndpoint", {
			Name: "DEFAULT",
			AgentRuntimeId: stack.resolve(agent.runtimeId),
		});
		const [runtime] = Object.values(
			template.findResources("AWS::BedrockAgentCore::Runtime"),
		);
		expect(
			runtime?.Properties.AgentRuntimeArtifact.CodeConfiguration.Code.S3,
		).toMatchObject({
			Bucket: expect.anything(),
			Prefix: expect.stringMatching(/\.zip$/),
		});
		const policy = agent.role.node.tryFindChild("DefaultPolicy");
		if (!policy) throw new Error("Expected AgentCore execution policy");
		// These are the upstream CDK runtime/asset grants, not additional Pawl
		// permissions. Keep exceptions on this policy and these exact findings.
		NagSuppressions.addResourceSuppressions(
			policy,
			[
				{
					id: "AwsSolutions-IAM5",
					appliesTo: [
						"Resource::arn:<AWS::Partition>:logs:<AWS::Region>:<AWS::AccountId>:log-group:/aws/bedrock-agentcore/runtimes/*",
						"Resource::arn:<AWS::Partition>:logs:<AWS::Region>:<AWS::AccountId>:log-group:*",
						"Resource::arn:<AWS::Partition>:logs:<AWS::Region>:<AWS::AccountId>:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*",
						"Resource::arn:<AWS::Partition>:bedrock-agentcore:<AWS::Region>:<AWS::AccountId>:workload-identity-directory/default/workload-identity/*",
					],
					reason:
						"The CDK AgentCore L2 uses service-created runtime/log/workload identities; this fixture retains those existing namespace-scoped grants.",
				},
				{
					id: "AwsSolutions-IAM5",
					appliesTo: ["Resource::*"],
					reason:
						"X-Ray telemetry and namespace-conditioned PutMetricData require wildcard resources; the exact statements are asserted below.",
				},
				{
					id: "AwsSolutions-IAM5",
					appliesTo: [
						"Action::s3:GetObject*",
						"Action::s3:GetBucket*",
						"Action::s3:List*",
						"Resource::arn:<AWS::Partition>:s3:::cdk-hnb659fds-assets-<AWS::AccountId>-<AWS::Region>/*",
					],
					reason:
						"The upstream code-asset grantRead uses S3 read action families on the CDK bootstrap asset bucket; this fixture does not widen that grant.",
				},
			],
			true,
		);
		const [iamPolicy] = Object.values(
			template.findResources("AWS::IAM::Policy"),
		);
		const statements = iamPolicy?.Properties.PolicyDocument.Statement as Array<
			Record<string, unknown>
		>;
		expect(
			statements.filter((statement) => statement.Resource === "*"),
		).toEqual([
			{
				Sid: "XRayAccess",
				Effect: "Allow",
				Resource: "*",
				Action: [
					"xray:PutTraceSegments",
					"xray:PutTelemetryRecords",
					"xray:GetSamplingRules",
					"xray:GetSamplingTargets",
				],
			},
			{
				Sid: "CloudWatchMetrics",
				Effect: "Allow",
				Resource: "*",
				Action: "cloudwatch:PutMetricData",
				Condition: {
					StringEquals: { "cloudwatch:namespace": "bedrock-agentcore" },
				},
			},
		]);
		const nag = new AwsSolutionsChecks();
		for (const construct of app.node.findAll()) nag.visit(construct);
		const errors = app.node
			.findAll()
			.flatMap((construct) => construct.node.metadata)
			.filter((metadata) => metadata.type === "aws:cdk:error");
		expect(errors).toEqual([]);
	});

	describe("Node 22 container runtime", () => {
		const containerName = `pawl-agentcore-${crypto.randomUUID()}`;
		let containerAttempted = false;
		let endpoint: string;

		beforeAll(async () => {
			// Only the built asset is mounted. No host environment, AWS credentials,
			// or LocalStack token is forwarded into the container.
			containerAttempted = true;
			await docker(
				"run",
				"--detach",
				"--name",
				containerName,
				"--publish",
				"127.0.0.1::8080",
				"--volume",
				`${assetPath}:/app:ro`,
				"--workdir",
				"/app",
				"--entrypoint",
				"/var/lang/bin/node",
				nodeImage,
				"index.js",
			);
			const address = (
				await docker("port", containerName, "8080/tcp").text()
			).trim();
			expect(address).toMatch(/^127\.0\.0\.1:\d+$/);
			endpoint = `http://${address}`;
			const deadline = Date.now() + 30_000;
			let lastError: unknown;
			while (Date.now() < deadline) {
				try {
					const response = await fetch(`${endpoint}/ping`, {
						signal: AbortSignal.timeout(1_000),
					});
					await response.arrayBuffer();
					if (response.ok) return;
					lastError = new Error(
						`Health check returned HTTP ${response.status}`,
					);
				} catch (error) {
					lastError = error;
				}
				await Bun.sleep(100);
			}
			const logs = await docker("logs", containerName);
			throw new Error(
				`Node 22 asset did not become healthy:\n${logs.stdout}\n${logs.stderr}`,
				{ cause: lastError },
			);
		}, 180_000);

		afterAll(async () => {
			if (containerAttempted) await removeOwnedContainer(containerName);
		});

		it("runs under Node 22 and responds to health checks", async () => {
			const version = await docker(
				"exec",
				containerName,
				"/var/lang/bin/node",
				"--version",
			).text();
			expect(version.trim()).toMatch(/^v22\./);
			const ping = await fetch(`${endpoint}/ping`, {
				signal: AbortSignal.timeout(5_000),
			});
			expect(ping.status).toBe(200);
			expect(await ping.json()).toMatchObject({ status: "Healthy" });
		});

		it("serves JSON invocations from the bundled Pawl runtime", async () => {
			const response = await fetch(`${endpoint}/invocations`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json",
					"x-amzn-bedrock-agentcore-runtime-session-id": `session-${crypto.randomUUID()}`,
				},
				body: JSON.stringify({ prompt: "hello" }),
				signal: AbortSignal.timeout(5_000),
			});
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain(
				"application/json",
			);
			expect(await response.json()).toEqual({ result: "response:hello" });
		});

		it("removes a container left behind by a failed Docker startup", async () => {
			const failedName = `pawl-agentcore-failed-${crypto.randomUUID()}`;
			try {
				const started = await docker(
					"run",
					"--detach",
					"--name",
					failedName,
					"--entrypoint",
					"/pawl-missing-executable",
					nodeImage,
				).nothrow();
				expect(started.exitCode).toBe(127);
				expect(
					(
						await docker(
							"inspect",
							"--format",
							"{{.State.Status}}",
							failedName,
						).text()
					).trim(),
				).toBe("created");
				await removeOwnedContainer(failedName);
				const absent = await docker("inspect", failedName).nothrow();
				expect(absent.exitCode).not.toBe(0);
				expect(absent.stderr.toString().toLowerCase()).toContain(
					`no such object: ${failedName}`,
				);
			} finally {
				// Also exercises idempotent cleanup when the owned container is absent.
				await removeOwnedContainer(failedName);
			}
		});

		it("returns 404 for unknown runtime routes", async () => {
			const response = await fetch(`${endpoint}/missing`, {
				signal: AbortSignal.timeout(5_000),
			});
			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({ error: "Not found" });
		});
	});
});
