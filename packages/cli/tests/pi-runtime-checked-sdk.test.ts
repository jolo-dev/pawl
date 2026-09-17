import { afterEach, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import {
	type HttpHandlerOptions,
	HttpRequest,
	HttpResponse,
} from "@smithy/core/protocols";
import { createLambdaScanner } from "../src/infra/scan/lambda";
import { createCheckedLambdaClient } from "../src/pi-runtime/checked-scanners";
import { createCheckedSdkExecutor } from "../src/pi-runtime/checked-sdk";
import {
	type CredentialSnapshot,
	createExecutionContext,
} from "../src/pi-runtime/execution-context";

const dirs: string[] = [];
afterEach(() => {
	for (const path of dirs.splice(0))
		rmSync(path, { recursive: true, force: true });
});
const ACCOUNT = "123456789012";
const REGION = "eu-central-1";
const NOW = 1_800_000_000_000;
function directory() {
	const path = mkdtempSync(join(tmpdir(), "pawl-sdk-test-"));
	dirs.push(path);
	return path;
}
async function fixture() {
	const controller = new AbortController();
	let credentials = {
		accessKeyId: "selected-key",
		secretAccessKey: "selected-secret",
		sessionToken: "selected-token",
		expiration: new Date(NOW + 3_600_000),
	};
	let arn = `arn:aws:sts::${ACCOUNT}:assumed-role/SelectedRole/session`;
	let now = NOW;
	let beforeResolve: (() => Promise<void>) | undefined;
	const checked: CredentialSnapshot[] = [];
	const context = await createExecutionContext(
		{
			projectDir: directory(),
			profile: "selected",
			region: REGION,
			signal: controller.signal,
		},
		{
			credentialsFromIni: () => async () => {
				await beforeResolve?.();
				return credentials;
			},
			identityClient: ({ credentials }) => {
				checked.push(credentials);
				return {
					identify: async () => ({ Account: ACCOUNT, Arn: arn }),
					destroy() {},
				};
			},
			now: () => now,
		},
	);
	return {
		context,
		controller,
		checked,
		pauseResolution(hook?: () => Promise<void>) {
			beforeResolve = hook;
		},
		rotate() {
			credentials = {
				...credentials,
				accessKeyId: "rotated-key",
				secretAccessKey: "rotated-secret",
				sessionToken: "rotated-token",
			};
		},
		rotateSecret() {
			credentials = { ...credentials, secretAccessKey: "new-secret-same-key" };
		},
		changeRole() {
			arn = `arn:aws:sts::${ACCOUNT}:assumed-role/OtherRole/session`;
			this.rotate();
		},
		expire() {
			now = NOW + 3_600_000;
		},
	};
}
const stsResponse = () => ({
	response: new HttpResponse({
		statusCode: 200,
		headers: { "content-type": "text/xml" },
		body: new TextEncoder().encode(
			`<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Arn>arn:aws:iam::${ACCOUNT}:user/fixture</Arn><Account>${ACCOUNT}</Account><UserId>fixture</UserId></GetCallerIdentityResult><ResponseMetadata><RequestId>fixture</RequestId></ResponseMetadata></GetCallerIdentityResponse>`,
		),
	}),
});
const jsonResponse = (data: unknown, statusCode = 200) => ({
	response: new HttpResponse({
		statusCode,
		headers: { "content-type": "application/json" },
		body: new TextEncoder().encode(JSON.stringify(data)),
	}),
});
type Handler = {
	handle(
		request: HttpRequest,
		options?: HttpHandlerOptions,
	): Promise<{ response: HttpResponse }>;
};
function sts(
	context: Awaited<ReturnType<typeof fixture>>["context"],
	handler: Handler,
	configure?: (client: STSClient) => void,
	operationSignal?: AbortSignal,
) {
	const execute = createCheckedSdkExecutor(
		context,
		(config) => {
			const client = new STSClient({
				...config,
				requestHandler: handler,
				maxAttempts: 3,
			});
			configure?.(client);
			return client;
		},
		(client, guard) => {
			client.middlewareStack.add(
				(next) => async (args) => {
					await guard();
					return next(args);
				},
				{ step: "deserialize", priority: "low", name: "pawlCheckedTransport" },
			);
		},
		operationSignal,
	);
	const send: STSClient["send"] = (command, optionsOrCallback?, callback?) => {
		const options =
			typeof optionsOrCallback === "function" ? undefined : optionsOrCallback;
		const result = execute(
			(client, signal) =>
				client.send(command, { ...options, abortSignal: signal }),
			options?.abortSignal,
		);
		const cb =
			typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
		if (typeof cb === "function")
			void result.then(
				(output) => cb(null, output),
				(error: unknown) => cb(error),
			);
		return result;
	};
	return { send };
}

test("reused SDK sends cannot bypass context cancellation through credential memoization", async () => {
	const f = await fixture();
	let requests = 0;
	const client = sts(f.context, {
		async handle() {
			requests++;
			return stsResponse();
		},
	});
	await client.send(new GetCallerIdentityCommand({}));
	f.controller.abort();
	await expect(client.send(new GetCallerIdentityCommand({}))).rejects.toThrow();
	expect(requests).toBe(1);
});

test("a later explicit send signs with refreshed selected credentials", async () => {
	const f = await fixture();
	const authorizations: string[] = [];
	const client = sts(f.context, {
		async handle(request) {
			authorizations.push(request.headers.authorization ?? "");
			return stsResponse();
		},
	});
	await client.send(new GetCallerIdentityCommand({}));
	f.rotate();
	await client.send(new GetCallerIdentityCommand({}));
	expect(authorizations[0]).toContain("Credential=selected-key/");
	expect(authorizations[1]).toContain("Credential=rotated-key/");
	expect(f.checked).toHaveLength(2);
});

for (const change of ["changeRole", "expire"] as const) {
	test(`reused SDK client rejects ${change} before transport`, async () => {
		const f = await fixture();
		let requests = 0;
		const client = sts(f.context, {
			async handle() {
				requests++;
				return stsResponse();
			},
		});
		await client.send(new GetCallerIdentityCommand({}));
		f[change]();
		await expect(
			client.send(new GetCallerIdentityCommand({})),
		).rejects.toThrow();
		expect(requests).toBe(1);
	});
}

test("real Lambda pagination stops before a page after context cancellation", async () => {
	const f = await fixture();
	let requests = 0;
	const client = createCheckedLambdaClient(f.context, {
		async handle() {
			requests++;
			f.controller.abort();
			return jsonResponse({
				Functions: [],
				NextMarker: requests === 1 ? "page-2" : undefined,
			});
		},
	});
	await expect(createLambdaScanner(client).scan()).rejects.toThrow();
	expect(requests).toBe(1);
});

test("proof scanner endpoint isolation survives real scanner construction", async () => {
	const f = await fixture();
	const hosts: string[] = [];
	const saved = process.env.AWS_ENDPOINT_URL_LAMBDA;
	try {
		process.env.AWS_ENDPOINT_URL_LAMBDA = "https://wrong.invalid";
		await f.context.scanProject({
			exec: async () => {
				throw new Error("no assembly");
			},
			services: ["lambda"],
			requestHandler: {
				async handle(request: HttpRequest) {
					hosts.push(request.hostname);
					return jsonResponse({ Functions: [] });
				},
			},
		});
		expect(hosts).toEqual([`lambda.${REGION}.amazonaws.com`]);
	} finally {
		if (saved === undefined) delete process.env.AWS_ENDPOINT_URL_LAMBDA;
		else process.env.AWS_ENDPOINT_URL_LAMBDA = saved;
	}
});

for (const change of ["changeRole", "expire"] as const) {
	test(`real scan pagination refuses ${change} between pages`, async () => {
		const f = await fixture();
		let requests = 0;
		await expect(
			f.context.scanProject({
				exec: async () => {
					throw new Error("no assembly");
				},
				services: ["lambda"],
				requestHandler: {
					async handle() {
						requests++;
						f[change]();
						return jsonResponse({
							Functions: [],
							NextMarker: requests === 1 ? "page-2" : undefined,
						});
					},
				},
			}),
		).rejects.toThrow();
		expect(requests).toBe(1);
	});
}

test("scan does not swallow credential expiry as an optional tag-read failure", async () => {
	const f = await fixture();
	let requests = 0;
	await expect(
		f.context.scanProject({
			exec: async () => {
				throw new Error("no assembly");
			},
			services: ["lambda"],
			requestHandler: {
				async handle() {
					requests++;
					f.expire();
					return jsonResponse({
						Functions: [
							{
								FunctionName: "fixture",
								FunctionArn: `arn:aws:lambda:${REGION}:${ACCOUNT}:function:fixture`,
							},
						],
					});
				},
			},
		}),
	).rejects.toThrow();
	expect(requests).toBe(1);
});

for (const change of [
	"rotate",
	"rotateSecret",
	"changeRole",
	"expire",
	"abort",
] as const) {
	for (const where of ["after signing", "before retry"] as const) {
		test(`${change} ${where} prevents transport and destroys the command client`, async () => {
			const f = await fixture();
			let requests = 0;
			let destroyed = 0;
			let signed = 0;
			const mutate = () =>
				change === "abort" ? f.controller.abort() : f[change]();
			const handler = {
				async handle() {
					requests++;
					mutate();
					const error = new Error("fixture timeout");
					error.name = "TimeoutError";
					throw error;
				},
				destroy() {
					destroyed++;
				},
			};
			const client = sts(
				f.context,
				handler,
				where === "after signing"
					? (client) => {
							client.middlewareStack.add(
								(next) => async (args) => {
									if (!HttpRequest.isInstance(args.request))
										throw new Error("missing signed request");
									expect(args.request.headers.authorization).toContain(
										"Credential=selected-key/",
									);
									signed++;
									mutate();
									return next(args);
								},
								{
									step: "deserialize",
									priority: "high",
									name: "fixtureAfterSigning",
								},
							);
						}
					: undefined,
			);
			await expect(
				client.send(new GetCallerIdentityCommand({})),
			).rejects.toThrow();
			expect(requests).toBe(where === "after signing" ? 0 : 1);
			expect(signed).toBe(where === "after signing" ? 1 : 0);
			expect(destroyed).toBe(1);
		});
	}
}

test("normal SDK retry with the same snapshot works and cleanup happens once", async () => {
	const f = await fixture();
	let requests = 0;
	let destroyed = 0;
	const handler = {
		async handle(request: HttpRequest) {
			expect(request.headers.authorization).toContain(
				"Credential=selected-key/",
			);
			if (++requests === 1) {
				const error = new Error("fixture timeout");
				error.name = "TimeoutError";
				throw error;
			}
			return stsResponse();
		},
		destroy() {
			destroyed++;
		},
	};
	await sts(f.context, handler).send(new GetCallerIdentityCommand({}));
	expect(requests).toBe(2);
	expect(destroyed).toBe(1);
});

// An independent SigV4 calculation proves secret rotation, not just key text in
// Authorization. This fixture uses STS POST / with no query parameters.
function expectedSignature(request: HttpRequest, secret: string): string {
	const authorization = request.headers.authorization ?? "";
	const scope = /Credential=[^/]+\/([^,]+)/.exec(authorization)?.[1];
	const signed = /SignedHeaders=([^,]+)/.exec(authorization)?.[1];
	if (!scope || !signed || typeof request.body !== "string")
		throw new Error("invalid fixture signing request");
	const [date, region, service] = scope.split("/");
	if (!date || !region || !service) throw new Error("invalid signing scope");
	const hash = (text: string) =>
		createHash("sha256").update(text).digest("hex");
	const headers = signed
		.split(";")
		.map(
			(name) =>
				`${name}:${request.headers[name]?.trim().replace(/\s+/g, " ")}\n`,
		)
		.join("");
	const canonical = [
		request.method,
		request.path,
		"",
		headers,
		signed,
		hash(request.body),
	].join("\n");
	const stringToSign = [
		"AWS4-HMAC-SHA256",
		request.headers["x-amz-date"],
		scope,
		hash(canonical),
	].join("\n");
	let key = createHmac("sha256", `AWS4${secret}`).update(date).digest();
	for (const part of [region, service, "aws4_request"])
		key = createHmac("sha256", key).update(part).digest();
	return createHmac("sha256", key).update(stringToSign).digest("hex");
}

test("fresh actual signers use changed secrets even when the access key is unchanged", async () => {
	const f = await fixture();
	let secret = "selected-secret";
	let requests = 0;
	const client = sts(f.context, {
		async handle(request) {
			requests++;
			expect(request.headers.authorization).toContain(
				`Signature=${expectedSignature(request, secret)}`,
			);
			expect(request.headers["x-amz-security-token"]).toBe("selected-token");
			return stsResponse();
		},
	});
	await client.send(new GetCallerIdentityCommand({}));
	f.rotateSecret();
	secret = "new-secret-same-key";
	await client.send(new GetCallerIdentityCommand({}));
	expect(requests).toBe(2);
	expect(f.checked).toHaveLength(2);
});

for (const source of ["global", "service", "shared config"] as const) {
	test(`all seven real proof scanners ignore ${source} endpoint conflicts`, async () => {
		const f = await fixture();
		const hosts: string[] = [];
		const configFile = join(directory(), "config");
		writeFileSync(
			configFile,
			`[default]\n${source === "shared config" ? "endpoint_url = https://wrong-shared.invalid\n" : ""}`,
		);
		const serviceKeys = [
			"AWS_ENDPOINT_URL_LAMBDA",
			"AWS_ENDPOINT_URL_API_GATEWAY",
			"AWS_ENDPOINT_URL_API_GATEWAY_V2",
			"AWS_ENDPOINT_URL_DYNAMODB",
			"AWS_ENDPOINT_URL_SQS",
			"AWS_ENDPOINT_URL_S3",
			"AWS_ENDPOINT_URL_EVENTBRIDGE",
		];
		const changes: Record<string, string | undefined> = {
			AWS_PROFILE: "default",
			AWS_CONFIG_FILE: configFile,
			AWS_ENDPOINT_URL:
				source === "global" ? "https://wrong-global.invalid" : undefined,
		};
		for (const key of serviceKeys)
			changes[key] =
				source === "service" ? "https://wrong-service.invalid" : undefined;
		const saved = Object.fromEntries(
			Object.keys(changes).map((key) => [key, process.env[key]]),
		);
		try {
			for (const [key, value] of Object.entries(changes)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			// Positive control: these conflicts really redirect an ordinary client.
			// Production defaults remain untouched; only proof clients isolate them.
			const defaultHosts: string[] = [];
			const ordinary = new LambdaClient({
				region: REGION,
				credentials: () => f.context.checkedCredentials(),
				requestHandler: {
					async handle(request: HttpRequest) {
						defaultHosts.push(request.hostname);
						return jsonResponse({ Functions: [] });
					},
				},
			});
			try {
				await createLambdaScanner(ordinary).scan();
			} finally {
				ordinary.destroy();
			}
			expect(defaultHosts).toEqual([
				source === "global"
					? "wrong-global.invalid"
					: source === "service"
						? "wrong-service.invalid"
						: "wrong-shared.invalid",
			]);
			const result = await f.context.scanProject({
				exec: async () => {
					throw new Error("no assembly");
				},
				requestHandler: {
					async handle(request) {
						hosts.push(request.hostname);
						expect(request.headers.authorization).toContain(
							"Credential=selected-key/",
						);
						expect(request.headers.authorization).toContain(`/${REGION}/`);
						expect(request.headers["x-amz-security-token"]).toBe(
							"selected-token",
						);
						if (request.hostname.startsWith("s3."))
							return {
								response: new HttpResponse({
									statusCode: 200,
									headers: { "content-type": "application/xml" },
									body: new TextEncoder().encode(
										'<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Buckets/></ListAllMyBucketsResult>',
									),
								}),
							};
						return jsonResponse({
							Functions: [],
							Items: [],
							items: [],
							TableNames: [],
							QueueUrls: [],
							EventBuses: [],
						});
					},
				},
			});
			expect(hosts).toEqual([
				`lambda.${REGION}.amazonaws.com`,
				`apigateway.${REGION}.amazonaws.com`,
				`apigateway.${REGION}.amazonaws.com`,
				`dynamodb.${REGION}.amazonaws.com`,
				`sqs.${REGION}.amazonaws.com`,
				`s3.${REGION}.amazonaws.com`,
				`events.${REGION}.amazonaws.com`,
			]);
			expect(result.report.coverage.total).toBe(7);
			expect(result.report.coverage.complete).toBe(true);
		} finally {
			for (const [key, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});
}

for (const cancellation of [
	"context",
	"operation",
	"send options",
	"legacy send options",
] as const) {
	test(`parallel commands receive ${cancellation} cancellation and destroy each client`, async () => {
		const f = await fixture();
		const operation = new AbortController();
		const sdk = new AbortController();
		const legacy: { aborted: boolean; onabort: (() => void) | null } = {
			aborted: false,
			onabort: null,
		};
		let requests = 0;
		let destroyed = 0;
		let active = 0;
		let peak = 0;
		let ready: () => void = () => {};
		const bothStarted = new Promise<void>((resolve) => {
			ready = resolve;
		});
		const handler = {
			async handle(_request: HttpRequest, options?: HttpHandlerOptions) {
				requests++;
				active++;
				peak = Math.max(peak, active);
				const signal = options?.abortSignal;
				if (!(signal instanceof AbortSignal))
					throw new Error("combined native signal missing");
				if (requests === 2) ready();
				try {
					return await new Promise<{ response: HttpResponse }>(
						(_resolve, reject) => {
							signal.addEventListener("abort", () => reject(signal.reason), {
								once: true,
							});
						},
					);
				} finally {
					active--;
				}
			},
			destroy() {
				destroyed++;
			},
		};
		const client = sts(f.context, handler, undefined, operation.signal);
		const options = {
			abortSignal: cancellation === "legacy send options" ? legacy : sdk.signal,
		};
		const first = client.send(new GetCallerIdentityCommand({}), options);
		const second = client.send(new GetCallerIdentityCommand({}), options);
		const results = Promise.allSettled([first, second]);
		await bothStarted;
		if (cancellation === "context") f.controller.abort();
		else if (cancellation === "operation") operation.abort();
		else if (cancellation === "send options") sdk.abort();
		else {
			legacy.aborted = true;
			legacy.onabort?.();
		}
		expect((await results).map((result) => result.status)).toEqual([
			"rejected",
			"rejected",
		]);
		expect(peak).toBe(2);
		expect(destroyed).toBe(2);
		expect(legacy.onabort).toBeNull();
		await expect(
			client.send(new GetCallerIdentityCommand({}), options),
		).rejects.toThrow();
		expect(requests).toBe(2);
	});
}

test("service-local facade preserves promise output typing, callbacks, options and error delivery", async () => {
	const f = await fixture();
	let destroyed = 0;
	const handler = {
		async handle(_request: HttpRequest, options?: HttpHandlerOptions) {
			expect(options?.requestTimeout).toBe(1234);
			return jsonResponse({ Functions: [{ FunctionName: "fixture" }] });
		},
		destroy() {
			destroyed++;
		},
	};
	const client = createCheckedLambdaClient(f.context, handler);
	const output = await client.send(new ListFunctionsCommand({}), {
		requestTimeout: 1234,
	});
	expect(output.Functions?.[0]?.FunctionName).toBe("fixture");
	// @ts-expect-error SDK-specific result type must not become any.
	void output.NotAnSdkField;
	await new Promise<void>((resolve, reject) => {
		client.send(
			new ListFunctionsCommand({}),
			{ requestTimeout: 1234 },
			(error: unknown, result) => {
				if (error) {
					reject(error);
					return;
				}
				expect(result?.Functions?.[0]?.FunctionName).toBe("fixture");
				// @ts-expect-error Callback result also retains its SDK type.
				void result?.NotAnSdkField;
				resolve();
			},
		);
	});
	expect(destroyed).toBe(2);
	f.controller.abort();
	await new Promise<void>((resolve, reject) => {
		client.send(new ListFunctionsCommand({}), (error: unknown, result) => {
			if (!error) {
				reject(new Error("callback error was not delivered"));
				return;
			}
			expect(result).toBeUndefined();
			resolve();
		});
	});
	expect(destroyed).toBe(2);
});

test("cancelled commands queued behind credential checking never construct or dispatch clients", async () => {
	const f = await fixture();
	const operation = new AbortController();
	let requests = 0;
	let ready: () => void = () => {};
	const started = new Promise<void>((resolve) => {
		ready = resolve;
	});
	f.pauseResolution(() => {
		ready();
		return new Promise(() => {});
	});
	const client = sts(
		f.context,
		{
			async handle() {
				requests++;
				return stsResponse();
			},
		},
		undefined,
		operation.signal,
	);
	const outcomes = Promise.allSettled([
		client.send(new GetCallerIdentityCommand({})),
		client.send(new GetCallerIdentityCommand({})),
	]);
	await started;
	operation.abort();
	expect((await outcomes).map((result) => result.status)).toEqual([
		"rejected",
		"rejected",
	]);
	expect(requests).toBe(0);
	f.pauseResolution();
	await sts(f.context, {
		async handle() {
			requests++;
			return stsResponse();
		},
	}).send(new GetCallerIdentityCommand({}));
	expect(requests).toBe(1);
});

test("parallel real Lambda tag calls stop on identity invalidation, including in-flight transport", async () => {
	const f = await fixture();
	let requests = 0;
	let destroyed = 0;
	let aborted = 0;
	let allStarted: () => void = () => {};
	let allCleaned: () => void = () => {};
	const started = new Promise<void>((resolve) => {
		allStarted = resolve;
	});
	const cleaned = new Promise<void>((resolve) => {
		allCleaned = resolve;
	});
	const handler = {
		async handle(request: HttpRequest, options?: HttpHandlerOptions) {
			requests++;
			const signal = options?.abortSignal;
			if (!(signal instanceof AbortSignal))
				throw new Error("missing combined signal");
			expect(signal.aborted).toBe(false);
			expect(f.context.signal.aborted).toBe(false);
			if (!request.path.includes("/tags/"))
				return jsonResponse({
					Functions: Array.from({ length: 12 }, (_, index) => ({
						FunctionName: `fixture-${index}`,
						FunctionArn: `arn:aws:lambda:${REGION}:${ACCOUNT}:function:fixture-${index}`,
					})),
				});
			if (requests === 11) allStarted();
			return new Promise<{ response: HttpResponse }>((_resolve, reject) => {
				signal.addEventListener(
					"abort",
					() => {
						aborted++;
						reject(signal.reason);
					},
					{ once: true },
				);
			});
		},
		destroy() {
			if (++destroyed === 11) allCleaned();
		},
	};
	const scan = f.context.scanProject({
		exec: async () => {
			throw new Error("no assembly");
		},
		services: ["lambda"],
		requestHandler: handler,
	});
	const settled = Promise.allSettled([scan]);
	async function within(work: Promise<unknown>, phase: string) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				work,
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(
						() =>
							reject(
								new Error(
									`Fixture deadline at ${phase}: requests=${requests} destroyed=${destroyed} aborted=${aborted}`,
								),
							),
						1000,
					);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
	}
	try {
		await within(started, "all tags started");
		f.changeRole();
		const invalidated = Promise.allSettled([f.context.checkedCredentials()]);
		await within(invalidated, "identity invalidation");
		expect((await invalidated)[0]?.status).toBe("rejected");
		const countAtInvalidation = requests;
		await within(Promise.all([settled, cleaned]), "all clients destroyed");
		expect((await settled)[0]?.status).toBe("rejected");
		await expect(
			createCheckedLambdaClient(f.context, handler).send(
				new ListFunctionsCommand({}),
			),
		).rejects.toThrow();
		expect(requests).toBe(countAtInvalidation);
		expect(requests).toBe(11);
		expect(aborted).toBe(10);
		expect(destroyed).toBe(11);
		expect(f.context.signal.aborted).toBe(true);
	} finally {
		f.controller.abort();
		await settled;
	}
});

test("ordinary service denial still reports production coverage rather than invalidating identity", async () => {
	const f = await fixture();
	const result = await f.context.scanProject({
		exec: async () => {
			throw new Error("no assembly");
		},
		services: ["lambda"],
		requestHandler: {
			async handle() {
				return jsonResponse(
					{ __type: "AccessDeniedException", message: "fixture denied" },
					403,
				);
			},
		},
	});
	expect(result.report.coverage.denied).toBe(1);
	expect(f.context.signal.aborted).toBe(false);
});
