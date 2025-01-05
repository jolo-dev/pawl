import * as path from "node:path";
import { ApiGateway, LambdaFunction, Stack } from "@hems-lib/cdk";
import { Template } from "aws-cdk-lib/assertions";
import type { Construct } from "constructs";
import { describe, expect, test } from "vitest";
import app from "./utils";

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
  const stack = new ApiTestStack(app, "ApiTestStack");
  test("if api cdk stack is created with correct properties", () => {
    expect(stack).toBeDefined();

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      Name: "TestApiGateway-apigateway",
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /test",
    });
  });
});
