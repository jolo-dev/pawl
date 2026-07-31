import { describe, expect, it } from "bun:test";
import { createLocalStackChildEnv } from "./localstack.setup";

describe("createLocalStackChildEnv", () => {
	it("keeps the LocalStack token out of child processes", () => {
		const env = createLocalStackChildEnv({
			parentEnv: {
				LOCALSTACK_AUTH_TOKEN: "container-only-secret",
				ORDINARY_ENV: "preserved",
				AWS_DEFAULT_REGION: "parent-region",
				AWS_ACCESS_KEY_ID: "parent-access-key",
				AWS_SECRET_ACCESS_KEY: "parent-secret-key",
				AWS_ENDPOINT_URL: "https://parent.example.com",
				AWS_ENDPOINT_URL_S3: "https://parent-s3.example.com",
			},
			endpoint: "http://localhost:4566",
			cdkContext: { stage: "dev", team: "foo" },
		});

		expect(env).not.toHaveProperty("LOCALSTACK_AUTH_TOKEN");
		expect(env.ORDINARY_ENV).toBe("preserved");
		expect(env).toMatchObject({
			AWS_DEFAULT_REGION: "us-east-1",
			AWS_ACCESS_KEY_ID: "test",
			AWS_SECRET_ACCESS_KEY: "test",
			AWS_ENDPOINT_URL: "http://localhost:4566",
			AWS_ENDPOINT_URL_S3: "http://s3.localhost:4566",
		});
	});
});
