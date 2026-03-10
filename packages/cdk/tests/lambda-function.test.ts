import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { Template } from "aws-cdk-lib/assertions";
import type { StackProps } from "aws-cdk-lib/core";
import { type Construct, Stack } from "../../cdk/src/stack";
import { LambdaFunction } from "../src/lambda-function";
import { createTestApp } from "./utils";

class LambdaTestStack extends Stack {
	constructor(scope: Construct, id: string, props?: StackProps) {
		super(scope, id, props);
		new LambdaFunction(this, "TestLambdaFunction", {
			entry: path.join(__dirname, "lambda", "test-lambda.ts"),
		});
	}
}

describe("LambdaTestStack", () => {
	// WHEN
	const stack = new LambdaTestStack(createTestApp(), "TestStack");

	// THEN
	test("if lambda cdk stack is created with correct properties", () => {
		expect(stack).toBeDefined();

		const template = Template.fromStack(stack);
		template.hasResourceProperties("AWS::Lambda::Function", {
			Handler: "index.handler",
			Runtime: "nodejs22.x",
			FunctionName: "foo-bar-TestLambdaFunction-lambda",
			// Order is important
			Tags: [
				{
					Key: "stage",
					Value: "bar",
				},
				{
					Key: "team",
					Value: "foo",
				},
			],
		});
	});
});
