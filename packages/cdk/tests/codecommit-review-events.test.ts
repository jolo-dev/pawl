import { describe, expect, expectTypeOf, test } from "bun:test";
import path from "node:path";
import { Aspects, type CfnResource } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { type IRepository, Repository } from "aws-cdk-lib/aws-codecommit";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import {
	CodeCommitReviewEvents,
	CodeCommitReviewEventsConfigSchema,
	type CodeCommitReviewEventsProps,
} from "../src/codecommit-review-events";
import { LambdaFunction } from "../src/lambda-function";
import { Stack } from "../src/stack";
import { createTestApp } from "./utils";

const lambdaEntry = path.join(__dirname, "lambda", "test-lambda.ts");

function createEvents(
	id = "ReviewEvents",
	props: Partial<CodeCommitReviewEventsProps> = {},
): {
	stack: Stack;
	router: LambdaFunction;
	construct: CodeCommitReviewEvents;
	template: Template;
} {
	const stack = new Stack(createTestApp(), `${id}Stack`);
	const router = new LambdaFunction(stack, "Router", { entry: lambdaEntry });
	const construct = new CodeCommitReviewEvents(stack, id, {
		repositoryName: "review-target",
		router,
		...props,
	});
	return { stack, router, construct, template: Template.fromStack(stack) };
}

function suppressLambdaFixtureFindings(lambdaFunction: LambdaFunction): void {
	NagSuppressions.addResourceSuppressions(
		lambdaFunction.lambda,
		[
			{
				id: "AwsSolutions-IAM4",
				reason:
					"The isolated router fixture uses the Lambda L2 logging policy.",
			},
			{
				id: "AwsSolutions-L1",
				reason: "Pawl pins its supported Node.js 22 runtime.",
			},
			{
				id: "AwsSolutions-Lambda1",
				reason: "The isolated router fixture does not require VPC access.",
			},
			{
				id: "AwsSolutions-Lambda4",
				reason: "The isolated router fixture has no workload DLQ.",
			},
			{
				id: "AwsSolutions-Lambda5",
				reason:
					"The isolated router fixture leaves concurrency to its consumer.",
			},
		],
		true,
	);
}

function statementsForRole(
	stack: Stack,
	template: Template,
	lambdaFunction: LambdaFunction,
): Array<Record<string, unknown>> {
	const roleId = stack.getLogicalId(
		lambdaFunction.lambda.role?.node.defaultChild as CfnResource,
	);
	return Object.values(template.findResources("AWS::IAM::Policy"))
		.filter(({ Properties }) =>
			(Properties.Roles as Array<{ Ref: string }> | undefined)?.some(
				(role) => role.Ref === roleId,
			),
		)
		.flatMap(({ Properties }) => Properties.PolicyDocument.Statement);
}

function grantStatements(
	stack: Stack,
	template: Template,
	lambdaFunction: LambdaFunction,
): Array<Record<string, unknown>> {
	return statementsForRole(stack, template, lambdaFunction).filter(
		(statement) => JSON.stringify(statement).includes("codecommit:"),
	);
}

describe("CodeCommitReviewEvents", () => {
	test("creates exactly two native default-bus rules scoped only to the repository", () => {
		const { construct, template } = createEvents();
		const rules = Object.values(template.findResources("AWS::Events::Rule"));

		expect(rules).toHaveLength(2);
		const repositoryArn = {
			"Fn::Join": [
				"",
				[
					"arn:",
					{ Ref: "AWS::Partition" },
					":codecommit:",
					{ Ref: "AWS::Region" },
					":",
					{ Ref: "AWS::AccountId" },
					":review-target",
				],
			],
		};
		expect(rules.map(({ Properties }) => Properties.EventPattern)).toEqual(
			expect.arrayContaining([
				{
					source: ["aws.codecommit"],
					"detail-type": ["CodeCommit Pull Request State Change"],
					resources: [repositoryArn],
				},
				{
					source: ["aws.codecommit"],
					"detail-type": ["CodeCommit Comment on Pull Request"],
					resources: [repositoryArn],
				},
			]),
		);
		for (const { Properties } of rules) {
			expect(Properties.EventBusName).toBeUndefined();
			const serialized = JSON.stringify(Properties.EventPattern).toLowerCase();
			expect(serialized).not.toContain("identity");
			expect(serialized).not.toContain("principal");
			expect(serialized).not.toContain("user");
		}
		expect(construct.repository.repositoryName).toBe("review-target");
	});

	test("preserves a supplied repository and scopes rules to its ARN", () => {
		const stack = new Stack(createTestApp(), "SharedRepositoryStack");
		const repository = new Repository(stack, "SharedRepository", {
			repositoryName: "shared-review-target",
		});
		const router = new LambdaFunction(stack, "Router", { entry: lambdaEntry });
		const construct = new CodeCommitReviewEvents(stack, "ReviewEvents", {
			repository,
			router,
		});
		const template = Template.fromStack(stack);

		expect(construct.repository).toBe(repository);
		expectTypeOf(construct.repository).toEqualTypeOf<IRepository>();
		for (const { Properties } of Object.values(
			template.findResources("AWS::Events::Rule"),
		)) {
			expect(Properties.EventPattern.resources).toEqual([
				{ "Fn::GetAtt": [expect.stringContaining("SharedRepository"), "Arn"] },
			]);
		}
	});

	test("rejects missing or ambiguous repository targets before child resources", () => {
		for (const [id, target] of [
			["Missing", {}],
			[
				"Ambiguous",
				{
					repositoryName: "review-target",
					repository: Repository.fromRepositoryName(
						new Stack(createTestApp(), "ImportedRepositoryStack"),
						"Repository",
						"other-target",
					),
				},
			],
		] as const) {
			const stack = new Stack(createTestApp(), `${id}Stack`);
			const router = new LambdaFunction(stack, "Router", {
				entry: lambdaEntry,
			});
			expect(
				() =>
					new CodeCommitReviewEvents(stack, "ReviewEvents", {
						...target,
						router,
					} as CodeCommitReviewEventsProps),
			).toThrow(/exactly one/);
			expect(
				Template.fromStack(stack).findResources("AWS::SQS::Queue"),
			).toEqual({});
			expect(
				Template.fromStack(stack).findResources("AWS::Events::Rule"),
			).toEqual({});
		}
	});

	test("targets the router with one shared DLQ and bounded retry policies", () => {
		const { router, template } = createEvents();
		const ruleResources = template.findResources("AWS::Events::Rule");
		const rules = Object.values(ruleResources);
		const ruleIds = Object.keys(ruleResources);
		const [routerId] = Object.keys(
			template.findResources("AWS::Lambda::Function"),
		);
		const [queueId] = Object.keys(template.findResources("AWS::SQS::Queue"));
		for (const { Properties } of rules) {
			expect(Properties.Targets).toHaveLength(1);
			expect(Properties.Targets[0]).toEqual({
				Arn: { "Fn::GetAtt": [routerId, "Arn"] },
				DeadLetterConfig: {
					Arn: { "Fn::GetAtt": [queueId, "Arn"] },
				},
				Id: "Target0",
				RetryPolicy: {
					MaximumEventAgeInSeconds: 3600,
					MaximumRetryAttempts: 3,
				},
			});
		}

		const permissions = Object.values(
			template.findResources("AWS::Lambda::Permission"),
		);
		expect(permissions).toHaveLength(2);
		for (const { Properties } of permissions) {
			const sourceRuleId = Properties.SourceArn["Fn::GetAtt"][0] as string;
			expect(Properties).toEqual({
				Action: "lambda:InvokeFunction",
				FunctionName: { "Fn::GetAtt": [routerId, "Arn"] },
				Principal: "events.amazonaws.com",
				SourceArn: { "Fn::GetAtt": [sourceRuleId, "Arn"] },
			});
			expect(ruleIds).toContain(sourceRuleId);
		}
		expect(router.lambda.functionArn).toBeDefined();

		const [queuePolicy] = Object.values(
			template.findResources("AWS::SQS::QueuePolicy"),
		);
		const statements = queuePolicy.Properties.PolicyDocument.Statement as Array<
			Record<string, unknown>
		>;
		const sendStatements = statements.filter(
			(statement) => statement.Action === "sqs:SendMessage",
		);
		expect(sendStatements).toHaveLength(2);
		for (const statement of sendStatements) {
			const sourceArn = (
				statement.Condition as {
					ArnEquals: { "aws:SourceArn": { "Fn::GetAtt": string[] } };
				}
			).ArnEquals["aws:SourceArn"];
			expect(statement).toEqual({
				Action: "sqs:SendMessage",
				Condition: {
					ArnEquals: { "aws:SourceArn": sourceArn },
				},
				Effect: "Allow",
				Principal: { Service: "events.amazonaws.com" },
				Resource: { "Fn::GetAtt": [queueId, "Arn"] },
				Sid: statement.Sid,
			});
			expect(statement.Sid).toMatch(/^AllowEventRule/);
			expect(ruleIds).toContain(sourceArn["Fn::GetAtt"][0]);
		}
	});

	test("creates an encrypted retained SSL-only DLQ and registers monitoring", () => {
		const stack = new Stack(createTestApp(), "MonitoredStack");
		const monitored: unknown[] = [];
		stack.monitoring.monitorSqsQueue = (props) => {
			monitored.push(props.queue);
			return stack.monitoring;
		};
		const router = new LambdaFunction(stack, "Router", { entry: lambdaEntry });
		const construct = new CodeCommitReviewEvents(stack, "ReviewEvents", {
			repositoryName: "review-target",
			router,
		});
		const template = Template.fromStack(stack);

		template.hasResource("AWS::SQS::Queue", {
			DeletionPolicy: "Retain",
			UpdateReplacePolicy: "Retain",
			Properties: {
				KmsMasterKeyId: "alias/aws/sqs",
				MessageRetentionPeriod: 1209600,
				Tags: Match.arrayWith([
					{ Key: "stage", Value: "bar" },
					{ Key: "team", Value: "foo" },
				]),
			},
		});
		template.hasResourceProperties("AWS::SQS::QueuePolicy", {
			PolicyDocument: {
				Statement: Match.arrayWith([
					Match.objectLike({
						Action: "sqs:*",
						Condition: { Bool: { "aws:SecureTransport": "false" } },
						Effect: "Deny",
						Principal: { AWS: "*" },
					}),
				]),
			},
		});
		expect(monitored).toEqual([construct.deadLetterQueue]);
	});

	test("adds the exact unfiltered CloudTrail fallback only when configured", () => {
		const { construct, template } = createEvents("Fallback", {
			commentEventFallback: "cloudtrail",
			retryAttempts: 0,
			maxEventAgeMinutes: 5,
		});
		const rules = Object.values(template.findResources("AWS::Events::Rule"));

		expect(rules).toHaveLength(3);
		template.hasResourceProperties("AWS::Events::Rule", {
			EventPattern: {
				source: ["aws.codecommit"],
				"detail-type": ["AWS API Call via CloudTrail"],
				detail: {
					eventSource: ["codecommit.amazonaws.com"],
					eventName: ["PostCommentForPullRequest"],
				},
			},
			Targets: [
				Match.objectLike({
					RetryPolicy: {
						MaximumEventAgeInSeconds: 300,
						MaximumRetryAttempts: 0,
					},
				}),
			],
		});
		const fallback = rules.find(({ Properties }) =>
			JSON.stringify(Properties.EventPattern).includes("CloudTrail"),
		);
		expect(fallback?.Properties.EventBusName).toBeUndefined();
		const serialized = JSON.stringify(
			fallback?.Properties.EventPattern,
		).toLowerCase();
		expect(serialized).not.toContain("identity");
		expect(serialized).not.toContain("principal");
		expect(serialized).not.toContain("user");
		expect(construct.fallbackRule).toBeDefined();
	});

	test("grants exact repository access only to intended Lambda roles and deduplicates", () => {
		const stack = new Stack(createTestApp(), "GrantStack");
		const router = new LambdaFunction(stack, "Router", { entry: lambdaEntry });
		const reviewer = new LambdaFunction(stack, "Reviewer", {
			entry: lambdaEntry,
		});
		const unrelated = new LambdaFunction(stack, "Unrelated", {
			entry: lambdaEntry,
		});
		const construct = new CodeCommitReviewEvents(stack, "ReviewEvents", {
			repositoryName: "review-target",
			router,
		});

		expect(construct.grantRead(reviewer)).toBe(construct);
		expect(construct.grantComment(reviewer)).toBe(construct);
		expect(construct.grantConfigRead(reviewer)).toBe(construct);
		construct
			.grantRead(reviewer)
			.grantComment(reviewer)
			.grantConfigRead(reviewer);
		const template = Template.fromStack(stack);
		const statements = grantStatements(stack, template, reviewer);

		expect(statements).toHaveLength(3);
		expect(
			statements.map(({ Action, Effect }) => ({ Action, Effect })),
		).toEqual(
			expect.arrayContaining([
				{
					Action: [
						"codecommit:GetPullRequest",
						"codecommit:GetDifferences",
						"codecommit:GetCommentsForPullRequest",
						"codecommit:GetCommit",
						"codecommit:BatchGetCommits",
					],
					Effect: "Allow",
				},
				{
					Action: [
						"codecommit:PostCommentForPullRequest",
						"codecommit:UpdateComment",
						"codecommit:PostCommentReply",
						"codecommit:PutCommentReaction",
					],
					Effect: "Allow",
				},
				{ Action: "codecommit:GetFile", Effect: "Allow" },
			]),
		);
		const repositoryArn = {
			"Fn::Join": [
				"",
				[
					"arn:",
					{ Ref: "AWS::Partition" },
					":codecommit:",
					{ Ref: "AWS::Region" },
					":",
					{ Ref: "AWS::AccountId" },
					":review-target",
				],
			],
		};
		for (const statement of statements) {
			expect(statement.Resource).toEqual(repositoryArn);
		}
		expect(grantStatements(stack, template, unrelated)).toEqual([]);
	});

	test("applies delayed generic permissions with exact effect and resource overrides", () => {
		const stack = new Stack(createTestApp(), "GenericGrantStack");
		const router = new LambdaFunction(stack, "Router", { entry: lambdaEntry });
		const reviewer = new LambdaFunction(stack, "Reviewer", {
			entry: lambdaEntry,
		});
		const override = "arn:aws:codecommit:eu-west-1:123456789012:override";
		const construct = new CodeCommitReviewEvents(stack, "ReviewEvents", {
			repositoryName: "review-target",
			router,
			permissions: [
				[
					reviewer,
					{
						effect: "deny",
						actions: ["codecommit:DeleteCommentContent"],
						resource: override,
					},
				],
			],
		});
		construct.grantPermission(reviewer, {
			effect: "allow",
			actions: ["codecommit:GetRepository"],
		});
		construct.grantPermission(reviewer, {
			effect: "allow",
			actions: ["codecommit:GetRepository"],
		});

		const template = Template.fromStack(stack);
		const statements = grantStatements(stack, template, reviewer);
		expect(statements).toHaveLength(2);
		expect(statements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					Action: "codecommit:DeleteCommentContent",
					Effect: "Deny",
					Resource: override,
				}),
				expect.objectContaining({
					Action: "codecommit:GetRepository",
					Effect: "Allow",
				}),
			]),
		);
		expect(JSON.stringify(statements)).toContain("review-target");
		expect(() =>
			construct.grantPermission(new Construct(stack, "Unsupported"), {
				effect: "allow",
				actions: ["codecommit:GetRepository"],
			}),
		).toThrow(/LambdaFunction/);
	});

	test("validates config, exposes rules, and inherits BasicConstruct tags", () => {
		const { construct, template } = createEvents();
		expect(construct.pullRequestRule).toBeDefined();
		expect(construct.commentRule).toBeDefined();
		expect(construct.fallbackRule).toBeUndefined();
		expect(construct.deadLetterQueue).toBeDefined();
		for (const { Properties } of Object.values(
			template.findResources("AWS::Events::Rule"),
		)) {
			expect(Properties.Tags).toEqual(
				expect.arrayContaining([
					{ Key: "stage", Value: "bar" },
					{ Key: "team", Value: "foo" },
				]),
			);
		}
		expect(CodeCommitReviewEventsConfigSchema.parse({})).toEqual({
			retryAttempts: 3,
			maxEventAgeMinutes: 60,
		});
	});

	test.each([
		["empty repository", { repositoryName: "" }],
		["blank repository", { repositoryName: "   " }],
		["negative retries", { retryAttempts: -1 }],
		["too many retries", { retryAttempts: 11 }],
		["fractional retries", { retryAttempts: 1.5 }],
		["zero max age", { maxEventAgeMinutes: 0 }],
		["excessive max age", { maxEventAgeMinutes: 1441 }],
		["fractional max age", { maxEventAgeMinutes: 1.5 }],
		["invalid fallback", { commentEventFallback: "audit-log" }],
	])("rejects %s", (_name, invalid) => {
		const stack = new Stack(createTestApp(), "InvalidStack");
		const router = new LambdaFunction(stack, "Router", { entry: lambdaEntry });
		expect(
			() =>
				new CodeCommitReviewEvents(stack, "Invalid", {
					repositoryName: "review-target",
					router,
					...invalid,
				} as CodeCommitReviewEventsProps),
		).toThrow();
	});

	test("passes AwsSolutions checks with only the narrow DLQ and fixture suppressions", () => {
		const { stack, router } = createEvents("Nag", {
			commentEventFallback: "cloudtrail",
		});
		suppressLambdaFixtureFindings(router);
		Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }));
		const errors = Annotations.fromStack(stack).findError(
			"*",
			Match.stringLikeRegexp("AwsSolutions-"),
		);
		expect(errors).toEqual([]);
	});
});
