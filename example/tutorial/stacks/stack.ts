import {
	type Construct,
	DynamoDbTableWithStreams,
	EventBridge,
	LambdaFunction,
	Sqs,
	Stack,
} from "@pawl/cdk";

export class TutorialStack extends Stack {
	constructor(scope: Construct, id: string) {
		super(scope, id);

		const sendWelcomeMessageHandler = new LambdaFunction(
			this,
			"send-welcome-message",
			{
				entry: "src/sendWelcomeMessageHandler.ts",
			},
		);

		const streams = new DynamoDbTableWithStreams(this, "message-event", {
			partitionKey: {
				name: "Id",
				type: "STRING",
			},
			dynamoStream: "NEW_IMAGE",
			lambdaFunction: sendWelcomeMessageHandler,
			eventSource: {
				startingPosition: "LATEST",
			},
		});

		const messageProcessorHandler = new LambdaFunction(
			this,
			"message-processor",
			{
				entry: "src/messageProcessorHandler.ts",
				environment: {
					DYNAMO_TABLE: streams.table.tableArn,
				},
			},
		);

		streams.grantPermission(messageProcessorHandler, {
			actions: ["dynamodb:PutItems"],
			effect: "allow",
		});

		const sqs = new Sqs(this, "user", {
			fn: messageProcessorHandler,
			retry: 2,
		});

		new EventBridge(this, "user-event", {
			eventBusName: "user-event-bus",
			targets: [
				{
					type: sqs,
					eventPattern: {
						detail: {
							"status-details": {
								status: ["CREATE_COMPLETE"],
							},
						},
					},
				},
			],
		});
	}
}
