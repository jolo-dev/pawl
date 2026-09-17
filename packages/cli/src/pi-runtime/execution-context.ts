import { createHash } from "node:crypto";
import {
	mkdtempSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
	GetCallerIdentityCommand,
	STSClient,
	type STSClientConfig,
} from "@aws-sdk/client-sts";
import { fromIni } from "@aws-sdk/credential-providers";
import { z } from "zod";
import {
	type RunProjectScanOptions,
	runProjectScan,
} from "../infra/project-scan";

import {
	createCheckedScannerFactories,
	type ProofScanRequestHandler,
} from "./checked-scanners";

export class ExecutionContextError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ExecutionContextError";
	}
}

/** Only resolved signing material crosses the identity-check boundary. Never persist it. */
export interface CredentialSnapshot {
	readonly accessKeyId: string;
	readonly secretAccessKey: string;
	readonly sessionToken?: string | undefined;
	readonly expiration?: Date | undefined;
}

export interface ExecutionIdentity {
	readonly accountId: string;
	readonly partition: string;
	/** Assumed-role sessions normalize to the role ARN; the role itself never changes. */
	readonly principalArn: string;
}

export interface ExecutionContextDependencies {
	credentialsFromIni(options: {
		profile: string;
		clientConfig: { region: string; ignoreConfiguredEndpointUrls: true };
		ignoreCache: true;
	}): () => Promise<CredentialSnapshot>;
	identityClient(config: { region: string; credentials: CredentialSnapshot }): {
		identify(signal: AbortSignal): Promise<{ Account?: string; Arn?: string }>;
		destroy(): void;
	};
	now(): number;
}

export function createStsIdentityClient(
	config: { region: string; credentials: CredentialSnapshot },
	requestHandler?: STSClientConfig["requestHandler"],
) {
	const client = new STSClient({
		region: config.region,
		// The SDK mutates static credential objects for source attribution. This
		// closure returns only the already-resolved frozen snapshot; it cannot
		// refresh or resolve the profile independently of the identity check.
		credentials: async () => config.credentials,
		ignoreConfiguredEndpointUrls: true,
		...(requestHandler ? { requestHandler } : {}),
	});
	return {
		identify: (abortSignal: AbortSignal) =>
			client.send(new GetCallerIdentityCommand({}), { abortSignal }),
		destroy: () => client.destroy(),
	};
}

const defaults: ExecutionContextDependencies = {
	credentialsFromIni: fromIni,
	identityClient: createStsIdentityClient,
	now: Date.now,
};

const selectionSchema = z.strictObject({
	projectDir: z.string().min(1),
	profile: z.string().trim().min(1),
	region: z.string().regex(/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/),
});
const credentialSchema = z.object({
	accessKeyId: z
		.string()
		.min(1)
		.regex(/^[^\s[\]]+$/),
	secretAccessKey: z
		.string()
		.min(1)
		.regex(/^[^\s[\]]+$/),
	sessionToken: z
		.string()
		.min(1)
		.regex(/^[^\s[\]]+$/)
		.optional(),
	expiration: z.date().optional(),
});
const identitySchema = z.object({
	Account: z.string().regex(/^\d{12}$/),
	Arn: z.string().min(1),
});
const childSchema = z.object({
	timeoutMs: z.number().int().positive().max(2_147_483_647),
	args: z.array(z.string()),
	assumeRoleArn: z.never().optional(),
});

function normalizeIdentity(value: unknown): ExecutionIdentity {
	const parsed = identitySchema.safeParse(value);
	if (!parsed.success)
		throw new ExecutionContextError(
			"STS did not return a valid account and principal",
		);
	const { Account: accountId, Arn: arn } = parsed.data;
	const match = /^arn:(aws(?:-[a-z]+)*):(sts|iam)::(\d{12}):(.+)$/.exec(arn);
	if (!match || match[3] !== accountId)
		throw new ExecutionContextError(
			"STS principal account or partition is invalid",
		);
	const partition = match[1];
	const resource = match[4];
	if (!partition || !resource)
		throw new ExecutionContextError("STS principal is incomplete");
	if (match[2] === "sts") {
		// STS role sessions have precisely role-name/session-name. Do not guess at
		// arbitrary path components or normalize federated identities into roles.
		const role = /^assumed-role\/([\w+=,.@-]+)\/[\w+=,.@-]+$/.exec(
			resource,
		)?.[1];
		if (!role)
			throw new ExecutionContextError("Cannot safely normalize STS principal");
		return Object.freeze({
			accountId,
			partition,
			principalArn: `arn:${partition}:iam::${accountId}:role/${role}`,
		});
	}
	if (
		resource !== "root" &&
		!/^user\/(?:[\w+=,.@-]+\/)*[\w+=,.@-]+$/.test(resource)
	) {
		throw new ExecutionContextError("Unsupported IAM caller principal");
	}
	return Object.freeze({ accountId, partition, principalArn: arn });
}

function snapshotOf(value: unknown): CredentialSnapshot {
	const result = credentialSchema.safeParse(value);
	if (!result.success)
		throw new ExecutionContextError(
			"Selected profile returned invalid signing credentials",
		);
	const { accessKeyId, secretAccessKey, sessionToken, expiration } =
		result.data;
	const expiresAt = expiration?.getTime();
	// Object.freeze(Date) does not prevent setTime. A defensive getter keeps the
	// snapshot immutable even if an SDK consumer mutates its returned Date.
	return Object.freeze({
		accessKeyId,
		secretAccessKey,
		...(sessionToken === undefined ? {} : { sessionToken }),
		get expiration() {
			return expiresAt === undefined ? undefined : new Date(expiresAt);
		},
	});
}

function fingerprint(snapshot: CredentialSnapshot): string {
	return createHash("sha256")
		.update(
			JSON.stringify([
				snapshot.accessKeyId,
				snapshot.secretAccessKey,
				snapshot.sessionToken,
				snapshot.expiration?.getTime(),
			]),
		)
		.digest("hex");
}

/** Stop waiting even when a credential source cannot itself consume a signal. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
		work
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", abort));
		if (signal.aborted) {
			signal.removeEventListener("abort", abort);
			abort();
		}
	});
}

export interface ChildEnvironmentOptions {
	readonly timeoutMs: number;
	readonly args: readonly string[];
	/** No additional role policy is approved, including same-account bootstrap roles. */
	readonly assumeRoleArn?: string;
	readonly env?: Readonly<NodeJS.ProcessEnv>;
	readonly signal?: AbortSignal;
}

export interface CheckedChildEnvironment {
	readonly env: Readonly<NodeJS.ProcessEnv>;
	readonly signal: AbortSignal;
}

type CheckedScanOptions = Pick<
	RunProjectScanOptions,
	"exec" | "services" | "skipSynth" | "maxEntries" | "scannerFactories"
> & {
	readonly signal?: AbortSignal;
	readonly requestHandler?: ProofScanRequestHandler;
};

export async function createExecutionContext(
	options: {
		projectDir: string;
		profile: string;
		region: string;
		signal?: AbortSignal | undefined;
	},
	dependencies: ExecutionContextDependencies = defaults,
) {
	const selected = selectionSchema.parse({
		projectDir: options.projectDir,
		profile: options.profile,
		region: options.region,
	});
	const projectDir = realpathSync(selected.projectDir);
	if (!statSync(projectDir).isDirectory())
		throw new ExecutionContextError("Project must be a directory");
	const { profile, region } = selected;
	const invalidation = new AbortController();
	const signal = options.signal
		? AbortSignal.any([options.signal, invalidation.signal])
		: invalidation.signal;
	signal.throwIfAborted();
	const resolveCredentials = dependencies.credentialsFromIni({
		profile,
		clientConfig: { region, ignoreConfiguredEndpointUrls: true },
		ignoreCache: true,
	});
	let identity: ExecutionIdentity | undefined;
	let cached: { fingerprint: string; snapshot: CredentialSnapshot } | undefined;
	let tail: Promise<unknown> = Promise.resolve();
	const operationSignal = (requested?: AbortSignal) =>
		requested ? AbortSignal.any([signal, requested]) : signal;
	const assertFresh = (snapshot: CredentialSnapshot) => {
		if (
			snapshot.expiration &&
			snapshot.expiration.getTime() <= dependencies.now()
		) {
			throw new ExecutionContextError(
				"Selected profile credentials have expired; refresh authentication before retrying",
			);
		}
	};

	async function checkedCredentials(
		requested?: AbortSignal,
	): Promise<CredentialSnapshot> {
		const currentSignal = operationSignal(requested);
		currentSignal.throwIfAborted();
		// Serialize validation so two concurrent first/refresh calls cannot bind
		// different identities or resurrect a cache after invalidation.
		const work = tail.then(async () => {
			currentSignal.throwIfAborted();
			const snapshot = snapshotOf(
				await abortable(resolveCredentials(), currentSignal),
			);
			currentSignal.throwIfAborted();
			assertFresh(snapshot);
			const key = fingerprint(snapshot);
			if (cached?.fingerprint === key) return cached.snapshot;
			const client = dependencies.identityClient({
				region,
				credentials: snapshot,
			});
			let response: unknown;
			try {
				response = await abortable(
					client.identify(currentSignal),
					currentSignal,
				);
			} finally {
				client.destroy();
			}
			currentSignal.throwIfAborted();
			assertFresh(snapshot);
			try {
				const next = normalizeIdentity(response);
				if (
					identity &&
					(identity.accountId !== next.accountId ||
						identity.partition !== next.partition ||
						identity.principalArn !== next.principalArn)
				) {
					throw new ExecutionContextError(
						"AWS identity changed; this execution context is invalid and a new session is required",
					);
				}
				identity = next;
			} catch (error) {
				cached = undefined;
				invalidation.abort(error);
				throw error;
			}
			cached = { fingerprint: key, snapshot };
			return snapshot;
		});
		tail = work.catch(() => undefined);
		return abortable(work, currentSignal);
	}

	await checkedCredentials();
	if (!identity)
		throw new ExecutionContextError("AWS identity was not established");
	const boundIdentity: ExecutionIdentity = identity;

	/** Credential/region configuration only. SDKs memoize this provider: use
	 * the checked SDK executor/service facades for the per-command/per-attempt boundary. */
	function sdkConfig(requested?: AbortSignal) {
		return {
			region,
			credentials: () => checkedCredentials(requested),
			ignoreConfiguredEndpointUrls: true as const,
		};
	}

	async function withChildEnvironment<T>(
		child: ChildEnvironmentOptions,
		operation: (invocation: CheckedChildEnvironment) => Promise<T>,
	): Promise<T> {
		const parsed = childSchema.safeParse(child);
		if (
			!parsed.success ||
			child.args.some((arg) =>
				/^(?:--(?:profile|role-arn|assume-role-arn|role)(?:=|$)|-r)/i.test(arg),
			)
		) {
			throw new ExecutionContextError(
				"A bounded timeout is required; extra profile flags and assume-role targets are not approved",
			);
		}
		const deadline = new AbortController();
		const currentSignal = AbortSignal.any([
			operationSignal(child.signal),
			deadline.signal,
		]);
		const timer = setTimeout(
			() =>
				deadline.abort(new ExecutionContextError("Child operation timed out")),
			child.timeoutMs,
		);
		let directory: string | undefined;
		try {
			let snapshot = await checkedCredentials(currentSignal);
			const enoughLifetime = (value: CredentialSnapshot) =>
				value.expiration
					? value.expiration.getTime() - dependencies.now() >=
						child.timeoutMs + 60_000
					: value.sessionToken === undefined;
			if (!enoughLifetime(snapshot))
				snapshot = await checkedCredentials(currentSignal);
			if (!enoughLifetime(snapshot))
				throw new ExecutionContextError(
					"Credential lifetime cannot cover the bounded child timeout plus 60 seconds",
				);
			currentSignal.throwIfAborted();
			const env: NodeJS.ProcessEnv = {};
			for (const [key, value] of Object.entries(child.env ?? process.env)) {
				if (
					!/^AWS_/i.test(key) &&
					!/^CDK_DEFAULT_(?:ACCOUNT|REGION)$/i.test(key)
				)
					env[key] = value;
			}
			const temporaryRoot = realpathSync(tmpdir());
			if (
				temporaryRoot === projectDir ||
				temporaryRoot.startsWith(
					projectDir.endsWith(sep) ? projectDir : `${projectDir}${sep}`,
				)
			) {
				throw new ExecutionContextError(
					"Credential temporary files must be outside the selected project",
				);
			}
			directory = mkdtempSync(join(temporaryRoot, "pawl-checked-aws-"));
			const config = join(directory, "config");
			const shared = join(directory, "credentials");
			writeFileSync(config, `[default]\nregion = ${region}\n`, {
				mode: 0o600,
				flag: "wx",
			});
			writeFileSync(
				shared,
				`[default]\naws_access_key_id = ${snapshot.accessKeyId}\naws_secret_access_key = ${snapshot.secretAccessKey}\n${snapshot.sessionToken ? `aws_session_token = ${snapshot.sessionToken}\n` : ""}`,
				{ mode: 0o600, flag: "wx" },
			);
			Object.assign(env, {
				AWS_ACCESS_KEY_ID: snapshot.accessKeyId,
				AWS_SECRET_ACCESS_KEY: snapshot.secretAccessKey,
				...(snapshot.sessionToken
					? { AWS_SESSION_TOKEN: snapshot.sessionToken }
					: {}),
				AWS_REGION: region,
				AWS_DEFAULT_REGION: region,
				AWS_PROFILE: "default",
				AWS_DEFAULT_PROFILE: "default",
				AWS_CONFIG_FILE: config,
				AWS_SHARED_CREDENTIALS_FILE: shared,
				AWS_SDK_LOAD_CONFIG: "1",
				AWS_EC2_METADATA_DISABLED: "true",
				CDK_DEFAULT_ACCOUNT: boundIdentity.accountId,
				CDK_DEFAULT_REGION: region,
			});
			currentSignal.throwIfAborted();
			return await abortable(
				operation({ env: Object.freeze(env), signal: currentSignal }),
				currentSignal,
			);
		} finally {
			clearTimeout(timer);
			if (directory) rmSync(directory, { recursive: true, force: true });
		}
	}

	async function scanProject(scan: CheckedScanOptions) {
		if (typeof scan.exec !== "function")
			throw new ExecutionContextError(
				"A controlled scan executor must be injected",
			);
		const refusal = new AbortController();
		const currentSignal = AbortSignal.any([
			operationSignal(scan.signal),
			refusal.signal,
		]);
		await checkedCredentials(currentSignal);
		const result = await abortable(
			runProjectScan({
				cwd: projectDir,
				...sdkConfig(currentSignal),
				resolveAccountId: async () => {
					await checkedCredentials(currentSignal);
					return boundIdentity.accountId;
				},
				// No default executor: Task 7 supplies controlled host execution.
				exec: async (command, args) => {
					currentSignal.throwIfAborted();
					return scan.exec(command, args);
				},
				services: scan.services,
				skipSynth: scan.skipSynth,
				maxEntries: scan.maxEntries,
				scannerFactories:
					scan.scannerFactories ??
					createCheckedScannerFactories(
						{
							region,
							signal: currentSignal,
							checkedCredentials,
							onCredentialRefusal: (error) => refusal.abort(error),
						},
						currentSignal,
						scan.requestHandler,
					),
			}),
			currentSignal,
		);
		// Shared scanners intentionally convert errors into coverage. Identity
		// invalidation/cancellation must still fail the whole proof operation.
		currentSignal.throwIfAborted();
		return result;
	}

	return Object.freeze({
		projectDir,
		profile,
		region,
		identity: boundIdentity,
		signal,
		checkedCredentials,
		sdkConfig,
		withChildEnvironment,
		scanProject,
	});
}

export type ExecutionContext = Awaited<
	ReturnType<typeof createExecutionContext>
>;
