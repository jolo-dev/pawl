import { describe, expect, test } from "bun:test";
import { App, CfnParameter } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Repository } from "aws-cdk-lib/aws-codecommit";
import {
	CodeCommitAutoReviewer,
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

	test("grants the foundation model routed by the configured Nova profile", () => {
		const stack = createStack("NovaBedrockPolicyStack");
		createReviewer(stack, {
			reviewerModelId: "eu.amazon.nova-2-lite-v1:0",
		});

		Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
			PolicyDocument: {
				Statement: Match.arrayWith([
					Match.objectLike({
						Action: "bedrock:InvokeModel",
						Effect: "Allow",
						Resource: [
							"arn:aws:bedrock:eu-west-1:123456789012:inference-profile/eu.amazon.nova-2-lite-v1:0",
							"arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0",
						],
					}),
				]),
			},
		});
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
		const functions = Object.values(template.findResources("AWS::Lambda::Function"));
		const routerFunc = functions.find((f) => {
			const env = (f.Properties as { Environment?: { Variables?: Record<string, string> } }).Environment?.Variables;
			return env?.REVIEWER_FUNCTION_NAME !== undefined && env?.STATE_TABLE_NAME !== undefined;
		});
		expect(routerFunc).toBeDefined();
		const routerEnv = (routerFunc!.Properties as { Environment?: { Variables?: Record<string, string> } }).Environment?.Variables;
		expect(routerEnv?.PIPELINE_NAME).toBeUndefined();
	});
});
