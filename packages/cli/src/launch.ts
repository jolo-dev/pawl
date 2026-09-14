import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Build the child-process environment for `eve dev`. */
export function buildEveEnv(options: {
	profile: string;
	region: string;
	modelId: string;
	projectDir: string;
	base?: Record<string, string | undefined>;
}): Record<string, string | undefined> {
	return {
		...options.base,
		AWS_PROFILE: options.profile,
		AWS_REGION: options.region,
		PAWL_BEDROCK_MODEL: options.modelId,
		PAWL_PROJECT_DIR: options.projectDir,
	};
}

/**
 * Root of the pawl CLI package — the directory that owns `agent/`.
 *
 * `src/launch.ts` sits one level below the package root.
 */
export function defaultAppRoot(): string {
	return dirname(dirname(fileURLToPath(import.meta.url)));
}

/** Absolute path to the eve CLI entry point shipped in `node_modules`. */
export function resolveEveBin(): string {
	const require = createRequire(import.meta.url);
	const evePackageJson = require.resolve("eve/package.json");
	return join(dirname(evePackageJson), "bin", "eve.js");
}

/** Finds an executable on PATH without depending on a runtime-specific API. */
function findOnPath(name: string): string | undefined {
	const extensions = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
	for (const directory of (process.env.PATH ?? "").split(delimiter)) {
		if (directory.length === 0) continue;
		for (const extension of extensions) {
			const candidate = join(directory, `${name}${extension}`);
			if (existsSync(candidate)) return candidate;
		}
	}
	return undefined;
}

/**
 * The runtime to launch eve with.
 *
 * Eve's server requires Node. Under Bun it starts far enough to answer on some
 * routes and then fails its worker init with
 * `[crossws] Using Node.js adapter in an incompatible environment`, which is the
 * worst kind of broken: a health check can pass against a runtime that cannot
 * serve a turn. `pawl` itself runs under Bun, so `process.execPath` is Bun here
 * and must not be used; a real `node` is preferred whenever one is on PATH.
 */
export function resolveEveRuntime(): string {
	if (!process.versions.bun) return process.execPath;
	return findOnPath("node") ?? process.execPath;
}

/**
 * Command used to start the eve runtime.
 *
 * Runs the installed eve binary with a Node runtime, so the handoff does not
 * depend on `eve` being on `PATH`.
 */
export function eveDevCommand(): { command: string; args: string[] } {
	return { command: resolveEveRuntime(), args: [resolveEveBin(), "dev"] };
}

/** Default port for the local runtime the client attaches to. */
export const DEFAULT_SERVER_PORT = 2145;

/** The local base URL for a given port. */
export function localServerUrl(port: number): string {
	return `http://127.0.0.1:${port}`;
}

export interface WaitForHealthyOptions {
	readonly timeoutMs?: number;
	readonly intervalMs?: number;
	/** Returns true once the server answers. Injectable for tests. */
	readonly check?: ((url: string) => Promise<boolean>) | undefined;
	readonly sleep?: ((ms: number) => Promise<void>) | undefined;
	/**
	 * Lets a server that died during startup fail immediately, rather than after
	 * the full timeout with no explanation.
	 */
	readonly hasExited?: (() => boolean) | undefined;
}

/**
 * Polls a local server until it answers.
 *
 * The default check asks for the *health* route and requires a successful
 * response, not merely a connection. A live run showed why: under an
 * unsupported runtime eve binds and answers on `/eve/v1/session` while its
 * worker init has already failed, so "something is listening" is not the same
 * as "the runtime works".
 */
export async function waitForHealthy(
	url: string,
	options: WaitForHealthyOptions = {},
): Promise<void> {
	const timeoutMs = options.timeoutMs ?? 60_000;
	const intervalMs = options.intervalMs ?? 250;
	const sleep =
		options.sleep ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const check =
		options.check ??
		(async (target: string) => {
			try {
				const response = await fetch(`${target}/eve/v1/health`);
				return response.ok;
			} catch {
				return false;
			}
		});

	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (options.hasExited?.()) {
			throw new Error("the server exited before it became healthy");
		}
		if (await check(url)) return;
		if (Date.now() >= deadline) {
			throw new Error(
				`timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${url}`,
			);
		}
		await sleep(intervalMs);
	}
}

export interface PawlServerHandle {
	readonly url: string;
	/** Recent server output, for diagnosing a failed start. */
	log(): string;
	stop(): Promise<void>;
}

/**
 * Start the eve runtime headless and wait until it answers.
 *
 * Headless because the client owns the terminal: `eve dev`'s own UI would fight
 * it for the screen. Stdio is piped rather than inherited for the same reason,
 * and so a startup failure can be reported with the server's own output instead
 * of a bare timeout.
 */
export async function startPawlServer(options: {
	readonly profile: string;
	readonly region: string;
	readonly modelId: string;
	readonly projectDir: string;
	readonly appRoot?: string | undefined;
	readonly port?: number | undefined;
	readonly timeoutMs?: number | undefined;
}): Promise<PawlServerHandle> {
	const port = options.port ?? DEFAULT_SERVER_PORT;
	const url = localServerUrl(port);
	const { command } = eveDevCommand();

	const child = spawn(
		command,
		[
			resolveEveBin(),
			"dev",
			"--no-ui",
			"--port",
			String(port),
			"--host",
			"127.0.0.1",
		],
		{
			cwd: options.appRoot ?? defaultAppRoot(),
			env: buildEveEnv({
				profile: options.profile,
				region: options.region,
				modelId: options.modelId,
				projectDir: options.projectDir,
				base: process.env,
			}),
			stdio: ["ignore", "pipe", "pipe"],
		},
	);

	let output = "";
	let exited = false;
	let exitCode: number | null = null;
	child.stdout?.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});
	child.once("exit", (code) => {
		exited = true;
		exitCode = code;
	});

	const stop = async (): Promise<void> => {
		if (exited) return;
		await new Promise<void>((resolve) => {
			child.once("close", () => resolve());
			child.kill("SIGTERM");
		});
	};

	// A client that dies without stopping its server leaves an orphan listening on
	// the port, so tie the two lifetimes together.
	const onExit = (): void => {
		child.kill("SIGTERM");
	};
	process.once("SIGINT", onExit);
	process.once("SIGTERM", onExit);
	process.once("exit", onExit);

	try {
		await waitForHealthy(url, {
			timeoutMs: options.timeoutMs,
			hasExited: () => exited,
		});
	} catch (error: unknown) {
		await stop();
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Could not start the pawl runtime: ${reason}${exitCode === null ? "" : ` (exit ${exitCode})`}\n${output.slice(-2000)}`,
		);
	}

	return { url, log: () => output, stop };
}
