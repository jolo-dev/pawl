import {
	ApiGateway,
	ApiGatewayV1,
	type Construct,
	LambdaFunction,
	Stack,
} from "@pawl/cdk";
import { lambdaSrc } from "../src/utils";

export class SimpleApiStack extends Stack {
	constructor(scope: Construct, id: string) {
		super(scope, id);

		const props = {
			routes: {
				"GET /foo": new LambdaFunction(this, "FooFunction", {
					entry: lambdaSrc("api-handler"),
				}),
			},
		};
		if (process.env.LOCAL) {
			new ApiGatewayV1(this, "ApiGatewayV1", props);
		} else {
			new ApiGateway(this, "ApiGateway", props);
		}
	}
}
