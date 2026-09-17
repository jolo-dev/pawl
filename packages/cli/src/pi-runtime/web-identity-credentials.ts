import {
	AssumeRoleWithWebIdentityCommand,
	STSClient,
	type STSClientConfig,
} from "@aws-sdk/client-sts";
import type { fromIni } from "@aws-sdk/credential-providers";
import { z } from "zod";

type WebIdentityRoleAssumer = NonNullable<
	NonNullable<Parameters<typeof fromIni>[0]>["roleAssumerWithWebIdentity"]
>;

const credentialsSchema = z.object({
	AccessKeyId: z.string().min(1),
	SecretAccessKey: z.string().min(1),
	SessionToken: z.string().min(1),
	Expiration: z.date(),
});

export class WebIdentityCredentialError extends Error {
	constructor() {
		super("Web identity STS returned invalid credentials");
		this.name = "WebIdentityCredentialError";
	}
}

/** fromIni drops clientConfig on its token-file branch. Supply an actual isolated
 * STS operation pinned to the checked execution context's selected region,
 * without environment/profile/default/metadata region discovery. */
export function createWebIdentityRoleAssumer(
	profile: string,
	region: string,
	signal: AbortSignal,
	requestHandler?: STSClientConfig["requestHandler"],
): WebIdentityRoleAssumer {
	return async (params) => {
		signal.throwIfAborted();
		const client = new STSClient({
			profile,
			region,
			ignoreConfiguredEndpointUrls: true,
			// Ambient signing preferences must not re-enter profile resolution.
			authSchemePreference: ["noAuth"],
			...(requestHandler ? { requestHandler } : {}),
		});
		try {
			// This command is anonymous; never resolve signing credentials here.
			const response = await client.send(
				new AssumeRoleWithWebIdentityCommand(params),
				{ abortSignal: signal },
			);
			signal.throwIfAborted();
			const parsed = credentialsSchema.safeParse(response.Credentials);
			if (!parsed.success) throw new WebIdentityCredentialError();
			return {
				accessKeyId: parsed.data.AccessKeyId,
				secretAccessKey: parsed.data.SecretAccessKey,
				sessionToken: parsed.data.SessionToken,
				expiration: parsed.data.Expiration,
			};
		} finally {
			client.destroy();
		}
	};
}
