import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	BedrockClient,
	ListFoundationModelsCommand,
} from "@aws-sdk/client-bedrock";
import {
	CreateTokenCommand,
	RegisterClientCommand,
	SSOOIDCClient,
	StartDeviceAuthorizationCommand,
} from "@aws-sdk/client-sso-oidc";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import {
	checkBedrockAccess,
	checkCredentials,
	getProfileRegion,
	isSSOTokenValid,
	listProfiles,
	ssoLogin,
} from "../src/aws-credentials";
import { defaultPromptDeps } from "../src/codecommit-init/prompts";

const sessionName = "fixture-session";
const envKeys = [
	"HOME",
	"PATH",
	"AWS_CONFIG_FILE",
	"AWS_SHARED_CREDENTIALS_FILE",
	"AWS_PROFILE",
	"AWS_DEFAULT_PROFILE",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_SESSION_TOKEN",
	"AWS_EC2_METADATA_DISABLED",
	"PAWL_TEST_BROWSER_OUTPUT",
] as const;

function mockSend(client: { readonly prototype: unknown }) {
	// Select the promise overload: Bun otherwise infers SDK send's callback
	// overload (void). Only awaited send calls are used by these helpers.
	const transport = client.prototype as {
		send(command: unknown): Promise<unknown>;
	};
	return spyOn(transport, "send").mockRejectedValue(
		new Error("Unexpected AWS transport request"),
	);
}

function mockClients() {
	// Fail closed: no test may accidentally reach an AWS transport.
	return {
		sts: mockSend(STSClient),
		bedrock: mockSend(BedrockClient),
		oidc: mockSend(SSOOIDCClient),
	};
}

describe("AWS Credentials", () => {
	let home: string;
	let cacheFile: string;
	let previousEnv: Record<string, string | undefined>;
	let clients: ReturnType<typeof mockClients>;

	beforeEach(async () => {
		previousEnv = Object.fromEntries(
			envKeys.map((key) => [key, process.env[key]]),
		);
		clients = mockClients();
		home = await mkdtemp(join(tmpdir(), "pawl-credentials-"));
		for (const key of envKeys) delete process.env[key];
		Object.assign(process.env, {
			HOME: home,
			PATH: `${join(home, "bin")}:${previousEnv.PATH ?? ""}`,
			AWS_CONFIG_FILE: join(home, "config"),
			AWS_SHARED_CREDENTIALS_FILE: join(home, "credentials"),
			AWS_EC2_METADATA_DISABLED: "true",
			PAWL_TEST_BROWSER_OUTPUT: join(home, "browser-url"),
		});
		await writeFile(
			join(home, "config"),
			`
[default]
region = us-east-1
[profile dev]
region = eu-central-1
sso_session = ${sessionName}
[profile dev.tools]
region = us-west-2
[profile services.prod]
region = us-west-1
[profile "sso-session.config"]
region = us-east-2
[services fixture-services]
ignored = true
[profile incomplete]
sso_session = missing-session
[sso-session ${sessionName}]
sso_start_url = https://example.invalid/start
sso_region = us-east-1
`,
		);
		await writeFile(
			join(home, "credentials"),
			`
[credentials-only]
aws_access_key_id = fixture-key
aws_secret_access_key = fixture-secret
[sso-session.dev]
aws_access_key_id = fixture-key
aws_secret_access_key = fixture-secret
[services.credentials]
aws_access_key_id = fixture-key
aws_secret_access_key = fixture-secret
`,
		);
		cacheFile = join(
			home,
			".aws",
			"sso",
			"cache",
			`${createHash("sha1").update(sessionName).digest("hex")}.json`,
		);
		await mkdir(join(home, "bin"));
		// Exercise the real shell call without ever launching a browser.
		const browser = join(home, "bin", "open");
		await writeFile(
			browser,
			'#!/bin/sh\nprintf "%s" "$1" > "$PAWL_TEST_BROWSER_OUTPUT"\n',
		);
		await chmod(browser, 0o700);
	});

	afterEach(async () => {
		for (const client of Object.values(clients)) client.mockRestore();
		for (const key of envKeys) {
			const value = previousEnv[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		if (home) await rm(home, { recursive: true, force: true });
	});

	it("lists profiles without exposing SSO/service sections in either CLI flow", async () => {
		const expected = [
			"credentials-only",
			"default",
			"dev",
			"dev.tools",
			"incomplete",
			"services.credentials",
			"services.prod",
			"sso-session.config",
			"sso-session.dev",
		];
		expect((await listProfiles()).sort()).toEqual(expected);
		expect((await defaultPromptDeps.listProfiles()).sort()).toEqual(expected);
	});

	it("loads profile regions and returns undefined for missing profiles", async () => {
		expect(await getProfileRegion("default")).toBe("us-east-1");
		expect(await getProfileRegion("dev")).toBe("eu-central-1");
		expect(await defaultPromptDeps.getProfileRegion("dev.tools")).toBe(
			"us-west-2",
		);
		expect(await getProfileRegion("missing")).toBeUndefined();
	});

	it.each([
		["future", "9999-01-01T00:00:00Z", true],
		["expired", "2000-01-01T00:00:00Z", false],
		["invalid", "not-a-date", false],
		["missing expiry", undefined, false],
	])("checks cached token validity: %s", async (_name, expiresAt, valid) => {
		await Bun.write(
			cacheFile,
			JSON.stringify({ accessToken: "fixture-token", expiresAt }),
		);
		expect(await isSSOTokenValid("dev")).toBe(valid);
	});

	it("rejects missing or malformed token files and profiles without SSO", async () => {
		expect(await isSSOTokenValid("dev")).toBe(false);
		expect(await isSSOTokenValid("default")).toBe(false);
		await Bun.write(cacheFile, "not JSON");
		expect(await isSSOTokenValid("dev")).toBe(false);
	});

	it("checks credentials through STS and returns the identity", async () => {
		const identity = {
			Arn: "arn:aws:iam::123456789012:user/fixture",
			Account: "123456789012",
			UserId: "fixture",
			$metadata: {},
		};
		clients.sts.mockResolvedValueOnce(identity);
		expect(await checkCredentials("dev", "eu-central-1")).toEqual(identity);
		expect(clients.sts.mock.calls[0]?.[0]).toBeInstanceOf(
			GetCallerIdentityCommand,
		);
		expect(clients.sts).toHaveBeenCalledTimes(1);
	});

	it("propagates credential errors rather than silently passing a test", async () => {
		const error = new Error("expired fixture credentials");
		clients.sts.mockRejectedValueOnce(error);
		await expect(checkCredentials("dev", "eu-central-1")).rejects.toBe(error);
	});

	it("checks Bedrock model access and reports denied access", async () => {
		clients.bedrock.mockResolvedValueOnce({
			modelSummaries: [],
			$metadata: {},
		});
		expect(await checkBedrockAccess("dev", "eu-central-1")).toBe(true);
		expect(clients.bedrock.mock.calls[0]?.[0]).toBeInstanceOf(
			ListFoundationModelsCommand,
		);
		expect(clients.bedrock.mock.calls[0]?.[0]).toMatchObject({
			input: { byOutputModality: "TEXT" },
		});
		clients.bedrock.mockRejectedValueOnce(new Error("fixture access denied"));
		expect(await checkBedrockAccess("dev", "eu-central-1")).toBe(false);
	});

	it("rejects missing SSO configuration without opening a browser", async () => {
		await expect(ssoLogin("default")).rejects.toThrow(
			'Profile "default" has no sso_session',
		);
		await expect(ssoLogin("incomplete")).rejects.toThrow(
			'SSO session "missing-session" missing sso_start_url or sso_region',
		);
		expect(clients.oidc).not.toHaveBeenCalled();
		expect(await Bun.file(join(home, "browser-url")).exists()).toBe(false);
	});

	function startDeviceAuthorization() {
		clients.oidc
			.mockResolvedValueOnce({
				clientId: "fixture-client",
				clientSecret: "fixture-client-secret",
				$metadata: {},
			})
			.mockResolvedValueOnce({
				verificationUriComplete: "https://example.invalid/verify",
				deviceCode: "fixture-device",
				interval: 0,
				$metadata: {},
			});
	}

	it("completes device authorization and caches the token only in the fixture home", async () => {
		startDeviceAuthorization();
		clients.oidc
			.mockRejectedValueOnce(
				Object.assign(new Error("pending"), {
					name: "AuthorizationPendingException",
				}),
			)
			.mockResolvedValueOnce({
				accessToken: "fixture-token",
				expiresIn: 600,
				$metadata: {},
			});
		const before = Date.now();
		await ssoLogin("dev");
		expect(await Bun.file(join(home, "browser-url")).text()).toBe(
			"https://example.invalid/verify",
		);
		expect(clients.oidc.mock.calls[0]?.[0]).toBeInstanceOf(
			RegisterClientCommand,
		);
		expect(clients.oidc.mock.calls[1]?.[0]).toBeInstanceOf(
			StartDeviceAuthorizationCommand,
		);
		expect(clients.oidc.mock.calls[2]?.[0]).toBeInstanceOf(CreateTokenCommand);
		expect(clients.oidc.mock.calls[2]?.[0]).toMatchObject({
			input: {
				clientId: "fixture-client",
				deviceCode: "fixture-device",
				grantType: "urn:ietf:params:oauth:grant-type:device_code",
			},
		});
		expect(clients.oidc).toHaveBeenCalledTimes(4);
		const cached = await Bun.file(cacheFile).json();
		expect(cached).toMatchObject({
			startUrl: "https://example.invalid/start",
			region: "us-east-1",
			accessToken: "fixture-token",
		});
		expect(new Date(cached.expiresAt).getTime()).toBeGreaterThanOrEqual(
			before + 600_000,
		);
		expect(await isSSOTokenValid("dev")).toBe(true);
	});

	it("propagates a terminal SSO authorization error without writing a token", async () => {
		startDeviceAuthorization();
		const error = Object.assign(new Error("denied"), {
			name: "AccessDeniedException",
		});
		clients.oidc.mockRejectedValueOnce(error);
		await expect(ssoLogin("dev")).rejects.toBe(error);
		expect(await Bun.file(cacheFile).exists()).toBe(false);
	});
});
