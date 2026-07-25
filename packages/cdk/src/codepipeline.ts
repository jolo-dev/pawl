import { Key } from "aws-cdk-lib/aws-kms";
import { Bucket } from "aws-cdk-lib/aws-s3";
import {
  Artifact,
  Pipeline,
  type PipelineProps,
} from "aws-cdk-lib/aws-codepipeline";
import {
  CodeCommitSourceAction,
  CodeCommitTrigger,
  CodeBuildAction,
  ManualApprovalAction,
  LambdaInvokeAction,
  S3DeployAction,
  CloudFormationCreateUpdateStackAction,
} from "aws-cdk-lib/aws-codepipeline-actions";
import { RemovalPolicy } from "aws-cdk-lib";
import type { Construct } from "constructs";
import type { IRepository } from "aws-cdk-lib/aws-codecommit";
import type { IBucket } from "aws-cdk-lib/aws-s3";
import type { LambdaFunction } from "./lambda-function";
import type { CodeBuildProject } from "./codebuild-project";
import { BasicConstruct } from "./basic-construct";
import type { Stack } from "./stack";

/**
 * Source configuration for a CodePipeline pipeline.
 *
 * CodeCommit is the primary use case. S3 and GitHub are supported but less
 * opinionated — the construct creates the source action but does not manage
 * the bucket or connection.
 */
export type PipelineSource =
  | {
      readonly type: "codecommit";
      readonly repository: IRepository;
      readonly branchName?: string;
    }
  | {
      readonly type: "s3";
      readonly bucket: IBucket;
      readonly objectKey: string;
    }
  | {
      readonly type: "github";
      readonly repository: string;
      readonly branch: string;
      readonly connectionArn: string;
    };

/**
 * A single stage in a pipeline with a name and ordered actions.
 */
export interface PipelineStage {
  readonly name: string;
  readonly actions: PipelineAction[];
}

/**
 * Pawl-validated pipeline action types.
 *
 * Each action explicitly models artifact dependencies. The construct creates
 * the underlying CDK action with correct artifact wiring.
 */
export type PipelineAction =
  | {
      readonly type: "codebuild";
      readonly name?: string;
      readonly project: CodeBuildProject;
      readonly inputArtifact?: Artifact;
      readonly outputArtifacts?: readonly Artifact[];
    }
  | {
      readonly type: "manualApproval";
      readonly name?: string;
      readonly description?: string;
    }
  | {
      readonly type: "lambda";
      readonly name?: string;
      readonly handler: LambdaFunction;
      readonly inputs?: Record<string, string>;
    }
  | {
      readonly type: "s3Deploy";
      readonly name?: string;
      readonly bucket: IBucket;
      readonly inputArtifact: Artifact;
      readonly objectKey: string;
    }
  | {
      readonly type: "cloudFormationDeploy";
      readonly name?: string;
      readonly stackName: string;
      readonly templatePath: string;
      readonly inputArtifact: Artifact;
      readonly actionMode?: "CREATE_UPDATE" | "REPLACE_ON_FAILURE";
      readonly capabilities?: readonly (
        | "CAPABILITY_IAM"
        | "CAPABILITY_NAMED_IAM"
        | "CAPABILITY_AUTO_EXPAND"
      )[];
    };

/**
 * Props for the {@link CodePipeline} construct.
 */
export interface CodePipelineProps {
  /** Source configuration — CodeCommit, S3, or GitHub. */
  readonly source: PipelineSource;
  /** Ordered stage definitions. Defaults to Source → Build → ManualApproval. */
  readonly stages?: PipelineStage[];
  /** Cross-account artifact bucket KMS key (auto-created by default). */
  readonly artifactEncryptionKey?: Key;
  /** When true, pipeline only triggers on PR events (router starts executions). Default: false (push-triggered). */
  readonly onPullRequest?: boolean;
  /** When set, deploys the durable auto-reviewer and wires it to the pipeline. */
  readonly autoReview?: AutoReviewConfig;
  /** Team/stage overrides (required when autoReview is set). */
  readonly team?: string;
  readonly stage?: string;
}

/**
 * CI/CD pipeline construct with optional durable auto-review.
 *
 * Supports four combinations:
 * - **Push, no review:** Standard CodePipeline triggering on branch pushes.
 * - **Push + review:** Pipeline on push, reviewer on PR events — independent.
 * - **PR-gated, no review:** Pipeline only starts on PR events via the router.
 * - **PR-gated + review:** Router starts pipeline and invokes AI reviewer in
 *   parallel on PR events via `Promise.allSettled`.
 *
 * @example Push-triggered with auto-review:
 * ```ts
 * new CodePipeline(this, "Pipeline", {
 *   source: { type: "codecommit", repository, branchName: "main" },
 *   autoReview: { modelId: "eu.anthropic.claude-sonnet-4-6" },
 * });
 * ```
 *
 * @example PR-gated with auto-review:
 * ```ts
 * new CodePipeline(this, "Pipeline", {
 *   source: { type: "codecommit", repository, branchName: "main" },
 *   onPullRequest: true,
 *   autoReview: { modelId: "eu.anthropic.claude-sonnet-4-6" },
 * });
 * ```
 */
export class CodePipeline extends BasicConstruct {
  readonly pipeline: Pipeline;
  readonly artifactBucket: Bucket;
  readonly artifactEncryptionKey: Key;

  constructor(scope: Stack, id: string, props: CodePipelineProps) {
    super(scope, id);

    // 1. Artifact bucket with KMS encryption
    this.artifactEncryptionKey =
      props.artifactEncryptionKey ??
      new Key(this, "ArtifactKey", {
        enableKeyRotation: true,
        removalPolicy: RemovalPolicy.RETAIN,
      });
    this.artifactBucket = new Bucket(this, "ArtifactBucket", {
      encryptionKey: this.artifactEncryptionKey,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // 2. Create pipeline
    const pipelineProps: PipelineProps = {
      artifactBucket: this.artifactBucket,
      crossAccountKeys: false,
    };
    this.pipeline = new Pipeline(this, "Pipeline", pipelineProps);

    // 3. Source stage
    const sourceArtifact = this.addSourceStage(props);

    // 4. User stages or default Build + ManualApproval
    if (props.stages !== undefined) {
      for (const stage of props.stages) {
        this.addStage(stage, sourceArtifact);
      }
    } else {
      this.addDefaultStages(sourceArtifact);
    }

    // 5. Auto-review infrastructure (if enabled)
    // This will be fully implemented in Task 5 when we wire the router
    // For now, the construct creates the pipeline without review infrastructure
  }

  private addSourceStage(props: CodePipelineProps): Artifact {
    const sourceAction = this.createSourceAction(props);
    this.pipeline.addStage({
      stageName: "Source",
      actions: [sourceAction],
    });
    return sourceAction.actionProperties.outputs?.[0] ?? new Artifact("SourceOutput");
  }

  private createSourceAction(props: CodePipelineProps): CodeCommitSourceAction {
    if (props.source.type === "codecommit") {
      return new CodeCommitSourceAction({
        actionName: "Source",
        repository: props.source.repository,
        branch: props.source.branchName ?? "main",
        trigger: props.onPullRequest === true ? CodeCommitTrigger.NONE : undefined,
        output: new Artifact("SourceOutput"),
      });
    }
    // S3 and GitHub sources — placeholder for future implementation
    throw new Error(`Source type "${props.source.type}" is not yet implemented`);
  }

  private addStage(stage: PipelineStage, sourceArtifact: Artifact): void {
    const actions = stage.actions.map((action) =>
      this.createAction(action, sourceArtifact),
    );
    this.pipeline.addStage({
      stageName: stage.name,
      actions,
    });
  }

  private addAction(action: PipelineAction, sourceArtifact: Artifact): unknown {
    switch (action.type) {
      case "codebuild":
        return new CodeBuildAction({
          actionName: action.name ?? "Build",
          project: action.project.project,
          input: action.inputArtifact ?? sourceArtifact,
          outputs: action.outputArtifacts,
        });
      case "manualApproval":
        return new ManualApprovalAction({
          actionName: action.name ?? "Approve",
          additionalInformation: action.description,
        });
      case "lambda":
        return new LambdaInvokeAction({
          actionName: action.name ?? "Invoke",
          lambda: action.handler.lambda,
          inputs: action.inputs
            ? Object.values(action.inputs).map((v) => new Artifact(v))
            : undefined,
        });
      case "s3Deploy":
        return new S3DeployAction({
          actionName: action.name ?? "Deploy",
          bucket: action.bucket,
          input: action.inputArtifact,
          objectKey: action.objectKey,
        });
      case "cloudFormationDeploy":
        return new CloudFormationCreateUpdateStackAction({
          actionName: action.name ?? "Deploy",
          stackName: action.stackName,
          templatePath: action.inputArtifact.atPath(action.templatePath),
          actionMode: action.actionMode ?? "CREATE_UPDATE",
          capabilities: action.capabilities as
            | ("CAPABILITY_IAM" | "CAPABILITY_NAMED_IAM" | "CAPABILITY_AUTO_EXPAND")[]
            | undefined,
        });
      default:
        throw new Error(`Unknown action type: ${(action as { type: string }).type}`);
    }
  }

  private createAction(action: PipelineAction, sourceArtifact: Artifact): unknown {
    return this.addAction(action, sourceArtifact);
  }

  private addDefaultStages(sourceArtifact: Artifact): void {
    // Build stage — placeholder, user creates their own CodeBuildProject
    // For now, just add a manual approval stage
    this.pipeline.addStage({
      stageName: "Approve",
      actions: [
        new ManualApprovalAction({
          actionName: "Approve",
        }),
      ],
    });
  }
}
