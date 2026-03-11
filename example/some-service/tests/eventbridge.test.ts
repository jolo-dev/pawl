import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	LocalstackContainer,
	type StartedLocalStackContainer,
} from "@testcontainers/localstack";
import { $ } from "bun";
import * as path from "node:path";

describe("EventbridgeStack", () => {
	let localstack: StartedLocalStackContainer;
	let endpoint: string;
	let env: Record<string, string>;
	const image = process.env.LOCALSTACK_IMAGE || "localstack/localstack:latest";

	beforeAll(async () => {
		localstack = await new LocalstackContainer(image)
			// Localstack needs access to the Docker socket to run the Lambda functions, so we need to bind mount it
			.withBindMounts([
				{
					source: "/var/run/docker.sock",
					target: "/var/run/docker.sock",
					mode: "rw",
				},
			])
			.start();
		endpoint = localstack.getConnectionUri();
		console.log(endpoint);
		const port = new URL(endpoint).port;
		const url = new URL(endpoint);
		const s3Endpoint = `http://s3.${url.hostname}:${port}`; // This seems to be the only way to get the correct S3 endpoint for Testcontainers, as it uses a different hostname than the other services

		env = {
			...process.env,
			AWS_ACCESS_KEY_ID: "test",
			AWS_SECRET_ACCESS_KEY: "test",
			AWS_ENDPOINT_URL: endpoint, // The Localstack Container creates a random port, so we need to set it in the environment for CDK Local
			AWS_ENDPOINT_URL_S3: s3Endpoint, //
			LOCAL: "true", // This is used in the CDK stack to determine whether to use the local API Gateway or the real one
		};

		const cdkApp = `bun run ${path.join(__dirname, "..")}/local.dev.ts`;
		await $`npx cdklocal bootstrap --app ${cdkApp} --context stage=dev --context team=foo`.env(
			env,
		);
		await $`npx cdklocal deploy EventBridgeStack --app ${cdkApp} --require-approval never --context stage=dev --context team=foo`.env(
			env,
		);
	}, 120000);

	afterAll(async () => {
		await localstack.stop();
	});

	it("should send a message to the Eventbridge", async () => {
		const detail = JSON.stringify({
			id: 1,
			email: "test@test.com",
			address: { street: "Main St", number: 1, postcode: 12345 },
		});

		// Put an event on the bus
		const putResult =
			await $`aws events put-events --endpoint-url ${endpoint} --region us-east-1 --entries ${JSON.stringify([{ Source: "foo", DetailType: "user", Detail: detail, EventBusName: "TestEventBus" }])}`
				.env(env)
				.json();
		expect(putResult.FailedEntryCount).toBe(0);

		// Wait for async Lambda invocation
		await new Promise((r) => setTimeout(r, 5000));

		// Check CloudWatch logs for the Lambda processing the event
		const logs =
			await $`aws logs filter-log-events --endpoint-url ${endpoint} --region us-east-1 --log-group-name /aws/lambda/foo-dev-Test-Eventbridge-lambda --filter-pattern "User with ID"`
				.env(env)
				.json();
		expect(logs.events.length).toBeGreaterThan(0);
	}, 30000);
});
