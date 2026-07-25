import { lstatSync, realpathSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { ValidatedCodeCommitInitConfig } from "./config";

export interface CodeCommitInitLayout {
	readonly sourceRoot: string;
	readonly projectDir: string;
	readonly infrastructureName?: string;
	readonly sourcePathFromStack: ".." | "../..";
}

const RESERVED_INFRA_NAMES = new Set([".git", "node_modules", "cdk.out"]);

const RESERVED_PREFIX = ".cdk.staging";

function isValidInfraName(dir: string): boolean {
	if (dir === "" || dir === "." || dir === "..") return false;
	if (isAbsolute(dir)) return false;
	if (dir.includes("/") || dir.includes(sep) || dir.includes("\\"))
		return false;
	if (RESERVED_INFRA_NAMES.has(dir)) return false;
	if (dir === RESERVED_PREFIX || dir.startsWith(`${RESERVED_PREFIX}-`))
		return false;
	if (dir.startsWith(".")) return false;
	return true;
}

function isENOENT(
	error: unknown,
): error is NodeJS.ErrnoException & { code: "ENOENT" } {
	return (
		error !== null &&
		typeof error === "object" &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}

async function assertAbsent(path: string, label: string): Promise<void> {
	try {
		lstatSync(path);
	} catch (error: unknown) {
		if (isENOENT(error)) return;
		throw error;
	}
	throw new Error(
		`${label} "${path}" already exists and cannot be overwritten`,
	);
}

async function assertReadableDir(p: string): Promise<string> {
	const resolved = realpathSync(p);
	if (!lstatSync(resolved).isDirectory()) {
		throw new Error(`Sync path "${p}" is not a directory`);
	}
	await access(resolved, constants.R_OK);
	return resolved;
}

/**
 * Resolve canonical paths for the generated Pawl project without creating or
 * mutating any files or directories.
 *
 * In sync mode the selected directory is the CodeCommit repository root, and
 * the Pawl project lives in a configurable direct child (default `infra`).
 *
 * In no-sync mode a new project root is generated directly at
 * `./<repository-name>` or the supplied directory under an existing parent.
 */
export async function resolveCodeCommitInitLayout(
	cwd: string,
	config: ValidatedCodeCommitInitConfig,
): Promise<CodeCommitInitLayout> {
	const baseCwd = resolve(cwd);

	if (config.syncPath !== undefined) {
		const sourceRoot = await assertReadableDir(
			resolve(baseCwd, config.syncPath),
		);
		const infraName = config.directory ?? "infra";
		if (!isValidInfraName(infraName)) {
			throw new Error(
				`Invalid infrastructure directory "${infraName}" (must be one direct-child name with no separators or reserved value)`,
			);
		}
		const projectDir = join(sourceRoot, infraName);
		await assertAbsent(projectDir, "Destination");
		return {
			sourceRoot,
			projectDir,
			infrastructureName: infraName,
			sourcePathFromStack: "..",
		};
	}

	// No-sync: generate directly at ./<repository-name> or a custom path.
	const rawDir = config.directory ?? config.repositoryName;
	const projectDir = resolve(baseCwd, rawDir);
	const parent = dirname(projectDir);
	try {
		await access(parent, constants.R_OK);
	} catch {
		throw new Error(
			`Output parent directory "${parent}" does not exist or is not readable`,
		);
	}
	await assertAbsent(projectDir, "Destination");
	return {
		sourceRoot: baseCwd,
		projectDir,
		sourcePathFromStack: "..",
	};
}
