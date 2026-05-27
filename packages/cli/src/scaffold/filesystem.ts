import { readdir } from "node:fs/promises";

/** Throw if the target directory already contains any files or folders. */
export async function assertEmptyTargetDir(targetDir: string): Promise<void> {
	const entries = await readdir(targetDir);
	if (entries.length > 0) {
		throw new Error(
			`Target directory is not empty: ${targetDir}. pawl init requires an empty directory.`,
		);
	}
}
