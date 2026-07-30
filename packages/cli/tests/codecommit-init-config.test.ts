import { describe, expect, test } from "bun:test";
import {
	CodeCommitInitConfigError,
	type CodeCommitInitFlags,
	validateCodeCommitInitConfig,
	validateCodeCommitInitCoreConfig,
} from "../src/codecommit-init/config";

const completeFlags = {
	repositoryName: "repo",
	syncPath: ".",
	autoReviewer: true,
	modelId: "eu.anthropic.claude-3-5-sonnet-20241022-v2:0",
	team: "platform",
	install: true,
	deploy: true,
	awsProfile: "dev",
	region: "eu-central-1",
} satisfies CodeCommitInitFlags;

describe("validateCodeCommitInitConfig", () => {
	test("normalizes a fully flagged config and supplies defaults", () => {
		expect(validateCodeCommitInitConfig(completeFlags)).toEqual({
			repositoryName: "repo",
			syncPath: ".",
			branchName: "main",
			autoReviewer: true,
			modelId: "eu.anthropic.claude-3-5-sonnet-20241022-v2:0",
			team: "platform",
			stage: "dev",
			install: true,
			deploy: true,
			awsProfile: "dev",
			region: "eu-central-1",
		});
	});

	test("normalizes negative choices without optional values", () => {
		expect(
			validateCodeCommitInitConfig({
				repositoryName: "repo",
				noSync: true,
				directory: "generated",
				noAutoReviewer: true,
				team: "platform",
				noInstall: true,
				noDeploy: true,
			}),
		).toEqual({
			repositoryName: "repo",
			noSync: true,
			directory: "generated",
			branchName: "main",
			autoReviewer: false,
			team: "platform",
			stage: "dev",
			install: false,
			deploy: false,
		});
	});

	test.each([
		["name", { repositoryName: undefined }],
		["sync choice", { syncPath: undefined }],
		["reviewer choice", { autoReviewer: undefined }],
		["team", { team: undefined }],
		["install choice", { install: undefined }],
		["deploy choice", { deploy: undefined }],
	])("non-TTY complete validation requires %s", (_label, change) => {
		expect(() =>
			validateCodeCommitInitConfig({ ...completeFlags, ...change }),
		).toThrow(CodeCommitInitConfigError);
	});

	test.each([
		["sync", { noSync: true }],
		["reviewer", { noAutoReviewer: true }],
		["install", { noInstall: true }],
		["deploy", { noDeploy: true }],
	] as const)("rejects contradictory %s choices", (_label, change) => {
		expect(() =>
			validateCodeCommitInitConfig({ ...completeFlags, ...change }),
		).toThrow(/exactly one/i);
	});

	test("requires model exactly when auto-review is enabled", () => {
		expect(() =>
			validateCodeCommitInitConfig({
				...completeFlags,
				modelId: undefined,
			}),
		).toThrow(/model/i);
		expect(() =>
			validateCodeCommitInitConfig({
				...completeFlags,
				autoReviewer: undefined,
				noAutoReviewer: true,
				modelId: "anthropic.claude-3-haiku",
			}),
		).toThrow(/model/i);
	});

	test.each([
		"eu.anthropic.claude-sonnet-4-6",
		"eu.amazon.nova-2-lite-v1:0",
	])("accepts system inference profile ID %s", (modelId) => {
		expect(
			validateCodeCommitInitConfig({ ...completeFlags, modelId }).modelId,
		).toBe(modelId);
	});

	test.each([
		"amazon.nova-pro-v1:0",
		"anthropic.claude-3-haiku",
		"arn:aws:bedrock:eu-central-1:123456789012:inference-profile/example",
		"eu.global.anthropic.claude-sonnet-4-6",
		"anthropic",
	])("rejects unsupported model ID %s", (modelId) => {
		expect(() =>
			validateCodeCommitInitConfig({ ...completeFlags, modelId }),
		).toThrow(/inference profile|model/i);
	});

	test("requires install, profile, and region exactly when deploying", () => {
		for (const change of [
			{ install: undefined, noInstall: true },
			{ awsProfile: undefined },
			{ region: undefined },
		] as const) {
			expect(() =>
				validateCodeCommitInitConfig({ ...completeFlags, ...change }),
			).toThrow(CodeCommitInitConfigError);
		}

		const noDeploy = {
			...completeFlags,
			deploy: undefined,
			noDeploy: true as const,
		};
		expect(() => validateCodeCommitInitConfig(noDeploy)).toThrow(/profile/i);
		expect(() =>
			validateCodeCommitInitConfig({
				...noDeploy,
				awsProfile: undefined,
			}),
		).toThrow(/region/i);
	});

	test("rejects auto-review in prod", () => {
		expect(() =>
			validateCodeCommitInitConfig({ ...completeFlags, stage: "prod" }),
		).toThrow(/prod/i);
	});

	test("uses the CDK repository and branch schemas", () => {
		expect(() =>
			validateCodeCommitInitConfig({
				...completeFlags,
				repositoryName: "repo.git",
			}),
		).toThrow(/repository/i);
		expect(() =>
			validateCodeCommitInitConfig({
				...completeFlags,
				branchName: "bad..branch",
			}),
		).toThrow(/branch/i);
	});

	test("aggregates all Zod issues in a typed error", () => {
		try {
			validateCodeCommitInitConfig({
				...completeFlags,
				repositoryName: "repo.git",
				branchName: "bad..branch",
				stage: "prod",
				region: undefined,
			});
			throw new Error("Expected validation to fail");
		} catch (error: unknown) {
			expect(error).toBeInstanceOf(CodeCommitInitConfigError);
			if (!(error instanceof CodeCommitInitConfigError)) return;
			expect(error.issues.length).toBeGreaterThanOrEqual(4);
			expect(error.message).toContain("repositoryName");
			expect(error.message).toContain("branchName");
		}
	});
});

describe("validateCodeCommitInitCoreConfig", () => {
	test("validates core TTY choices before install and deploy prompts", () => {
		expect(
			validateCodeCommitInitCoreConfig({
				repositoryName: "repo",
				syncPath: ".",
				noAutoReviewer: true,
				team: "platform",
			}),
		).toEqual({
			repositoryName: "repo",
			syncPath: ".",
			branchName: "main",
			autoReviewer: false,
			team: "platform",
			stage: "dev",
		});
	});

	test("does not weaken required core choices", () => {
		expect(() => validateCodeCommitInitCoreConfig({})).toThrow(
			CodeCommitInitConfigError,
		);
	});
});
