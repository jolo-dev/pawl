import { type Construct, DynamoDbTableWithStreams, LambdaFunction, Stack } from "@pawl/cdk";
import { lambdaSrc } from "../src/utils";

export class DynamoDbStreamsStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new DynamoDbTableWithStreams(this, "TestStreamTable", {
      eventSource: {
        startingPosition: "LATEST",
        retryAttempts: 2,
      },
      dynamoStream: "NEW_AND_OLD_IMAGES",
      partitionKey: { name: "id", type: "STRING" },
      lambdaFunction: new LambdaFunction(this, "dynamodb-streams", {
        entry: lambdaSrc("dynamodb-streams-test-handler"),
      }),
    });
  }
}
