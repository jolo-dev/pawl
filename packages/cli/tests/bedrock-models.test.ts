import { describe, expect, test } from "bun:test";
import {
	contextWindowForModel,
	DEFAULT_BEDROCK_MODEL_ID,
	groupBedrockModels,
} from "../src/bedrock-models";

describe("DEFAULT_BEDROCK_MODEL_ID", () => {
	test("is the Nova 2 Lite eu inference profile", () => {
		expect(DEFAULT_BEDROCK_MODEL_ID).toBe("eu.amazon.nova-2-lite-v1:0");
	});
});

describe("contextWindowForModel", () => {
	test("reports Nova 2 Lite's 128k window, per pi-ai's verified value", () => {
		// A public model list reports 1M. pi-ai — the team that actually drives
		// these models — says 128k, and an over-estimate is the dangerous
		// direction: eve compacts at 90% of this, so a wrong high number lets
		// requests overflow the model.
		expect(contextWindowForModel("eu.amazon.nova-2-lite-v1:0")).toBe(128_000);
		expect(contextWindowForModel("global.amazon.nova-2-lite-v1:0")).toBe(
			128_000,
		);
	});

	test("reports Claude Sonnet 4.6's 1M window regardless of profile prefix", () => {
		expect(contextWindowForModel("us.anthropic.claude-sonnet-4-6")).toBe(
			1_000_000,
		);
		expect(contextWindowForModel("eu.anthropic.claude-sonnet-4-6")).toBe(
			1_000_000,
		);
	});

	test("falls back conservatively for an unknown model", () => {
		expect(contextWindowForModel("eu.unknown.model-v9:0")).toBe(200_000);
	});

	test("honours an explicit override", () => {
		expect(contextWindowForModel("eu.amazon.nova-2-lite-v1:0", "512000")).toBe(
			512_000,
		);
	});

	test("ignores a blank or nonsense override", () => {
		expect(contextWindowForModel("eu.amazon.nova-2-lite-v1:0", "  ")).toBe(
			128_000,
		);
		expect(contextWindowForModel("eu.amazon.nova-2-lite-v1:0", "abc")).toBe(
			128_000,
		);
	});
});

describe("groupBedrockModels", () => {
	test("groups a base model with its inference-profile scopes", () => {
		const groups = groupBedrockModels(
			[
				{
					modelId: "anthropic.claude-sonnet-4-6",
					modelName: "Claude Sonnet 4.6",
					providerName: "Anthropic",
					inputModalities: ["TEXT"],
					outputModalities: ["TEXT"],
				},
			],
			[
				{ inferenceProfileId: "eu.anthropic.claude-sonnet-4-6" },
				{ inferenceProfileId: "us.anthropic.claude-sonnet-4-6" },
			],
		);

		expect(groups).toHaveLength(1);
		expect(groups[0]?.baseId).toBe("anthropic.claude-sonnet-4-6");
		expect(groups[0]?.provider).toBe("anthropic");
		expect(groups[0]?.name).toBe("Claude Sonnet 4.6");
		expect([...(groups[0]?.scopes ?? [])].sort()).toEqual([
			"eu.anthropic.claude-sonnet-4-6",
			"us.anthropic.claude-sonnet-4-6",
		]);
	});

	test("falls back to the bare model id when no inference profile exists", () => {
		const groups = groupBedrockModels(
			[
				{
					modelId: "amazon.nova-pro-v1:0",
					modelName: "Nova Pro",
					providerName: "Amazon",
					inputModalities: ["TEXT"],
					outputModalities: ["TEXT"],
				},
			],
			[],
		);

		expect(groups[0]?.scopes).toEqual(["amazon.nova-pro-v1:0"]);
	});

	test("keeps only text-output models", () => {
		const groups = groupBedrockModels(
			[
				{
					modelId: "amazon.titan-embed-text-v2:0",
					modelName: "Titan Embed",
					providerName: "Amazon",
					inputModalities: ["TEXT"],
					outputModalities: ["EMBEDDING"],
				},
				{
					modelId: "anthropic.claude-opus-4-8",
					modelName: "Claude Opus 4.8",
					providerName: "Anthropic",
					inputModalities: ["TEXT"],
					outputModalities: ["TEXT"],
				},
			],
			[],
		);

		expect(groups.map((g) => g.baseId)).toEqual(["anthropic.claude-opus-4-8"]);
	});

	test("drops ids that are not curated chat models", () => {
		// Bedrock reports rerankers and video models with a TEXT output modality,
		// but they cannot serve a conversation. This is the bug a raw dump had.
		const groups = groupBedrockModels(
			[
				{ modelId: "amazon.rerank-v1:0", outputModalities: ["TEXT"] },
				{ modelId: "twelvelabs.pegasus-1-2-v1:0", outputModalities: ["TEXT"] },
				{ modelId: "anthropic.claude-sonnet-4-6", outputModalities: ["TEXT"] },
			],
			[],
		);

		expect(groups.map((g) => g.baseId)).toEqual([
			"anthropic.claude-sonnet-4-6",
		]);
	});

	test("orders scopes so the region's own profile is offered first", () => {
		const groups = groupBedrockModels(
			[
				{
					modelId: "amazon.nova-2-lite-v1:0",
					outputModalities: ["TEXT"],
				},
			],
			[
				{ inferenceProfileId: "global.amazon.nova-2-lite-v1:0" },
				{ inferenceProfileId: "eu.amazon.nova-2-lite-v1:0" },
			],
			undefined,
			"eu-central-1",
		);

		// Being listed does not mean the account can invoke it: a regional profile
		// is far more likely to be enabled than a global one, so it goes first.
		expect(groups[0]?.scopes).toEqual([
			"eu.amazon.nova-2-lite-v1:0",
			"global.amazon.nova-2-lite-v1:0",
		]);
	});

	test("takes names and context windows from the catalog", () => {
		const groups = groupBedrockModels(
			[{ modelId: "amazon.nova-2-lite-v1:0", outputModalities: ["TEXT"] }],
			[],
		);

		expect(groups[0]?.name).toBe("Nova 2 Lite");
	});
});
