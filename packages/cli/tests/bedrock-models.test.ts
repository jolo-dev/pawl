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
	test("reports Nova 2 Lite's 1M window", () => {
		expect(contextWindowForModel("eu.amazon.nova-2-lite-v1:0")).toBe(1_000_000);
		expect(contextWindowForModel("global.amazon.nova-2-lite-v1:0")).toBe(
			1_000_000,
		);
	});

	test("reports Claude's 200k window regardless of profile prefix", () => {
		expect(contextWindowForModel("us.anthropic.claude-sonnet-4-6")).toBe(
			200_000,
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
			1_000_000,
		);
		expect(contextWindowForModel("eu.amazon.nova-2-lite-v1:0", "abc")).toBe(
			1_000_000,
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

	test("ignores malformed catalog entries", () => {
		const groups = groupBedrockModels(
			[{ modelName: "No id" }, { modelId: "x.y", outputModalities: ["TEXT"] }],
			[{}, { inferenceProfileId: "eu.x.y" }],
		);

		expect(groups.map((g) => g.baseId)).toEqual(["x.y"]);
		expect(groups[0]?.name).toBe("x.y");
		expect(groups[0]?.scopes).toEqual(["eu.x.y"]);
	});
});
