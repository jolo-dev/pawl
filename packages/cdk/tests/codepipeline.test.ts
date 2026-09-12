import { describe, expect, test } from "bun:test";
import { Match, Template } from "aws-cdk-lib/assertions";
import { CodePipeline, type CodePipelineProps } from "../src/codepipeline";
import { Stack } from "../src/stack";
import { createTestApp } from "./utils";

function createPipelineStack(
	id: string,
	props: Partial<CodePipelineProps> = {},
): { stack: Stack; template: Template; construct: CodePipeline } {
	const stack = new Stack(createTestApp(), `${id}Stack`);
	const construct = new CodePipeline(stack, "Pipeline", props)
		.source({
			origin: "codecommit",
			create: true,
			repositoryName: "test-repo",
			branchName: "main",
		})
		.stage({
			name: "Approval",
			actions: [{ name: "Approve", type: "approval" }],
		});
	return {
		stack,
		template: Template.fromStack(stack),
		construct,
	};
}

describe("CodePipeline push mode", () => {
	test("creates a pipeline with CodeCommit source and artifact bucket", () => {
		const { template } = createPipelineStack("Basic");

		template.hasResourceProperties("AWS::CodePipeline::Pipeline", {
			Stages: Match.arrayWith([
				Match.objectLike({
					Name: "Source",
					Actions: Match.arrayWith([
						Match.objectLike({
							Name: "Source",
							ActionTypeId: {
								Category: "Source",
								Provider: "CodeCommit",
							},
						}),
					]),
				}),
			]),
		});
		template.hasResourceProperties("AWS::S3::Bucket", {
			BucketEncryption: {
				ServerSideEncryptionConfiguration: Match.arrayWith([
					Match.objectLike({
						ServerSideEncryptionByDefault: {
							SSEAlgorithm: "aws:kms",
						},
					}),
				]),
			},
		});
	});

	test("uses standard source detection in push mode (no trigger override)", () => {
		const { template } = createPipelineStack("PushDetection");
		const pipelines = Object.values(
			template.findResources("AWS::CodePipeline::Pipeline"),
		);
		const sourceStage = (
			pipelines[0] as {
				Properties: {
					Stages: Array<{
						Actions: Array<{ Configuration: Record<string, string> }>;
					}>;
				};
			}
		).Properties.Stages[0];
		// EventBridge detects pushes; CodeCommit polling is disabled.
		const sourceAction = sourceStage?.Actions[0];
		if (!sourceAction) throw new Error("Expected pipeline source action");
		const sourceConfig = sourceAction.Configuration;
		expect(sourceConfig.PollForSourceChanges).toBeFalse();
		template.hasResourceProperties("AWS::Events::Rule", {
			EventPattern: {
				source: ["aws.codecommit"],
				"detail-type": ["CodeCommit Repository State Change"],
				detail: {
					event: ["referenceCreated", "referenceUpdated"],
					referenceName: ["main"],
				},
			},
		});
	});

	test("does not create reviewer infrastructure without autoReview", () => {
		const { template } = createPipelineStack("NoReview");
		const serialized = JSON.stringify(template.toJSON());
		expect(serialized).not.toContain("AWS::Lambda::Function");
		expect(serialized).not.toContain("AWS::DynamoDB::Table");
		expect(serialized).not.toContain("AWS::CodeBuild::Project");
	});

	test("creates KMS key for artifact bucket", () => {
		const { template } = createPipelineStack("KMS");
		template.hasResource("AWS::KMS::Key", {
			Properties: { EnableKeyRotation: true },
		});
	});
});

describe("CodePipeline PR-gated mode", () => {
	test("uses CodeCommitTrigger.NONE when onPullRequest is true", () => {
		const { template } = createPipelineStack("PRGated", {
			onPullRequest: true,
		});
		const pipelines = Object.values(
			template.findResources("AWS::CodePipeline::Pipeline"),
		);
		const sourceStage = (
			pipelines[0] as {
				Properties: {
					Stages: Array<{
						Actions: Array<{ Configuration: Record<string, string> }>;
					}>;
				};
			}
		).Properties.Stages[0];
		const sourceAction = sourceStage?.Actions[0];
		if (!sourceAction) throw new Error("Expected pipeline source action");
		const sourceConfig = sourceAction.Configuration;
		expect(sourceConfig.PollForSourceChanges).toBeFalse();
	});

	test("creates PR routing state without an AI reviewer when only onPullRequest is set", () => {
		const { template } = createPipelineStack("PRNoReview", {
			onPullRequest: true,
		});
		template.resourceCountIs("AWS::Lambda::Function", 1);
		template.hasResourceProperties("AWS::Lambda::Function", {
			FunctionName: Match.stringLikeRegexp("Router-lambda$"),
		});
		template.resourceCountIs("AWS::DynamoDB::Table", 0);
		template.resourceCountIs("AWS::DynamoDB::GlobalTable", 1);
		template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
			TableName: Match.stringLikeRegexp("PullRequestState-table$"),
		});
		const serialized = JSON.stringify(template.toJSON());
		expect(serialized).not.toContain("Reviewer-lambda");
		expect(serialized).not.toContain("AIReview");
	});
});
