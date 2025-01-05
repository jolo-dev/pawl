import * as path from "node:path";
import { SecretValue } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import type { Construct } from "constructs";
import { describe, it } from "vitest";
import { ApiDestination, Authorization } from "../src/api-destination";
import { EventBridge } from "../src/eventbridge";
import { LambdaFunction } from "../src/lambda-function";
import { Stack } from "../src/stack";
import app from "./utils";

describe("eventbridge", () => {
  class TestStack extends Stack {
    constructor(scope: Construct, id: string) {
      super(scope, id);

      const lambdaFunction = new LambdaFunction(this, "TestLambdaEventTarget", {
        entry: path.join(__dirname, "lambda", "dynamodb-streams-test-handler.ts"),
      });

      const apiDestination = new ApiDestination(this, "ApiDestination", {
        apiDestinationName: "TestApiDestination",
        authorization: {
          type: Authorization.basic("foo", SecretValue.secretsManager("bar")),
        },
        description: "To Foobar",
        endpoint: "fooo",
        httpMethod: "GET",
      });

      new EventBridge(this, "TestEventBridge", {
        eventBusName: "TestEventBus",
        targets: [lambdaFunction, apiDestination],
      });
    }
  }

  const stack = new TestStack(app, "EventBridgeTest");
  const template = Template.fromStack(stack);
  it("should contain an eventbus, a Lambda Function as target and an API Destination", () => {
    // console.log(JSON.stringify(template.toJSON()));
    const targets = [
      "AWS::Events::EventBus",
      "AWS::Events::Connection",
      "AWS::Events::ApiDestination",
      "AWS::Lambda::Function",
    ];
    for (const targ of targets) {
      if (targ.includes("Lambda")) {
        template.hasResourceProperties("AWS::Events::Rule", {
          Targets: [
            {
              Id: "Target0", // Because Lambda is first
            },
          ],
        });
      } else {
        template.hasResource(targ, {});
      }
    }
  });
});
