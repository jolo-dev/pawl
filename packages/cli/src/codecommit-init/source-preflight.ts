import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	analyzeCodeCommitSource,
	CodeCommitSourceLimitError,
	createCodeCommitSourceArchive,
} from "@pawl/cdk";

export interface CodeCommitPreflightResult {
	readonly fileCount: number;
	readonly totalBytes: number;
	readonly archiveBytes: number;
}

/**
 * Run source preflight: analyze, create exact ZIP, validate limits.
 *
 * Writes the ZIP under an OS temporary directory and removes it in `finally`.
 * Diagnostics print paths and sizes, never file contents.
 */
export function runCodeCommitSourcePreflight(options: {
	readonly sourcePath: string;
	readonly forceIncludePath?: string;
}): CodeCommitPreflightResult {
	const analysis = analyzeCodeCommitSource({
		sourcePath: options.sourcePath,
		forceIncludePath: options.forceIncludePath,
	});

	const tempDir = mkdtempSync(join(tmpdir(), "pawl-preflight-"));
	try {
		const archive = createCodeCommitSourceArchive({
			analysis,
			outputDirectory: tempDir,
		});
		return {
			fileCount: analysis.files.length,
			totalBytes: analysis.totalBytes,
			archiveBytes: archive.bytes,
		};
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

/**
 * Format a preflight or limit error into a concise diagnostic message.
 *
 * Never includes file contents.
 */
export function formatPreflightError(error: unknown): string {
	if (error instanceof CodeCommitSourceLimitError) {
		return error.message;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
