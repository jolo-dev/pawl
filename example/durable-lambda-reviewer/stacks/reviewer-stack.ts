import type { Construct } from "@pawl/cdk";
import { CodeCommitAutoReviewer, Stack } from "@pawl/cdk";

/**
 * Thin consumer stack: a single `CodeCommitAutoReviewer` shared across all
 * repositories (matching the original architecture). All reviewer infrastructure
 * (durable Lambda, router, state table, CodeBuild, Bedrock IAM, event routing)
 * is encapsulated in the `@pawl/cdk` construct.
 */
export class DurableLambdaReviewerStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const repositories = this.node.tryGetContext("repositories") as
      | string[]
      | undefined;
    if (repositories === undefined || repositories.length === 0) {
      throw new Error("repositories context is required and must be non-empty");
    }
    const modelId = this.node.tryGetContext("reviewerModelId") as
      | string
      | undefined;
    if (modelId === undefined) {
      throw new Error("reviewerModelId context is required");
    }
    const botArnPatterns = this.node.tryGetContext("botArnPatterns") as
      | string
      | undefined;

    new CodeCommitAutoReviewer(this, "Reviewer", {
      repositories,
      reviewerModelId: modelId,
      ...(botArnPatterns === undefined ? {} : { botArnPatterns }),
    });
  }
}
