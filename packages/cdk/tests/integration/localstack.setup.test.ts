import { describe, expect, it } from "bun:test";
import {
	createLocalStackChildEnv,
	createLocalStackContainerEnv,
} from "./localstack.setup";

const CONTAINER_TOKEN = "unit-test-container-token";

describe("LocalStack environment containment", () => {
	it("passes the auth token only through the container environment", () => {
		expect(
			createLocalStackContainerEnv({
				LOCALSTACK_AUTH_TOKEN: CONTAINER_TOKEN,
				ORDINARY_ENV: "not-forwarded",
			}),
		).toEqual({ LOCALSTACK_AUTH_TOKEN: CONTAINER_TOKEN });
	});

	it("deletes the auth token from every CDK and AWS child environment source", () => {
		const env = createLocalStackChildEnv({
			parentEnv: {
				LOCALSTACK_AUTH_TOKEN: CONTAINER_TOKEN,
				ORDINARY_ENV: "preserved",
				AWS_DEFAULT_REGION: "parent-region",
				AWS_ACCESS_KEY_ID: "parent-access-key",
				AWS_SECRET_ACCESS_KEY: "parent-secret-key",
				AWS_ENDPOINT_URL: "https://parent.example.com",
				AWS_ENDPOINT_URL_S3: "https://parent-s3.example.com",
			},
			endpoint: "http://localhost:4566",
			cdkContext: { stage: "dev", team: "foo" },
			extraEnv: {
				LOCALSTACK_AUTH_TOKEN: "ignored-extra-env-token",
				EXTRA_ENV: "preserved",
			},
		});

		expect(env).not.toHaveProperty("LOCALSTACK_AUTH_TOKEN");
		expect(env.ORDINARY_ENV).toBe("preserved");
		expect(env.EXTRA_ENV).toBe("preserved");
		expect(env).toMatchObject({
			AWS_DEFAULT_REGION: "us-east-1",
			AWS_ACCESS_KEY_ID: "test",
			AWS_SECRET_ACCESS_KEY: "test",
			AWS_ENDPOINT_URL: "http://localhost:4566",
			AWS_ENDPOINT_URL_S3: "http://s3.localhost:4566",
		});
	});

	it("fails closed when the container token is unavailable", () => {
		expect(() => createLocalStackContainerEnv({})).toThrow(
			"LOCALSTACK_AUTH_TOKEN is missing",
		);
	});
});
