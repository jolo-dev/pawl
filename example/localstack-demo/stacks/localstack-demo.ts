import { type Construct, LambdaFunction, Sqs, Stack } from "@pawl/cdk";
import { lambdaSrc } from "../src/utils";

export class LocalstackDemoStack extends Stack {
	constructor(scope: Construct, id: string) {
		super(scope, id);

		const lambda = new LambdaFunction(this, "LocalstackLambda", {
			entry: lambdaSrc("sqs-demo-handler"),
		});
		new Sqs(this, "demo-queue", {
			fn: lambda,
			retry: 2,
			fifo: true,
		});
	}
}
