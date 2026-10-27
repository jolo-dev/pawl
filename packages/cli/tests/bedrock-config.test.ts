import { afterEach, expect, test } from "bun:test";
import { pawlModelConfig } from "../agent/lib/bedrock";

const original = {
	AWS_REGION: process.env.AWS_REGION,
	PAWL_BEDROCK_MODEL: process.env.PAWL_BEDROCK_MODEL,
	PAWL_CONTEXT_WINDOW_TOKENS: process.env.PAWL_CONTEXT_WINDOW_TOKENS,
};
afterEach(() => {
	for (const [key, value] of Object.entries(original)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

test("resolves model and provider options together after compilation-time model changes", async () => {
	// Eve caches the authored definition. The next launch can select Nova even
	// when that generation was compiled with Claude in the environment.
	process.env.PAWL_BEDROCK_MODEL = "eu.anthropic.claude-sonnet-4-6";
	const config = pawlModelConfig();
	expect(config.model).toHaveProperty(["events", "step.started"]);
	expect(config).not.toHaveProperty("modelOptions");
	expect(config).not.toHaveProperty("modelContextWindowTokens");

	process.env.AWS_REGION = "eu-central-1";
	process.env.PAWL_BEDROCK_MODEL = "eu.amazon.nova-2-lite-v1:0";
	process.env.PAWL_CONTEXT_WINDOW_TOKENS = "64000";
	const resolve = config.model.events["step.started"];
	if (!resolve) throw new Error("missing runtime model resolver");
	const context = {
		session: { id: "test", auth: { current: null, initiator: null } },
		channel: { kind: "http" },
		messages: [],
	};
	const event = {
		type: "step.started",
		data: { turnId: "turn_0", stepIndex: 0 },
	};
	const nova = await resolve(event, context);
	expect(nova.model.modelId).toBe("eu.amazon.nova-2-lite-v1:0");
	expect(nova.modelContextWindowTokens).toBe(64000);
	expect(nova.modelOptions?.providerOptions).toEqual({
		amazonBedrock: {
			reasoningConfig: { type: "enabled", maxReasoningEffort: "medium" },
		},
	});

	process.env.PAWL_BEDROCK_MODEL = "eu.anthropic.claude-sonnet-4-6";
	const claude = await resolve(event, context);
	expect(claude.model.modelId).toBe("eu.anthropic.claude-sonnet-4-6");
	expect(claude.modelOptions).toBeUndefined();
});
