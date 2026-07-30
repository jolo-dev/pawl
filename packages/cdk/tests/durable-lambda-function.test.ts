import { describe, expect, test } from "bun:test";
import path from "node:path";
import { Aspects, type CfnResource } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import type { Construct } from "constructs";
import { DurableLambdaFunction } from "../src/durable-lambda-function";
import { LambdaFunction } from "../src/lambda-function";
import { Stack } from "../src/stack";
import { createTestApp } from "./utils";

const entry = path.join(__dirname, "lambda", "test-lambda.ts");

function suppressFixtureFindings(lambdaFunction: LambdaFunction): void {
	NagSuppressions.addResourceSuppressions(
		lambdaFunction.lambda,
		[
			{
				id: "AwsSolutions-IAM4",
				reason:
					"The Lambda L2's generated execution role uses AWSLambdaBasicExecutionRole for fixture logging.",
			},
			{
				id: "AwsSolutions-L1",
				reason:
					"Pawl deliberately pins the supported Node.js 22 runtime rather than CDK's moving latest runtime.",
			},
			{
				id: "AwsSolutions-Lambda1",
				reason: "This isolated construct fixture does not require VPC access.",
			},
			{
				id: "AwsSolutions-Lambda4",
				reason:
					"The minimal fixture has no workload-specific dead-letter destination.",
			},
			{
				id: "AwsSolutions-Lambda5",
				reason:
					"The minimal fixture leaves concurrency sizing to consuming stacks.",
			},
		],
		true,
	);
}

class DurableLambdaTestStack extends Stack {
	readonly durable: DurableLambdaFunction;
	readonly grantee: LambdaFunction;

	constructor(scope: Construct, id: string) {
		super(scope, id);
		this.durable = new DurableLambdaFunction(this, "Durable", {
			entry,
			executionTimeoutSeconds: 2_592_000,
			retentionDays: 90,
		});
		this.grantee = new LambdaFunction(this, "Grantee", { entry });

		this.durable
			.grantInvokeDurable(this.grantee)
			.grantReadDurableExecutions(this.grantee)
			.grantSendDurableExecutionCallbacks(this.grantee)
			.grantStopDurableExecution(this.grantee);

		suppressFixtureFindings(this.durable);
		suppressFixtureFindings(this.grantee);
	}
}

function createDurable(
	props: Partial<{
		executionTimeoutSeconds: number;
		retentionDays: number;
		aliasName: string;
	}> = {},
): DurableLambdaFunction {
	const stack = new Stack(createTestApp(), "ValidationStack");
	return new DurableLambdaFunction(stack, "Durable", {
		entry,
		executionTimeoutSeconds: 60,
		...props,
	});
}

describe("DurableLambdaFunction", () => {
	const stack = new DurableLambdaTestStack(
		createTestApp(),
		"DurableLambdaTestStack",
	);
	const template = Template.fromStack(stack);

	test("synthesizes Pawl defaults and durable configuration", () => {
		template.hasResourceProperties("AWS::Lambda::Function", {
			Architectures: ["arm64"],
			Runtime: "nodejs22.x",
			DurableConfig: {
				ExecutionTimeout: 2_592_000,
				RetentionPeriodInDays: 90,
			},
		});
		template.resourceCountIs("AWS::Lambda::Version", 1);
		template.hasResourceProperties("AWS::Lambda::Alias", {
			Name: "live",
			FunctionVersion: {
				"Fn::GetAtt": [Match.stringLikeRegexp("Version"), "Version"],
			},
		});
	});

	test("defaults retention to 14 days", () => {
		const defaultStack = new Stack(createTestApp(), "DefaultRetentionStack");
		new DurableLambdaFunction(defaultStack, "Durable", {
			entry,
			executionTimeoutSeconds: 60,
		});

		Template.fromStack(defaultStack).hasResourceProperties(
			"AWS::Lambda::Function",
			{
				DurableConfig: {
					ExecutionTimeout: 60,
					RetentionPeriodInDays: 14,
				},
			},
		);
	});

	test("exposes the alias and its ARN", () => {
		expect(stack.durable.alias).toBeDefined();
		expect(stack.durable.alias.functionArn).toBeDefined();
		expect(stack.durable.durableFunctionArn).toBe(
			stack.durable.alias.functionArn,
		);
	});

	test.each([
		["timeout below the minimum", { executionTimeoutSeconds: 0 }],
		["timeout above the maximum", { executionTimeoutSeconds: 31_622_401 }],
		["retention below the minimum", { retentionDays: 0 }],
		["retention above the maximum", { retentionDays: 91 }],
		["blank alias", { aliasName: "" }],
		["whitespace-only alias", { aliasName: "   " }],
		["alias containing a slash", { aliasName: "bad/name" }],
		["numeric-only alias", { aliasName: "123" }],
		["alias longer than 128 characters", { aliasName: "a".repeat(129) }],
	])("rejects %s during construction", (_name, props) => {
		expect(() => createDurable(props)).toThrow();
	});

	test("adds exact durable permissions only to dedicated grantee policies", () => {
		const granteeRoleId = stack.getLogicalId(
			stack.grantee.lambda.role?.node.defaultChild as CfnResource,
		);
		const durableRoleId = stack.getLogicalId(
			stack.durable.lambda.role?.node.defaultChild as CfnResource,
		);
		const aliasId = stack.getLogicalId(
			stack.durable.alias.node.defaultChild as CfnResource,
		);
		const functionId = stack.getLogicalId(
			stack.durable.lambda.node.defaultChild as CfnResource,
		);
		const functionArn = { "Fn::GetAtt": [functionId, "Arn"] };
		const [versionId] = Object.keys(
			template.findResources("AWS::Lambda::Version"),
		);
		const currentExecutionResource = {
			"Fn::Join": ["", [{ Ref: versionId }, "/durable-execution/*/*"]],
		};
		const historicalExecutionResource = {
			"Fn::Join": ["", [functionArn, ":*/durable-execution/*/*"]],
		};

		template.resourceCountIs("AWS::IAM::Policy", 2);
		template.hasResourceProperties("AWS::IAM::Policy", {
			PolicyDocument: {
				Statement: [
					{
						Action: "lambda:InvokeFunction",
						Effect: "Allow",
						Resource: { Ref: aliasId },
					},
					{
						Action: "lambda:ListDurableExecutionsByFunction",
						Effect: "Allow",
						Resource: functionArn,
					},
					{
						Action: [
							"lambda:GetDurableExecution",
							"lambda:GetDurableExecutionHistory",
						],
						Effect: "Allow",
						Resource: historicalExecutionResource,
					},
					{
						Action: "lambda:StopDurableExecution",
						Effect: "Allow",
						Resource: currentExecutionResource,
					},
				],
				Version: "2012-10-17",
			},
			Roles: [{ Ref: granteeRoleId }],
		});
		template.hasResourceProperties("AWS::IAM::Policy", {
			PolicyDocument: {
				Statement: [
					{
						Action: [
							"lambda:SendDurableExecutionCallbackSuccess",
							"lambda:SendDurableExecutionCallbackFailure",
							"lambda:SendDurableExecutionCallbackHeartbeat",
						],
						Effect: "Allow",
						Resource: "*",
					},
				],
				Version: "2012-10-17",
			},
			Roles: [{ Ref: granteeRoleId }],
		});

		const policies = Object.values(template.findResources("AWS::IAM::Policy"));
		const callbackPolicies = policies.filter((policy) =>
			JSON.stringify(policy).includes(
				"lambda:SendDurableExecutionCallbackSuccess",
			),
		);
		const defaultPolicies = policies.filter(
			(policy) => !callbackPolicies.includes(policy),
		);
		const durablePolicies = policies.filter((policy) =>
			JSON.stringify(policy).includes(`"Ref":"${durableRoleId}"`),
		);

		expect(callbackPolicies).toHaveLength(1);
		expect(defaultPolicies).toHaveLength(1);
		expect(JSON.stringify(callbackPolicies[0])).toContain("Resource::*");
		const defaultPolicy = JSON.stringify(defaultPolicies[0]);
		expect(defaultPolicy).not.toContain("Resource::*");
		expect(defaultPolicy).not.toContain(":function:*");
		expect(defaultPolicy).not.toContain(":function/DurableLambdaTestStack*");
		expect(defaultPolicy).toContain(":*/durable-execution/*/*");
		expect(durablePolicies).toEqual([]);
	});

	test("passes AwsSolutions checks with documented narrow suppressions", () => {
		Aspects.of(stack).add(new AwsSolutionsChecks());
		stack.node.root.synth();

		const errors = Annotations.fromStack(stack).findError(
			"*",
			Match.stringLikeRegexp("AwsSolutions-.*"),
		);
		expect(errors).toEqual([]);
	});
});
