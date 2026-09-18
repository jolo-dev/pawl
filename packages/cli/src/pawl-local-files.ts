import type { Stats } from "node:fs";
import { appendFile, lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Shared protection for Pawl's private local files under `.pawl/`.
 *
 * `protectPawlLocalFiles` appends ONE deterministic final managed block to
 * `.pawl/.gitignore`, covering the settings, sessions and artifacts file
 * families plus their owned temporary files. Rules are appended last so prior
 * negations can never re-expose private content, and an already-final block is
 * never rewritten, so alternating settings/session/artifact writes cannot
 * churn the ignore file. All other user content is preserved.
 *
 * `ensurePawlSubdirectory` creates `.pawl/<name>` as a real directory with
 * mode 0700 and refuses symbolic links instead of following them, so session
 * or artifact IO is never redirected outside the selected project.
 *
 * These checks are NOT a sandbox: a malicious same-user process can still race
 * path checks, replace files between checks, or read anything the pawl process
 * can read. They protect against accidents (staging, sharing, redirected
 * writes), not against attackers.
 */

export class PawlLocalFilesError extends Error {}

/** The single managed ignore block, without a trailing newline. */
export const PAWL_LOCAL_FILES_BLOCK = [
	"# pawl local private files (settings, sessions, artifacts)",
	"/settings.json",
	"/.settings-*.tmp",
	"/sessions/",
	"/.sessions-*.tmp",
	"/artifacts/",
	"/.artifacts-*.tmp",
].join("\n");

function hasCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

/**
 * Shared path inspection. Symlinks are refused outright; an existing path must
 * have the expected kind. Returns the existing stat or undefined when missing.
 */
export async function expectRealPath(
	path: string,
	kind: "directory" | "file",
	detail: string,
): Promise<Stats | undefined> {
	let stat: Stats;
	try {
		stat = await lstat(path);
	} catch (error) {
		if (hasCode(error, "ENOENT")) return undefined;
		throw new PawlLocalFilesError(
			`Cannot inspect the path for ${detail} at ${path}. Check permissions and the path before retrying.`,
			{ cause: error },
		);
	}
	if (stat.isSymbolicLink()) {
		throw new PawlLocalFilesError(
			`Refusing symbolic link at ${path}. Remove or replace it with a project-local ${kind}.`,
		);
	}
	const matches = kind === "directory" ? stat.isDirectory() : stat.isFile();
	if (!matches) {
		throw new PawlLocalFilesError(
			`Expected a ${kind} at ${path}. Remove or replace this path before ${detail}.`,
		);
	}
	return stat;
}

/**
 * Idempotently ensures `.pawl/.gitignore` ends with the single deterministic
 * managed block covering all Pawl private file families. Existing content is
 * preserved and our block stays last so it wins over prior negations.
 */
export async function protectPawlLocalFiles(directory: string): Promise<void> {
	// A symlinked `.pawl` would silently redirect all private IO outside the
	// selected project; refuse it instead of following it.
	await expectRealPath(directory, "directory", "ignore-rule protection");
	const path = resolve(directory, ".gitignore");
	const stat = await expectRealPath(path, "file", "ignore-rule protection");
	const contents = stat ? await readIgnoreRules(path) : "";
	const withoutFinalNewline = contents.endsWith("\n")
		? contents.slice(0, -1)
		: contents;
	if (
		withoutFinalNewline === PAWL_LOCAL_FILES_BLOCK ||
		withoutFinalNewline.endsWith(`\n${PAWL_LOCAL_FILES_BLOCK}`)
	) {
		return;
	}
	// Keep our rules last so existing negations cannot expose local files.
	const separator = contents && !contents.endsWith("\n") ? "\n" : "";
	try {
		await appendFile(path, `${separator}${PAWL_LOCAL_FILES_BLOCK}\n`, {
			flag: stat ? "a" : "wx",
		});
	} catch (error) {
		throw new PawlLocalFilesError(
			`Cannot append local-file ignore rules at ${path}. Check permissions and the path before retrying.`,
			{ cause: error },
		);
	}
}

async function readIgnoreRules(path: string): Promise<string> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		throw new PawlLocalFilesError(
			`Cannot read ignore rules at ${path}. Check permissions and the path before retrying.`,
			{ cause: error },
		);
	}
}

/**
 * Ensures `.pawl/<name>` exists as a real directory with mode 0700, refusing
 * symlinks on both `.pawl` and the subdirectory. Returns the resolved
 * absolute path.
 */
export async function ensurePawlSubdirectory(
	directory: string,
	name: string,
): Promise<string> {
	let stat = await expectRealPath(
		directory,
		"directory",
		"local session storage",
	);
	if (!stat) {
		try {
			await mkdir(directory, { mode: 0o700 });
		} catch (error) {
			throw new PawlLocalFilesError(
				`Cannot create the private directory at ${directory}. Check permissions and the path before retrying.`,
				{ cause: error },
			);
		}
	}
	const subdirectory = resolve(directory, name);
	stat = await expectRealPath(
		subdirectory,
		"directory",
		"local session storage",
	);
	if (!stat) {
		try {
			await mkdir(subdirectory, { mode: 0o700 });
		} catch (error) {
			throw new PawlLocalFilesError(
				`Cannot create the ${name} directory at ${subdirectory}. Check permissions and the path before retrying.`,
				{ cause: error },
			);
		}
	}
	return realpath(subdirectory);
}
