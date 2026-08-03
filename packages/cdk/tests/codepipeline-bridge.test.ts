import { describe, expect, test } from "bun:test";
import { Template } from "aws-cdk-lib/assertions";
import { Repository } from "aws-cdk-lib/aws-codecommit";
import { CodePipeline, type CodePipelineProps } from "../src/codepipeline";
import { Stack } from "../src/stack";
import { createTestApp } from "./utils";

const createBridgePipeline = (overrides: Partial<CodePipelineProps> = {}) => {
	const stack = new Stack(createTestApp(), "BridgePipelineStack");
	const repository = new Repository(stack, "Repo", {
		repositoryName: "test-repo",
	});
	new CodePipeline(stack, "Pipeline", {
		onPullRequest: true,
		autoReviewer: { modelId: "eu.anthropic.claude-sonnet-4-6" },
		...overrides,
	})
		.source({
			origin: "codecommit",
			repository,
			repositoryName: "test-repo",
			branchName: "main",
		})
		.stage({
			name: "Build",
			actions: [{ type: "approval", name: "Approve" }],
		});
	return Template.fromStack(stack);
};

const pipelineResource = (template: Template) =>
	Object.values(template.findResources("AWS::CodePipeline::Pipeline"))[0] as {
		Properties: {
			Variables?: Array<{ Name: string; DefaultValue?: string }>;
			Stages: Array<{
				Name: string;
				Actions: Array<{
					Name: string;
					Configuration: Record<string, unknown>;
				}>;
			}>;
		};
	};

describe("CodePipeline durable review bridge", () => {
	test("injects an ordinary bridge action with sanitized pipeline variables", () => {
		const template = createBridgePipeline();
		const pipeline = pipelineResource(template);
		expect(pipeline.Properties.Variables?.map(({ Name }) => Name)).toEqual([
			"PAWL_PROVIDER",
			"PAWL_REPOSITORY",
			"PAWL_REQUEST_ID",
			"PAWL_GENERATION",
			"PAWL_SOURCE_REVISION",
			"PAWL_DESTINATION_REVISION",
		]);
		const build = pipeline.Properties.Stages.find(
			({ Name }) => Name === "Build",
		);
		const review = build?.Actions.find(({ Name }) => Name === "AIReview");
		expect(review).toBeDefined();
		const serialized = JSON.stringify(review?.Configuration);
		expect(serialized).toContain("PipelineExecutionId");
		expect(serialized).toContain("PAWL_SOURCE_REVISION");
		expect(serialized).not.toContain("$LATEST");
		expect(serialized).not.toContain(":function:");
	});

	test("creates bridge, reconciler, scheduled redrive, GSIs, and callback IAM", () => {
		const template = createBridgePipeline();
		const lambdas = Object.values(
			template.findResources("AWS::Lambda::Function"),
		).map((resource) => JSON.stringify(resource));
		expect(
			lambdas.some((resource) => resource.includes("Bridge-lambda")),
		).toBeTrue();
		expect(
			lambdas.some((resource) => resource.includes("Reconciler-lambda")),
		).toBeTrue();
		expect(
			lambdas.some(
				(resource) =>
					resource.includes("Bridge-lambda") &&
					resource.includes('"REVIEW_ACTION_TIMEOUT_MINUTES":"15"'),
			),
		).toBeTrue();
		template.hasResourceProperties("AWS::Events::Rule", {
			ScheduleExpression: "rate(1 minute)",
		});
		const tables = Object.values(
			template.findResources("AWS::DynamoDB::GlobalTable"),
		);
		expect(JSON.stringify(tables)).toContain("GSI1");
		expect(JSON.stringify(tables)).toContain("GSI2");
		const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
		expect(policies).toContain("codepipeline:PutJobSuccessResult");
		expect(policies).toContain("codepipeline:PutJobFailureResult");
	});

	test("does not inject the bridge gate for push-triggered review", () => {
		const template = createBridgePipeline({ onPullRequest: false });
		const serialized = JSON.stringify(pipelineResource(template));
		expect(serialized).not.toContain("AIReview");
		expect(serialized).not.toContain("PAWL_SOURCE_REVISION");
	});

	test("validates the conservative CodePipeline review timeout", () => {
		expect(() =>
			createBridgePipeline({ reviewActionTimeoutMinutes: 4 }),
		).toThrow();
		expect(() =>
			createBridgePipeline({ reviewActionTimeoutMinutes: 16 }),
		).toThrow();
		expect(() =>
			createBridgePipeline({ reviewActionTimeoutMinutes: 60 }),
		).toThrow();
		expect(() =>
			createBridgePipeline({ reviewActionTimeoutMinutes: 15 }),
		).not.toThrow();
		expect(() =>
			createBridgePipeline({
				onPullRequest: false,
				reviewActionTimeoutMinutes: 15,
			}),
		).toThrow();
	});
});
