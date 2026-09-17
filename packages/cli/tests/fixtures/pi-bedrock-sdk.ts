// Offline child for the Bedrock stream feasibility gate: it executes the real
// public `bedrockProviderModule.stream` and the real Pawl runtime module while
// intercepting only the installed `@aws-sdk/client-bedrock-runtime` transport
// boundary inside this isolated subprocess. No network is contacted: the fake
// client answers every send from memory and every capture is printed as
// evidence. Mocking is confined to this child, so the rest of `bun test` never
// sees it.

import { mock } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scenarioName = process.argv[2] ?? "";
assert.ok(scenarioName.length > 0, "a scenario name is required");

const region = "eu-central-1";
const account = "123456789012";
const fixtureArn = `arn:aws:sts::${account}:assumed-role/ProofFixture/session`;

interface SnapshotSpec {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken?: string;
	expiration?: Date;
}

interface ClientCapture {
	config: Record<string, unknown>;
	commands: Record<string, unknown>[];
	sendAbortSignals: unknown[];
	destroyed: number;
}

const captures: ClientCapture[] = [];
const resetCaptures = () => {
	captures.length = 0;
};

// --- Installed SDK boundary mock, installed before any pi-ai import ---------
const sdkEntry = join(
	import.meta.dir,
	"../../../../node_modules/@earendil-works/pi-ai/node_modules/@aws-sdk/client-bedrock-runtime/dist-cjs/index.js",
);
const realSdk = (await import(sdkEntry)) as Record<string, unknown>;
// Keep references to the real SDK classes before the boundary mock replaces
// the module namespace: transport-level hazard probes must use the actual
// installed client, never the fake.
type RealBedrockRuntimeClientClass = new (
	config: Record<string, unknown>,
) => {
	send(command: unknown): Promise<unknown>;
	destroy(): void;
};
const RealBedrockRuntimeClient =
	realSdk.BedrockRuntimeClient as unknown as RealBedrockRuntimeClientClass;
const RealConverseStreamCommand =
	realSdk.ConverseStreamCommand as unknown as new (
		input: unknown,
	) => unknown;

async function* fixtureStream() {
	yield { messageStart: { role: "assistant" } };
	yield {
		contentBlockDelta: { contentBlockIndex: 0, delta: { text: "proof" } },
	};
	yield { contentBlockStop: { contentBlockIndex: 0 } };
	yield { messageStop: { stopReason: "end_turn" } };
	yield {
		metadata: { usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } },
	};
}

class FakeBedrockRuntimeClient {
	readonly middlewareStack = {
		add(): void {},
		remove(): void {},
	};
	constructor(readonly config: Record<string, unknown>) {
		captures.push({ config, commands: [], sendAbortSignals: [], destroyed: 0 });
	}
	async send(
		command: { input: Record<string, unknown> },
		options?: { abortSignal?: AbortSignal },
	) {
		const capture = captures[captures.length - 1];
		assert.ok(capture, "a client must be constructed before send");
		capture.commands.push({ ...command.input });
		capture.sendAbortSignals.push(options?.abortSignal ?? undefined);
		return {
			stream: fixtureStream(),
			$metadata: { httpStatusCode: 200, requestId: "fixture-request" },
		};
	}
	destroy(): void {
		const capture = captures[captures.length - 1];
		assert.ok(capture, "a client must be constructed before destroy");
		capture.destroyed++;
	}
}

mock.module(sdkEntry, () => ({
	...realSdk,
	BedrockRuntimeClient: FakeBedrockRuntimeClient,
}));

// pi-ai and Pawl modules load only after the boundary mock is installed.
const { bedrockProviderModule } = await import(
	"@earendil-works/pi-ai/bedrock-provider"
);
const { createBedrockModelStream, resolveApprovedBedrockModel } = await import(
	"../../src/pi-runtime/bedrock"
);
const { createExecutionContext } = await import(
	"../../src/pi-runtime/execution-context"
);

interface IdentitySpec {
	Account: string;
	Arn: string;
}

interface ContextSpec {
	snapshots: SnapshotSpec[];
	identities?: IdentitySpec[];
	clock?: { value: number };
}

interface BuiltContext {
	context: Awaited<ReturnType<typeof createExecutionContext>>;
	acquisitions: () => number;
	clock: { value: number };
	projectDir: string;
}

async function buildContext(spec: ContextSpec): Promise<BuiltContext> {
	const projectDir = mkdtempSync(join(tmpdir(), "pawl-bedrock-proof-"));
	const clock = spec.clock ?? { value: 1_700_000_000_000 };
	let acquisitions = 0;
	const context = await createExecutionContext(
		{ projectDir, profile: "proof", region },
		{
			credentialsFromIni: () => async () => {
				acquisitions++;
				const snapshot =
					spec.snapshots[Math.min(acquisitions - 1, spec.snapshots.length - 1)];
				assert.ok(snapshot, "fixture snapshot queue is empty");
				return snapshot;
			},
			identityClient: (config) => {
				assert.equal(config.region, region, "identity client region");
				const identity = spec.identities?.[
					Math.min(acquisitions - 1, (spec.identities?.length ?? 1) - 1)
				] ?? { Account: account, Arn: fixtureArn };
				return {
					identify: async () => ({
						Account: identity.Account,
						Arn: identity.Arn,
					}),
					destroy(): void {},
				};
			},
			now: () => clock.value,
		},
	);
	contextDirectories.push(projectDir);
	return { context, acquisitions: () => acquisitions, clock, projectDir };
}

const contextDirectories: string[] = [];
function disposeContexts(): void {
	for (const directory of contextDirectories) {
		rmSync(directory, { recursive: true, force: true });
	}
}

const piContext = {
	systemPrompt: "proof",
	messages: [{ role: "user" as const, content: "hello", timestamp: 0 }],
	tools: [],
};

interface StreamOutcome {
	events: string[];
	stopReason: string | undefined;
	errorMessage: string | undefined;
}

async function streamOnce(
	streamFn: ReturnType<typeof createBedrockModelStream>,
	model: Parameters<typeof streamFn>[0],
	signal?: AbortSignal,
): Promise<StreamOutcome> {
	const events: string[] = [];
	let stopReason: string | undefined;
	let errorMessage: string | undefined;
	const stream = streamFn(model, piContext, signal ? { signal } : {});
	for await (const event of stream) {
		events.push(event.type);
		if (event.type === "done" || event.type === "error") {
			stopReason = event.reason;
			errorMessage =
				event.type === "error" ? event.error.errorMessage : undefined;
		}
	}
	return { events, stopReason, errorMessage };
}

function checkedSnapshot(
	accessKeyId: string,
	sessionToken: string | undefined,
	lifetimeMs: number,
	clock: { value: number },
): SnapshotSpec {
	return {
		accessKeyId,
		secretAccessKey: "checked-secret",
		...(sessionToken === undefined ? {} : { sessionToken }),
		expiration: new Date(clock.value + lifetimeMs),
	};
}

function configOf(capture: ClientCapture | undefined) {
	assert.ok(capture, "a BedrockRuntimeClient must have been constructed");
	const config = capture.config;
	return {
		region: config.region,
		profile: config.profile,
		credentials: config.credentials,
		authSchemePreference: config.authSchemePreference,
		token: config.token,
		endpoint: config.endpoint,
		requestHandler: config.requestHandler === undefined ? undefined : "present",
	};
}

function commandOf(capture: ClientCapture | undefined) {
	assert.ok(capture, "a BedrockRuntimeClient must have been constructed");
	assert.equal(capture.commands.length, 1, "exactly one command per request");
	const input = capture.commands[0];
	assert.ok(input, "the captured command input must exist");
	return {
		modelId: input.modelId,
		inferenceConfig: input.inferenceConfig,
		additionalModelRequestFields: input.additionalModelRequestFields,
	};
}

async function runScenario(): Promise<Record<string, unknown>> {
	switch (scenarioName) {
		case "profile-credentials-precedence": {
			// Ambient profile, ambient keys and ambient regions all exist; the
			// checked snapshot's explicit credential object must win.
			assert.equal(process.env.AWS_PROFILE, "ambient-profile");
			assert.equal(process.env.AWS_ACCESS_KEY_ID, "ambient-key");
			assert.equal(process.env.AWS_BEARER_TOKEN_BEDROCK, undefined);
			const clock = { value: 1_700_000_000_000 };
			const { context } = await buildContext({
				clock,
				snapshots: [
					{
						accessKeyId: "checked-key",
						secretAccessKey: "checked-secret",
						sessionToken: "checked-token",
						expiration: new Date(clock.value + 3_600_000),
					},
				],
			});
			const streamFn = createBedrockModelStream(context, {
				reasoning: "medium",
			});
			const model = resolveApprovedBedrockModel(
				"eu.anthropic.claude-haiku-4-5-20251001-v1:0",
				region,
			);
			const outcome = await streamOnce(streamFn, model);
			assert.equal(captures.length, 1);
			const config = configOf(captures[0]);
			assert.deepEqual(config.credentials, {
				accessKeyId: "checked-key",
				secretAccessKey: "checked-secret",
				sessionToken: "checked-token",
			});
			// Documented installed behavior: the ambient profile name still
			// reaches the client config, but the SDK's explicit credential
			// object takes precedence over profile resolution.
			assert.equal(config.profile, "ambient-profile");
			assert.equal(config.region, region);
			assert.equal(config.authSchemePreference, undefined);
			assert.equal(config.token, undefined);
			assert.equal(config.endpoint, undefined);
			assert.equal(config.requestHandler, undefined);
			const command = commandOf(captures[0]);
			assert.equal(
				command.modelId,
				"eu.anthropic.claude-haiku-4-5-20251001-v1:0",
			);
			assert.deepEqual(command.inferenceConfig, { maxTokens: 64000 });
			const fields = command.additionalModelRequestFields as Record<
				string,
				unknown
			>;
			assert.deepEqual(fields.thinking, {
				type: "enabled",
				budget_tokens: 8192,
				display: "summarized",
			});
			assert.deepEqual(fields.anthropic_beta, [
				"interleaved-thinking-2025-05-14",
			]);
			assert.equal(outcome.stopReason, "stop");
			return {
				scenario: scenarioName,
				offline: true,
				clients: captures.length,
				config,
				command,
				final: outcome,
				acquisitions: 1,
			};
		}
		case "clean-env": {
			assert.equal(process.env.AWS_PROFILE, undefined);
			assert.equal(process.env.AWS_ACCESS_KEY_ID, undefined);
			assert.equal(process.env.AWS_REGION, undefined);
			const clock = { value: 1_700_000_000_000 };
			const { context } = await buildContext({
				clock,
				snapshots: [
					checkedSnapshot("checked-key", "checked-token", 3_600_000, clock),
				],
			});
			const streamFn = createBedrockModelStream(context, {
				reasoning: "medium",
			});
			const model = resolveApprovedBedrockModel(
				"eu.anthropic.claude-sonnet-4-6",
				region,
			);
			const outcome = await streamOnce(streamFn, model);
			assert.equal(captures.length, 1);
			const config = configOf(captures[0]);
			assert.equal(config.profile, undefined);
			assert.deepEqual(config.credentials, {
				accessKeyId: "checked-key",
				secretAccessKey: "checked-secret",
				sessionToken: "checked-token",
			});
			assert.equal(config.region, region);
			const command = commandOf(captures[0]);
			assert.equal(command.modelId, "eu.anthropic.claude-sonnet-4-6");
			assert.deepEqual(command.additionalModelRequestFields, {
				thinking: { type: "adaptive", display: "summarized" },
				output_config: { effort: "medium" },
			});
			assert.equal(outcome.stopReason, "stop");
			return {
				scenario: scenarioName,
				offline: true,
				clients: captures.length,
				config,
				command,
				final: outcome,
			};
		}
		case "claude-budget-reasoning": {
			const clock = { value: 1_700_000_000_000 };
			const { context } = await buildContext({
				clock,
				snapshots: [
					checkedSnapshot("checked-key", "checked-token", 3_600_000, clock),
				],
			});
			const streamFn = createBedrockModelStream(context, {
				reasoning: "medium",
			});
			const model = resolveApprovedBedrockModel(
				"eu.anthropic.claude-haiku-4-5-20251001-v1:0",
				region,
			);
			const outcome = await streamOnce(streamFn, model);
			assert.equal(captures.length, 1);
			const command = commandOf(captures[0]);
			assert.equal(
				command.modelId,
				"eu.anthropic.claude-haiku-4-5-20251001-v1:0",
			);
			// Explicit output cap above the explicit thinking budget: never an
			// 8192-token thinking budget under a 4096-token output cap.
			assert.deepEqual(command.inferenceConfig, { maxTokens: 64000 });
			assert.deepEqual(command.additionalModelRequestFields, {
				thinking: {
					type: "enabled",
					budget_tokens: 8192,
					display: "summarized",
				},
				anthropic_beta: ["interleaved-thinking-2025-05-14"],
			});
			assert.equal(outcome.stopReason, "stop");
			return {
				scenario: scenarioName,
				offline: true,
				clients: captures.length,
				command,
				final: outcome,
			};
		}
		case "claude-adaptive-reasoning": {
			const clock = { value: 1_700_000_000_000 };
			const { context } = await buildContext({
				clock,
				snapshots: [
					checkedSnapshot("checked-key", "checked-token", 3_600_000, clock),
				],
			});
			const streamFn = createBedrockModelStream(context, {
				reasoning: "medium",
			});
			const model = resolveApprovedBedrockModel(
				"eu.anthropic.claude-sonnet-4-6",
				region,
			);
			const outcome = await streamOnce(streamFn, model);
			assert.equal(captures.length, 1);
			const command = commandOf(captures[0]);
			assert.equal(command.modelId, "eu.anthropic.claude-sonnet-4-6");
			assert.deepEqual(command.inferenceConfig, { maxTokens: 64000 });
			assert.deepEqual(command.additionalModelRequestFields, {
				thinking: { type: "adaptive", display: "summarized" },
				output_config: { effort: "medium" },
			});
			assert.equal(outcome.stopReason, "stop");
			return {
				scenario: scenarioName,
				offline: true,
				clients: captures.length,
				command,
				final: outcome,
			};
		}
		case "nova-reasoning": {
			const clock = { value: 1_700_000_000_000 };
			const { context } = await buildContext({
				clock,
				snapshots: [
					checkedSnapshot("checked-key", "checked-token", 3_600_000, clock),
				],
			});
			const streamFn = createBedrockModelStream(context, {
				reasoning: "medium",
			});
			const model = resolveApprovedBedrockModel(
				"eu.amazon.nova-2-lite-v1:0",
				region,
			);
			// The base catalog entry is cloned with the exact selected
			// inference-profile id; complete metadata is preserved.
			assert.equal(model.id, "eu.amazon.nova-2-lite-v1:0");
			assert.equal(model.contextWindow, 128_000);
			assert.equal(model.maxTokens, 4096);
			const outcome = await streamOnce(streamFn, model);
			assert.equal(captures.length, 1);
			const command = commandOf(captures[0]);
			// Invocation must never substitute the base id.
			assert.equal(command.modelId, "eu.amazon.nova-2-lite-v1:0");
			assert.deepEqual(command.inferenceConfig, { maxTokens: 4096 });
			assert.deepEqual(command.additionalModelRequestFields, {
				reasoningConfig: { type: "enabled", maxReasoningEffort: "medium" },
			});
			assert.equal(outcome.stopReason, "stop");
			return {
				scenario: scenarioName,
				offline: true,
				clients: captures.length,
				command,
				final: outcome,
			};
		}
		case "bearer-hazard": {
			assert.equal(process.env.AWS_BEARER_TOKEN_BEDROCK, "ambient-bearer");
			const clock = { value: 1_700_000_000_000 };
			const { context } = await buildContext({
				clock,
				snapshots: [
					checkedSnapshot("checked-key", "checked-token", 3_600_000, clock),
				],
			});
			const model = resolveApprovedBedrockModel(
				"eu.anthropic.claude-sonnet-4-6",
				region,
			);
			// Hazard probe: a naive integration that scopes keys and region but
			// not the bearer token would silently authenticate as the ambient
			// bearer token instead of the checked snapshot.
			const naive = bedrockProviderModule.stream(model, piContext, {
				region,
				env: {
					AWS_ACCESS_KEY_ID: "checked-key",
					AWS_SECRET_ACCESS_KEY: "checked-secret",
					AWS_SESSION_TOKEN: "checked-token",
					AWS_REGION: region,
					AWS_DEFAULT_REGION: region,
					AWS_BEDROCK_SKIP_AUTH: "0",
				},
			});
			const probeEvents: string[] = [];
			for await (const event of naive) probeEvents.push(event.type);
			assert.equal(captures.length, 1);
			const probeConfig = configOf(captures[0]);
			assert.deepEqual(probeConfig.token, { token: "ambient-bearer" });
			assert.deepEqual(probeConfig.authSchemePreference, ["httpBearerAuth"]);
			// The wrapper must fail closed before any client is constructed.
			resetCaptures();
			const streamFn = createBedrockModelStream(context, {
				reasoning: "medium",
			});
			const outcome = await streamOnce(streamFn, model);
			assert.equal(captures.length, 0);
			assert.equal(outcome.stopReason, "error");
			assert.match(outcome.errorMessage ?? "", /bearer/i);
			return {
				scenario: scenarioName,
				offline: true,
				probe: {
					bearerTokenLeaked: true,
					authSchemePreference: probeConfig.authSchemePreference,
					probeEvents,
				},
				failedClosed: true,
				clients: captures.length,
				final: outcome,
			};
		}
		case "skip-auth-hazard": {
			assert.equal(process.env.AWS_BEDROCK_SKIP_AUTH, "1");
			const clock = { value: 1_700_000_000_000 };
			const { context } = await buildContext({
				clock,
				snapshots: [
					checkedSnapshot("checked-key", "checked-token", 3_600_000, clock),
				],
			});
			const model = resolveApprovedBedrockModel(
				"eu.anthropic.claude-sonnet-4-6",
				region,
			);
			// Hazard probe: without the scoped skip-auth override the provider
			// builds dummy credentials and sends an unsigned request.
			const naive = bedrockProviderModule.stream(model, piContext, {
				region,
				env: {
					AWS_ACCESS_KEY_ID: "checked-key",
					AWS_SECRET_ACCESS_KEY: "checked-secret",
					AWS_SESSION_TOKEN: "checked-token",
					AWS_REGION: region,
					AWS_DEFAULT_REGION: region,
				},
			});
			for await (const event of naive) event.type;
			assert.equal(captures.length, 1);
			const probeConfig = configOf(captures[0]);
			assert.deepEqual(probeConfig.credentials, {
				accessKeyId: "dummy-access-key",
				secretAccessKey: "dummy-secret-key",
			});
			// With the wrapper the scoped "0" keeps real SigV4 credentials.
			resetCaptures();
			const streamFn = createBedrockModelStream(context, {
				reasoning: "medium",
			});
			const outcome = await streamOnce(streamFn, model);
			assert.equal(captures.length, 1);
			const config = configOf(captures[0]);
			assert.deepEqual(config.credentials, {
				accessKeyId: "checked-key",
				secretAccessKey: "checked-secret",
				sessionToken: "checked-token",
			});
			assert.equal(config.token, undefined);
			assert.equal(outcome.stopReason, "stop");
			return {
				scenario: scenarioName,
				offline: true,
				probe: { dummyCredentials: true },
				clients: captures.length,
				config,
				final: outcome,
			};
		}
		case "empty-env-fallthrough-hazard": {
			assert.equal(process.env.AWS_ACCESS_KEY_ID, "ambient-key");
			assert.equal(process.env.AWS_SECRET_ACCESS_KEY, "ambient-secret");
			assert.equal(process.env.AWS_SESSION_TOKEN, "ambient-token");
			const model = resolveApprovedBedrockModel(
				"eu.anthropic.claude-sonnet-4-6",
				region,
			);
			// Hazard probe: empty-string scoped values do not clear ambient
			// values (installed `env[name] || process.env[name]` lookup), so the
			// client would silently resolve ambient credentials.
			const naive = bedrockProviderModule.stream(model, piContext, {
				region,
				env: {
					AWS_ACCESS_KEY_ID: "",
					AWS_SECRET_ACCESS_KEY: "",
					AWS_SESSION_TOKEN: "",
					AWS_REGION: region,
					AWS_DEFAULT_REGION: region,
					AWS_BEDROCK_SKIP_AUTH: "0",
				},
			});
			for await (const event of naive) event.type;
			assert.equal(captures.length, 1);
			const probeConfig = configOf(captures[0]);
			assert.deepEqual(probeConfig.credentials, {
				accessKeyId: "ambient-key",
				secretAccessKey: "ambient-secret",
				sessionToken: "ambient-token",
			});
			return {
				scenario: scenarioName,
				offline: true,
				probe: { ambientLeakThroughEmptyOverride: true },
				clients: captures.length,
			};
		}
		case "session-token-ambient-fail-closed": {
			assert.equal(process.env.AWS_SESSION_TOKEN, "ambient-stale-token");
			const clock = { value: 1_700_000_000_000 };
			const { context } = await buildContext({
				clock,
				// Selected credentials without a session token.
				snapshots: [
					checkedSnapshot("checked-key", undefined, 3_600_000, clock),
				],
			});
			const streamFn = createBedrockModelStream(context, {
				reasoning: "medium",
			});
			const model = resolveApprovedBedrockModel(
				"eu.anthropic.claude-sonnet-4-6",
				region,
			);
			const outcome = await streamOnce(streamFn, model);
			assert.equal(captures.length, 0);
			assert.equal(outcome.stopReason, "error");
			assert.match(outcome.errorMessage ?? "", /session token/i);
			return {
				scenario: scenarioName,
				offline: true,
				failedClosed: true,
				clients: captures.length,
				final: outcome,
			};
		}
		case "credential-refresh": {
			const clock = { value: 1_700_000_000_000 };
			const { context, acquisitions } = await buildContext({
				clock,
				snapshots: [
					{
						accessKeyId: "gen-a-key",
						secretAccessKey: "checked-secret",
						sessionToken: "gen-a-token",
						expiration: new Date(clock.value + 3_600_000),
					},
					{
						accessKeyId: "gen-b-key",
						secretAccessKey: "checked-secret",
						sessionToken: "gen-b-token",
						expiration: new Date(clock.value + 7_200_000),
					},
					// Third acquisition returns already-expired credentials.
					{
						accessKeyId: "gen-c-key",
						secretAccessKey: "checked-secret",
						sessionToken: "gen-c-token",
						expiration: new Date(clock.value - 60_000),
					},
				],
			});
			const streamFn = createBedrockModelStream(context, {
				reasoning: "medium",
			});
			const model = resolveApprovedBedrockModel(
				"eu.anthropic.claude-sonnet-4-6",
				region,
			);
			const first = await streamOnce(streamFn, model);
			assert.equal(captures.length, 1);
			assert.deepEqual(configOf(captures[0]).credentials, {
				accessKeyId: "gen-a-key",
				secretAccessKey: "checked-secret",
				sessionToken: "gen-a-token",
			});
			// Same generation is reused inside the five-minute lease window.
			const second = await streamOnce(streamFn, model);
			assert.equal(captures.length, 2);
			assert.deepEqual(configOf(captures[1]).credentials, {
				accessKeyId: "gen-a-key",
				secretAccessKey: "checked-secret",
				sessionToken: "gen-a-token",
			});
			// Advance past the lease: a fresh checked generation is acquired and
			// observed at the SDK boundary.
			clock.value += 6 * 60_000;
			const third = await streamOnce(streamFn, model);
			assert.equal(captures.length, 3);
			assert.deepEqual(configOf(captures[2]).credentials, {
				accessKeyId: "gen-b-key",
				secretAccessKey: "checked-secret",
				sessionToken: "gen-b-token",
			});
			// Advance past the next lease and the third snapshot's expiration:
			// the expired generation fails closed.
			clock.value += 6 * 60_000;
			const fourth = await streamOnce(streamFn, model);
			assert.equal(captures.length, 3);
			assert.equal(fourth.stopReason, "error");
			assert.match(fourth.errorMessage ?? "", /expired/i);
			for (const outcome of [first, second, third]) {
				assert.equal(outcome.stopReason, "stop");
			}
			return {
				scenario: scenarioName,
				offline: true,
				clients: captures.length,
				generationsObserved: captures.map(
					(capture) =>
						(capture.config.credentials as Record<string, unknown> | undefined)
							?.accessKeyId,
				),
				expiredFailure: {
					stopReason: fourth.stopReason,
					errorMessage: fourth.errorMessage,
				},
				acquisitions: acquisitions(),
			};
		}
		case "identity-change": {
			const clock = { value: 1_700_000_000_000 };
			const { context } = await buildContext({
				clock,
				snapshots: [
					{
						accessKeyId: "gen-a-key",
						secretAccessKey: "checked-secret",
						sessionToken: "gen-a-token",
						// Long-lived credentials: the local five-minute reuse
						// window is what ends, so the refresh re-checks identity.
						expiration: new Date(clock.value + 3_600_000),
					},
				],
				identities: [
					{
						Account: account,
						Arn: `arn:aws:sts::${account}:assumed-role/ProofFixture/session`,
					},
					{
						Account: "999999999999",
						Arn: "arn:aws:sts::999999999999:assumed-role/DifferentFixture/session",
					},
				],
			});
			const streamFn = createBedrockModelStream(context, {
				reasoning: "medium",
			});
			const model = resolveApprovedBedrockModel(
				"eu.anthropic.claude-sonnet-4-6",
				region,
			);
			clock.value += 6 * 60_000;
			const outcome = await streamOnce(streamFn, model);
			assert.equal(captures.length, 0);
			assert.equal(outcome.stopReason, "error");
			assert.match(outcome.errorMessage ?? "", /identity changed/i);
			return {
				scenario: scenarioName,
				offline: true,
				clients: captures.length,
				final: outcome,
			};
		}
		case "cancellation": {
			const clock = { value: 1_700_000_000_000 };
			const { context } = await buildContext({
				clock,
				snapshots: [
					checkedSnapshot("checked-key", "checked-token", 3_600_000, clock),
				],
			});
			const streamFn = createBedrockModelStream(context, {
				reasoning: "medium",
			});
			const model = resolveApprovedBedrockModel(
				"eu.anthropic.claude-sonnet-4-6",
				region,
			);
			const controller = new AbortController();
			controller.abort(new Error("caller cancelled before credentials"));
			const outcome = await streamOnce(streamFn, model, controller.signal);
			assert.equal(captures.length, 0);
			assert.equal(outcome.stopReason, "aborted");
			assert.match(outcome.errorMessage ?? "", /cancelled before credentials/i);
			return {
				scenario: scenarioName,
				offline: true,
				clients: captures.length,
				final: outcome,
			};
		}
		case "region-conflict": {
			const clock = { value: 1_700_000_000_000 };
			const { context } = await buildContext({
				clock,
				snapshots: [
					checkedSnapshot("checked-key", "checked-token", 3_600_000, clock),
				],
			});
			const streamFn = createBedrockModelStream(context, {
				reasoning: "medium",
			});
			const conflicting = {
				...resolveApprovedBedrockModel(
					"eu.anthropic.claude-sonnet-4-6",
					region,
				),
				id: "arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-4-6",
			} as Parameters<typeof streamFn>[0];
			const outcome = await streamOnce(streamFn, conflicting);
			assert.equal(captures.length, 0);
			assert.equal(outcome.stopReason, "error");
			assert.match(
				outcome.errorMessage ?? "",
				/conflicts with the selected region/i,
			);
			return {
				scenario: scenarioName,
				offline: true,
				clients: captures.length,
				final: outcome,
			};
		}
		case "ambient-endpoint-hazard": {
			assert.equal(
				process.env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME,
				"https://service-attacker.invalid",
			);
			assert.equal(
				process.env.AWS_ENDPOINT_URL,
				"https://global-attacker.invalid",
			);
			// Transport-level hazard probe: the REAL installed client (kept from
			// before the boundary mock) honors ambient endpoint env vars at
			// request time even with explicit checked credentials and region.
			let observedHostname: string | undefined;
			let observedAuthorization: string | undefined;
			const realClient = new RealBedrockRuntimeClient({
				region,
				credentials: {
					accessKeyId: "checked-key",
					secretAccessKey: "checked-secret",
					sessionToken: "checked-token",
				},
				requestHandler: {
					async handle(request: {
						hostname: string;
						headers: Record<string, string | undefined>;
					}) {
						observedHostname = request.hostname;
						observedAuthorization = request.headers.authorization;
						throw new Error("fixture transport refused");
					},
					destroy(): void {},
				},
			});
			try {
				await realClient.send(
					new RealConverseStreamCommand({
						modelId: "eu.anthropic.claude-sonnet-4-6",
					}),
				);
			} catch {
				// The stub handler refuses every request; only the wire shape is
				// observed here.
			}
			realClient.destroy();
			assert.equal(observedHostname, "service-attacker.invalid");
			assert.match(observedAuthorization ?? "", /Credential=checked-key\//);
			// The wrapper must refuse to stream in this environment.
			resetCaptures();
			const clock = { value: 1_700_000_000_000 };
			const { context } = await buildContext({
				clock,
				snapshots: [
					checkedSnapshot("checked-key", "checked-token", 3_600_000, clock),
				],
			});
			const streamFn = createBedrockModelStream(context, {
				reasoning: "medium",
			});
			const model = resolveApprovedBedrockModel(
				"eu.anthropic.claude-sonnet-4-6",
				region,
			);
			const outcome = await streamOnce(streamFn, model);
			assert.equal(captures.length, 0);
			assert.equal(outcome.stopReason, "error");
			assert.match(outcome.errorMessage ?? "", /custom endpoints|ambient/i);
			return {
				scenario: scenarioName,
				offline: true,
				probe: {
					hazardHostname: observedHostname,
					signedWithCheckedKey: (observedAuthorization ?? "").includes(
						"Credential=checked-key/",
					),
				},
				clients: captures.length,
				final: outcome,
			};
		}
		case "custom-endpoint": {
			const clock = { value: 1_700_000_000_000 };
			const { context } = await buildContext({
				clock,
				snapshots: [
					checkedSnapshot("checked-key", "checked-token", 3_600_000, clock),
				],
			});
			const streamFn = createBedrockModelStream(context, {
				reasoning: "medium",
			});
			const custom = {
				...resolveApprovedBedrockModel(
					"eu.anthropic.claude-sonnet-4-6",
					region,
				),
				baseUrl: "https://custom-proxy.example.invalid/bedrock",
			} as Parameters<typeof streamFn>[0];
			const outcome = await streamOnce(streamFn, custom);
			assert.equal(captures.length, 0);
			assert.equal(outcome.stopReason, "error");
			assert.match(outcome.errorMessage ?? "", /custom endpoint/i);
			return {
				scenario: scenarioName,
				offline: true,
				clients: captures.length,
				final: outcome,
			};
		}
		default:
			throw new Error(`unknown scenario ${scenarioName}`);
	}
}

const evidence = await runScenario();
console.log(JSON.stringify({ ...evidence, offline: true }));
if (evidence.scenario !== scenarioName) {
	throw new Error("scenario evidence mismatch");
}
disposeContexts();
