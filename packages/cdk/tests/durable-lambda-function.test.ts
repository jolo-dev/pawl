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
	])("rejects %s during construction", (_name, props) => {
		expect(() => createDurable(props)).toThrow();
	});

	test("adds durable permissions only to the grantee role", () => {
		const granteeRoleId = stack.getLogicalId(
			stack.grantee.lambda.role?.node.defaultChild as CfnResource,
		);
		const durableRoleId = stack.getLogicalId(
			stack.durable.lambda.role?.node.defaultChild as CfnResource,
		);
		const policies = template.findResources("AWS::IAM::Policy");
		const granteePolicies = Object.values(policies).filter((policy) =>
			JSON.stringify(policy).includes(`"Ref":"${granteeRoleId}"`),
		);
		const durablePolicies = Object.values(policies).filter((policy) =>
			JSON.stringify(policy).includes(`"Ref":"${durableRoleId}"`),
		);
		const expectedActions = [
			"lambda:InvokeFunction",
			"lambda:ListDurableExecutionsByFunction",
			"lambda:GetDurableExecution",
			"lambda:GetDurableExecutionHistory",
			"lambda:SendDurableExecutionCallbackSuccess",
			"lambda:SendDurableExecutionCallbackFailure",
			"lambda:SendDurableExecutionCallbackHeartbeat",
			"lambda:StopDurableExecution",
		];

		for (const action of expectedActions) {
			expect(JSON.stringify(granteePolicies)).toContain(action);
			expect(JSON.stringify(durablePolicies)).not.toContain(action);
		}
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
