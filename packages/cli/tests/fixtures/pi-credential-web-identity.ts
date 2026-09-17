// Offline child: every non-intercepted route is a bounded synthetic loopback responder.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { fromIni } from "@aws-sdk/credential-providers";
import {
	type HttpHandlerOptions,
	type HttpRequest,
	HttpResponse,
} from "@smithy/core/protocols";
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
const scenario = process.argv[2] ?? "global-profile";
const account = "123456789012";
const role = `arn:aws:iam::${account}:role/WebFixture`;
const token = "synthetic-web-identity-token";
const workRegion = "eu-central-1";
const profileRegion = "us-west-2";
const authRegion = scenario === "global-env" ? "ap-southeast-2" : profileRegion;
const expiration = new Date(Date.now() + 3_600_000).toISOString();
const xml = (malformed = false) =>
	`<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleWithWebIdentityResult><Credentials><AccessKeyId>web-fixture-key</AccessKeyId>${malformed ? "" : "<SecretAccessKey>web-fixture-secret</SecretAccessKey>"}<SessionToken>web-fixture-session</SessionToken><Expiration>${expiration}</Expiration></Credentials><AssumedRoleUser><Arn>arn:aws:sts::${account}:assumed-role/WebFixture/session</Arn><AssumedRoleId>fixture</AssumedRoleId></AssumedRoleUser></AssumeRoleWithWebIdentityResult><ResponseMetadata><RequestId>fixture</RequestId></ResponseMetadata></AssumeRoleWithWebIdentityResponse>`;
function checkBody(body: string) {
	const params = new URLSearchParams(body);
	assert.equal(params.get("Action"), "AssumeRoleWithWebIdentity");
	assert.equal(params.get("WebIdentityToken"), token);
	assert.equal(params.get("RoleArn"), role);
	assert.equal(params.get("RoleSessionName"), "profile-session");
}
let loopbackRequests = 0;
let unexpected = 0;
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		try {
			assert.equal(new URL(request.url).pathname, "/");
			assert.equal(request.method, "POST");
			assert.equal(request.headers.get("authorization"), null);
			checkBody(await request.text());
			loopbackRequests++;
			return new Response(xml(), { headers: { "content-type": "text/xml" } });
		} catch {
			unexpected++;
			return new Response("unexpected fixture route", { status: 400 });
		}
	},
});
const deadline = setTimeout(() => server.stop(true), 6000);
const endpoint = `http://127.0.0.1:${server.port}`;
try {
	// Mutation is confined to this disposable child, never the production process.
	if (scenario.startsWith("service"))
		process.env.AWS_ENDPOINT_URL_STS = endpoint;
	else if (!scenario.startsWith("shared"))
		process.env.AWS_ENDPOINT_URL = endpoint;
	if (scenario === "global-env") process.env.AWS_REGION = authRegion;
	if (scenario === "global-no-ambient") {
		assert.equal(process.env.AWS_ACCESS_KEY_ID, undefined);
		assert.equal(process.env.AWS_SECRET_ACCESS_KEY, undefined);
		// Trap any accidental metadata fallback on loopback; no real metadata access.
		process.env.AWS_EC2_METADATA_DISABLED = "false";
		process.env.AWS_EC2_METADATA_SERVICE_ENDPOINT = endpoint;
	}
	const profileEndpoint = scenario.startsWith("shared")
		? `endpoint_url = ${endpoint}\nservices = local\n`
		: "";
	writeFileSync(join(home, "token"), token, { mode: 0o600 });
	writeFileSync(join(home, "credentials"), "", { mode: 0o600 });
	writeFileSync(
		join(home, "config"),
		`[profile selected]\nrole_arn = ${role}\nweb_identity_token_file = ${join(home, "token")}\nrole_session_name = profile-session\n${scenario === "global-missing-region" ? "" : `region = ${profileRegion}\n`}${profileEndpoint}\n[profile wrong]\nregion = us-east-2\n${profileEndpoint}\n[default]\nregion = us-east-2\n${profileEndpoint}\n[services local]\nsts =\n  endpoint_url = ${endpoint}\n`,
		{ mode: 0o600 },
	);
	let discardedHandlerCalls = 0;
	// Positive control: ACTUAL installed defective fromIni branch drops clientConfig,
	// including both the isolation flag and handler, and discloses only our fake token to loopback.
	await fromIni({
		profile: "selected",
		ignoreCache: true,
		clientConfig: {
			ignoreConfiguredEndpointUrls: true,
			requestHandler: {
				async handle() {
					discardedHandlerCalls++;
					throw new Error("should be dropped by installed branch");
				},
			},
		},
	})();
	assert.equal(loopbackRequests, 1);
	assert.equal(discardedHandlerCalls, 0);
	assert.equal(unexpected, 0);
	loopbackRequests = 0;
	const endpoints: string[] = [];
	let destroyed = 0;
	let onDestroyed: () => void = () => {};
	const destruction = new Promise<void>((resolve) => {
		onDestroyed = resolve;
	});
	let acquisitions = 0;
	let identities = 0;
	const controller = new AbortController();
	let caught: unknown;
	try {
		const context = await createExecutionContext(
			{
				projectDir: home,
				profile: "selected",
				region: workRegion,
				signal: controller.signal,
			},
			{
				credentialsFromIni(options) {
					const provider = fromIni(options);
					return async () => {
						acquisitions++;
						return provider();
					};
				},
				webIdentityRequestHandler: {
					async handle(request: HttpRequest, options?: HttpHandlerOptions) {
						endpoints.push(request.hostname);
						assert.equal(request.hostname, `sts.${authRegion}.amazonaws.com`);
						assert.equal(request.headers.authorization, undefined); // anonymous operation: no recursive signing provider
						assert.equal(request.headers["x-amz-security-token"], undefined);
						assert.equal(typeof request.body, "string");
						if (typeof request.body !== "string")
							throw new Error("unexpected body");
						checkBody(request.body);
						if (scenario === "global-error")
							throw new Error("fixture transport refused");
						if (scenario === "global-cancel") {
							const signal = options?.abortSignal;
							assert.ok(signal instanceof AbortSignal);
							return new Promise<{ response: HttpResponse }>(
								(_resolve, reject) => {
									signal.addEventListener(
										"abort",
										() => reject(signal.reason),
										{ once: true },
									);
									controller.abort(new Error("fixture cancelled"));
								},
							);
						}
						return {
							response: new HttpResponse({
								statusCode: 200,
								headers: { "content-type": "text/xml" },
								body: new TextEncoder().encode(
									xml(scenario === "global-malformed"),
								),
							}),
						};
					},
					destroy() {
						destroyed++;
						onDestroyed();
					},
				},
				identityClient(config) {
					identities++;
					assert.equal(config.region, workRegion);
					return createStsIdentityClient(config, {
						async handle(request: HttpRequest) {
							endpoints.push(request.hostname);
							assert.equal(request.hostname, `sts.${workRegion}.amazonaws.com`);
							assert.match(
								request.headers.authorization ?? "",
								/Credential=web-fixture-key\//,
							);
							return {
								response: new HttpResponse({
									statusCode: 200,
									headers: { "content-type": "text/xml" },
									body: new TextEncoder().encode(
										`<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Account>${account}</Account><Arn>arn:aws:sts::${account}:assumed-role/WebFixture/session</Arn></GetCallerIdentityResult></GetCallerIdentityResponse>`,
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
					/Credential=web-fixture-key\//,
				);
				assert.equal(
					request.headers["x-amz-security-token"],
					"web-fixture-session",
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
	} catch (error) {
		caught = error;
	}
	assert.equal(
		loopbackRequests,
		0,
		"protected acquisition must not disclose the token to configured endpoints",
	);
	let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			destruction,
			new Promise<never>((_resolve, reject) => {
				cleanupTimer = setTimeout(
					() => reject(new Error("acquisition client cleanup did not settle")),
					1000,
				);
			}),
		]);
	} finally {
		clearTimeout(cleanupTimer);
	}
	assert.equal(unexpected, 0);
	assert.equal(acquisitions, 1);
	assert.equal(destroyed, 1);
	if (
		[
			"global-missing-region",
			"global-malformed",
			"global-error",
			"global-cancel",
		].includes(scenario)
	) {
		assert.ok(caught instanceof Error);
		assert.equal(identities, 0);
		const pattern =
			scenario === "global-missing-region"
				? /region/i
				: scenario === "global-malformed"
					? /invalid.*credentials/i
					: scenario === "global-error"
						? /transport refused/i
						: /cancelled/i;
		assert.match(caught.message, pattern);
		assert.equal(
			endpoints.length,
			scenario === "global-missing-region" ? 0 : 1,
		);
	} else {
		assert.equal(caught, undefined);
		assert.equal(identities, 1);
		assert.deepEqual(endpoints, [
			`sts.${authRegion}.amazonaws.com`,
			`sts.${workRegion}.amazonaws.com`,
			`lambda.${workRegion}.amazonaws.com`,
		]);
	}
	console.log(
		JSON.stringify({
			scenario,
			positiveControlDisclosures: 1,
			protectedDisclosures: loopbackRequests,
			endpoints,
			destroyed,
			acquisitions,
			offline: true,
		}),
	);
} finally {
	clearTimeout(deadline);
	await server.stop(true);
}
