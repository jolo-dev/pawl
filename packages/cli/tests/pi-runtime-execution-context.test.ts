import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fromIni } from "@aws-sdk/credential-providers";
import {
	type CredentialSnapshot,
	createExecutionContext,
	createStsIdentityClient,
	type ExecutionContextDependencies,
} from "../src/pi-runtime/execution-context";

const directories: string[] = [];
const project = () => {
	const path = mkdtempSync(join(tmpdir(), "pawl-context-test-"));
	directories.push(path);
	return path;
};
afterEach(() => {
	for (const path of directories.splice(0))
		rmSync(path, { recursive: true, force: true });
});
const ACCOUNT = "123456789012";
const REGION = "eu-central-1";
const NOW = 1_800_000_000_000;
const credentials = (key = "selected-key", expires = NOW + 3_600_000) => ({
	accessKeyId: key,
	secretAccessKey: "selected-secret",
	sessionToken: "selected-token",
	expiration: new Date(expires),
});
const caller = (
	role = "SelectedRole",
	session = "session-1",
	account = ACCOUNT,
	partition = "aws",
) => ({
	Account: account,
	Arn: `arn:${partition}:sts::${account}:assumed-role/${role}/${session}`,
});
function fixture() {
	let current = credentials();
	let identity: { Account?: string; Arn?: string } = caller();
	let time = NOW;
	let resolves = 0;
	let destroys = 0;
	const checks: CredentialSnapshot[] = [];
	const factoryOptions: unknown[] = [];
	const dependencies: ExecutionContextDependencies = {
		credentialsFromIni(options) {
			factoryOptions.push(options);
			return async () => {
				resolves++;
				return current;
			};
		},
		identityClient(config) {
			expect(config.region).toBe(REGION);
			checks.push(config.credentials);
			return {
				async identify(signal) {
					signal.throwIfAborted();
					return identity;
				},
				destroy() {
					destroys++;
				},
			};
		},
		now: () => time,
	};
	return {
		dependencies,
		checks,
		factoryOptions,
		setCredentials(value: typeof current) {
			current = value;
		},
		setIdentity(value: typeof identity) {
			identity = value;
		},
		setTime(value: number) {
			time = value;
		},
		get resolves() {
			return resolves;
		},
		get destroys() {
			return destroys;
		},
		create: (signal?: AbortSignal) =>
			createExecutionContext(
				{ projectDir: project(), profile: "selected", region: REGION, signal },
				dependencies,
			),
	};
}

describe("createExecutionContext", () => {
	test("requires explicit project/profile/region and a real project directory", async () => {
		const f = fixture();
		for (const field of ["projectDir", "profile", "region"] as const) {
			await expect(
				createExecutionContext(
					{
						projectDir: project(),
						profile: "selected",
						region: REGION,
						[field]: "",
					},
					f.dependencies,
				),
			).rejects.toThrow();
		}
		await expect(
			createExecutionContext(
				{
					projectDir: join(project(), "missing"),
					profile: "selected",
					region: REGION,
				},
				f.dependencies,
			),
		).rejects.toThrow();
		expect(f.resolves).toBe(0);
	});

	test("real fromIni selects fixture profile over conflicting ambient credentials", async () => {
		const f = fixture();
		const directory = project();
		const filepath = join(directory, "credentials");
		const configFilepath = join(directory, "config");
		writeFileSync(
			filepath,
			"[selected]\naws_access_key_id = selected-key\naws_secret_access_key = selected-secret\n[default]\naws_access_key_id = wrong-key\naws_secret_access_key = wrong-secret\n",
		);
		writeFileSync(configFilepath, "[profile selected]\nregion = us-west-2\n");
		f.dependencies.credentialsFromIni = (options) =>
			fromIni({ ...options, filepath, configFilepath });
		const ambient = {
			AWS_PROFILE: "default",
			AWS_ACCESS_KEY_ID: "ambient-key",
			AWS_SECRET_ACCESS_KEY: "ambient-secret",
			AWS_SESSION_TOKEN: "ambient-token",
			AWS_REGION: "us-east-1",
			AWS_BEARER_TOKEN_BEDROCK: "ambient-bearer",
		};
		const previous = Object.fromEntries(
			Object.keys(ambient).map((key) => [key, process.env[key]]),
		);
		try {
			Object.assign(process.env, ambient);
			const context = await f.create();
			const snapshot = await context.checkedCredentials();
			expect(snapshot.accessKeyId).toBe("selected-key");
			expect(snapshot.secretAccessKey).toBe("selected-secret");
			expect(snapshot.sessionToken).toBeUndefined();
			expect(context.region).toBe(REGION);
		} finally {
			for (const [key, value] of Object.entries(previous)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});

	test("canonicalizes project and explicitly selects profile and region", async () => {
		const f = fixture();
		const target = project();
		const link = join(project(), "link ");
		symlinkSync(target, link);
		const context = await createExecutionContext(
			{ projectDir: link, profile: "selected", region: REGION },
			f.dependencies,
		);
		expect(context.projectDir).toBe(realpathSync(target));
		expect(context.profile).toBe("selected");
		expect(context.region).toBe(REGION);
		expect(f.factoryOptions).toEqual([
			{
				profile: "selected",
				clientConfig: { ignoreConfiguredEndpointUrls: true },
				ignoreCache: true,
				roleAssumerWithWebIdentity: expect.any(Function),
			},
		]);
		expect(context.identity).toEqual({
			accountId: ACCOUNT,
			partition: "aws",
			principalArn: `arn:aws:iam::${ACCOUNT}:role/SelectedRole`,
		});
		expect(Object.isFrozen(context)).toBe(true);
		expect(Object.isFrozen(context.identity)).toBe(true);
	});

	test("real STS SDK signs with the frozen snapshot without independent resolution or network", async () => {
		const f = fixture();
		let requests = 0;
		let checked: CredentialSnapshot | undefined;
		f.dependencies.identityClient = (config) => {
			checked = config.credentials;
			return createStsIdentityClient(config, {
				async handle(request: {
					hostname: string;
					headers: Record<string, string>;
				}) {
					requests++;
					expect(request.hostname).toBe(`sts.${REGION}.amazonaws.com`);
					expect(request.headers.authorization).toContain(
						"Credential=selected-key/",
					);
					expect(request.headers.authorization).toContain(
						`/${REGION}/sts/aws4_request`,
					);
					expect(request.headers["x-amz-security-token"]).toBe(
						"selected-token",
					);
					return {
						response: {
							statusCode: 200,
							headers: { "content-type": "text/xml" },
							body: new TextEncoder().encode(
								`<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Arn>${caller().Arn}</Arn><Account>${ACCOUNT}</Account><UserId>fixture-user</UserId></GetCallerIdentityResult><ResponseMetadata><RequestId>fixture-request</RequestId></ResponseMetadata></GetCallerIdentityResponse>`,
							),
						},
					};
				},
			});
		};
		const context = await f.create();
		expect(requests).toBe(1);
		expect(f.resolves).toBe(1);
		expect(Object.isFrozen(checked)).toBe(true);
		expect(checked).toEqual(credentials());
		expect(checked).toBe(await context.sdkConfig().credentials());
		expect(context.identity.accountId).toBe(ACCOUNT);
		expect(requests).toBe(1);
		expect(f.resolves).toBe(1);
	});

	test("passes the exact immutable STS-checked snapshot to an SDK operation", async () => {
		const f = fixture();
		const source = credentials();
		f.setCredentials(source);
		const context = await f.create();
		const sdk = context.sdkConfig();
		expect(sdk.region).toBe(REGION);
		const operationCredentials = await sdk.credentials();
		expect(f.checks[0]).toBe(operationCredentials);
		expect(Object.isFrozen(operationCredentials)).toBe(true);
		expect(operationCredentials).not.toBe(source);
		source.secretAccessKey = "mutated-source";
		source.expiration.setTime(0);
		operationCredentials.expiration?.setTime(0);
		expect(operationCredentials.secretAccessKey).toBe("selected-secret");
		expect(operationCredentials.expiration?.getTime()).toBe(NOW + 3_600_000);
		expect(f.checks).toHaveLength(1);
		expect(f.destroys).toBe(1);
		expect(JSON.stringify(context)).not.toContain("selected-secret");
	});

	for (const identity of [
		{ Arn: caller().Arn },
		{ Account: ACCOUNT },
		{ Account: "", Arn: "" },
		{ Account: "999999999999", Arn: caller().Arn },
		{
			Account: ACCOUNT,
			Arn: `arn:aws:sts::${ACCOUNT}:assumed-role/role/path/session`,
		},
		{ Account: ACCOUNT, Arn: `arn:aws:sts::${ACCOUNT}:federated-user/name` },
	]) {
		test(`fails closed for missing or ambiguous identity: ${JSON.stringify(identity)}`, async () => {
			const f = fixture();
			f.setIdentity(identity);
			await expect(f.create()).rejects.toThrow();
			expect(f.destroys).toBe(1);
		});
	}

	test("accepts stable IAM user identity without stripping its path", async () => {
		const f = fixture();
		const arn = `arn:aws:iam::${ACCOUNT}:user/team/user`;
		f.setIdentity({ Account: ACCOUNT, Arn: arn });
		expect((await f.create()).identity.principalArn).toBe(arn);
	});

	test("revalidates refresh, tolerating only assumed-role session rotation", async () => {
		const f = fixture();
		const context = await f.create();
		f.setCredentials(credentials("refreshed"));
		f.setIdentity(caller("SelectedRole", "session-2"));
		const snapshot = await context.refreshCredentials();
		expect(snapshot.accessKeyId).toBe("refreshed");
		expect(f.checks[1]).toBe(snapshot);
		expect(context.signal.aborted).toBe(false);
		await context.checkedCredentials();
		expect(f.checks).toHaveLength(2);
	});

	for (const field of [
		"secretAccessKey",
		"sessionToken",
		"expiration",
	] as const) {
		test(`fingerprint includes ${field}`, async () => {
			const f = fixture();
			const context = await f.create();
			const next = credentials();
			if (field === "expiration") next.expiration = new Date(NOW + 7_200_000);
			else next[field] = "rotated";
			f.setCredentials(next);
			await context.refreshCredentials();
			expect(f.checks).toHaveLength(2);
		});
	}

	for (const identity of [
		caller("OtherRole"),
		caller("SelectedRole", "s2", "999999999999"),
		caller("SelectedRole", "s2", ACCOUNT, "aws-cn"),
		{ Account: ACCOUNT },
	]) {
		test(`invalidates all future work on incompatible refresh: ${JSON.stringify(identity)}`, async () => {
			const f = fixture();
			const context = await f.create();
			f.setCredentials(credentials("changed"));
			f.setIdentity(identity);
			await expect(context.refreshCredentials()).rejects.toThrow();
			expect(context.signal.aborted).toBe(true);
			f.setIdentity(caller());
			f.setCredentials(credentials());
			await expect(context.sdkConfig().credentials()).rejects.toThrow();
			expect(f.checks).toHaveLength(2);
		});
	}

	test("refuses expired snapshots before STS and after cached validation expires", async () => {
		const f = fixture();
		f.setCredentials(credentials("expired", NOW));
		await expect(f.create()).rejects.toThrow(/expired/i);
		expect(f.checks).toHaveLength(0);
		f.setCredentials(credentials());
		const context = await f.create();
		f.setTime(NOW + 3_600_000);
		await expect(context.checkedCredentials()).rejects.toThrow(/expired/i);
		expect(f.checks).toHaveLength(1);
	});

	test("rechecks expiry after STS completes", async () => {
		const f = fixture();
		f.dependencies.identityClient = () => ({
			async identify() {
				f.setTime(NOW + 3_600_000);
				return caller();
			},
			destroy() {},
		});
		await expect(f.create()).rejects.toThrow(/expired/i);
	});

	test("does not cache a failed STS check", async () => {
		const f = fixture();
		const context = await f.create();
		f.setCredentials(credentials("new"));
		const original = f.dependencies.identityClient;
		f.dependencies.identityClient = () => ({
			async identify() {
				throw new Error("offline STS failure");
			},
			destroy() {},
		});
		await expect(context.refreshCredentials()).rejects.toThrow();
		f.dependencies.identityClient = original;
		await context.checkedCredentials();
		expect(f.checks).toHaveLength(2);
	});

	test("aborts pending credential resolution without starting STS", async () => {
		const f = fixture();
		const controller = new AbortController();
		f.dependencies.credentialsFromIni = () => () => new Promise(() => {});
		const pending = f.create(controller.signal);
		controller.abort();
		await expect(pending).rejects.toThrow();
		expect(f.checks).toHaveLength(0);
	});

	test("concurrent credential checks share one identity validation", async () => {
		const f = fixture();
		const context = await f.create();
		f.setCredentials(credentials("next"));
		const snapshots = await Promise.all(
			Array.from({ length: 5 }, () => context.refreshCredentials()),
		);
		expect(f.checks).toHaveLength(2);
		for (const snapshot of snapshots) expect(f.checks[1]).toBe(snapshot);
	});

	test("cancellation destroys a pending STS client and never returns its late identity", async () => {
		const f = fixture();
		const operation = new AbortController();
		const context = await f.create(operation.signal);
		f.setCredentials(credentials("next"));
		let destroyed = false;
		f.dependencies.identityClient = () => ({
			async identify(signal) {
				operation.abort();
				signal.throwIfAborted();
				return caller();
			},
			destroy() {
				destroyed = true;
			},
		});
		await expect(
			context.refreshCredentials(operation.signal),
		).rejects.toThrow();
		expect(destroyed).toBe(true);
	});

	test("operation cancellation leaves the context usable; context cancellation does not", async () => {
		const f = fixture();
		const parent = new AbortController();
		const context = await f.create(parent.signal);
		const operation = new AbortController();
		operation.abort();
		await expect(
			context.checkedCredentials(operation.signal),
		).rejects.toThrow();
		expect(context.signal.aborted).toBe(false);
		await context.checkedCredentials();
		parent.abort();
		await expect(context.checkedCredentials()).rejects.toThrow();
	});
});

describe("checked child environment", () => {
	const ambient = {
		PATH: "/ordinary/bin",
		HOME: "/ordinary/home",
		KEEP: "value",
		AWS_PROFILE: "wrong",
		AWS_DEFAULT_PROFILE: "wrong",
		AWS_REGION: "wrong",
		AWS_DEFAULT_REGION: "wrong",
		AWS_ACCESS_KEY_ID: "wrong",
		AWS_SECRET_ACCESS_KEY: "wrong",
		AWS_SESSION_TOKEN: "wrong",
		AWS_BEARER_TOKEN_BEDROCK: "wrong",
		AWS_CONFIG_FILE: "/wrong",
		AWS_SHARED_CREDENTIALS_FILE: "/wrong",
		AWS_WEB_IDENTITY_TOKEN_FILE: "/wrong",
		AWS_ROLE_ARN: "wrong",
		AWS_ENDPOINT_URL: "wrong",
		AWS_CONTAINER_CREDENTIALS_FULL_URI: "wrong",
		AWS_CUSTOM_SETTING: "wrong",
		CDK_DEFAULT_ACCOUNT: "wrong",
		CDK_DEFAULT_REGION: "wrong",
	};
	test("isolates credentials/config with private temporary files and cleans on success", async () => {
		const f = fixture();
		const context = await f.create();
		let directory = "";
		const before = { ...ambient };
		const result = await context.withChildEnvironment(
			{ timeoutMs: 1000, args: [], env: ambient },
			async ({ env, signal }) => {
				signal.throwIfAborted();
				expect(env.PATH).toBe(ambient.PATH);
				expect(env.HOME).toBe(ambient.HOME);
				expect(env.KEEP).toBe("value");
				expect(Object.values(env)).not.toContain("wrong");
				expect(env.AWS_ACCESS_KEY_ID).toBe(f.checks[0]?.accessKeyId);
				expect(env.AWS_SECRET_ACCESS_KEY).toBe(f.checks[0]?.secretAccessKey);
				expect(env.AWS_SESSION_TOKEN).toBe(f.checks[0]?.sessionToken);
				expect(env.AWS_REGION).toBe(REGION);
				expect(env.AWS_DEFAULT_REGION).toBe(REGION);
				expect(env.CDK_DEFAULT_REGION).toBe(REGION);
				expect(env.CDK_DEFAULT_ACCOUNT).toBe(ACCOUNT);
				const config = env.AWS_CONFIG_FILE as string;
				const shared = env.AWS_SHARED_CREDENTIALS_FILE as string;
				directory = dirname(config);
				expect(directory.startsWith(context.projectDir)).toBe(false);
				expect(statSync(directory).mode & 0o777).toBe(0o700);
				for (const path of [config, shared])
					expect(statSync(path).mode & 0o777).toBe(0o600);
				expect(readFileSync(config, "utf8")).toBe(
					`[default]\nregion = ${REGION}\n`,
				);
				expect(readFileSync(shared, "utf8")).toContain(
					"aws_access_key_id = selected-key",
				);
				expect(readFileSync(shared, "utf8")).not.toMatch(
					/credential_process|role_arn|source_profile/,
				);
				expect(env.AWS_PROFILE).toBe("default");
				return "result";
			},
		);
		expect(result).toBe("result");
		expect(ambient).toEqual(before);
		expect(existsSync(directory)).toBe(false);
	});

	test("refuses a temporary credential location inside the selected project", async () => {
		const f = fixture();
		const context = await createExecutionContext(
			{ projectDir: tmpdir(), profile: "selected", region: REGION },
			f.dependencies,
		);
		await expect(
			context.withChildEnvironment(
				{ timeoutMs: 1000, args: [] },
				async () => {},
			),
		).rejects.toThrow(/outside/i);
	});

	test("the real SDK profile reader resolves only the child snapshot files", async () => {
		const context = await fixture().create();
		await context.withChildEnvironment(
			{ timeoutMs: 1000, args: [], env: ambient },
			async ({ env }) => {
				const provider = fromIni({
					profile: env.AWS_PROFILE,
					filepath: env.AWS_SHARED_CREDENTIALS_FILE,
					configFilepath: env.AWS_CONFIG_FILE,
				});
				const snapshot = await provider();
				expect(snapshot.accessKeyId).toBe("selected-key");
				expect(snapshot.secretAccessKey).toBe("selected-secret");
				expect(snapshot.sessionToken).toBe("selected-token");
			},
		);
	});

	test("static credentials omit ambient tokens; temporary credentials require known expiration", async () => {
		const f = fixture();
		f.dependencies.credentialsFromIni = () => async () => ({
			accessKeyId: "static",
			secretAccessKey: "secret",
		});
		const context = await f.create();
		await context.withChildEnvironment(
			{ timeoutMs: 1000, args: [], env: ambient },
			async ({ env }) => {
				expect(env.AWS_SESSION_TOKEN).toBeUndefined();
				expect(
					readFileSync(env.AWS_SHARED_CREDENTIALS_FILE as string, "utf8"),
				).not.toContain("aws_session_token");
			},
		);
		f.dependencies.credentialsFromIni = () => async () => ({
			accessKeyId: "temporary",
			secretAccessKey: "secret",
			sessionToken: "token",
		});
		const temporary = await f.create();
		await expect(
			temporary.withChildEnvironment(
				{ timeoutMs: 1000, args: [] },
				async () => {},
			),
		).rejects.toThrow(/lifetime/i);
	});

	for (const outcome of ["failure", "abort", "timeout"] as const) {
		test(`cleans private files on ${outcome}`, async () => {
			const f = fixture();
			const context = await f.create();
			const controller = new AbortController();
			let directory = "";
			let childSignal: AbortSignal | undefined;
			await expect(
				context.withChildEnvironment(
					{
						timeoutMs: outcome === "timeout" ? 20 : 1000,
						args: [],
						signal: controller.signal,
					},
					async ({ env, signal }) => {
						directory = dirname(env.AWS_CONFIG_FILE as string);
						childSignal = signal;
						if (outcome === "failure") throw new Error("fixture failure");
						if (outcome === "abort") controller.abort();
						return new Promise(() => {});
					},
				),
			).rejects.toThrow();
			expect(existsSync(directory)).toBe(false);
			if (outcome !== "failure") expect(childSignal?.aborted).toBe(true);
		});
	}

	test("refreshes insufficient lifetime once before invoking child", async () => {
		const f = fixture();
		const context = await f.create();
		f.setCredentials(credentials("short", NOW + 60_999));
		await context.refreshCredentials();
		const resolutions = f.resolves;
		// A selected profile provider can return fresh credentials on its next resolution.
		f.setCredentials(credentials("long"));
		await context.withChildEnvironment(
			{ timeoutMs: 1000, args: [] },
			async ({ env }) => {
				expect(env.AWS_ACCESS_KEY_ID).toBe("long");
			},
		);
		expect(f.resolves - resolutions).toBe(1);
	});

	test("refuses insufficient lifetime when refresh cannot cover timeout plus 60 seconds", async () => {
		const f = fixture();
		const context = await f.create();
		f.setCredentials(credentials("short", NOW + 60_999));
		await context.refreshCredentials();
		let invoked = false;
		await expect(
			context.withChildEnvironment({ timeoutMs: 1000, args: [] }, async () => {
				invoked = true;
			}),
		).rejects.toThrow(/lifetime/i);
		expect(invoked).toBe(false);
	});

	for (const args of [
		["--profile", "other"],
		["--profile=selected"],
		["--role-arn", `arn:aws:iam::${ACCOUNT}:role/other`],
		["-r", `arn:aws:iam::${ACCOUNT}:role/other`],
	]) {
		test(`rejects explicit profile/role flags: ${args[0]}`, async () => {
			const context = await fixture().create();
			let invoked = false;
			await expect(
				context.withChildEnvironment({ timeoutMs: 1000, args }, async () => {
					invoked = true;
				}),
			).rejects.toThrow();
			expect(invoked).toBe(false);
		});
	}
	for (const account of [ACCOUNT, "999999999999"]) {
		test(`rejects unapproved role targets in account ${account}`, async () => {
			const context = await fixture().create();
			await expect(
				context.withChildEnvironment(
					{
						timeoutMs: 1000,
						args: [],
						assumeRoleArn: `arn:aws:iam::${account}:role/other`,
					},
					async () => {},
				),
			).rejects.toThrow();
		});
	}
	for (const timeoutMs of [0, -1, Infinity, NaN, 2_147_483_648]) {
		test(`requires bounded positive timeout: ${timeoutMs}`, async () => {
			const context = await fixture().create();
			await expect(
				context.withChildEnvironment({ timeoutMs, args: [] }, async () => {}),
			).rejects.toThrow();
		});
	}
});

describe("checked project scan adapter", () => {
	test("injects project, region and checked credentials into the real shared scan", async () => {
		const f = fixture();
		const context = await f.create();
		const sdkSnapshots: CredentialSnapshot[] = [];
		const paths: string[] = [];
		const outcome = await context.scanProject({
			exec: async (_command, args) => {
				paths.push(...args);
				throw new Error("fixture project has no assembly");
			},
			scannerFactories: [
				({ accountId, region, credentials: provider }) => {
					expect(accountId).toBe(ACCOUNT);
					expect(region).toBe(REGION);
					return {
						service: "s3",
						async scan() {
							sdkSnapshots.push(await provider());
							return [];
						},
					};
				},
			],
		});
		expect(outcome.report.accountId).toBe(ACCOUNT);
		expect(outcome.report.region).toBe(REGION);
		expect(sdkSnapshots[0]).toBe(f.checks[0]);
		expect(paths.every((path) => path.startsWith(context.projectDir))).toBe(
			true,
		);
	});

	test("rejects missing injected executor even when there is no CDK project", async () => {
		const context = await fixture().create();
		// @ts-expect-error Deliberately exercise an untyped caller missing required execution.
		await expect(context.scanProject({ scannerFactories: [] })).rejects.toThrow(
			/executor/i,
		);
	});

	test("scan fails closed when the shared scanner records identity failure as coverage", async () => {
		const f = fixture();
		const context = await f.create();
		await expect(
			context.scanProject({
				exec: async () => {
					throw new Error("no assembly");
				},
				scannerFactories: [
					({ credentials: provider }) => ({
						service: "s3",
						async scan() {
							f.setCredentials(credentials("new"));
							f.setIdentity(caller("OtherRole"));
							await context.refreshCredentials();
							await provider();
							return [];
						},
					}),
				],
			}),
		).rejects.toThrow();
		expect(context.signal.aborted).toBe(true);
	});
});
