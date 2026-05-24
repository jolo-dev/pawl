import path from "node:path";
import { ApiGateway, LambdaFunction, stacks } from "@pawl/cdk";
import { createLocalStackSetup } from "./localstack.setup";

const foo = function ApiGatewayLambdaStack() {
	const lambda = new LambdaFunction("TestFunction", {
		entry: path.join(__dirname, "../lambda", "test-lambda.ts"),
	});

	new ApiGateway("ApiGateway", {
		routes: {
			"GET /lambda": lambda,
		},
	});
};

if (!stacks(foo)) {
	const { describe, expect, it } = await import("bun:test");

	describe("integ:apigateway-lambda", () => {
		const ls = createLocalStackSetup({
			appFile: import.meta.path,
			stack: foo,
			outputsFile: "/tmp/cdk-outputs.json",
		});

		it("should return 200 from GET /lambda via REST API", async () => {
			const outputs = await Bun.file("/tmp/cdk-outputs.json").json();
			const stackOutputs = Object.values(outputs)[0] as Record<string, string>;
			const cfnUrl = Object.values(stackOutputs).find((v) =>
				v.includes("execute-api"),
			);
			if (!cfnUrl) throw new Error("No execute-api URL found in stack outputs");
			console.log("API Gateway URL:", cfnUrl);
			const apiId = new URL(cfnUrl).hostname.split(".")[0];

			const apiUrl = `${ls.endpoint}/restapis/${apiId}/prod/_user_request_`;
			const res = await fetch(`${apiUrl}/lambda`);

			expect(res.status).toBe(200);
		});
	});
}
