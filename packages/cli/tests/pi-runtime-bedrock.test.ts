// Offline evidence for the early Bedrock authentication and stream
// feasibility gate. Every SDK-boundary scenario runs the real public
// bedrockProviderModule.stream (and the real Pawl wrapper) inside an isolated
// subprocess that intercepts only the installed
// @aws-sdk/client-bedrock-runtime transport boundary. No network is
// contacted anywhere in this suite.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import {
	assertCompleteModelMetadata,
	createBedrockModelStream,
	MEDIUM_THINKING_BUDGET,
	planBedrockReasoning,
	resolveApprovedBedrockModel,
} from "../src/pi-runtime/bedrock";
import { createExecutionContext } from "../src/pi-runtime/execution-context";

const region = "eu-central-1";

interface FixtureEvidence {
	scenario: string;
	offline: boolean;
	clients: number;
	[key: string]: unknown;
}

async function runFixture(scenario: string): Promise<FixtureEvidence> {
	const child = Bun.spawn(
		[
			process.execPath,
			join(import.meta.dir, "fixtures/pi-bedrock-sdk.ts"),
			scenario,
		],
		{
			env: ambientEnv(scenario),
			stdout: "pipe",
			stderr: "pipe",
			timeout: 30_000,
		},
	);
	const [exit, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
	const evidence = JSON.parse(stdout) as FixtureEvidence;
	expect(evidence.scenario).toBe(scenario);
	expect(evidence.offline).toBe(true);
	return evidence;
}

/** Scenario-specific ambient environment; the child starts otherwise clean. */
function ambientEnv(scenario: string): Record<string, string> {
	const base: Record<string, string> = { PATH: process.env.PATH ?? "" };
	switch (scenario) {
		case "profile-credentials-precedence":
			return {
				...base,
				AWS_PROFILE: "ambient-profile",
				AWS_ACCESS_KEY_ID: "ambient-key",
				AWS_SECRET_ACCESS_KEY: "ambient-secret",
				AWS_REGION: "us-east-1",
				AWS_DEFAULT_REGION: "us-east-1",
			};
		case "bearer-hazard":
			return {
				...base,
				AWS_ACCESS_KEY_ID: "ambient-key",
				AWS_SECRET_ACCESS_KEY: "ambient-secret",
				AWS_BEARER_TOKEN_BEDROCK: "ambient-bearer",
			};
		case "skip-auth-hazard":
			return {
				...base,
				AWS_ACCESS_KEY_ID: "ambient-key",
				AWS_SECRET_ACCESS_KEY: "ambient-secret",
				AWS_BEDROCK_SKIP_AUTH: "1",
			};
		case "empty-env-fallthrough-hazard":
			return {
				...base,
				AWS_ACCESS_KEY_ID: "ambient-key",
				AWS_SECRET_ACCESS_KEY: "ambient-secret",
				AWS_SESSION_TOKEN: "ambient-token",
			};
		case "session-token-ambient-fail-closed":
			return { ...base, AWS_SESSION_TOKEN: "ambient-stale-token" };
		case "ambient-endpoint-hazard":
			return {
				...base,
				AWS_ENDPOINT_URL: "https://global-attacker.invalid",
				AWS_ENDPOINT_URL_BEDROCK_RUNTIME: "https://service-attacker.invalid",
			};
		default:
			return base;
	}
}

/** An offline execution context with fully stubbed credential resolution. */
async function offlineContext() {
	const { mkdtempSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const projectDir = mkdtempSync(join(tmpdir(), "pawl-bedrock-proof-test-"));
	const context = await createExecutionContext(
		{ projectDir, profile: "proof", region },
		{
			credentialsFromIni: () => async () => ({
				accessKeyId: "checked-key",
				secretAccessKey: "checked-secret",
				sessionToken: "checked-token",
			}),
			identityClient: () => ({
				identify: async () => ({
					Account: "123456789012",
					Arn: "arn:aws:sts::123456789012:assumed-role/ProofFixture/session",
				}),
				destroy(): void {},
			}),
			now: Date.now,
		},
	);
	return {
		context,
		dispose: () => rmSync(projectDir, { recursive: true, force: true }),
	};
}

function syntheticModel(
	overrides: Partial<Model<"bedrock-converse-stream">>,
): Model<"bedrock-converse-stream"> {
	return {
		id: "eu.anthropic.claude-sonnet-4-6",
		name: "Claude Sonnet 4.6 (EU)",
		api: "bedrock-converse-stream",
		provider: "amazon-bedrock",
		baseUrl: "",
		reasoning: true,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
		...overrides,
	} as Model<"bedrock-converse-stream">;
}

describe("Pi Bedrock authentication and stream feasibility gate", () => {
	const scenarios = [
		"profile-credentials-precedence",
		"clean-env",
		"claude-budget-reasoning",
		"claude-adaptive-reasoning",
		"nova-reasoning",
		"bearer-hazard",
		"skip-auth-hazard",
		"empty-env-fallthrough-hazard",
		"session-token-ambient-fail-closed",
		"credential-refresh",
		"identity-change",
		"cancellation",
		"region-conflict",
		"custom-endpoint",
		"ambient-endpoint-hazard",
	];

	for (const scenario of scenarios) {
		test(`actual provider SDK-boundary evidence: ${scenario}`, async () => {
			await runFixture(scenario);
		}, 40_000);
	}

	test("the SDK boundary receives the checked snapshot as explicit credentials", async () => {
		const evidence = await runFixture("clean-env");
		const config = evidence.config as Record<string, unknown>;
		expect(config.credentials).toEqual({
			accessKeyId: "checked-key",
			secretAccessKey: "checked-secret",
			sessionToken: "checked-token",
		});
		expect(config.region).toBe(region);
		expect(config.profile).toBeUndefined();
		expect(config.authSchemePreference).toBeUndefined();
		expect(config.token).toBeUndefined();
		expect(config.endpoint).toBeUndefined();
		expect(evidence.final).toMatchObject({ stopReason: "stop" });
	}, 40_000);

	test("the ambient profile cannot override the explicit credential object", async () => {
		const evidence = await runFixture("profile-credentials-precedence");
		const config = evidence.config as Record<string, unknown>;
		// Documented installed behavior: the ambient profile name still reaches
		// config.profile, but the SDK's explicit credentials win over profile
		// resolution — asserted at the captured client boundary.
		expect(config.profile).toBe("ambient-profile");
		expect(config.credentials).toEqual({
			accessKeyId: "checked-key",
			secretAccessKey: "checked-secret",
			sessionToken: "checked-token",
		});
		expect(config.region).toBe(region);
	}, 40_000);

	test("budget-based Claude reasoning uses an explicit budget under a larger output cap", async () => {
		const evidence = await runFixture("claude-budget-reasoning");
		const command = evidence.command as Record<string, unknown>;
		expect(command.inferenceConfig).toEqual({ maxTokens: 64000 });
		expect(command.additionalModelRequestFields).toEqual({
			thinking: {
				type: "enabled",
				budget_tokens: MEDIUM_THINKING_BUDGET,
				display: "summarized",
			},
			anthropic_beta: ["interleaved-thinking-2025-05-14"],
		});
	}, 40_000);

	test("adaptive Claude reasoning uses the family-aware medium effort", async () => {
		const evidence = await runFixture("claude-adaptive-reasoning");
		const command = evidence.command as Record<string, unknown>;
		expect(command.additionalModelRequestFields).toEqual({
			thinking: { type: "adaptive", display: "summarized" },
			output_config: { effort: "medium" },
		});
	}, 40_000);

	test("Nova 2 Lite is invoked with the exact selected inference-profile id", async () => {
		const evidence = await runFixture("nova-reasoning");
		const command = evidence.command as Record<string, unknown>;
		expect(command.modelId).toBe("eu.amazon.nova-2-lite-v1:0");
		expect(command.inferenceConfig).toEqual({ maxTokens: 4096 });
		expect(command.additionalModelRequestFields).toEqual({
			reasoningConfig: { type: "enabled", maxReasoningEffort: "medium" },
		});
	}, 40_000);

	test("an ambient bearer token would hijack a naive integration and fails closed", async () => {
		const evidence = await runFixture("bearer-hazard");
		expect((evidence.probe as Record<string, unknown>).bearerTokenLeaked).toBe(
			true,
		);
		expect(evidence.failedClosed).toBe(true);
		expect(evidence.clients).toBe(0);
	}, 40_000);

	test("skip-auth dummy credentials are a documented hazard and stay overridden", async () => {
		const evidence = await runFixture("skip-auth-hazard");
		expect((evidence.probe as Record<string, unknown>).dummyCredentials).toBe(
			true,
		);
		const config = evidence.config as Record<string, unknown>;
		expect((config.credentials as Record<string, unknown>).accessKeyId).toBe(
			"checked-key",
		);
	}, 40_000);

	test("empty scoped env values fall through to ambient values in the installed provider", async () => {
		const evidence = await runFixture("empty-env-fallthrough-hazard");
		expect(
			(evidence.probe as Record<string, unknown>)
				.ambientLeakThroughEmptyOverride,
		).toBe(true);
	}, 40_000);

	test("absent selected session token with an ambient token fails closed", async () => {
		const evidence = await runFixture("session-token-ambient-fail-closed");
		expect(evidence.clients).toBe(0);
		expect(evidence.final).toMatchObject({ stopReason: "error" });
	}, 40_000);

	test("credential rotation is observed at the SDK boundary per request", async () => {
		const evidence = await runFixture("credential-refresh");
		expect(evidence.generationsObserved).toEqual([
			"gen-a-key",
			"gen-a-key",
			"gen-b-key",
		]);
		expect(evidence.expiredFailure).toMatchObject({ stopReason: "error" });
	}, 40_000);

	test("an identity change invalidates the context before any model request", async () => {
		const evidence = await runFixture("identity-change");
		expect(evidence.clients).toBe(0);
		expect(evidence.final).toMatchObject({ stopReason: "error" });
	}, 40_000);

	test("cancellation before credential resolution encodes an aborted assistant message", async () => {
		const evidence = await runFixture("cancellation");
		expect(evidence.clients).toBe(0);
		expect(evidence.final).toMatchObject({ stopReason: "aborted" });
	}, 40_000);

	test("an ARN model region conflicting with the selected region fails closed", async () => {
		const evidence = await runFixture("region-conflict");
		expect(evidence.clients).toBe(0);
	}, 40_000);

	test("ambient endpoint env vars redirect the real SDK and fail closed in the wrapper", async () => {
		const evidence = await runFixture("ambient-endpoint-hazard");
		const probe = evidence.probe as Record<string, unknown>;
		expect(probe.hazardHostname).toBe("service-attacker.invalid");
		expect(probe.signedWithCheckedKey).toBe(true);
		expect(evidence.clients).toBe(0);
	}, 40_000);

	test("caller-supplied custom endpoints fail closed", async () => {
		const evidence = await runFixture("custom-endpoint");
		expect(evidence.clients).toBe(0);
	}, 40_000);

	describe("offline unit checks of the approved model boundary", () => {
		test("resolves exact catalog ids and clones base metadata for selected inference profiles", () => {
			const exact = resolveApprovedBedrockModel(
				"eu.anthropic.claude-sonnet-4-6",
				region,
			);
			expect(exact.id).toBe("eu.anthropic.claude-sonnet-4-6");
			expect(exact.provider).toBe("amazon-bedrock");
			const cloned = resolveApprovedBedrockModel(
				"eu.amazon.nova-2-lite-v1:0",
				region,
			);
			expect(cloned.id).toBe("eu.amazon.nova-2-lite-v1:0");
			expect(cloned.name).toBe("Nova 2 Lite");
			expect(cloned.contextWindow).toBe(128_000);
			expect(cloned.maxTokens).toBe(4096);
		});

		test("rejects ids outside the approved Pawl chat catalog", () => {
			expect(() =>
				resolveApprovedBedrockModel("amazon.titan-text-express-v1", region),
			).toThrow(/approved chat catalog/i);
			expect(() =>
				resolveApprovedBedrockModel("xx.anthropic.claude-sonnet-4-6", region),
			).toThrow(/approved chat catalog/i);
		});

		test("rejects ARN ids whose region conflicts with the selected region", () => {
			expect(() =>
				resolveApprovedBedrockModel(
					"arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-4-6",
					region,
				),
			).toThrow(/conflicts with the selected region/i);
		});

		test("requires complete context/output metadata", () => {
			// The installed catalog is complete, so incompleteness is exercised
			// through the metadata guard the resolver applies.
			expect(() =>
				assertCompleteModelMetadata(syntheticModel({ contextWindow: 0 }), "m"),
			).toThrow(/complete context\/output metadata/i);
			expect(() =>
				assertCompleteModelMetadata(syntheticModel({ maxTokens: 0 }), "m"),
			).toThrow(/complete context\/output metadata/i);
		});

		test("blocks budget-based reasoning under an output cap that cannot exceed the thinking budget", () => {
			const tiny = syntheticModel({
				id: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
				name: "Claude Haiku 4.5 (EU)",
				maxTokens: 4096,
			});
			expect(() => planBedrockReasoning(tiny, "medium")).toThrow(
				/8192.*output cap|output cap.*8192/i,
			);
		});

		test("fails closed for unknown reasoning families instead of guessing", () => {
			const mistral = syntheticModel({
				id: "mistral.mistral-large-2402-v1:0",
				name: "Mistral Large",
				reasoning: false,
			});
			expect(() => planBedrockReasoning(mistral, "medium")).toThrow(
				/unknown for|reasoning behavior/i,
			);
		});

		test("reasoning off sends no reasoning fields", () => {
			const plan = planBedrockReasoning(
				resolveApprovedBedrockModel("eu.anthropic.claude-sonnet-4-6", region),
				"off",
			);
			expect(plan.reasoning).toBeUndefined();
			expect(plan.thinkingBudgets).toBeUndefined();
			expect(plan.novaReasoningConfig).toBeUndefined();
		});

		test("rejects caller-supplied uncontrolled stream options before any request", async () => {
			const { context, dispose } = await offlineContext();
			try {
				const streamFn = createBedrockModelStream(context, {
					reasoning: "medium",
				});
				const model = resolveApprovedBedrockModel(
					"eu.anthropic.claude-sonnet-4-6",
					region,
				);
				const piContext = {
					systemPrompt: "proof",
					messages: [{ role: "user" as const, content: "hi", timestamp: 0 }],
				};
				for (const rejected of [
					{ apiKey: "caller-key" },
					{ bearerToken: "caller-bearer" },
					{ env: { AWS_ACCESS_KEY_ID: "caller" } },
					{ profile: "caller-profile" },
					{ maxTokens: 1 },
					{ reasoning: "high" },
				]) {
					const stream = streamFn(model, piContext, rejected as never);
					for await (const event of stream) {
						expect(event.type).toBe("error");
					}
					const message = await stream.result();
					expect(message.stopReason).toBe("error");
					expect(message.errorMessage).toMatch(
						/uncontrolled|only an abort signal/i,
					);
				}
			} finally {
				dispose();
			}
		});
	});
});
