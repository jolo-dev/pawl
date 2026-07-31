import { afterAll, beforeAll } from "bun:test";
import {
	LocalstackContainer,
	type StartedLocalStackContainer,
} from "@testcontainers/localstack";
import { $ } from "bun";
import type { StackFunction } from "../../src/stack-function";

const defaultCdkContext = {
	stage: "dev",
	team: "foo",
};

export interface LocalStackSetupConfig {
	appFile: string;
	stack: StackFunction;
	outputsFile?: string;
	extraEnv?: Record<string, string>;
	extraCdkContext?: Record<string, string>;
	timeout?: number;
}

export interface LocalStackSetup {
	readonly endpoint: string;
	readonly env: Record<string, string>;
}

export interface LocalStackChildEnvConfig {
	readonly parentEnv: Readonly<Record<string, string | undefined>>;
	readonly endpoint: string;
	readonly cdkContext: Readonly<Record<string, string>>;
	readonly extraEnv?: Readonly<Record<string, string>>;
}

export function createLocalStackChildEnv(
	config: LocalStackChildEnvConfig,
): Record<string, string> {
	const env: Record<string, string> = {};
	copyChildEnv(config.parentEnv, env);

	const url = new URL(config.endpoint);
	Object.assign(env, {
		PAWL_CDK_SYNTH: "1",
		PAWL_CDK_CONTEXT: JSON.stringify(config.cdkContext),
		AWS_DEFAULT_REGION: "us-east-1",
		AWS_ACCESS_KEY_ID: "test",
		AWS_SECRET_ACCESS_KEY: "test",
		AWS_ENDPOINT_URL: config.endpoint,
		AWS_ENDPOINT_URL_S3: `http://s3.${url.hostname}:${url.port}`,
	});
	copyChildEnv(config.extraEnv ?? {}, env);

	return env;
}

export function createLocalStackSetup(
	config: LocalStackSetupConfig,
): LocalStackSetup {
	const cdkApp = `bun run ${config.appFile}`;
	const stackName = getLocalStackSetupStackName(config.stack);
	const cdkContext = {
		...defaultCdkContext,
		...config.extraCdkContext,
	};

	let localstack: StartedLocalStackContainer | undefined;
	let endpoint: string;
	let env: Record<string, string>;

	beforeAll(async () => {
		const image =
			process.env.LOCALSTACK_IMAGE || "localstack/localstack:2026.5.0";
		localstack = await new LocalstackContainer(image)
			.withEnvironment({
				LOCALSTACK_AUTH_TOKEN:
					process.env.LOCALSTACK_AUTH_TOKEN ??
					throwError("LOCALSTACK_AUTH_TOKEN is missing"),
			})
			.withBindMounts([
				{
					source: "/var/run/docker.sock",
					target: "/var/run/docker.sock",
					mode: "rw",
				},
			])
			.start();
		endpoint = localstack.getConnectionUri();
		env = createLocalStackChildEnv({
			parentEnv: process.env,
			endpoint,
			cdkContext,
			extraEnv: config.extraEnv,
		});

		const contextArgs = Object.entries(cdkContext).flatMap(([k, v]) => [
			"--context",
			`${k}=${v}`,
		]);

		await $`npx cdklocal bootstrap --app ${cdkApp} ${contextArgs}`.env(env);

		const outputsFileArgs = config.outputsFile
			? ["--outputs-file", config.outputsFile]
			: [];

		await $`npx cdklocal deploy ${stackName} --app ${cdkApp} --require-approval never ${outputsFileArgs} ${contextArgs}`.env(
			env,
		);
	}, config.timeout ?? 120_000);

	afterAll(async () => {
		await localstack?.stop();
	});

	return {
		get endpoint() {
			return endpoint;
		},
		get env() {
			return env;
		},
	};
}

export function getLocalStackSetupStackName(stack: StackFunction): string {
	if (!stack.name) throw new Error("Stack functions must be named");
	return stack.name;
}

function copyChildEnv(
	source: Readonly<Record<string, string | undefined>>,
	target: Record<string, string>,
): void {
	for (const [key, value] of Object.entries(source)) {
		if (key !== "LOCALSTACK_AUTH_TOKEN" && value !== undefined) {
			target[key] = value;
		}
	}
}

function throwError(message: string): never {
	throw new Error(message);
}
