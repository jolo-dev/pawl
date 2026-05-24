import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import path from "node:path";
import {
	LocalstackContainer,
	type StartedLocalStackContainer,
} from "@testcontainers/localstack";
import { $ } from "bun";
import { throwError } from "../src/utils";

describe("SimpleApiStack", () => {
	let localstack: StartedLocalStackContainer;
	let endpoint: string;
	let env: Record<string, string>;
	const image =
		process.env.LOCALSTACK_IMAGE || "localstack/localstack:2026.4.2";

	beforeAll(async () => {
		console.log("Starting Localstack...");
		localstack = await new LocalstackContainer(image)
			.withEnvironment({
				LOCALSTACK_AUTH_TOKEN:
					process.env.LOCALSTACK_AUTH_TOKEN ??
					throwError("LOCALSTACK_AUTH_TOKEN is missing"), // TODO
			})
			// Localstack needs access to the Docker socket to run the Lambda functions, so we need to bind mount it
			.withBindMounts([
				{
					source: "/var/run/docker.sock",
					target: "/var/run/docker.sock",
					mode: "rw",
				},
			])
			.start();
		console.log("Localstack started", localstack.getId());
		endpoint = localstack.getConnectionUri();
		console.log(endpoint);
		const isMinistack = image.includes("ministack");
		const port = new URL(endpoint).port;
		const url = new URL(endpoint);
		const s3Endpoint = isMinistack
			? endpoint
			: `http://s3.${url.hostname}:${port}`;

		env = {
			...process.env,
			AWS_DEFAULT_REGION: "us-east-1",
			AWS_ACCESS_KEY_ID: "test",
			AWS_SECRET_ACCESS_KEY: "test",
			AWS_ENDPOINT_URL: endpoint, // The Localstack Container creates a random port, so we need to set it in the environment for CDK Local
			AWS_ENDPOINT_URL_S3: s3Endpoint,
			// LOCAL: "true", // This is used in the CDK stack to determine whether to use the local API Gateway or the real one
		};

		const cdkApp = `bun run ${path.join(__dirname, "..")}/local.dev.ts`;
		await $`npx cdklocal bootstrap --app ${cdkApp} --context stage=dev --context team=foo`.env(
			env,
		);
		await $`npx cdklocal deploy SimpleApiStack --app ${cdkApp} --require-approval never --outputs-file /tmp/cdk-outputs.json --context stage=dev --context team=foo`.env(
			env,
		);
	}, 120000);

	afterAll(async () => {
		await localstack.stop();
	});

	it("should return 200 from GET /foo via REST API", async () => {
		const outputs = await Bun.file("/tmp/cdk-outputs.json").json();
		const stackOutputs = Object.values(outputs)[0] as Record<string, string>;
		const cfnUrl = Object.values(stackOutputs).find((v) =>
			v.includes("execute-api"),
		);
		if (!cfnUrl) throw new Error("No execute-api URL found in stack outputs");
		console.log("API Gateway URL:", cfnUrl);
		const apiId = new URL(cfnUrl).hostname.split(".")[0];
		const isMinistack = image.includes("ministack");

		let res: Response;
		if (isMinistack) {
			// Ministack data plane: route via Host header, stage name is "prod" (not the prefixed CFN output)
			res = await fetch(`${endpoint}/prod/foo`, {
				headers: { Host: `${apiId}.execute-api.localhost` },
			});
		} else {
			// LocalStack REST API path format
			const apiUrl = `${endpoint}/restapis/${apiId}/prod/_user_request_`;
			res = await fetch(`${apiUrl}/foo`);
		}

		expect(res.status).toBe(200);
	});
});
