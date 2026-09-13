import { describe, expect, test } from "bun:test";
import { defaultBedrockModelId, groupBedrockModels } from "../src/bedrock-models";

describe("defaultBedrockModelId", () => {
	test("picks the inference-profile prefix from the region", () => {
		expect(defaultBedrockModelId("eu-central-1")).toBe(
			"eu.anthropic.claude-sonnet-4-6",
		);
		expect(defaultBedrockModelId("us-east-1")).toBe(
			"us.anthropic.claude-sonnet-4-6",
		);
		expect(defaultBedrockModelId("ap-southeast-2")).toBe(
			"apac.anthropic.claude-sonnet-4-6",
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
