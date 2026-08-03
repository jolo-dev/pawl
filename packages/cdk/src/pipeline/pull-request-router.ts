import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IRepository } from "aws-cdk-lib/aws-codecommit";
import type { Pipeline } from "aws-cdk-lib/aws-codepipeline";
import { Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction as LambdaEventTarget } from "aws-cdk-lib/aws-events-targets";
import {
	Effect,
	PolicyStatement as IamPolicyStatement,
} from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import { z } from "zod";
import {
	BasicConstruct,
	type PolicyStatement as BasicPolicyStatement,
} from "../basic-construct";
import {
	normalizeRepositoryTarget,
	type RepositoryTarget,
} from "../codecommit-repository";
import { CodeCommitReviewEvents } from "../codecommit-review-events";
import { DynamoDbTable } from "../dynamodb-table";
import { LambdaFunction } from "../lambda-function";
import type { Stack } from "../stack";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PAWL_ROOT = path.resolve(__dirname, "../../../..");
const PAWL_LOCKFILE = path.join(PAWL_ROOT, "bun.lock");

const PullRequestRouterConfigSchema = z.object({
	sourceActionName: z
		.string()
		.min(1)
		.max(100)
		.regex(/^[A-Za-z0-9.@_-]+$/),
});

/** Internal infrastructure required to start a CodePipeline from PR events. */
export type PullRequestRouterProps = RepositoryTarget & {
	readonly pipeline: Pipeline;
	readonly sourceActionName: string;
};

/**
 * Routes CodeCommit PR events into a pipeline without provisioning AI review.
 *
 * This construct intentionally reuses the durable reviewer's ordinary router
 * handler in its pipeline-only composition: pipeline environment is present
 * while reviewer-function environment is absent.
 */
export class PullRequestRouter extends BasicConstruct {
	readonly repository: IRepository;
	readonly router: LambdaFunction;
	readonly stateTable: DynamoDbTable;
	readonly reviewEvents: CodeCommitReviewEvents;
	readonly pipelineExecutionRule: Rule;

	constructor(scope: Stack, id: string, props: PullRequestRouterProps) {
		super(scope, id);
		const { sourceActionName } = PullRequestRouterConfigSchema.parse(props);
		this.repository = normalizeRepositoryTarget(
			this,
			"Repository",
			props,
		).repository;

		this.stateTable = new DynamoDbTable(scope, `${id}State`, {
			partitionKey: { name: "pk", type: "STRING" },
			sortKey: { name: "sk", type: "STRING" },
			timeToLiveAttribute: "expiresAt",
			pointInTimeRecovery: true,
			retain: true,
			globalSecondaryIndexes: [
				{
					indexName: "GSI2",
					partitionKey: { name: "gsi2pk", type: "STRING" },
					sortKey: { name: "gsi2sk", type: "STRING" },
				},
			],
		});

		this.router = new LambdaFunction(scope, `${id}Router`, {
			entry: path.resolve(__dirname, "../reviewer/handlers/router.ts"),
			projectRoot: PAWL_ROOT,
			depsLockFilePath: PAWL_LOCKFILE,
			environment: {
				STATE_TABLE_NAME: this.stateTable.tableName,
				PIPELINE_NAME: props.pipeline.pipelineName,
				PIPELINE_SOURCE_ACTION_NAME: sourceActionName,
			},
		});
		this.stateTable.grantReadWrite(this.router);
		this.router.lambda.addToRolePolicy(
			new IamPolicyStatement({
				effect: Effect.ALLOW,
				actions: [
					"codepipeline:StartPipelineExecution",
					"codepipeline:GetPipelineExecution",
					"codepipeline:ListPipelineExecutions",
					"codepipeline:ListActionExecutions",
				],
				resources: [props.pipeline.pipelineArn],
			}),
		);

		this.reviewEvents = new CodeCommitReviewEvents(scope, `${id}Events`, {
			repository: this.repository,
			router: this.router,
		});
		this.reviewEvents
			.grantRead(this.router)
			.grantConfigRead(this.router)
			.grantComment(this.router);

		this.pipelineExecutionRule = new Rule(scope, `${id}PipelineExecutionRule`, {
			eventPattern: {
				source: ["aws.codepipeline"],
				detailType: ["CodePipeline Pipeline Execution State Change"],
				detail: { pipeline: [props.pipeline.pipelineName] },
			},
			targets: [new LambdaEventTarget(this.router.lambda)],
		});
	}

	createAlarm(_scope: Stack): void {
		// Child constructs register their own Lambda, table, and DLQ monitoring.
	}

	protected applyPermissionPolicy(
		_construct: Construct,
		_policyStatement: BasicPolicyStatement,
	): void {
		// This internal orchestration construct does not expose aggregate grants.
	}
}
