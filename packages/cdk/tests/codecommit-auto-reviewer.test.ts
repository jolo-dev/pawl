import { describe, expect, test } from "bun:test";
import { App, CfnParameter } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Repository } from "aws-cdk-lib/aws-codecommit";
import {
	CodeCommitAutoReviewer,
	CodeCommitAutoReviewerConfigSchema,
	type CodeCommitAutoReviewerProps,
} from "../src/codecommit-auto-reviewer";
import { Stack } from "../src/stack";

const networkPolicy: CodeCommitAutoReviewerProps["codeBuildNetworkPolicy"] = {
	mode: "public-test",
	packageAccess: {
		mode: "approved-registry",
		endpoint: "https://registry.npmjs.org",
	},
};

function createStack(id: string): Stack {
	const app = new App({
		context: {
			team: "review-team",
			stage: "test",
		},
	});
	return new Stack(app, id, {
		env: { account: "123456789012", region: "eu-west-1" },
	});
}

function createReviewer(
	stack: Stack,
	props: Partial<CodeCommitAutoReviewerProps> = {},
): CodeCommitAutoReviewer {
	return new CodeCommitAutoReviewer(stack, "AutoReviewer", {
		repositories: ["repo"],
		reviewerModelId: "eu.anthropic.claude-sonnet-4-6",
		codeBuildNetworkPolicy: networkPolicy,
		...props,
	});
}

function expectNoReviewerChildren(stack: Stack): void {
	const template = Template.fromStack(stack);
	template.resourceCountIs("AWS::DynamoDB::Table", 0);
	template.resourceCountIs("AWS::CodeBuild::Project", 0);
	template.resourceCountIs("AWS::Events::Rule", 0);
}

interface SynthPolicyStatement {
	readonly Action?: string | string[];
	readonly Condition?: Record<string, unknown>;
	readonly Effect?: string;
	readonly Resource?: string | string[];
}

function bedrockPolicyStatements(stack: Stack): SynthPolicyStatement[] {
	const policies = Template.fromStack(stack).findResources("AWS::IAM::Policy");
	return Object.values(policies).flatMap((policy) => {
		const statements = (
			policy.Properties as {
				PolicyDocument?: { Statement?: SynthPolicyStatement[] };
			}
		).PolicyDocument?.Statement;
		return (statements ?? []).filter((statement) =>
			Array.isArray(statement.Action)
				? statement.Action.includes("bedrock:InvokeModel")
				: statement.Action === "bedrock:InvokeModel",
		);
	});
}

describe("CodeCommitAutoReviewer", () => {
	test("rejects duplicate repository names before creating children", () => {
		const stack = createStack("DuplicateRepositoriesStack");

		expect(() =>
			createReviewer(stack, { repositories: ["repo", "repo"] }),
		).toThrow(/duplicate/i);
		expectNoReviewerChildren(stack);
	});

	test("rejects an unknown repository resource key before creating children", () => {
		const stack = createStack("UnknownRepositoryResourceStack");
		const repository = new Repository(stack, "Repository", {
			repositoryName: "other",
		});

		expect(() =>
			createReviewer(stack, {
				repositoryResources: new Map([["other", repository]]),
			}),
		).toThrow(/unknown/i);
		expectNoReviewerChildren(stack);
	});

	test("rejects a resource whose repository name differs from its map key", () => {
		const stack = createStack("MismatchedRepositoryResourceStack");
		const repository = new Repository(stack, "Repository", {
			repositoryName: "other",
		});

		expect(() =>
			createReviewer(stack, {
				repositoryResources: new Map([["repo", repository]]),
			}),
		).toThrow(/match|mismatch/i);
		expectNoReviewerChildren(stack);
	});

	test("rejects an unresolved resource name that cannot be matched safely", () => {
		const stack = createStack("UnresolvedRepositoryResourceStack");
		const repositoryName = new CfnParameter(stack, "RepositoryName")
			.valueAsString;
		const repository = new Repository(stack, "Repository", { repositoryName });

		expect(() =>
			createReviewer(stack, {
				repositoryResources: new Map([["repo", repository]]),
			}),
		).toThrow(/resolved repository name/i);
		expectNoReviewerChildren(stack);
	});

	test("rejects invalid durable aliases before creating children", () => {
		const stack = createStack("InvalidReviewerAliasStack");

		expect(() =>
			createReviewer(stack, { reviewerAlias: "bad.alias" }),
		).toThrow();
		expectNoReviewerChildren(stack);
	});

	test("preserves a supplied repository in build and event constructs", () => {
		const stack = createStack("SharedRepositoryResourceStack");
		const repository = new Repository(stack, "Repository", {
			repositoryName: "repo",
		});
		const reviewer = createReviewer(stack, {
			repositoryResources: new Map([["repo", repository]]),
			team: "override-team",
			stage: "override-stage",
		});

		expect(reviewer.codeBuildProjects.get("repo")?.repository).toBe(repository);
		expect(reviewer.eventConstructs.get("repo")?.repository).toBe(repository);
		Template.fromStack(stack).resourceCountIs("AWS::CodeBuild::Project", 1);
	});

	test("falls back to name imports for repository-resource map gaps", () => {
		const stack = createStack("PartialRepositoryResourcesStack");
		const repository = new Repository(stack, "Repository", {
			repositoryName: "created-repo",
		});
		const reviewer = createReviewer(stack, {
			repositories: ["created-repo", "imported-repo"],
			repositoryResources: new Map([["created-repo", repository]]),
		});

		expect(reviewer.codeBuildProjects.get("created-repo")?.repository).toBe(
			repository,
		);
		expect(reviewer.eventConstructs.get("created-repo")?.repository).toBe(
			repository,
		);
		expect(
			reviewer.codeBuildProjects.get("imported-repo")?.repository
				.repositoryName,
		).toBe("imported-repo");
		expect(
			reviewer.eventConstructs.get("imported-repo")?.repository.repositoryName,
		).toBe("imported-repo");
		expect(
			reviewer.codeBuildProjects.get("imported-repo")?.repository,
		).not.toBe(repository);
		expect(reviewer.eventConstructs.get("imported-repo")?.repository).not.toBe(
			repository,
		);
		Template.fromStack(stack).resourceCountIs("AWS::CodeBuild::Project", 2);
	});

	test("uses validated legacy suffixes only for the configured repositories", () => {
		const stack = createStack("LegacySuffixStack");
		const reviewer = createReviewer(stack, {
			repositories: ["legacy-repository"],
			legacyResourceIdSuffixes: new Map([
				["legacy-repository", "codepipeline-autoreviewer-demo"],
			]),
		});

		expect(reviewer.codeBuildProjects.get("legacy-repository")?.node.id).toBe(
			"AutoReviewerChecks-codepipeline-autoreviewer-demo",
		);
		expect(reviewer.eventConstructs.get("legacy-repository")?.node.id).toBe(
			"AutoReviewerEvents-codepipeline-autoreviewer-demo",
		);
	});

	test("validates legacy suffix keys, values, and effective uniqueness before creating children", () => {
		const invalidSuffixStack = createStack("InvalidLegacySuffixStack");
		expect(() =>
			createReviewer(invalidSuffixStack, {
				legacyResourceIdSuffixes: new Map([["repo", "invalid suffix"]]),
			}),
		).toThrow(/letters/i);
		expectNoReviewerChildren(invalidSuffixStack);

		const unknownKeyStack = createStack("UnknownLegacySuffixStack");
		expect(() =>
			createReviewer(unknownKeyStack, {
				legacyResourceIdSuffixes: new Map([["other", "legacy"]]),
			}),
		).toThrow(/unknown/i);
		expectNoReviewerChildren(unknownKeyStack);

		const duplicateStack = createStack("DuplicateLegacySuffixStack");
		expect(() =>
			createReviewer(duplicateStack, {
				repositories: ["first", "second"],
				legacyResourceIdSuffixes: new Map([
					["first", "same"],
					["second", "same"],
				]),
			}),
		).toThrow(/unique/i);
		expectNoReviewerChildren(duplicateStack);
	});

	test("keeps punctuation-colliding repository names distinct with hashed defaults", () => {
		const stack = createStack("DefaultSuffixCollisionStack");
		const reviewer = createReviewer(stack, {
			repositories: ["foo.bar", "foo-bar"],
		});

		expect(reviewer.codeBuildProjects.get("foo.bar")?.node.id).not.toBe(
			reviewer.codeBuildProjects.get("foo-bar")?.node.id,
		);
	});

	test("retains dotted repository identity while deriving safe deterministic build names", () => {
		const firstStack = createStack("DottedRepositoryStack");
		const repository = new Repository(firstStack, "Repository", {
			repositoryName: "repo.name",
		});
		const first = createReviewer(firstStack, {
			repositories: ["repo.name"],
			repositoryResources: new Map([["repo.name", repository]]),
		});
		const second = createReviewer(createStack("DottedRepositoryRetryStack"), {
			repositories: ["repo.name"],
		});
		const firstBuild = first.codeBuildProjects.get("repo.name");
		const secondBuild = second.codeBuildProjects.get("repo.name");
		const [project] = Object.values(
			Template.fromStack(firstStack).findResources("AWS::CodeBuild::Project"),
		);

		expect(firstBuild?.repository).toBe(repository);
		expect(firstBuild?.node.id).toMatch(
			/^AutoReviewerChecks-repo-name-[0-9a-f]{8}$/,
		);
		expect(project?.Properties.Name).not.toContain("repo.name");
		expect(secondBuild?.node.id).toBe(firstBuild?.node.id);
		expect(first.eventConstructs.has("repo.name")).toBe(true);
	});

	test.each([
		"amazon.nova-2-lite-v1:0",
		"anthropic.claude-sonnet-4-6",
		"meta.llama3-3-70b-instruct-v1:0",
		"eu.amazon.nova-2-lite-v1:0",
		"eu.anthropic.claude-sonnet-4-6",
		"us.meta.llama3-3-70b-instruct-v1:0",
		"apac.mistral.mistral-large-2407-v1:0",
		"global.cohere.command-r-plus-v1:0",
	])("accepts safe Bedrock model identifier %s", (reviewerModelId) => {
		const result = CodeCommitAutoReviewerConfigSchema.safeParse({
			repositories: ["repo"],
			reviewerModelId,
		});
		expect(result.success).toBe(true);
	});

	test.each([
		"",
		"moon.amazon.nova-2-lite-v1:0",
		"eu.global.anthropic.claude-sonnet-4-6",
		"arn:aws:bedrock:eu-west-1:123456789012:inference-profile/eu.amazon.nova-2-lite-v1:0",
		"eu.amazon/nova-2-lite-v1:0",
		"eu.amazon.nova-*",
		"eu.amazon.nova model",
		" eu.amazon.nova-2-lite-v1:0",
		"eu.amazon.nova-2-lite-v1:0 ",
		"eu..amazon.nova-2-lite-v1:0",
		"eu.amazon.",
		"eu.amazon.nova-2-lite-v1:0:1",
		"anthropic.claude-sonnet-4-6:0:1",
		"anthropic..claude-sonnet-4-6",
		"anthropic/claude-sonnet-4-6",
		"anthropic.claude_*",
		`eu.amazon.${"a".repeat(55)}`,
		`anthropic.${"a".repeat(60)}`,
	])("rejects unsafe Bedrock model identifier %p", (reviewerModelId) => {
		const result = CodeCommitAutoReviewerConfigSchema.safeParse({
			repositories: ["repo"],
			reviewerModelId,
		});
		expect(result.success).toBe(false);
	});

	test("only grants direct foundation-model invocation in the stack region", () => {
		const stack = createStack("DirectBedrockPolicyStack");
		createReviewer(stack, {
			reviewerModelId: "anthropic.claude-sonnet-4-6",
		});

		expect(bedrockPolicyStatements(stack)).toEqual([
			{
				Action: "bedrock:InvokeModel",
				Effect: "Allow",
				Resource:
					"arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-sonnet-4-6",
			},
		]);
	});

	test("only grants Nova foundation-model invocation through the configured profile", () => {
		const stack = createStack("NovaBedrockPolicyStack");
		createReviewer(stack, {
			reviewerModelId: "eu.amazon.nova-2-lite-v1:0",
		});

		const inferenceProfileArn =
			"arn:aws:bedrock:eu-west-1:123456789012:inference-profile/eu.amazon.nova-2-lite-v1:0";
		expect(bedrockPolicyStatements(stack)).toEqual([
			{
				Action: "bedrock:InvokeModel",
				Effect: "Allow",
				Resource: inferenceProfileArn,
			},
			{
				Action: "bedrock:InvokeModel",
				Condition: {
					ArnEquals: {
						"bedrock:InferenceProfileArn": inferenceProfileArn,
					},
				},
				Effect: "Allow",
				Resource: "arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0",
			},
		]);
	});
});

describe("CodeCommitAutoReviewer deprecated pipelineCoordination alias", () => {
	test("pipelineCoordination alone maps to active phase resources with the safe default", () => {
		const stack = createStack("PipelineCoordinationAliasStack");
		createReviewer(stack, {
			pipelineCoordination: {},
		});
		const template = Template.fromStack(stack);
		const serialized = JSON.stringify(template.toJSON());
		expect(serialized).toContain("codepipeline:PutJobSuccessResult");
		expect(serialized).toContain('"REVIEW_ACTION_TIMEOUT_MINUTES":"15"');
		expect(serialized).toContain("Bridge-lambda");
		expect(serialized).toContain("Reconciler-lambda");
		// Verify GSIs are present (both GSI1 and GSI2 for active phase)
		const tables = template.findResources("AWS::DynamoDB::GlobalTable");
		const tableResource = Object.values(tables)[0] as {
			Properties?: {
				GlobalSecondaryIndexes?: readonly { IndexName: string }[];
			};
		};
		const indexes =
			tableResource?.Properties?.GlobalSecondaryIndexes?.map(
				({ IndexName }) => IndexName,
			) ?? [];
		expect(indexes).toContain("GSI1");
		expect(indexes).toContain("GSI2");
	});

	test("pipelineCoordination with reviewCoordinationDeployment throws conflict", () => {
		const stack = createStack("PipelineCoordinationConflictStack");
		expect(() =>
			createReviewer(stack, {
				pipelineCoordination: { reviewActionTimeoutMinutes: 60 },
				reviewCoordinationDeployment: {
					phase: "prepareGsi1",
				},
			}),
		).toThrow(/do not specify both/i);
	});

	test("pipelineCoordination with invalid timeout throws Zod validation", () => {
		const stack = createStack("PipelineCoordinationInvalidStack");
		expect(() =>
			createReviewer(stack, {
				pipelineCoordination: { reviewActionTimeoutMinutes: 0 },
			}),
		).toThrow();
		expect(() =>
			createReviewer(createStack("PipelineCoordinationLegacyTimeoutStack"), {
				pipelineCoordination: { reviewActionTimeoutMinutes: 60 },
			}),
		).toThrow();
		expect(() =>
			createReviewer(createStack("ReviewCoordinationLegacyTimeoutStack"), {
				reviewCoordinationDeployment: {
					phase: "active",
					reviewActionTimeoutMinutes: 60,
				},
			}),
		).toThrow();
	});
});

describe("CodeCommitAutoReviewer pipeline regression", () => {
	test("does not create codepipeline IAM grants", () => {
		const stack = createStack("RegressionNoPipeline");
		createReviewer(stack);
		const template = Template.fromStack(stack);
		const serialized = JSON.stringify(template.toJSON());
		expect(serialized).not.toContain("codepipeline:");
		expect(serialized).not.toContain("CodePipeline");
	});

	test("does not set PIPELINE_NAME env var on router", () => {
		const stack = createStack("RegressionNoPipelineEnv");
		createReviewer(stack);
		const template = Template.fromStack(stack);
		const functions = Object.values(
			template.findResources("AWS::Lambda::Function"),
		);
		const routerFunc = functions.find((f) => {
			const env = (
				f.Properties as { Environment?: { Variables?: Record<string, string> } }
			).Environment?.Variables;
			return (
				env?.REVIEWER_FUNCTION_NAME !== undefined &&
				env?.STATE_TABLE_NAME !== undefined
			);
		});
		expect(routerFunc).toBeDefined();
		const routerEnv = (
			routerFunc?.Properties as
				| { Environment?: { Variables?: Record<string, string> } }
				| undefined
		)?.Environment?.Variables;
		expect(routerEnv?.PIPELINE_NAME).toBeUndefined();
	});
});
