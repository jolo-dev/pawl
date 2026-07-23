import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { Duration } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { NagSuppressions } from "cdk-nag";
import { z } from "zod";
import {
	CodeBuildProject,
	type CodeBuildNetworkPolicy,
	type CodeBuildComputeSize,
} from "./codebuild-project";
import { CodeCommitReviewEvents } from "./codecommit-review-events";
import { DurableLambdaFunction } from "./durable-lambda-function";
import { DynamoDbTable } from "./dynamodb-table";
import { LambdaFunction } from "./lambda-function";
import type { Stack } from "./stack";
import { projectEnvVar } from "./reviewer/adapters/codebuild-check-runner";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** The Pawl workspace root (parent of packages/cdk). The reviewer handler
 * entry files live under packages/cdk/src/reviewer/ and must be bundled with
 * this as the esbuild project root so NodejsFunction's path validation passes. */
const PAWL_ROOT = path.resolve(__dirname, "../../..");
const PAWL_LOCKFILE = path.join(PAWL_ROOT, "bun.lock");

const nonEmptyString = z.string().trim().min(1);

const repositoryNameSchema = nonEmptyString.regex(
	/^[A-Za-z0-9._-]+$/,
	"repository names may contain letters, digits, . _ -",
);

/**
 * Zod-validated configuration for the auto-reviewer.
 *
 * `repositories` is a non-empty list of CodeCommit repository names; one
 * CodeBuild project and one CodeCommit event construct is created per entry,
 * sharing a single durable reviewer, router, and state table.
 */
export const CodeCommitAutoReviewerConfigSchema = z.object({
	repositories: z.array(repositoryNameSchema).min(1),
	reviewerModelId: nonEmptyString,
	reviewerAlias: z.string().trim().min(1).default("live"),
	reviewerExecutionTimeoutSeconds: z
		.number()
		.int()
		.min(1)
		.max(31_622_400)
		.default(2_592_000),
	reviewerRetentionDays: z.number().int().min(1).max(90).default(14),
	reviewerTimeoutMinutes: z.number().int().min(1).max(15).default(15),
	reviewerMemorySize: z.number().int().min(128).max(10_240).default(512),
	codeBuildComputeSize: z
		.enum(["SMALL", "MEDIUM", "LARGE"])
		.default("SMALL"),
	codeBuildNetworkPolicy: z
		.object({
			mode: z.literal("public-test"),
			packageAccess: z.object({
				mode: z.literal("approved-registry"),
				endpoint: z
					.string()
					.trim()
					.url()
					.refine((v) => v.startsWith("https://"), "must be HTTPS"),
			}),
		})
		.default({
			mode: "public-test",
			packageAccess: {
				mode: "approved-registry",
				endpoint: "https://registry.npmjs.org",
			},
		}),
	botArnPatterns: z.string().default(""),
});

export type CodeCommitAutoReviewerConfig = z.infer<
	typeof CodeCommitAutoReviewerConfigSchema
>;

export type CodeCommitAutoReviewerProps = z.input<
	typeof CodeCommitAutoReviewerConfigSchema
> & {
	/** Override the team context value (defaults to CDK context `team`). */
	team?: string;
	/** Override the stage context value (defaults to CDK context `stage`). */
	stage?: string;
};

/**
 * Deploys the full durable CodeCommit PR auto-reviewer infrastructure.
 *
 * Creates: DynamoDB state table, per-repo CodeBuild projects, durable reviewer
 * Lambda, event-router Lambda, Bedrock IAM, and per-repo CodeCommit event
 * routing — all wired with least-privilege grants.
 *
 * The reviewer Lambda physical name is `${team}-${stage}-Reviewer-lambda`
 * (derived from CDK context) so the router invoke target, IAM scope, and
 * bot-filter ARN stay aligned.
 *
 * For single-repo opt-in, use the higher-level `CodeCommit` construct with
 * `autoReview: { ... }` instead.
 */
export class CodeCommitAutoReviewer {
	readonly reviewer: DurableLambdaFunction;
	readonly router: LambdaFunction;
	readonly stateTable: DynamoDbTable;
	readonly codeBuildProjects: ReadonlyMap<string, CodeBuildProject>;
	readonly eventConstructs: ReadonlyMap<string, CodeCommitReviewEvents>;

	constructor(scope: Stack, id: string, props: CodeCommitAutoReviewerProps) {
		const config = CodeCommitAutoReviewerConfigSchema.parse(props);
		const team = props.team ?? scope.node.tryGetContext("team");
		const stage = props.stage ?? scope.node.tryGetContext("stage");
		if (!team || !stage) {
			throw new Error(
				"CodeCommitAutoReviewer: team and stage are required (set via CDK context or props)",
			);
		}
		const reviewerName = `${team}-${stage}-Reviewer-lambda`;
		const reviewerArn = `arn:aws:lambda:${scope.region}:${scope.account}:function:${reviewerName}:${config.reviewerAlias}`;

		// 1. State table
		const stateTable = new DynamoDbTable(scope, `${id}State`, {
			partitionKey: { name: "pk", type: "STRING" },
			sortKey: { name: "sk", type: "STRING" },
			timeToLiveAttribute: "expiresAt",
			pointInTimeRecovery: true,
			retain: true,
		});

		// 2. Per-repo CodeBuild projects (created first so project-name tokens
		//    can source the reviewer's env vars).
		const codeBuildProjects = new Map<string, CodeBuildProject>();
		const reviewerEnvironment: Record<string, string> = {
			STATE_TABLE_NAME: stateTable.tableName,
			BOT_ARN_PATTERNS: config.botArnPatterns,
			REVIEWER_FUNCTION_ARN: reviewerArn,
			REVIEWER_MODEL_ID: config.reviewerModelId,
			CODEBUILD_REPOSITORIES: config.repositories.join(","),
		};
		for (const repo of config.repositories) {
			const codeBuild = new CodeBuildProject(scope, `${id}Checks-${repo}`, {
				repositoryName: repo,
				computeSize: config.codeBuildComputeSize,
				networkPolicy: config.codeBuildNetworkPolicy,
			});
			codeBuildProjects.set(repo, codeBuild);
			reviewerEnvironment[projectEnvVar(repo)] = codeBuild.projectName;
		}

		// 3. Durable reviewer Lambda
		const reviewer = new DurableLambdaFunction(scope, `${id}Reviewer`, {
			entry: path.resolve(__dirname, "reviewer/handlers/reviewer.ts"),
			projectRoot: PAWL_ROOT,
			depsLockFilePath: PAWL_LOCKFILE,
			executionTimeoutSeconds: config.reviewerExecutionTimeoutSeconds,
			retentionDays: config.reviewerRetentionDays,
			aliasName: config.reviewerAlias,
			timeout: Duration.minutes(config.reviewerTimeoutMinutes),
			memorySize: config.reviewerMemorySize,
			environment: reviewerEnvironment,
		});

		stateTable.grantReadWrite(reviewer);

		// 4. Bedrock InvokeModel IAM (inference-profile + foundation-model).
		//    The region wildcard is required for cross-region inference profiles.
		reviewer.lambda.addToRolePolicy(
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: ["bedrock:InvokeModel"],
				resources: [
					`arn:aws:bedrock:${scope.region}:${scope.account}:inference-profile/${config.reviewerModelId}`,
					`arn:aws:bedrock:*::foundation-model/anthropic.*`,
				],
			}),
		);
		NagSuppressions.addResourceSuppressions(
			reviewer.lambda,
			[
				{
					id: "AwsSolutions-IAM5",
					reason:
						"bedrock:InvokeModel on arn:aws:bedrock:*::foundation-model/anthropic.* is region- and model-wildcarded because cross-region inference profiles route across multiple regions and the base model id differs from the profile id; scoped to Anthropic foundation models only.",
					appliesTo: ["Resource::arn:aws:bedrock:*::foundation-model/anthropic.*"],
				},
			],
			true,
		);

		// 5. Router Lambda
		const router = new LambdaFunction(scope, `${id}Router`, {
			entry: path.resolve(__dirname, "reviewer/handlers/router.ts"),
			projectRoot: PAWL_ROOT,
			depsLockFilePath: PAWL_LOCKFILE,
			environment: {
				STATE_TABLE_NAME: stateTable.tableName,
				REVIEWER_FUNCTION_NAME: reviewer.lambda.functionName,
				REVIEWER_FUNCTION_ALIAS: config.reviewerAlias,
				REVIEWER_FUNCTION_ARN: reviewer.durableFunctionArn,
				BOT_ARN_PATTERNS: config.botArnPatterns,
			},
		});

		stateTable.grantReadWrite(router);

		// 6. Per-repo CodeBuild grants + CodeCommit event routing
		const eventConstructs = new Map<string, CodeCommitReviewEvents>();
		for (const repo of config.repositories) {
			const codeBuild = codeBuildProjects.get(repo);
			if (codeBuild === undefined) continue;
			codeBuild.grantRunAndRead(reviewer);

			const events = new CodeCommitReviewEvents(scope, `${id}Events-${repo}`, {
				repositoryName: repo,
				router,
			});
			events.grantRead(router);
			events.grantConfigRead(router);
			events.grantRead(reviewer);
			events.grantConfigRead(reviewer);
			events.grantComment(reviewer);
			eventConstructs.set(repo, events);
		}

		// 7. Durable execution IAM (router → reviewer)
		reviewer.grantInvokeDurable(router);
		reviewer.grantReadDurableExecutions(router);
		reviewer.grantSendDurableExecutionCallbacks(router);

		this.reviewer = reviewer;
		this.router = router;
		this.stateTable = stateTable;
		this.codeBuildProjects = codeBuildProjects;
		this.eventConstructs = eventConstructs;
	}
}
