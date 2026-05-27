import type { ErrnoException } from "node:fs";
import { readdir } from "node:fs/promises";

/** Throw if the target directory already contains any files or folders. */
export async function assertEmptyTargetDir(targetDir: string): Promise<void> {
	try {
		const entries = await readdir(targetDir);
		if (entries.length > 0) {
			throw new Error(
				`Target directory is not empty: ${targetDir}. pawl init requires an empty directory.`,
			);
		}
	} catch (error: unknown) {
		if (isNotFoundError(error)) return;
		throw error;
	}
}

function isNotFoundError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as ErrnoException).code === "ENOENT"
	);
}
