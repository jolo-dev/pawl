import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
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

/**
 * Command used to start the eve terminal UI.
 *
 * Runs the installed eve binary with the same runtime that launched pawl, so
 * the handoff does not depend on `eve` being on `PATH`.
 */
export function eveDevCommand(): { command: string; args: string[] } {
	return { command: process.execPath, args: [resolveEveBin(), "dev"] };
}

/**
 * Start `eve dev` from the pawl package root with inherited stdio.
 *
 * The working directory must be the package root, because eve locates its
 * application by walking up for `agent/`. The user's project travels in
 * `PAWL_PROJECT_DIR` instead, and the terminal UI needs a real TTY, so stdio is
 * inherited rather than piped.
 */
export async function launchEveDev(options: {
	profile: string;
	region: string;
	modelId: string;
	projectDir: string;
	appRoot?: string;
}): Promise<number> {
	const { command, args } = eveDevCommand();
	const child = spawn(command, args, {
		cwd: options.appRoot ?? defaultAppRoot(),
		env: buildEveEnv({ ...options, base: process.env }),
		stdio: ["inherit", "inherit", "inherit"],
	});
	return new Promise<number>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code) => resolve(code ?? 0));
	});
}
