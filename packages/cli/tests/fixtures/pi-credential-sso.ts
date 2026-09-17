// Offline subprocess fixture. HOME and every AWS path are private fixture paths.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { fromIni, type fromSSO } from "@aws-sdk/credential-providers";
import { type HttpRequest, HttpResponse } from "@smithy/core/protocols";
import { createCheckedLambdaClient } from "../../src/pi-runtime/checked-scanners";
import {
	createExecutionContext,
	createStsIdentityClient,
} from "../../src/pi-runtime/execution-context";

const home = process.env.PAWL_FIXTURE_HOME;
assert.ok(
	home && process.env.HOME === home && process.env.USERPROFILE === home,
);
assert.equal(process.env.AWS_CONFIG_FILE, join(home, "config"));
assert.equal(
	process.env.AWS_SHARED_CREDENTIALS_FILE,
	join(home, "credentials"),
);
const account = "123456789012";
const authRegion = "us-east-1";
const workRegion = "eu-central-1";
const startUrl = "https://fixture.awsapps.com/start";
const cache = join(home, ".aws", "sso", "cache");
mkdirSync(cache, { recursive: true, mode: 0o700 });
writeFileSync(
	join(cache, `${createHash("sha1").update(startUrl).digest("hex")}.json`),
	JSON.stringify({
		accessToken: "fixture-sso-token",
		expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
		region: authRegion,
		startUrl,
	}),
	{ mode: 0o600 },
);
writeFileSync(
	join(home, "config"),
	`[profile selected]\nsso_start_url = ${startUrl}\nsso_region = ${authRegion}\nsso_account_id = ${account}\nsso_role_name = FixtureRole\nregion = ${workRegion}\nendpoint_url = https://wrong-shared.invalid\n`,
	{ mode: 0o600 },
);
writeFileSync(join(home, "credentials"), "", { mode: 0o600 });
const endpoints: string[] = [];
const context = await createExecutionContext(
	{ projectDir: home, profile: "selected", region: workRegion },
	{
		credentialsFromIni(options) {
			// Directly documented fromIni option, typed via the public fromSSO API.
			const clientConfig: NonNullable<
				Parameters<typeof fromSSO>[0]
			>["clientConfig"] = {
				...options.clientConfig,
				requestHandler: {
					async handle(request: HttpRequest) {
						endpoints.push(request.hostname);
						assert.equal(
							request.hostname,
							`portal.sso.${authRegion}.amazonaws.com`,
						);
						assert.equal(
							request.headers["x-amz-sso_bearer_token"],
							"fixture-sso-token",
						);
						return {
							response: new HttpResponse({
								statusCode: 200,
								headers: { "content-type": "application/json" },
								body: new TextEncoder().encode(
									JSON.stringify({
										roleCredentials: {
											accessKeyId: "fixture-sso-key",
											secretAccessKey: "fixture-sso-secret",
											sessionToken: "fixture-session-token",
											expiration: Date.now() + 3_600_000,
										},
									}),
								),
							}),
						};
					},
				},
			};
			return fromIni({
				...options,
				clientConfig,
				filepath: join(home, "credentials"),
				configFilepath: join(home, "config"),
			});
		},
		identityClient(config) {
			assert.equal(config.region, workRegion);
			return createStsIdentityClient(config, {
				async handle(request: HttpRequest) {
					endpoints.push(request.hostname);
					assert.equal(request.hostname, `sts.${workRegion}.amazonaws.com`);
					assert.match(
						request.headers.authorization ?? "",
						/Credential=fixture-sso-key\//,
					);
					return {
						response: new HttpResponse({
							statusCode: 200,
							headers: { "content-type": "text/xml" },
							body: new TextEncoder().encode(
								`<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Account>${account}</Account><Arn>arn:aws:sts::${account}:assumed-role/FixtureRole/session</Arn><UserId>fixture</UserId></GetCallerIdentityResult><ResponseMetadata><RequestId>fixture</RequestId></ResponseMetadata></GetCallerIdentityResponse>`,
							),
						}),
					};
				},
			});
		},
		now: Date.now,
	},
);
await createCheckedLambdaClient(context, {
	async handle(request) {
		endpoints.push(request.hostname);
		assert.equal(request.hostname, `lambda.${workRegion}.amazonaws.com`);
		assert.match(
			request.headers.authorization ?? "",
			/Credential=fixture-sso-key\//,
		);
		assert.equal(
			request.headers["x-amz-security-token"],
			"fixture-session-token",
		);
		return {
			response: new HttpResponse({
				statusCode: 200,
				headers: { "content-type": "application/json" },
				body: new TextEncoder().encode('{"Functions":[]}'),
			}),
		};
	},
}).send(new ListFunctionsCommand({}));
assert.deepEqual(endpoints, [
	`portal.sso.${authRegion}.amazonaws.com`,
	`sts.${workRegion}.amazonaws.com`,
	`lambda.${workRegion}.amazonaws.com`,
]);
console.log(
	JSON.stringify({
		endpoints,
		account: context.identity.accountId,
		workloadRegion: context.region,
		offline: true,
	}),
);
