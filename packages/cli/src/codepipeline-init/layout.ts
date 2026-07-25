import { lstatSync, realpathSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";

export interface CodePipelineInitLayout {
	readonly projectDir: string;
}

export async function resolveCodePipelineInitLayout(
	cwd: string,
	repositoryName: string,
): Promise<CodePipelineInitLayout> {
	const baseCwd = resolve(cwd);
	const projectDir = join(baseCwd, `${repositoryName}-pipeline`);
	const parent = dirname(projectDir);
	try {
		await access(parent, constants.R_OK);
	} catch {
		throw new Error(`Output parent directory "${parent}" does not exist or is not readable`);
	}
	// Check destination doesn't exist
	try {
		lstatSync(projectDir);
		throw new Error(`Destination "${projectDir}" already exists`);
	} catch (error: unknown) {
		if (error instanceof Error && error.message.includes("already exists")) throw error;
		// ENOENT is expected — destination should not exist
	}
	return { projectDir };
}
