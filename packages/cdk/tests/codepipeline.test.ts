import { describe, expect, test } from "bun:test";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Repository } from "aws-cdk-lib/aws-codecommit";
import { CodePipeline } from "../src/codepipeline";
import { Stack } from "../src/stack";
import { createTestApp } from "./utils";

function createPipelineStack(
	id: string,
	props: Partial<CodePipelineProps> = {},
): { stack: Stack; template: Template; construct: CodePipeline } {
	const stack = new Stack(createTestApp(), `${id}Stack`);
	const repository = new Repository(stack, "Repo", {
		repositoryName: "test-repo",
	});
	const construct = new CodePipeline(stack, "Pipeline", {
		source: { type: "codecommit", repository, branchName: "main" },
		...props,
	});
	return {
		stack,
		template: Template.fromStack(stack),
		construct,
	};
}

function pipelineResource(template: Template): {
	logicalId: string;
	properties: {
		Variables?: Array<{ Name: string; DefaultValue?: string }>;
	};
} {
	const [entry] = Object.entries(
		template.findResources("AWS::CodePipeline::Pipeline"),
	);
	if (entry === undefined)
		throw new Error("Expected one CodePipeline resource");
	return {
		logicalId: entry[0],
		properties: entry[1].Properties as {
			Variables?: Array<{ Name: string; DefaultValue?: string }>;
		},
	};
}

function routerStatements(
	template: Template,
	lambdaLogicalId: string,
): Array<Record<string, unknown>> {
	const lambda = template.findResources("AWS::Lambda::Function")[
		lambdaLogicalId
	];
	if (lambda === undefined) throw new Error("Expected router Lambda");
	const roleLogicalId = (lambda.Properties.Role as { "Fn::GetAtt": string[] })[
		"Fn::GetAtt"
	][0];
	if (roleLogicalId === undefined)
		throw new Error("Expected router execution role");
	return Object.values(template.findResources("AWS::IAM::Policy"))
		.filter(({ Properties }) =>
			(Properties.Roles as Array<{ Ref: string }> | undefined)?.some(
				({ Ref }) => Ref === roleLogicalId,
			),
		)
		.flatMap(({ Properties }) => Properties.PolicyDocument.Statement);
}

function actionsOf(statement: Record<string, unknown>): string[] {
	return typeof statement.Action === "string"
		? [statement.Action]
		: (statement.Action as string[]);
}

describe("CodePipeline push mode", () => {
	test("creates a pipeline with CodeCommit source and artifact bucket", () => {
		const { template } = createPipelineStack("Basic");

		template.hasResourceProperties("AWS::CodePipeline::Pipeline", {
			Stages: Match.arrayWith([
				Match.objectLike({
					Name: "Source",
					Actions: Match.arrayWith([
						Match.objectLike({
							Name: "Source",
							ActionTypeId: {
								Category: "Source",
								Provider: "CodeCommit",
							},
						}),
					]),
				}),
			]),
		});
		template.hasResourceProperties("AWS::S3::Bucket", {
			BucketEncryption: {
				ServerSideEncryptionConfiguration: Match.arrayWith([
					Match.objectLike({
						ServerSideEncryptionByDefault: {
							SSEAlgorithm: "aws:kms",
						},
					}),
				]),
			},
		});
	});

	test("uses standard source detection in push mode (no trigger override)", () => {
		const { template } = createPipelineStack("PushDetection");
		const pipelines = Object.values(
			template.findResources("AWS::CodePipeline::Pipeline"),
		);
		const sourceStage = (
			pipelines[0] as {
				Properties: {
					Stages: Array<{
						Actions: Array<{ Configuration: Record<string, string> }>;
					}>;
				};
			}
		).Properties.Stages[0];
		// In push mode, trigger should be EVENTS (default) or not explicitly set to NONE
		const sourceAction = sourceStage.Actions[0];
		if (!sourceAction) {
			throw new Error("Expected source stage to contain an action");
		}
		const sourceConfig = sourceAction.Configuration;
		// CodeCommitTrigger.NONE would set DetectChanges to false
		// Default (EVENTS) leaves DetectChanges true or absent
		expect(sourceConfig.DetectChanges ?? "true").not.toBe("false");
	});

	test("does not create reviewer infrastructure or variables without autoReview", () => {
		const { template } = createPipelineStack("NoReview");
		const serialized = JSON.stringify(template.toJSON());
		expect(serialized).not.toContain("AWS::Lambda::Function");
		expect(serialized).not.toContain("AWS::DynamoDB::GlobalTable");
		expect(serialized).not.toContain("AWS::CodeBuild::Project");
		expect(pipelineResource(template).properties.Variables).toBeUndefined();
	});

	test("creates KMS key for artifact bucket", () => {
		const { template } = createPipelineStack("KMS");
		template.hasResource("AWS::KMS::Key", {
			Properties: { EnableKeyRotation: true },
		});
	});
});

describe("CodePipeline PR-gated mode", () => {
	test("uses CodeCommitTrigger.NONE when onPullRequest is true", () => {
		const { template } = createPipelineStack("PRGated", {
			onPullRequest: true,
		});
		const pipelines = Object.values(
			template.findResources("AWS::CodePipeline::Pipeline"),
		);
		const sourceStage = (
			pipelines[0] as {
				Properties: {
					Stages: Array<{
						Actions: Array<{ Configuration: Record<string, string> }>;
					}>;
				};
			}
		).Properties.Stages[0];
		const sourceAction = sourceStage.Actions[0];
		if (!sourceAction) {
			throw new Error("Expected source stage to contain an action");
		}
		const sourceConfig = sourceAction.Configuration;
		expect(sourceConfig.PollForSourceChanges).toBe(false);
	});

	test("creates only the pipeline-mode router and declares its six variables", () => {
		const { template } = createPipelineStack("PRNoReview", {
			onPullRequest: true,
		});
		const lambdas = template.findResources("AWS::Lambda::Function");
		const entries = Object.entries(lambdas);
		expect(entries).toHaveLength(1);
		const [lambdaLogicalId, lambdaResource] = entries[0] ?? [];
		if (lambdaLogicalId === undefined || lambdaResource === undefined) {
			throw new Error("Expected pipeline-only router Lambda");
		}
		const environment = lambdaResource.Properties.Environment
			.Variables as Record<string, unknown>;
		expect(Object.keys(environment).sort()).toEqual([
			"PIPELINE_NAME",
			"PIPELINE_SOURCE_ACTION_NAME",
			"STATE_TABLE_NAME",
		]);
		expect(environment).toMatchObject({
			PIPELINE_SOURCE_ACTION_NAME: "Source",
		});
		expect(JSON.stringify(environment.PIPELINE_NAME)).toContain(
			pipelineResource(template).logicalId,
		);
		expect(JSON.stringify(environment.STATE_TABLE_NAME)).toContain(
			Object.keys(template.findResources("AWS::DynamoDB::GlobalTable"))[0] ??
				"missing-table",
		);

		expect(pipelineResource(template).properties.Variables).toEqual(
			[
				"PAWL_PROVIDER",
				"PAWL_REPOSITORY",
				"PAWL_REQUEST_ID",
				"PAWL_GENERATION",
				"PAWL_SOURCE_REVISION",
				"PAWL_DESTINATION_REVISION",
			].map((Name) => ({ Name, DefaultValue: "UNSET" })),
		);
		const serialized = JSON.stringify(template.toJSON());
		expect(serialized).not.toContain("Reviewer-lambda");
		expect(serialized).not.toContain("Bridge-lambda");
		expect(serialized).not.toContain("Reconciler-lambda");
		expect(serialized).not.toContain("AWS::CodeBuild::Project");
		expect(serialized).not.toContain("bedrock:InvokeModel");
	});

	test("creates the shared state schema with exactly the mandatory GSI2", () => {
		const { template } = createPipelineStack("PRState", {
			onPullRequest: true,
		});
		const tables = Object.values(
			template.findResources("AWS::DynamoDB::GlobalTable"),
		);
		expect(tables).toHaveLength(1);
		const table = tables[0];
		expect(table?.Properties.KeySchema).toEqual([
			{ AttributeName: "pk", KeyType: "HASH" },
			{ AttributeName: "sk", KeyType: "RANGE" },
		]);
		expect(table?.Properties.GlobalSecondaryIndexes).toEqual([
			{
				IndexName: "GSI2",
				KeySchema: [
					{ AttributeName: "gsi2pk", KeyType: "HASH" },
					{ AttributeName: "gsi2sk", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
		]);
		expect(JSON.stringify(table)).not.toContain("GSI1");
	});

	test("routes CodeCommit and pipeline state-change events to the same router", () => {
		const { template } = createPipelineStack("PRRules", {
			onPullRequest: true,
		});
		const [lambdaLogicalId] = Object.keys(
			template.findResources("AWS::Lambda::Function"),
		);
		if (lambdaLogicalId === undefined)
			throw new Error("Expected router Lambda");
		const rules = Object.values(template.findResources("AWS::Events::Rule"));
		expect(rules).toHaveLength(3);
		expect(rules.map(({ Properties }) => Properties.EventPattern)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					source: ["aws.codecommit"],
					"detail-type": ["CodeCommit Pull Request State Change"],
				}),
				expect.objectContaining({
					source: ["aws.codecommit"],
					"detail-type": ["CodeCommit Comment on Pull Request"],
				}),
				{
					source: ["aws.codepipeline"],
					"detail-type": ["CodePipeline Pipeline Execution State Change"],
					detail: {
						pipeline: [{ Ref: pipelineResource(template).logicalId }],
					},
				},
			]),
		);
		for (const rule of rules) {
			expect(rule.Properties.Targets).toHaveLength(1);
			expect(rule.Properties.Targets[0].Arn).toEqual({
				"Fn::GetAtt": [lambdaLogicalId, "Arn"],
			});
		}
	});

	test("grants only exact repository, table, and pipeline access to the router", () => {
		const { template } = createPipelineStack("PRGrants", {
			onPullRequest: true,
		});
		const [lambdaLogicalId] = Object.keys(
			template.findResources("AWS::Lambda::Function"),
		);
		if (lambdaLogicalId === undefined)
			throw new Error("Expected router Lambda");
		const statements = routerStatements(template, lambdaLogicalId);
		const codeCommitStatements = statements.filter((statement) =>
			actionsOf(statement).some((action) => action.startsWith("codecommit:")),
		);
		expect(codeCommitStatements.flatMap(actionsOf).sort()).toEqual(
			[
				"codecommit:BatchGetCommits",
				"codecommit:GetCommentsForPullRequest",
				"codecommit:GetCommit",
				"codecommit:GetDifferences",
				"codecommit:GetFile",
				"codecommit:GetPullRequest",
				"codecommit:PostCommentForPullRequest",
				"codecommit:PostCommentReply",
				"codecommit:PutCommentReaction",
				"codecommit:UpdateComment",
			].sort(),
		);
		for (const statement of codeCommitStatements) {
			expect(JSON.stringify(statement.Resource)).toContain("Repo");
			expect(statement.Resource).not.toBe("*");
		}

		const pipelineStatement = statements.find((statement) =>
			actionsOf(statement).includes("codepipeline:StartPipelineExecution"),
		);
		expect(pipelineStatement).toBeDefined();
		expect(pipelineStatement && actionsOf(pipelineStatement)).toEqual([
			"codepipeline:StartPipelineExecution",
			"codepipeline:GetPipelineExecution",
			"codepipeline:ListPipelineExecutions",
			"codepipeline:ListActionExecutions",
		]);
		expect(JSON.stringify(pipelineStatement?.Resource)).toContain(
			pipelineResource(template).logicalId,
		);
		expect(pipelineStatement?.Resource).not.toBe("*");

		const dynamoStatements = statements.filter((statement) =>
			actionsOf(statement).some((action) => action.startsWith("dynamodb:")),
		);
		expect(dynamoStatements.length).toBeGreaterThan(0);
		const dynamoActions = dynamoStatements.flatMap(actionsOf);
		expect(dynamoActions).toEqual(
			expect.arrayContaining([
				"dynamodb:GetItem",
				"dynamodb:Query",
				"dynamodb:PutItem",
				"dynamodb:UpdateItem",
				"dynamodb:DeleteItem",
			]),
		);
		const [tableLogicalId] = Object.keys(
			template.findResources("AWS::DynamoDB::GlobalTable"),
		);
		if (tableLogicalId === undefined) throw new Error("Expected state table");
		for (const statement of dynamoStatements) {
			expect(JSON.stringify(statement.Resource)).toContain(tableLogicalId);
		}

		const serialized = JSON.stringify(statements);
		expect(serialized).not.toContain("lambda:InvokeFunction");
		expect(serialized).not.toContain("lambda:InvokeFunctionUrl");
		expect(serialized).not.toContain("durable-execution");
		expect(serialized).not.toContain("codepipeline:PutJob");
	});
});
