import { join } from "node:path";
import {
	BedrockClient,
	ListFoundationModelsCommand,
} from "@aws-sdk/client-bedrock";
import {
	CreateTokenCommand,
	type CreateTokenCommandOutput,
	RegisterClientCommand,
	SSOOIDCClient,
	StartDeviceAuthorizationCommand,
} from "@aws-sdk/client-sso-oidc";
import {
	GetCallerIdentityCommand,
	type GetCallerIdentityCommandOutput,
	STSClient,
} from "@aws-sdk/client-sts";
import { fromIni } from "@aws-sdk/credential-providers";
import {
	getSSOTokenFromFile,
	loadSsoSessionData,
} from "@smithy/shared-ini-file-loader";
import { $ } from "bun";

export async function listProfiles(): Promise<string[]> {
	const profiles = await parseKnownFiles({});
	return Object.keys(profiles);
}

export async function checkCredentials(
	profile?: string,
	region?: string,
): Promise<GetCallerIdentityCommandOutput> {
	const client = new STSClient({
		profile,
		region,
		credentials: profile ? fromIni({ profile }) : undefined,
	});
	return client.send(new GetCallerIdentityCommand({}));
}

export async function isSSOTokenValid(profile: string): Promise<boolean> {
	const profiles = await parseKnownFiles({});
	const ssoSession = profiles[profile]?.sso_session;
	if (!ssoSession) return false;

	try {
		const token = await getSSOTokenFromFile(ssoSession);
		return !!token.expiresAt && new Date(token.expiresAt) > new Date();
	} catch {
		return false;
	}
}

export async function ssoLogin(profile: string): Promise<void> {
	const profiles = await parseKnownFiles({});
	const ssoSessionName = profiles[profile]?.sso_session;
	if (!ssoSessionName)
		throw new Error(`Profile "${profile}" has no sso_session`);

	const sessions = await loadSsoSessionData();
	const session = sessions[ssoSessionName];
	if (!session?.sso_start_url || !session?.sso_region)
		throw new Error(
			`SSO session "${ssoSessionName}" missing sso_start_url or sso_region`,
		);

	const oidc = new SSOOIDCClient({ region: session.sso_region });

	const { clientId, clientSecret } = await oidc.send(
		new RegisterClientCommand({ clientName: "pawl-cli", clientType: "public" }),
	);

	const { verificationUriComplete, deviceCode, interval } = await oidc.send(
		new StartDeviceAuthorizationCommand({
			clientId,
			clientSecret,
			startUrl: session.sso_start_url,
		}),
	);

	console.log(`Opening browser for SSO login:\n${verificationUriComplete}`);
	await $`open ${verificationUriComplete ?? ""}`.quiet();

	const pollMs = (interval ?? 5) * 1000;
	let token: CreateTokenCommandOutput | undefined;
	while (!token) {
		await new Promise((r) => setTimeout(r, pollMs));
		try {
			token = await oidc.send(
				new CreateTokenCommand({
					clientId,
					clientSecret,
					deviceCode,
					grantType: "urn:ietf:params:oauth:grant-type:device_code",
				}),
			);
		} catch (e: unknown) {
			const err = e as { name?: string };
			if (err.name === "AuthorizationPendingException") continue;
			if (err.name === "SlowDownException") {
				await new Promise((r) => setTimeout(r, pollMs));
				continue;
			}
			throw e;
		}
	}

	const home = Bun.env.HOME || "~";
	const cacheDir = join(home, ".aws", "sso", "cache");
	await $`mkdir -p ${cacheDir}`.quiet();
	const cacheKey = new Bun.CryptoHasher("sha1")
		.update(ssoSessionName)
		.digest("hex");
	await Bun.write(
		join(cacheDir, `${cacheKey}.json`),
		JSON.stringify(
			{
				startUrl: session.sso_start_url,
				region: session.sso_region,
				accessToken: token.accessToken,
				expiresAt: new Date(
					Date.now() + (token.expiresIn ?? 28800) * 1000,
				).toISOString(),
			},
			null,
			2,
		),
	);

	console.log(`SSO login successful for profile "${profile}"`);
}

export async function getProfileRegion(
	profile: string,
): Promise<string | undefined> {
	const profiles = await parseKnownFiles({});
	return profiles[profile]?.region;
}

export async function checkBedrockAccess(
	profile?: string,
	region?: string,
): Promise<boolean> {
	try {
		const client = new BedrockClient({
			profile,
			region,
			credentials: profile ? fromIni({ profile }) : undefined,
		});
		await client.send(
			new ListFoundationModelsCommand({ byOutputModality: "TEXT" }),
		);
		return true;
	} catch {
		return false;
	}
}
