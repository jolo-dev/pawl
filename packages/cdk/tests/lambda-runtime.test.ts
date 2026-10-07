import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
	App,
	CodeBuildProject,
	CodePipeline,
	LocalStack,
	Stack,
	Template,
} from "@pawl/cdk";
import { AwsSolutionsChecks } from "cdk-nag";

function createApp(): App {
	return new App({ context: { team: "runtime", stage: "dev" } });
}

function expectNode24(stack: Stack): void {
	const template = Template.fromStack(stack);
	expect(
		Object.keys(template.findResources("AWS::Lambda::Function")).length,
	).toBeGreaterThan(0);
	template.allResourcesProperties("AWS::Lambda::Function", {
		Runtime: "nodejs24.x",
	});

	// This suite checks runtime compliance; dedicated construct suites cover IAM.
	const nag = new AwsSolutionsChecks();
	for (const construct of stack.node.findAll()) nag.visit(construct);
	const runtimeErrors = stack.node
		.findAll()
		.flatMap((construct) => construct.node.metadata)
		.filter(
			(metadata) =>
				metadata.type === "aws:cdk:error" &&
				/^AwsSolutions-L1[:[]/.test(String(metadata.data)),
		);
	expect(runtimeErrors).toEqual([]);
}

describe("Lambda Node.js 24 runtime", () => {
	test("CDK-generated S3 cleanup helpers use Node.js 24", () => {
		const stack = new Stack(createApp(), "HelperRuntimeStack");
		new CodeBuildProject(stack, "Build", {
			pipelineMode: true,
			networkPolicy: {
				mode: "public-test",
				packageAccess: {
					mode: "approved-registry",
					endpoint: "https://registry.npmjs.org/",
				},
			},
		});
		expectNode24(stack);
	});

	test("PR pipeline router, durable reviewer, bridge, and reconciler use Node.js 24", () => {
		const stack = new Stack(createApp(), "PipelineRuntimeStack");
		new CodePipeline(stack, "Pipeline", {
			onPullRequest: true,
			autoReviewer: { modelId: "eu.anthropic.claude-sonnet-4-6" },
		})
			.source({
				origin: "codecommit",
				create: true,
				repositoryName: "node24-runtime",
				branchName: "main",
			})
			.stage({
				name: "Approval",
				actions: [{ name: "Approve", type: "approval" }],
			});
		// Four Pawl functions plus the CDK-generated S3 cleanup provider.
		Template.fromStack(stack).resourceCountIs("AWS::Lambda::Function", 5);
		expectNode24(stack);
	});

	test.each([undefined, "node22", "node24"] as const)(
		"local functions inherit Node.js 24 with runtime hint %s",
		(runtime) => {
			const stack = new LocalStack(createApp(), `LocalRuntime${runtime}`, {
				lambdaDir: path.join(import.meta.dir, "lambda"),
				runtime,
			});
			expectNode24(stack);
		},
	);
});
