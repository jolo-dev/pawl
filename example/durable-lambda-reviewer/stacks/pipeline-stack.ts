import path from "node:path";
import type { Construct } from "@pawl/cdk";
import {
  Artifact,
  CodeBuildProject,
  CodeCommit,
  CodePipeline,
  type PipelineStage,
  Stack,
} from "@pawl/cdk";

/**
 * Example stack showcasing `CodePipeline` with a CodeCommit repository
 * seeded from this directory's source code and durable auto-review with
 * PR-gated triggering.
 *
 * Flow:
 * 1. `CodeCommit` creates and seeds a repository from `sourcePath` (this
 *    directory). The initial commit includes all project files.
 * 2. `CodePipeline` creates a CI/CD pipeline using the created repository as
 *    its source. With `onPullRequest: true`, the pipeline only starts when a
 *    PR is opened — the router starts executions with the PR's source commit.
 * 3. `autoReview` deploys the durable reviewer infrastructure. On each PR
 *    event, the router starts the pipeline (CI) and invokes the durable
 *    reviewer (AI review) in parallel via `Promise.allSettled`.
 *
 * @example
 * ```bash
 * # Deploy
 * AWS_PROFILE=my-profile bunx cdk deploy CodePipelineReviewerStack
 * ```
 */
export class CodePipelineReviewerStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const repositoryName = "codepipeline-autoreviewer-demo";
    const branchName =
      (this.node.tryGetContext("branchName") as string | undefined) ?? "main";
    const modelId = this.node.tryGetContext("reviewerModelId") as
      | string
      | undefined;
    if (modelId === undefined) {
      throw new Error("reviewerModelId context is required");
    }

    // The source path is this example directory itself (parent of stacks/)
    const sourcePath = path.resolve(import.meta.dirname, "..");

    // Create and seed a CodeCommit repository from the local source code.
    // The Pawl construct handles .gitignore-aware file filtering.
    const codeCommit = new CodeCommit(this, "Repository", {
      repositoryName,
      create: {
        sourcePath,
        branchName,
        description: "Durable Lambda reviewer example with CodePipeline",
      },
    });

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

    // Create the pipeline with PR-gated auto-review, using the created
    // repository as its source.
    new CodePipeline(this, "Pipeline", {
      source: {
        type: "codecommit",
        repository: codeCommit.repository,
        branchName,
      },
      stages,
      onPullRequest: true,
      autoReview: { modelId },
    });
  }
}
