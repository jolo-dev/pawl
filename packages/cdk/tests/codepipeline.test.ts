import { describe, expect, test } from "bun:test";
import { Template, Match } from "aws-cdk-lib/assertions";
import { Repository } from "aws-cdk-lib/aws-codecommit";
import { CodePipeline } from "../src/codepipeline";
import { Stack } from "../src/stack";
import { createTestApp } from "./utils";

function createPipelineStack(
	id: string,
	props: Partial<CodePipelineProps> = {},
): { stack: Stack; template: Template; construct: CodePipeline } {
	const stack = new Stack(createTestApp(), `${id}Stack`);
	const repository = new Repository(stack, "Repo", {
		repositoryName: "test-repo",
	});
	const construct = new CodePipeline(stack, "Pipeline", {
		source: { type: "codecommit", repository, branchName: "main" },
		...props,
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
		const sourceStage = (pipelines[0] as { Properties: { Stages: Array<{ Actions: Array<{ Configuration: Record<string, string> }> }> } }).Properties.Stages[0];
		// In push mode, trigger should be EVENTS (default) or not explicitly set to NONE
		const sourceConfig = sourceStage.Actions[0]!.Configuration;
		// CodeCommitTrigger.NONE would set DetectChanges to false
		// Default (EVENTS) leaves DetectChanges true or absent
		expect(sourceConfig.DetectChanges ?? "true").not.toBe("false");
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
