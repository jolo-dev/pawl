import { describe, expect, test } from "bun:test";
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
  test("creates and seeds a CodeCommit repository from local source", () => {
    const { template } = createStack();
    template.hasResourceProperties("AWS::CodeCommit::Repository", {
      RepositoryName: "durable-lambda-reviewer",
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
    const sourceAction = (pipelines[0] as { Properties: { Stages: Array<{ Actions: Array<{ Configuration: Record<string, unknown> }> }> } }).Properties.Stages[0].Actions[0];
    expect(sourceAction.Configuration.PollForSourceChanges).toBe(false);
  });

  test("creates Build and Approve stages", () => {
    const { template } = createStack();
    template.hasResourceProperties("AWS::CodePipeline::Pipeline", {
      Stages: Match.arrayWith([
        Match.objectLike({ Name: "Build" }),
        Match.objectLike({ Name: "Approve" }),
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

  test("uses retained removal policy for the created repository", () => {
    const { template } = createStack();
    template.hasResource("AWS::CodeCommit::Repository", {
      DeletionPolicy: "RetainExceptOnCreate",
      UpdateReplacePolicy: "Retain",
    });
  });

  test("requires reviewerModelId context", () => {
    expect(() =>
      createStack("NoModel", { ...DEFAULT_CONTEXT, reviewerModelId: undefined }),
    ).toThrow(/reviewerModelId/);
  });

  test("passes AwsSolutions checks", () => {
    const app = new App();
    for (const [key, value] of Object.entries(DEFAULT_CONTEXT)) {
      app.node.setContext(key, value);
    }
    const stack = new CodePipelineReviewerStack(app, "NagStack");

    NagSuppressions.addStackSuppressions(stack, [
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
    ], true);

    Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }));
    const errors = Annotations.fromStack(stack).findError(
      "*",
      Match.stringLikeRegexp("AwsSolutions-"),
    );
    expect(errors).toEqual([]);
  });
});
