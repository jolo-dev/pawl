import path from "node:path";
import type { Construct } from "@pawl/cdk";
import { CodeBuildProject, CodePipeline, Stack } from "@pawl/cdk";

/**
 * Example stack showcasing `CodePipeline` with a CodeCommit repository
 * seeded from this directory's source code and durable auto-review with
 * PR-gated triggering.
 *
 * Flow:
 * 1. `CodePipeline.source()` creates and seeds a managed CodeCommit repository
 *    from `sourcePath` (this directory). The initial commit includes all
 *    project files.
 * 2. `CodePipeline` creates a CI/CD pipeline using its managed repository as
 *    the source. With `onPullRequest: true`, the pipeline only starts when a
 *    PR is opened — the router starts executions with the PR's source commit.
 * 3. `autoReviewer` deploys the durable reviewer infrastructure. On each PR
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

		// Create a pipeline-mode CodeBuild project before defining its fluent
		// pipeline action.
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

		// The pipeline owns source creation and seeding. Fluent stages infer the
		// SourceOutput input and BuildOutput output artifacts automatically.
		new CodePipeline(this, "Pipeline", {
			onPullRequest: true,
			autoReviewer: { modelId },
		})
			.source({
				origin: "codecommit",
				create: true,
				repositoryName,
				branchName,
				description: "Durable Lambda reviewer example with CodePipeline",
				sync: sourcePath,
			})
			.stage([
				{
					name: "Build",
					actions: [
						{ name: "Build", type: "codebuild", project: buildProject },
					],
				},
				{
					name: "Approve",
					actions: [
						{
							name: "Approve",
							type: "approval",
							description:
								"Review the build output and AI review comment before merging.",
						},
					],
				},
			]);
	}
}
