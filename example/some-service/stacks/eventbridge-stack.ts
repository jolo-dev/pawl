import {
	ApiDestination,
	Authorization,
	type Construct,
	EventBridge,
	LambdaFunction,
	SecretValue,
	Sqs,
	Stack,
} from "@pawl/cdk";
import { lambdaSrc } from "../src/utils";

export class EventBridgeStack extends Stack {
	constructor(scope: Construct, id: string) {
		super(scope, id);

		const eventPattern = { source: ["foo"] };

		const lambda = new LambdaFunction(this, "Test-Eventbridge", {
			entry: lambdaSrc("eventbridge-user-handler"),
		});

		const sqsLambda = new LambdaFunction(this, "Test-Eventbridge-Sqs", {
			entry: lambdaSrc("sqs-handler"),
		});

		const sqs = new Sqs(this, "Foo-EventBridge", {
			fn: sqsLambda,
			retry: 3,
			fifo: true,
		});

		const targets = [
			{
				type: lambda,
				eventPattern,
			},
			{
				type: sqs,
				eventPattern,
			},
		];

		if (!process.env.LOCAL) {
			targets.push({
				type: new ApiDestination(this, "ApiDestination", {
					apiDestinationName: "foo",
					authorization: Authorization.basic(
						"foo",
						SecretValue.unsafePlainText("test-unsafe"),
					),
					description: "This goes to an API",
					endpoint: "https://foo.bar",
				}),
				eventPattern,
			});
		}

		new EventBridge(this, "test", {
			eventBusName: "TestEventBus",
			targets,
		});
	}
}
