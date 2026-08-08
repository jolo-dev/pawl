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
	pipelineCoordinationName:
		"CodePipelineReviewerStack-Pipeline9850B417-41iImnwp8TWb",
};

function createStack(
	id = "CodePipelineReviewerStack",
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
	test("preserves the historical repository logical ID while seeding it", () => {
		const { template } = createStack();
		const resources = template.toJSON().Resources as Record<string, unknown>;
		expect(resources).toHaveProperty("RepositoryRepository412D33BA");
		template.hasResourceProperties("AWS::CodeCommit::Repository", {
			RepositoryName: "codepipeline-autoreviewer-demo",
			RepositoryDescription:
				"Durable Lambda reviewer example with CodePipeline",
			Code: {
				BranchName: "main",
				S3: {
					Key: "6b52ebe09ae185b7d29d3f63654fb5beb7966e50befc17b752ce7cc905a1301a.zip",
				},
			},
		});
	});

	test("uses the preserved repository as source without a PipelineSource repository", () => {
		const { template } = createStack();
		const resources = template.toJSON().Resources as Record<
			string,
			{ Type?: string }
		>;
		expect(
			Object.entries(resources).some(
				([key, resource]) =>
					key.startsWith("PipelineSource") &&
					resource.Type === "AWS::CodeCommit::Repository",
			),
		).toBe(false);
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

	test("preserves the deployed buildspec", () => {
		const { template } = createStack();
		template.hasResourceProperties("AWS::CodeBuild::Project", {
			Source: {
				Type: "S3",
				BuildSpec: JSON.stringify(
					{
						version: "0.2",
						phases: {
							install: { "runtime-versions": { nodejs: 22 } },
							build: {
								commands: [
									`test -d src && bash -o pipefail -c 'find src -type f -name "*.ts" -print0 | while IFS= read -r -d "" file; do node --check "$file" || exit; done'`,
								],
							},
						},
					},
					null,
					2,
				),
			},
		});
	});

	test("uses CloudFormation pipeline naming and the deployed coordination name", () => {
		const { template } = createStack();
		const pipeline = Object.values(
			template.findResources("AWS::CodePipeline::Pipeline"),
		)[0] as {
			Properties: {
				Name?: string;
				Stages: Array<{
					Actions: Array<{
						Name: string;
						Configuration?: { UserParameters?: string };
					}>;
				}>;
			};
		};
		const buildStage = pipeline.Properties.Stages.find(({ Actions }) =>
			Actions.some(({ Name }) => Name === "AIReview"),
		);
		const aiReview = buildStage?.Actions.find(
			({ Name }) => Name === "AIReview",
		);

		expect(pipeline.Properties.Name).toBeUndefined();
		expect(aiReview?.Configuration?.UserParameters).toContain(
			"CodePipelineReviewerStack-Pipeline9850B417-41iImnwp8TWb",
		);
	});

	test("retains every deployed per-repository review resource logical ID", () => {
		const { template } = createStack();
		const resourceIds = Object.keys(
			template.toJSON().Resources as Record<string, unknown>,
		);

		const deployedResourceIds = [
			"PipelineAutoReviewCheckscodepipelineautoreviewerdemoEncryptionKeyFD8D9D72",
			"PipelineAutoReviewCheckscodepipelineautoreviewerdemoLogGroupC7A369B8",
			"PipelineAutoReviewCheckscodepipelineautoreviewerdemoPipelinePlaceholderBucketB86467FE",
			"PipelineAutoReviewCheckscodepipelineautoreviewerdemoPipelinePlaceholderBucketPolicy7C8113ED",
			"PipelineAutoReviewCheckscodepipelineautoreviewerdemoPipelinePlaceholderBucketAutoDeleteObjectsCustomResourceBE1E3A7A",
			"PipelineAutoReviewCheckscodepipelineautoreviewerdemoProjectRole60319D62",
			"PipelineAutoReviewCheckscodepipelineautoreviewerdemoProjectRoleDefaultPolicyEC8D6E7D",
			"PipelineAutoReviewCheckscodepipelineautoreviewerdemoProjectE9B40273",
			"PipelineAutoReviewCheckscodepipelineautoreviewerdemoReviewerRunAndReadPolicyc8622a63ad6b326af57cc84b463c4adba03e425e24542FF2BF",
			"PipelineAutoReviewEventscodepipelineautoreviewerdemoRepositoryPullRequestRuleB55FBF62",
			"PipelineAutoReviewEventscodepipelineautoreviewerdemoRepositoryPullRequestRuleAllowEventRuleCodePipelineReviewerStackPipelineAutoReviewRouterLambdaFunctionD20803889A0C2B86",
			"PipelineAutoReviewEventscodepipelineautoreviewerdemoRepositoryCommentRuleA270519F",
			"PipelineAutoReviewEventscodepipelineautoreviewerdemoRepositoryCommentRuleAllowEventRuleCodePipelineReviewerStackPipelineAutoReviewRouterLambdaFunctionD20803882947935F",
			"PipelineAutoReviewEventscodepipelineautoreviewerdemoDeadLetterQueue844FE052",
			"PipelineAutoReviewEventscodepipelineautoreviewerdemoDeadLetterQueuePolicy638B5AF2",
		];
		for (const deployedResourceId of deployedResourceIds) {
			expect(resourceIds).toContain(deployedResourceId);
		}
		expect(
			resourceIds.some((id) =>
				id.startsWith(
					"PipelineAutoReviewCheckscodepipelineautoreviewerdemo4ecc0b91",
				),
			),
		).toBe(false);
		expect(
			resourceIds.some((id) =>
				id.startsWith(
					"PipelineAutoReviewEventscodepipelineautoreviewerdemo4ecc0b91",
				),
			),
		).toBe(false);
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
