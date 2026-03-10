import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { Template } from "aws-cdk-lib/assertions";
import type { Construct } from "constructs";
import { ApiGateway } from "../src/apigateway";
import { LambdaFunction } from "../src/lambda-function";
import { Stack } from "../src/stack";
import { createTestApp } from "./utils";

class ApiTestStack extends Stack {
	constructor(scope: Construct, id: string) {
		super(scope, id);

		const lambda = new LambdaFunction(this, "TestLambdaFunction", {
			entry: path.join(__dirname, "lambda", "test-lambda.ts"),
		});

		new ApiGateway(this, "TestApiGateway", {
			routes: {
				"GET /test": lambda,
			},
		});
	}
}

describe("Api", () => {
	// WHEN
	const stack = new ApiTestStack(createTestApp(), "ApiTestStack");
	test("if api cdk stack is created with correct properties", () => {
		expect(stack).toBeDefined();

		const template = Template.fromStack(stack);
		template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
			Name: "foo-bar-TestApiGateway-apigateway",
		});
		template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
			RouteKey: "GET /test",
		});
	});
});
