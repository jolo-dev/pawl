import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { fromIni } from "@aws-sdk/credential-providers";
import {
	type HttpHandlerOptions,
	type HttpRequest,
	HttpResponse,
} from "@smithy/core/protocols";
import { createCheckedLambdaClient } from "../src/pi-runtime/checked-scanners";
import {
	type CredentialSnapshot,
	createExecutionContext,
} from "../src/pi-runtime/execution-context";

const directories: string[] = [];
afterEach(() => {
	for (const path of directories.splice(0))
		rmSync(path, { recursive: true, force: true });
});
const ACCOUNT = "123456789012";
const REGION = "eu-central-1";
const FIVE_MINUTES = 300_000;
function directory() {
	const path = mkdtempSync(join(tmpdir(), "pawl-lease-"));
	directories.push(path);
	return path;
}
const response = () => ({
	response: new HttpResponse({
		statusCode: 200,
		headers: { "content-type": "application/json" },
		body: new TextEncoder().encode('{"Functions":[]}'),
	}),
});
async function roleFixture() {
	const dir = directory();
	const filepath = join(dir, "credentials");
	const configFilepath = join(dir, "config");
	writeFileSync(
		filepath,
		"[source]\naws_access_key_id = fixture-source\naws_secret_access_key = fixture-secret\n",
		{ mode: 0o600 },
	);
	writeFileSync(
		configFilepath,
		`[profile selected]\nrole_arn = arn:aws:iam::${ACCOUNT}:role/FixtureRole\nsource_profile = source\n`,
		{ mode: 0o600 },
	);
	let time = Date.now();
	let issued = 0;
	let role = "FixtureRole";
	let fail = false;
	let lifetime = 3_600_000;
	let gate: (() => Promise<void>) | undefined;
	const checked: CredentialSnapshot[] = [];
	const context = await createExecutionContext(
		{ projectDir: dir, profile: "selected", region: REGION },
		{
			credentialsFromIni: (options) =>
				fromIni({
					...options,
					filepath,
					configFilepath,
					roleAssumer: async (source, params) => {
						expect(source.accessKeyId).toBe("fixture-source");
						expect(params.RoleArn).toBe(
							`arn:aws:iam::${ACCOUNT}:role/FixtureRole`,
						);
						issued++;
						await gate?.();
						if (fail) throw new Error("fixture issuance failure");
						return {
							accessKeyId: `fixture-key-${issued}`,
							secretAccessKey: `fixture-secret-${issued}`,
							sessionToken: `fixture-token-${issued}`,
							expiration: new Date(time + lifetime),
						};
					},
				}),
			identityClient: ({ credentials }) => {
				checked.push(credentials);
				return {
					identify: async () => ({
						Account: ACCOUNT,
						Arn: `arn:aws:sts::${ACCOUNT}:assumed-role/${role}/session-${issued}`,
					}),
					destroy() {},
				};
			},
			now: () => time,
		},
	);
	return {
		context,
		checked,
		get issued() {
			return issued;
		},
		advance(ms: number) {
			time += ms;
		},
		changeRole() {
			role = "OtherRole";
		},
		fail(value: boolean) {
			fail = value;
		},
		lifetime(ms: number) {
			lifetime = ms;
		},
		gate(value?: () => Promise<void>) {
			gate = value;
		},
	};
}

test("real issuing fromIni profile supports sequential and concurrent guarded commands with one issuance", async () => {
	const f = await roleFixture();
	const signing: string[] = [];
	let destroys = 0;
	const handler = {
		async handle(request: HttpRequest) {
			signing.push(request.headers.authorization ?? "");
			expect(request.headers["x-amz-security-token"]).toBe("fixture-token-1");
			return response();
		},
		destroy() {
			destroys++;
		},
	};
	const client = createCheckedLambdaClient(f.context, handler);
	await client.send(new ListFunctionsCommand({}));
	await client.send(new ListFunctionsCommand({}));
	await Promise.all(
		Array.from({ length: 4 }, () => client.send(new ListFunctionsCommand({}))),
	);
	expect(signing).toHaveLength(6);
	for (const authorization of signing)
		expect(authorization).toContain("Credential=fixture-key-1/");
	expect(f.issued).toBe(1);
	expect(f.checked).toHaveLength(1);
	expect(destroys).toBe(6);
	expect(f.checked[0]).toBe(await f.context.checkedCredentials());
});

test("timed acquisition refresh coalesces and guards never issue another role", async () => {
	const f = await roleFixture();
	const old = await f.context.checkedCredentials();
	const oldLease = f.context.credentialLease(old);
	try {
		f.advance(FIVE_MINUTES);
		expect(() => oldLease.validate()).toThrow(/lease/i);
		const refreshed = await Promise.all(
			Array.from({ length: 5 }, () => f.context.checkedCredentials()),
		);
		expect(f.issued).toBe(2);
		expect(f.checked).toHaveLength(2);
		for (const snapshot of refreshed) expect(f.checked[1]).toBe(snapshot);
		const snapshot = refreshed[0];
		if (!snapshot) throw new Error("missing refreshed snapshot");
		const lease = f.context.credentialLease(snapshot);
		try {
			for (let i = 0; i < 5; i++) lease.validate();
			expect(f.issued).toBe(2);
		} finally {
			lease.dispose();
		}
		expect(oldLease.signal.aborted).toBe(true);
		expect(f.context.signal.aborted).toBe(false);
	} finally {
		oldLease.dispose();
	}
});

test("explicit refresh retires immediately and coalesces; successful same-role session rotation is allowed", async () => {
	const f = await roleFixture();
	const lease = f.context.credentialLease(await f.context.checkedCredentials());
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	f.gate(() => gate);
	try {
		const first = f.context.refreshCredentials();
		const second = f.context.refreshCredentials();
		expect(lease.signal.aborted).toBe(true);
		expect(() => lease.validate()).toThrow();
		release();
		const [a, b] = await Promise.all([first, second]);
		expect(a).toBe(b);
		expect(f.issued).toBe(2);
		expect(f.context.identity.principalArn).toBe(
			`arn:aws:iam::${ACCOUNT}:role/FixtureRole`,
		);
	} finally {
		release();
		lease.dispose();
	}
});

test("failed refresh cannot restore a retired generation, and incompatible identity permanently aborts", async () => {
	const f = await roleFixture();
	const old = await f.context.checkedCredentials();
	const lease = f.context.credentialLease(old);
	try {
		f.fail(true);
		await expect(f.context.refreshCredentials()).rejects.toThrow(
			"fixture issuance failure",
		);
		expect(lease.signal.aborted).toBe(true);
		expect(() => f.context.credentialLease(old)).toThrow();
		await expect(f.context.checkedCredentials()).rejects.toThrow(
			"fixture issuance failure",
		);
		f.fail(false);
		f.changeRole();
		await expect(f.context.refreshCredentials()).rejects.toThrow(
			/identity changed/i,
		);
		expect(f.context.signal.aborted).toBe(true);
		await expect(f.context.checkedCredentials()).rejects.toThrow();
	} finally {
		lease.dispose();
	}
});

test("static credentials are reacquired and STS-revalidated after five minutes, even unchanged", async () => {
	let time = Date.now();
	let acquired = 0;
	let checks = 0;
	const context = await createExecutionContext(
		{ projectDir: directory(), profile: "selected", region: REGION },
		{
			credentialsFromIni: () => async () => {
				acquired++;
				return { accessKeyId: "static-key", secretAccessKey: "static-secret" };
			},
			identityClient: () => ({
				async identify() {
					checks++;
					return {
						Account: ACCOUNT,
						Arn: `arn:aws:iam::${ACCOUNT}:user/fixture`,
					};
				},
				destroy() {},
			}),
			now: () => time,
		},
	);
	const old = await context.checkedCredentials();
	const lease = context.credentialLease(old);
	try {
		time += FIVE_MINUTES - 1;
		expect(await context.checkedCredentials()).toBe(old);
		expect(acquired).toBe(1);
		time++;
		const next = await context.checkedCredentials();
		expect(next).not.toBe(old);
		expect(acquired).toBe(2);
		expect(checks).toBe(2);
		expect(lease.signal.aborted).toBe(true);
	} finally {
		lease.dispose();
	}
});

test("a stalled real SDK request is cancelled at credential expiration without refresh or replay", async () => {
	let acquired = 0;
	let requests = 0;
	let destroyed = 0;
	const context = await createExecutionContext(
		{ projectDir: directory(), profile: "selected", region: REGION },
		{
			credentialsFromIni: () => async () => {
				acquired++;
				return {
					accessKeyId: "short-key",
					secretAccessKey: "short-secret",
					expiration: new Date(Date.now() + 100),
				};
			},
			identityClient: () => ({
				async identify() {
					return {
						Account: ACCOUNT,
						Arn: `arn:aws:iam::${ACCOUNT}:user/fixture`,
					};
				},
				destroy() {},
			}),
			now: Date.now,
		},
	);
	const handler = {
		async handle(_request: HttpRequest, options?: HttpHandlerOptions) {
			requests++;
			const signal = options?.abortSignal;
			if (!(signal instanceof AbortSignal))
				throw new Error("missing native lease signal");
			return new Promise<{ response: HttpResponse }>((_resolve, reject) =>
				signal.addEventListener("abort", () => reject(signal.reason), {
					once: true,
				}),
			);
		},
		destroy() {
			destroyed++;
		},
	};
	await expect(
		createCheckedLambdaClient(context, handler).send(
			new ListFunctionsCommand({}),
		),
	).rejects.toThrow(/lease|expired/i);
	expect(requests).toBe(1);
	expect(acquired).toBe(1);
	expect(destroyed).toBe(1);
});

test("child lifetime checks explicitly refresh once and retirement cancels a running child scope", async () => {
	const f = await roleFixture();
	f.lifetime(61_000);
	await f.context.refreshCredentials();
	f.lifetime(3_600_000);
	await expect(
		f.context.withChildEnvironment(
			{ timeoutMs: 2000, args: [] },
			async ({ env, signal }) => {
				expect(env.AWS_ACCESS_KEY_ID).toBe("fixture-key-3");
				expect(f.issued).toBe(3);
				const refreshing = f.context.refreshCredentials();
				expect(signal.aborted).toBe(true);
				await refreshing;
			},
		),
	).rejects.toThrow();
});

test("real issuing profile SDK retry keeps its pinned session without another issuance", async () => {
	const f = await roleFixture();
	let requests = 0;
	const client = createCheckedLambdaClient(f.context, {
		async handle(request) {
			expect(request.headers.authorization).toContain(
				"Credential=fixture-key-1/",
			);
			if (++requests === 1) {
				const error = new Error("fixture timeout");
				error.name = "TimeoutError";
				throw error;
			}
			return response();
		},
	});
	await client.send(new ListFunctionsCommand({}));
	expect(requests).toBe(2);
	expect(f.issued).toBe(1);
	expect(f.checked).toHaveLength(1);
});

test("source identity changes are observed at explicit refresh, not by issuing a session in the guard", async () => {
	const f = await roleFixture();
	let requests = 0;
	f.changeRole();
	const client = createCheckedLambdaClient(f.context, {
		async handle() {
			requests++;
			return response();
		},
	});
	await client.send(new ListFunctionsCommand({}));
	expect(f.issued).toBe(1);
	await expect(f.context.refreshCredentials()).rejects.toThrow(
		/identity changed/i,
	);
	await expect(client.send(new ListFunctionsCommand({}))).rejects.toThrow();
	expect(requests).toBe(1);
});

test("a cancelled refresh waiter does not cancel a concurrent acquisition's shared issuance", async () => {
	const f = await roleFixture();
	const cancelled = new AbortController();
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	f.gate(() => gate);
	try {
		const first = f.context.refreshCredentials(cancelled.signal);
		const second = f.context.checkedCredentials();
		const firstResult = Promise.allSettled([first]);
		cancelled.abort();
		expect((await firstResult)[0]?.status).toBe("rejected");
		release();
		const next = await second;
		expect(next.accessKeyId).toBe("fixture-key-2");
		expect(f.issued).toBe(2);
	} finally {
		release();
	}
});

test("successful same-role refresh cancels an in-flight old generation, then a new explicit command succeeds", async () => {
	const f = await roleFixture();
	let started: () => void = () => {};
	const ready = new Promise<void>((resolve) => {
		started = resolve;
	});
	let requests = 0;
	let destroyed = 0;
	const handler = {
		async handle(request: HttpRequest, options?: HttpHandlerOptions) {
			requests++;
			if (requests > 1) {
				expect(request.headers.authorization).toContain(
					"Credential=fixture-key-2/",
				);
				return response();
			}
			const signal = options?.abortSignal;
			if (!(signal instanceof AbortSignal))
				throw new Error("missing lease signal");
			started();
			return new Promise<{ response: HttpResponse }>((_resolve, reject) =>
				signal.addEventListener("abort", () => reject(signal.reason), {
					once: true,
				}),
			);
		},
		destroy() {
			destroyed++;
		},
	};
	const client = createCheckedLambdaClient(f.context, handler);
	const settled = Promise.allSettled([
		client.send(new ListFunctionsCommand({})),
	]);
	await ready;
	await f.context.refreshCredentials();
	expect((await settled)[0]?.status).toBe("rejected");
	expect(requests).toBe(1);
	expect(destroyed).toBe(1);
	await client.send(new ListFunctionsCommand({}));
	expect(requests).toBe(2);
	expect(destroyed).toBe(2);
	expect(f.issued).toBe(2);
});

test("static SDK leases cancel in-flight work at the five-minute local reuse deadline", async () => {
	let now = Date.now();
	let acquired = 0;
	let requests = 0;
	let destroyed = 0;
	const context = await createExecutionContext(
		{ projectDir: directory(), profile: "selected", region: REGION },
		{
			credentialsFromIni: () => async () => {
				acquired++;
				return { accessKeyId: "static", secretAccessKey: "static-secret" };
			},
			identityClient: () => ({
				async identify() {
					return {
						Account: ACCOUNT,
						Arn: `arn:aws:iam::${ACCOUNT}:user/fixture`,
					};
				},
				destroy() {},
			}),
			now: () => now,
		},
	);
	now += FIVE_MINUTES - 100;
	const handler = {
		async handle(_request: HttpRequest, options?: HttpHandlerOptions) {
			requests++;
			const signal = options?.abortSignal;
			if (!(signal instanceof AbortSignal))
				throw new Error("missing deadline signal");
			return new Promise<{ response: HttpResponse }>((_resolve, reject) =>
				signal.addEventListener("abort", () => reject(signal.reason), {
					once: true,
				}),
			);
		},
		destroy() {
			destroyed++;
		},
	};
	await expect(
		createCheckedLambdaClient(context, handler).send(
			new ListFunctionsCommand({}),
		),
	).rejects.toThrow(/lease expired/i);
	expect(acquired).toBe(1);
	expect(requests).toBe(1);
	expect(destroyed).toBe(1);
});

test("a validated bounded child timeout is not shortened by an SDK lease deadline", async () => {
	const f = await roleFixture();
	const lease = f.context.credentialLease(await f.context.checkedCredentials());
	try {
		await f.context.withChildEnvironment(
			{ timeoutMs: 360_000, args: [] },
			async ({ signal }) => {
				f.advance(FIVE_MINUTES);
				expect(() => lease.validate()).toThrow(/lease expired/i);
				expect(signal.aborted).toBe(false);
				expect(f.issued).toBe(1);
			},
		);
	} finally {
		lease.dispose();
	}
});

test("actual fromIni SSO uses the private profile home region, not the workload region", async () => {
	const home = directory();
	const child = Bun.spawn(
		[process.execPath, join(import.meta.dir, "fixtures/pi-credential-sso.ts")],
		{
			env: {
				PATH: process.env.PATH,
				HOME: home,
				USERPROFILE: home,
				PAWL_FIXTURE_HOME: home,
				AWS_CONFIG_FILE: join(home, "config"),
				AWS_SHARED_CREDENTIALS_FILE: join(home, "credentials"),
				AWS_PROFILE: "wrong",
				AWS_REGION: "ap-southeast-2",
				AWS_DEFAULT_REGION: "ap-southeast-2",
				AWS_ENDPOINT_URL: "https://wrong-global.invalid",
				AWS_ENDPOINT_URL_SSO: "https://wrong-sso.invalid",
				AWS_ENDPOINT_URL_STS: "https://wrong-sts.invalid",
				AWS_ENDPOINT_URL_LAMBDA: "https://wrong-lambda.invalid",
				AWS_EC2_METADATA_DISABLED: "true",
			},
			stdout: "pipe",
			stderr: "pipe",
			timeout: 5000,
		},
	);
	const [stdout, stderr, exit] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
	const result: unknown = JSON.parse(stdout);
	expect(result).toEqual({
		endpoints: [
			"portal.sso.us-east-1.amazonaws.com",
			`sts.${REGION}.amazonaws.com`,
			`lambda.${REGION}.amazonaws.com`,
		],
		account: ACCOUNT,
		workloadRegion: REGION,
		offline: true,
	});
});
