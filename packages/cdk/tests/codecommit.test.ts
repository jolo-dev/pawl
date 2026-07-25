import { afterEach, describe, expect, expectTypeOf, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { CfnRepository, Repository } from "aws-cdk-lib/aws-codecommit";
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import { Aspects } from "aws-cdk-lib/core";
import { AwsSolutionsChecks } from "cdk-nag";
import {
	App,
	CfnOutput,
	CodeCommit,
	type CodeCommitProps,
	type Construct,
	LambdaFunction,
	Stack,
} from "../index";

const temporaryDirectories: string[] = [];
const lambdaEntry = path.join(__dirname, "lambda", "test-lambda.ts");

function temporaryDirectory(prefix: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

function createStack(id: string): Stack {
	const app = new App({
		outdir: temporaryDirectory("pawl-codecommit-cdk-out-"),
		context: { team: "review-team", stage: "test" },
	});
	return new Stack(app, id, {
		env: { account: "123456789012", region: "eu-west-1" },
	});
}

function createSource(): string {
	const sourcePath = temporaryDirectory("pawl-codecommit-seed-");
	mkdirSync(path.join(sourcePath, "infra"));
	writeFileSync(path.join(sourcePath, "README.md"), "# seeded\n");
	writeFileSync(path.join(sourcePath, "infra", "stack.ts"), "export {};\n");
	return sourcePath;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("CodeCommit repository lifecycle", () => {
	test("creates and seeds a retained repository from the exact ZIP asset", () => {
		const stack = createStack("SeededRepositoryStack");
		const sourcePath = createSource();
		const construct = new CodeCommit(stack, "Code", {
			repositoryName: "seeded-repository",
			create: {
				sourcePath,
				branchName: "develop",
				description: "Seeded repository",
				forceIncludePath: "infra",
			},
		});
		const template = Template.fromStack(stack);

		expect(construct.repository).toBeInstanceOf(Repository);
		template.resourceCountIs("AWS::CodeCommit::Repository", 1);
		template.hasResource("AWS::CodeCommit::Repository", {
			DeletionPolicy: "RetainExceptOnCreate",
			UpdateReplacePolicy: "Retain",
			Properties: {
				RepositoryName: "seeded-repository",
				RepositoryDescription: "Seeded repository",
				Code: {
					BranchName: "develop",
					S3: {
						Bucket: Match.anyValue(),
						Key: Match.anyValue(),
					},
				},
			},
		});
		const assets = stack.node
			.findAll()
			.filter((child): child is Asset => child instanceof Asset);
		expect(assets).toHaveLength(1);
		const asset = assets[0];
		if (asset === undefined) throw new Error("Expected repository seed asset");
		expect(asset.isZipArchive).toBe(true);
		expect(path.extname(asset.assetPath)).toBe(".zip");
		const stagedAssetPath = path.join(
			(stack.node.root as App).outdir,
			asset.assetPath,
		);
		expect(readFileSync(stagedAssetPath).readUInt32LE(0)).toBe(0x04034b50);
	});

	test("defaults the seeded branch to main", () => {
		const stack = createStack("DefaultBranchStack");
		new CodeCommit(stack, "Code", {
			repositoryName: "default-branch-repository",
			create: { sourcePath: createSource() },
		});

		Template.fromStack(stack).hasResourceProperties(
			"AWS::CodeCommit::Repository",
			{ Code: { BranchName: "main" } },
		);
	});

	test("creates a retained empty repository without a Code property", () => {
		const stack = createStack("EmptyRepositoryStack");
		new CodeCommit(stack, "Code", {
			repositoryName: "empty-repository",
			create: { description: "Empty repository" },
		});
		const repositories = Template.fromStack(stack).findResources(
			"AWS::CodeCommit::Repository",
		);
		const repository = Object.values(repositories)[0];

		expect(repository?.Properties).not.toHaveProperty("Code");
		expect(repository?.DeletionPolicy).toBe("RetainExceptOnCreate");
		expect(repository?.UpdateReplacePolicy).toBe("Retain");
	});

	test("imports by name and creates no repository resource", () => {
		const stack = createStack("ImportedRepositoryStack");
		const construct = new CodeCommit(stack, "Code", {
			repositoryName: "imported-repository",
		});

		expect(construct.repository.repositoryName).toBe("imported-repository");
		expect(construct.repository).not.toBeInstanceOf(Repository);
		Template.fromStack(stack).resourceCountIs("AWS::CodeCommit::Repository", 0);
	});

	test("repository-only mode has no ancillary review resources and optional outputs stay absent", () => {
		const stack = createStack("RepositoryOnlyStack");
		const construct = new CodeCommit(stack, "Code", {
			repositoryName: "repository-only",
			create: {},
		});
		const template = Template.fromStack(stack);

		expect(construct.events).toBeUndefined();
		expect(construct.autoReviewer).toBeUndefined();
		for (const resourceType of [
			"AWS::Events::Rule",
			"AWS::Lambda::Function",
			"AWS::CodeBuild::Project",
			"AWS::DynamoDB::Table",
			"AWS::Bedrock::Agent",
		]) {
			template.resourceCountIs(resourceType, 0);
		}
	});
});

describe("CodeCommit review combinations", () => {
	test("router mode reuses the same created repository", () => {
		const stack = createStack("RouterRepositoryStack");
		const router = new LambdaFunction(stack, "Router", { entry: lambdaEntry });
		const construct = new CodeCommit(stack, "Code", {
			repositoryName: "router-repository",
			create: {},
			router,
		});

		expect(construct.events).toBeDefined();
		expect(construct.events?.repository).toBe(construct.repository);
		expect(construct.autoReviewer).toBeUndefined();
		Template.fromStack(stack).resourceCountIs("AWS::Events::Rule", 2);
	});

	test("auto-review mode passes a concrete created repository through every consumer", () => {
		const stack = createStack("AutoReviewRepositoryStack");
		const construct = new CodeCommit(stack, "Code", {
			repositoryName: "auto-review-repository",
			create: {},
			autoReview: { modelId: "eu.anthropic.claude-sonnet-4-6" },
		});

		expect(construct.autoReviewer).toBeDefined();
		expect(construct.events).toBeDefined();
		expect(construct.events?.repository).toBe(construct.repository);
		expect(
			construct.autoReviewer?.codeBuildProjects.get("auto-review-repository")
				?.repository as typeof construct.repository,
		).toBe(construct.repository);
	});

	test("auto-review import mode preserves name-based fallback", () => {
		const stack = createStack("ImportedAutoReviewRepositoryStack");
		const construct = new CodeCommit(stack, "Code", {
			repositoryName: "imported-auto-review-repository",
			autoReview: { modelId: "anthropic.claude-sonnet-4-6" },
		});

		expect(construct.events).toBeDefined();
		expect(construct.events?.repository.repositoryName).toBe(
			"imported-auto-review-repository",
		);
		expect(construct.events?.repository).not.toBe(construct.repository);
	});

	test("rejects simultaneous router and auto-review before creating review resources", () => {
		const stack = createStack("ConflictingReviewModesStack");
		const router = new LambdaFunction(stack, "Router", { entry: lambdaEntry });

		expect(
			() =>
				new CodeCommit(stack, "Code", {
					repositoryName: "conflicting-repository",
					router,
					autoReview: { modelId: "eu.anthropic.claude-sonnet-4-6" },
				}),
		).toThrow(/mutually exclusive|both/i);
		const template = Template.fromStack(stack);
		template.resourceCountIs("AWS::CodeBuild::Project", 0);
		template.resourceCountIs("AWS::DynamoDB::Table", 0);
	});
});

describe("CodeCommit validation", () => {
	test.each([
		"",
		"invalid repository",
		"repo/name",
		"repo.git",
	])("rejects invalid repository name %p", (repositoryName) => {
		const stack = createStack(`InvalidRepository${repositoryName.length}Stack`);
		expect(() => new CodeCommit(stack, "Code", { repositoryName })).toThrow();
	});

	test.each([
		"",
		"-feature",
		"feature..branch",
		"feature branch",
	])("rejects invalid branch %p", (branchName) => {
		const stack = createStack(`InvalidBranch${branchName.length}Stack`);
		expect(
			() =>
				new CodeCommit(stack, "Code", {
					repositoryName: "branch-repository",
					create: { sourcePath: createSource(), branchName },
				}),
		).toThrow();
	});

	test("rejects branch and force-include without source", () => {
		const branchStack = createStack("BranchWithoutSourceStack");
		expect(
			() =>
				new CodeCommit(branchStack, "Code", {
					repositoryName: "branch-without-source",
					create: { branchName: "main" },
				}),
		).toThrow(/sourcePath/i);
		const forceStack = createStack("ForceWithoutSourceStack");
		expect(
			() =>
				new CodeCommit(forceStack, "Code", {
					repositoryName: "force-without-source",
					create: { forceIncludePath: "infra" },
				}),
		).toThrow(/sourcePath/i);
	});

	test.each([
		"",
		".",
		"..",
		"/absolute",
		"nested/child",
		"nested\\child",
		".git",
		"node_modules",
		"cdk.out",
		".cdk.staging",
		".cdk.staging-123",
	])("rejects unsafe forceIncludePath %p", (forceIncludePath) => {
		const stack = createStack(`UnsafeForce${forceIncludePath.length}Stack`);
		expect(
			() =>
				new CodeCommit(stack, "Code", {
					repositoryName: "unsafe-force-repository",
					create: { sourcePath: createSource(), forceIncludePath },
				}),
		).toThrow(/forceIncludePath|safe direct child/i);
	});

	test.each([
		"",
		"arn:aws:bedrock:eu-west-1:123456789012:foundation-model/anthropic.claude",
		"amazon.titan-text",
		"eu.amazon.titan-text",
		"anthropic.",
		"eu..anthropic.claude",
		"eu.anthropic./claude",
		"eu anthropic.claude",
	])("rejects unsupported auto-review model %p", (modelId) => {
		const stack = createStack(`InvalidModel${modelId.length}Stack`);
		expect(
			() =>
				new CodeCommit(stack, "Code", {
					repositoryName: "invalid-model-repository",
					autoReview: { modelId },
				}),
		).toThrow(/model|anthropic/i);
		const template = Template.fromStack(stack);
		template.resourceCountIs("AWS::CodeBuild::Project", 0);
		template.resourceCountIs("AWS::DynamoDB::Table", 0);
	});
});

describe("CodeCommit package entrypoint", () => {
	test("exports generated-code CDK entrypoints with their public types", () => {
		const app = new App({ outdir: temporaryDirectory("pawl-entrypoint-") });
		const stack = new Stack(app, "EntrypointStack");
		const output = new CfnOutput(stack, "Output", { value: "value" });
		const scope: Construct = stack;

		expect(output).toBeDefined();
		expect(scope).toBe(stack);
		expectTypeOf<Construct>().not.toBeAny();

		// @ts-expect-error CodeCommitProps requires repositoryName.
		const missingRepositoryName: CodeCommitProps = {};
		void missingRepositoryName;
	});

	test("passes AwsSolutions checks in repository-only mode", () => {
		const stack = createStack("NagRepositoryStack");
		new CodeCommit(stack, "Code", {
			repositoryName: "nag-repository",
			create: {},
		});
		Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }));
		(stack.node.root as App).synth();

		const errors = Annotations.fromStack(stack).findError(
			"*",
			Match.stringLikeRegexp("AwsSolutions-"),
		);
		expect(errors).toEqual([]);
	});

	test("exposes the created repository as the synthesized L1 identity", () => {
		const stack = createStack("IdentityRepositoryStack");
		const construct = new CodeCommit(stack, "Code", {
			repositoryName: "identity-repository",
			create: {},
		});
		const child = construct.repository.node.defaultChild;

		expect(child).toBeInstanceOf(CfnRepository);
		expect((child as CfnRepository).repositoryName).toBe("identity-repository");
	});
});
