import { fileURLToPath } from "node:url";
import { type Construct, Stack, WebFunction } from "@pawl/cdk";

export class LambdaWebFunctionStack extends Stack {
	constructor(scope: Construct, id: string) {
		super(scope, id);
		new WebFunction(this, "my-web-function", {
			functionName: "my-web-function",
			authType: "ApplicationManaged",
			entry: fileURLToPath(new URL("../src/http.ts", import.meta.url)),
			endpointType: "HomeRegion",
			endpointName: "dev",
		});
	}
}
