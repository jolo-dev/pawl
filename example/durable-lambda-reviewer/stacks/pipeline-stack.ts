import type { Construct } from "@pawl/cdk";
import {
  CodeBuildProject,
  CodePipeline,
  type PipelineStage,
  Stack,
} from "@pawl/cdk";
import { Repository } from "aws-cdk-lib/aws-codecommit";
import { Artifact } from "aws-cdk-lib/aws-codepipeline";

/**
 * Example stack showcasing `CodePipeline` with durable auto-review and
 * PR-gated triggering.
 *
 * This stack creates a CI/CD pipeline for the `durable-reviewer-demo`
 * CodeCommit repository. The pipeline only starts when a pull request is
 * opened or updated (`onPullRequest: true`). On each PR event, the router
 * Lambda starts a pipeline execution with the PR's source commit and
 * simultaneously invokes the durable reviewer Lambda for AI review — both
 * running in parallel via `Promise.allSettled`.
 *
 * Pipeline stages:
 * 1. **Source** — CodeCommit repository, branch `main`, trigger disabled
 *    (`CodeCommitTrigger.NONE`). The router starts executions explicitly.
 * 2. **Build** — A `CodeBuildProject` in pipeline mode runs the repository's
 *    `buildspec.yml`. The project uses a placeholder S3 source (CodePipeline
 *    overrides it at execution time).
 * 3. **Approve** — A manual approval gate before any deployment.
 *
 * Review infrastructure (created automatically by `autoReview`):
 * - Durable reviewer Lambda (AI review via Bedrock)
 * - Router Lambda (starts pipeline + invokes reviewer in parallel)
 * - DynamoDB state table (review status + execution-to-PR mapping)
 * - CodeBuild review-check projects
 * - EventBridge rules (CodeCommit PR events + CodePipeline execution state)
 * - Bedrock IAM (anthropic.* foundation-model grant)
 *
 * @example
 * ```bash
 * # Deploy
 * AWS_PROFILE=jolo bunx cdk deploy CodePipelineReviewerStack
 *
 * # The pipeline and reviewer are now active. Opening a PR on the
 * # `durable-reviewer-demo` repository will trigger both CI and AI review.
 * ```
 */
export class CodePipelineReviewerStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const repositoryName = this.node.tryGetContext("repositoryName") as
      | string
      | undefined;
    if (repositoryName === undefined) {
      throw new Error("repositoryName context is required");
    }
    const branchName = (this.node.tryGetContext("branchName") as
      | string
      | undefined) ?? "main";
    const modelId = this.node.tryGetContext("reviewerModelId") as
      | string
      | undefined;
    if (modelId === undefined) {
      throw new Error("reviewerModelId context is required");
    }

    // Import the existing CodeCommit repository by name
    const repository = Repository.fromRepositoryName(
      this,
      "Repository",
      repositoryName,
    );

    // Create a pipeline-mode CodeBuild project for the Build stage
    const buildProject = new CodeBuildProject(this, "BuildProject", {
      pipelineMode: true,
      networkPolicy: {
        mode: "public-test",
        packageAccess: {
          mode: "approved-registry",
          endpoint: "https://registry.npmjs.org",
        },
      },
    });

    // Define the Build and Approve stages
    const sourceOutput = new Artifact("SourceOutput");
    const buildOutput = new Artifact("BuildOutput");
    const stages: PipelineStage[] = [
      {
        name: "Build",
        actions: [
          {
            type: "codebuild",
            name: "Build",
            project: buildProject,
            inputArtifact: sourceOutput,
            outputArtifacts: [buildOutput],
          },
        ],
      },
      {
        name: "Approve",
        actions: [
          {
            type: "manualApproval",
            name: "Approve",
            description:
              "Review the build output and AI review comment before merging.",
          },
        ],
      },
    ];

    // Create the pipeline with PR-gated auto-review
    new CodePipeline(this, "Pipeline", {
      source: {
        type: "codecommit",
        repository,
        branchName,
      },
      stages,
      onPullRequest: true,
      autoReview: { modelId },
    });
  }
}
