import { fileURLToPath } from "node:url";
import {
	type Construct,
	Stack,
	WebFunction,
	WebFunctionAuthType,
	WebFunctionEndpointType,
} from "@pawl/cdk";

export class LambdaWebFunctionStack extends Stack {
	constructor(scope: Construct, id: string) {
		super(scope, id);
		new WebFunction(this, "my-web-function", {
			functionName: "my-web-function",
			authType: WebFunctionAuthType.APPLICATION_MANAGED,
			entry: fileURLToPath(new URL("../src/http.ts", import.meta.url)),
			endpointType: WebFunctionEndpointType.HOME_REGION,
			endpointName: "dev",
		});
	}
}
