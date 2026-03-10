import { Template } from "aws-cdk-lib/assertions";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { describe, it } from "vitest";
import { BasicConstruct } from "../src/basic-construct";
import { type Construct, Stack } from "../src/stack";
import app from "./utils";

describe("basic-construct", () => {
	class TestConstruct extends BasicConstruct {
		constructor(scope: Stack, id: string) {
			super(scope, id);
			new HttpApi(this, "TestApi");
		}
		createAlarm(_stack: Stack): void {
			throw new Error("Method not implemented.");
		}
	}

	class TestStack extends Stack {
		constructor(scope: Construct, id: string) {
			super(scope, id);
			new TestConstruct(this, "TestBasicConstruct");
		}
	}
	const stack = new TestStack(app, "TestStack");
	const template = Template.fromStack(stack);

	it("should check if context are set", () => {
		template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
			Tags: {
				team: "foo",
				stage: "bar",
			},
		});
	});

	it("should contain a monitoring dashboard", () => {
		// console.log(JSON.stringify(template.toJSON()));
		template.hasResource("AWS::CloudWatch::Dashboard", {});
	});

	// This works btw
	//   it("should throw error when no tags are set", () => {
	//     expect(() => new TestWithoutTagsStack(new Stack(), "TestStackWithoutTags")).throw();
	//   });
});
