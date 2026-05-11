import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import path from "node:path";
import {
	LocalstackContainer,
	type StartedLocalStackContainer,
} from "@testcontainers/localstack";
import { $ } from "bun";

describe("LocalstackDemo", () => {
	let localstack: StartedLocalStackContainer;
	let endpoint: string;
	let env: Record<string, string>;
	const image =
		process.env.LOCALSTACK_IMAGE || "localstack/localstack:community-archive";

	beforeAll(async () => {
		console.log("Starting Localstack...");
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
		console.log("Localstack started", localstack.getId());
		endpoint = localstack.getConnectionUri();
		console.log(endpoint);
		const port = new URL(endpoint).port;
		const url = new URL(endpoint);
		const s3Endpoint = `http://s3.${url.hostname}:${port}`;

		env = {
			...process.env,
			AWS_DEFAULT_REGION: "us-east-1",
			AWS_ACCESS_KEY_ID: "test",
			AWS_SECRET_ACCESS_KEY: "test",
			AWS_ENDPOINT_URL: endpoint, // The Localstack Container creates a random port, so we need to set it in the environment for CDK Local
			AWS_ENDPOINT_URL_S3: s3Endpoint,
			LOCAL: "true", // This is used in the CDK stack to determine whether to use the local API Gateway or the real one
		};

		const cdkApp = `bun run ${path.join(__dirname, "..")}/local.dev.ts`;
		await $`npx cdklocal bootstrap --app ${cdkApp} --context stage=dev --context team=foo`.env(
			env,
		);
		await $`npx cdklocal deploy LocalstackDemoStack --app ${cdkApp} --require-approval never --outputs-file /tmp/cdk-outputs.json --context stage=dev --context team=foo`.env(
			env,
		);
	}, 120000);

	afterAll(async () => {
		await localstack.stop();
	});

	it("should send a message to sqs and triggers a Lambda", async () => {
		const queues =
			await $`aws sqs list-queues --endpoint-url ${endpoint} --region us-east-1`
				.env(env)
				.json();
		const queueUrl = (queues.QueueUrls as string[]).find((url) =>
			url.includes("-sqs.fifo"),
		);

		console.log("queueUrl", queueUrl);

		const sqsMessage = JSON.stringify({
			message: "Hi",
		});

		await $`aws sqs send-message --endpoint-url ${endpoint} --region us-east-1 --queue-url ${queueUrl} --message-body ${sqsMessage} --message-group-id test`
			.env(env)
			.json();

		// Wait for Lambda to be triggered by SQS
		await new Promise((r) => setTimeout(r, 5000));

		// Check CloudWatch logs for the Lambda processing the message
		const logs =
			await $`aws logs filter-log-events --endpoint-url ${endpoint} --region us-east-1 --log-group-name /aws/lambda/foo-dev-LocalstackLambda-lambda --filter-pattern "Hi"`
				.env(env)
				.json();

		expect(logs.events.length).toBeGreaterThan(0);
	}, 30000);
});
