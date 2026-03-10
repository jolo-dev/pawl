import * as path from "node:path";
import { Template } from "aws-cdk-lib/assertions";
import { describe, it } from "vitest";
import { DynamoDbTableWithStreams } from "../src/dynamodb-streams";
import { LambdaFunction } from "../src/lambda-function";
import { type Construct, Stack } from "../src/stack";
import app from "./utils";

describe("dynamodb-streams", () => {
	class TestStack extends Stack {
		constructor(scope: Construct, id: string) {
			super(scope, id);

			const lambdaFunction = new LambdaFunction(
				this,
				"TestLambdaDynamoStreamer",
				{
					entry: path.join(
						__dirname,
						"lambda",
						"dynamodb-streams-test-handler.ts",
					),
				},
			);

			new DynamoDbTableWithStreams(this, "TestDynamoDb", {
				partitionKey: {
					name: "id",
					type: "STRING",
				},
				dynamoStream: "NEW_AND_OLD_IMAGES",
				lambdaFunction,
				eventSource: {
					startingPosition: "LATEST",
				},
			});
		}
	}

	const stack = new TestStack(app, "DynamoDbStreamTest");
	const template = Template.fromStack(stack);
	it("should have streams enabled", () => {
		template.hasResource("AWS::DynamoDB::GlobalTable", {
			Properties: {
				StreamSpecification: {
					StreamViewType: "NEW_AND_OLD_IMAGES",
				},
			},
		});

		template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
			StartingPosition: "LATEST",
		});
	});
});
