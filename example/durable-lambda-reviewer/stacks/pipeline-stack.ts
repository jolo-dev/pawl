import path from "node:path";
import type { Construct } from "@pawl/cdk";
import {
	BuildSpec,
	CodeBuildProject,
	CodeCommit,
	CodePipeline,
	Stack,
} from "@pawl/cdk";

/**
 * Example stack showcasing `CodePipeline` with a CodeCommit repository
 * seeded from this directory's source code and durable auto-review with
 * PR-gated triggering.
 *
 * Flow:
 * 1. `CodeCommit` explicitly creates and seeds the repository from
 *    `sourcePath` (this directory). The initial commit includes all project
 *    files.
 * 2. `CodePipeline` creates a CI/CD pipeline that reuses that concrete
 *    repository as its source. With `onPullRequest: true`, the pipeline only starts when a
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
		const pipelineCoordinationName = this.node.tryGetContext(
			"pipelineCoordinationName",
		) as string | undefined;
		if (pipelineCoordinationName === undefined) {
			throw new Error("pipelineCoordinationName context is required");
		}

		// The source path is this example directory itself (parent of stacks/)
		const sourcePath = path.resolve(import.meta.dirname, "..");
		const repository = new CodeCommit(this, "Repository", {
			repositoryName,
			create: {
				branchName,
				description: "Durable Lambda reviewer example with CodePipeline",
				sourcePath,
				// Retain the deployed seed asset identity; changing Code replaces the repository.
				sourceAssetHash:
					"6b52ebe09ae185b7d29d3f63654fb5beb7966e50befc17b752ce7cc905a1301a",
			},
		});

		// Create a pipeline-mode CodeBuild project before defining its fluent
		// pipeline action.
		const buildProject = new CodeBuildProject(this, "BuildProject", {
			pipelineMode: true,
			// Preserve the deployed buildspec while source migration is in flight.
			buildSpec: BuildSpec.fromObject({
				version: "0.2",
				phases: {
					install: { "runtime-versions": { nodejs: 22 } },
					build: {
						commands: [
							`test -d src && bash -o pipefail -c 'find src -type f -name "*.ts" -print0 | while IFS= read -r -d "" file; do node --check "$file" || exit; done'`,
						],
					},
				},
			}),
			networkPolicy: {
				mode: "public-test",
				packageAccess: {
					mode: "approved-registry",
					endpoint: "https://registry.npmjs.org",
				},
			},
		});

		// The fluent pipeline reuses the concrete CodeCommit repository above.
		// Fluent stages infer the SourceOutput input and BuildOutput output artifacts
		// automatically.
		new CodePipeline(this, "Pipeline", {
			onPullRequest: true,
			autoReviewer: {
				modelId,
				legacyResourceIdSuffix: "codepipeline-autoreviewer-demo",
			},
			pipelineNaming: {
				mode: "cloudFormation",
				coordinationName: pipelineCoordinationName,
			},
		})
			.source({
				origin: "codecommit",
				repository: repository.repository,
				repositoryName,
				branchName,
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
