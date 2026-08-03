import path from "node:path";
import { fileURLToPath } from "node:url";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import type { IRepository } from "aws-cdk-lib/aws-codecommit";
import type { Pipeline } from "aws-cdk-lib/aws-codepipeline";
import { Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction as LambdaEventTarget } from "aws-cdk-lib/aws-events-targets";
import {
	Effect,
	PolicyStatement as IamPolicyStatement,
} from "aws-cdk-lib/aws-iam";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { NagSuppressions } from "cdk-nag";
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
	readonly deadLetterQueue: Queue;
	readonly pullRequestRule: Rule;
	readonly commentRule: Rule;
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
		this.router.lambda.addToRolePolicy(
			new IamPolicyStatement({
				effect: Effect.ALLOW,
				actions: [
					"dynamodb:GetItem",
					"dynamodb:PutItem",
					"dynamodb:UpdateItem",
					"dynamodb:TransactWriteItems",
				],
				resources: [this.stateTable.tableArn],
			}),
		);
		this.router.lambda.addToRolePolicy(
			new IamPolicyStatement({
				effect: Effect.ALLOW,
				actions: ["dynamodb:Query"],
				resources: [
					this.stateTable.tableArn,
					`${this.stateTable.tableArn}/index/GSI2`,
				],
			}),
		);
		this.router.lambda.addToRolePolicy(
			new IamPolicyStatement({
				effect: Effect.ALLOW,
				actions: [
					"codepipeline:StartPipelineExecution",
					"codepipeline:GetPipelineExecution",
					"codepipeline:ListActionExecutions",
				],
				resources: [props.pipeline.pipelineArn],
			}),
		);
		this.router.lambda.addToRolePolicy(
			new IamPolicyStatement({
				effect: Effect.ALLOW,
				actions: [
					"codecommit:GetPullRequest",
					"codecommit:PostCommentForPullRequest",
				],
				resources: [this.repository.repositoryArn],
			}),
		);

		this.deadLetterQueue = new Queue(this, "DeadLetterQueue", {
			encryption: QueueEncryption.KMS_MANAGED,
			enforceSSL: true,
			retentionPeriod: Duration.days(14),
			removalPolicy: RemovalPolicy.RETAIN,
		});
		NagSuppressions.addResourceSuppressions(this.deadLetterQueue, [
			{
				id: "AwsSolutions-SQS3",
				reason:
					"This retained queue is itself the terminal EventBridge dead-letter queue and must not forward failures to another queue.",
			},
		]);
		const target = () =>
			new LambdaEventTarget(this.router.lambda, {
				deadLetterQueue: this.deadLetterQueue,
				retryAttempts: 3,
				maxEventAge: Duration.minutes(60),
			});
		const repositoryEventPattern = {
			source: ["aws.codecommit"],
			resources: [this.repository.repositoryArn],
			detail: { repositoryName: [this.repository.repositoryName] },
		};
		this.pullRequestRule = new Rule(this, "PullRequestStateRule", {
			eventPattern: {
				...repositoryEventPattern,
				detailType: ["CodeCommit Pull Request State Change"],
			},
			targets: [target()],
		});
		this.commentRule = new Rule(this, "PullRequestCommentRule", {
			eventPattern: {
				...repositoryEventPattern,
				detailType: ["CodeCommit Comment on Pull Request"],
			},
			targets: [target()],
		});
		this.pipelineExecutionRule = new Rule(this, "PipelineExecutionRule", {
			eventPattern: {
				source: ["aws.codepipeline"],
				detailType: ["CodePipeline Pipeline Execution State Change"],
				detail: { pipeline: [props.pipeline.pipelineName] },
			},
			targets: [new LambdaEventTarget(this.router.lambda)],
		});
		this.createAlarm(this.stack);
	}

	createAlarm(scope: Stack): void {
		scope.monitoring.monitorSqsQueue({ queue: this.deadLetterQueue });
	}

	protected applyPermissionPolicy(
		_construct: Construct,
		_policyStatement: BasicPolicyStatement,
	): void {
		// This internal orchestration construct does not expose aggregate grants.
	}
}
