import { describe, expect, test } from "bun:test";
import { LambdaFunction } from "@pawl/cdk";
import { App, Aspects } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { CodePipelineReviewerStack } from "../../stacks/pipeline-stack";

const DEFAULT_CONTEXT: Record<string, unknown> = {
	team: "jolo",
	stage: "dev",
	reviewerModelId: "anthropic.claude-sonnet-4-6",
};

function createStack(
	id = "PipelineStack",
	context: Record<string, unknown> = DEFAULT_CONTEXT,
): { stack: CodePipelineReviewerStack; template: Template } {
	const app = new App();
	for (const [key, value] of Object.entries(context)) {
		app.node.setContext(key, value);
	}
	const stack = new CodePipelineReviewerStack(app, id);
	return { stack, template: Template.fromStack(stack) };
}

describe("CodePipelineReviewerStack", () => {
	test("lets the pipeline create and seed its managed CodeCommit source", () => {
		const { template } = createStack();
		template.resourceCountIs("AWS::CodeCommit::Repository", 1);
		template.hasResourceProperties("AWS::CodeCommit::Repository", {
			RepositoryName: "codepipeline-autoreviewer-demo",
			RepositoryDescription:
				"Durable Lambda reviewer example with CodePipeline",
			Code: {
				BranchName: "main",
			},
		});
	});

	test("creates a CodePipeline with the created repository as source", () => {
		const { template } = createStack();
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
	});

	test("disables source detection for PR-gated mode", () => {
		const { template } = createStack();
		const pipelines = Object.values(
			template.findResources("AWS::CodePipeline::Pipeline"),
		);
		const sourceAction = (
			pipelines[0] as {
				Properties: {
					Stages: Array<{
						Actions: Array<{ Configuration: Record<string, unknown> }>;
					}>;
				};
			}
		).Properties.Stages[0].Actions[0];
		expect(sourceAction.Configuration.PollForSourceChanges).toBe(false);
	});

	test("creates Build and Approve stages with fluent automatic artifacts", () => {
		const { template } = createStack();
		template.hasResourceProperties("AWS::CodePipeline::Pipeline", {
			Stages: Match.arrayWith([
				Match.objectLike({
					Name: "Build",
					Actions: Match.arrayWith([
						Match.objectLike({
							Name: "Build",
							InputArtifacts: [{ Name: "SourceOutput" }],
							OutputArtifacts: [{ Name: "BuildOutput" }],
						}),
						Match.objectLike({
							Name: "AIReview",
							InputArtifacts: [{ Name: "SourceOutput" }],
						}),
					]),
				}),
				Match.objectLike({
					Name: "Approve",
					Actions: Match.arrayWith([
						Match.objectLike({
							Name: "Approve",
							ActionTypeId: {
								Category: "Approval",
								Provider: "Manual",
							},
						}),
					]),
				}),
			]),
		});
	});

	test("creates a KMS-encrypted artifact bucket", () => {
		const { template } = createStack();
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

	test("creates a pipeline-mode CodeBuild project with S3 source", () => {
		const { template } = createStack();
		template.hasResourceProperties("AWS::CodeBuild::Project", {
			Source: {
				Type: "S3",
			},
		});
	});

	test("requires reviewerModelId context", () => {
		expect(() =>
			createStack("NoModel", {
				...DEFAULT_CONTEXT,
				reviewerModelId: undefined,
			}),
		).toThrow(/reviewerModelId/);
	});

	test("passes AwsSolutions checks", () => {
		const app = new App();
		for (const [key, value] of Object.entries(DEFAULT_CONTEXT)) {
			app.node.setContext(key, value);
		}
		const stack = new CodePipelineReviewerStack(app, "NagStack");

		NagSuppressions.addStackSuppressions(
			stack,
			[
				{
					id: "AwsSolutions-S1",
					reason:
						"The artifact bucket does not require versioning for CI/CD pipelines.",
				},
				{
					id: "AwsSolutions-S10",
					reason:
						"The artifact bucket is internal to CodePipeline and not directly accessible; SSL is enforced by the pipeline service.",
				},
				{
					id: "AwsSolutions-IAM5",
					reason:
						"CodePipeline actions require wildcard permissions for cross-service access.",
				},
			],
			true,
		);

		const reviewerFunctions = stack.node
			.findAll()
			.filter(
				(construct): construct is LambdaFunction =>
					construct instanceof LambdaFunction,
			);
		expect(reviewerFunctions).toHaveLength(4);
		for (const fn of reviewerFunctions) {
			NagSuppressions.addResourceSuppressions(
				fn.lambda,
				[
					{
						id: "AwsSolutions-IAM4",
						reason:
							"This Lambda uses the AWS-managed basic execution policy for CloudWatch logging.",
					},
					{
						id: "AwsSolutions-L1",
						reason: "Pawl pins its supported Node.js 22 runtime.",
					},
				],
				true,
			);
		}

		Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }));
		const errors = Annotations.fromStack(stack).findError(
			"*",
			Match.stringLikeRegexp("AwsSolutions-"),
		);
		expect(errors).toEqual([]);
	});
});
