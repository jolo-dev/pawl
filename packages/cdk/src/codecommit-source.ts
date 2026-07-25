import { createHash } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { IgnoreStrategy } from "aws-cdk-lib";

export const CODECOMMIT_SOURCE_LIMITS = {
	archiveBytes: 4_000_000,
	totalBytes: 20_000_000,
	fileBytes: 6_000_000,
	files: 100,
	pathCharacters: 4_096,
} as const;

export const CODECOMMIT_SECURITY_EXCLUDES = [
	"**/.git",
	"**/.git/**",
	"**/node_modules/**",
	"**/cdk.out/**",
	"**/.cdk.staging/**",
	"**/.env",
	"**/.env.*",
	"**/.aws/credentials",
	"**/.aws/config",
	"**/*.pem",
	"**/*.key",
	"**/*.p12",
	"**/*.pfx",
	"**/id_rsa",
	"**/id_ed25519",
] as const;

export interface AnalyzeCodeCommitSourceOptions {
	readonly sourcePath: string;
	readonly forceIncludePath?: string;
}

export interface CodeCommitSourceFile {
	readonly absolutePath: string;
	readonly relativePath: string;
	readonly bytes: number;
}

export interface CodeCommitSourceAnalysis {
	readonly files: readonly CodeCommitSourceFile[];
	readonly assetExcludes: readonly string[];
	readonly totalBytes: number;
}

export type CodeCommitSourceLimitKind =
	| "archiveBytes"
	| "fileBytes"
	| "files"
	| "pathCharacters"
	| "totalBytes";

export class CodeCommitSourceLimitError extends Error {
	readonly kind: CodeCommitSourceLimitKind;
	readonly limit: number;
	readonly actual: number;
	readonly relativePath?: string;

	constructor(options: {
		readonly kind: CodeCommitSourceLimitKind;
		readonly limit: number;
		readonly actual: number;
		readonly relativePath?: string;
		readonly reason?: string;
	}) {
		const pathDescription = options.relativePath
			? ` for ${JSON.stringify(options.relativePath)}`
			: "";
		super(
			options.reason ??
				`CodeCommit source ${options.kind}${pathDescription} is ${options.actual}; limit is ${options.limit}`,
		);
		this.name = "CodeCommitSourceLimitError";
		this.kind = options.kind;
		this.limit = options.limit;
		this.actual = options.actual;
		this.relativePath = options.relativePath;
	}
}

function readRegularFileWithoutFollowingSymlinks(absolutePath: string): Buffer {
	const descriptor = openSync(
		absolutePath,
		constants.O_RDONLY | constants.O_NOFOLLOW,
	);
	try {
		const metadata = fstatSync(descriptor);
		if (!metadata.isFile()) {
			throw new TypeError(
				`CodeCommit source entry is not a regular file: ${JSON.stringify(absolutePath)}`,
			);
		}
		return readFileSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
}

function readRootGitIgnore(sourcePath: string): string[] {
	const gitIgnorePath = path.join(sourcePath, ".gitignore");
	let metadata: ReturnType<typeof lstatSync>;
	try {
		metadata = lstatSync(gitIgnorePath);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return [];
		}
		throw error;
	}
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		return [];
	}
	if (metadata.size > CODECOMMIT_SOURCE_LIMITS.fileBytes) {
		throw new CodeCommitSourceLimitError({
			kind: "fileBytes",
			limit: CODECOMMIT_SOURCE_LIMITS.fileBytes,
			actual: metadata.size,
			relativePath: ".gitignore",
		});
	}
	return readRegularFileWithoutFollowingSymlinks(gitIgnorePath)
		.toString("utf8")
		.split("\n")
		.map((pattern) => (pattern.endsWith("\r") ? pattern.slice(0, -1) : pattern))
		.filter((pattern) => pattern.length > 0);
}

function validateForceIncludePath(forceIncludePath: string): void {
	if (
		!/^[A-Za-z0-9._-]+$/.test(forceIncludePath) ||
		forceIncludePath === "." ||
		forceIncludePath === ".."
	) {
		throw new TypeError("forceIncludePath must be one safe direct child name");
	}
}

function comparePaths(left: string, right: string): number {
	if (left === right) return 0;
	return left < right ? -1 : 1;
}

function validateFileLimits(files: readonly CodeCommitSourceFile[]): number {
	if (files.length === 0) {
		throw new CodeCommitSourceLimitError({
			kind: "files",
			limit: 1,
			actual: 0,
			reason: "CodeCommit source must contain at least one file",
		});
	}
	if (files.length > CODECOMMIT_SOURCE_LIMITS.files) {
		throw new CodeCommitSourceLimitError({
			kind: "files",
			limit: CODECOMMIT_SOURCE_LIMITS.files,
			actual: files.length,
		});
	}

	let totalBytes = 0;
	for (const file of files) {
		if (file.relativePath.length > CODECOMMIT_SOURCE_LIMITS.pathCharacters) {
			throw new CodeCommitSourceLimitError({
				kind: "pathCharacters",
				limit: CODECOMMIT_SOURCE_LIMITS.pathCharacters,
				actual: file.relativePath.length,
				relativePath: file.relativePath,
			});
		}
		if (file.bytes > CODECOMMIT_SOURCE_LIMITS.fileBytes) {
			throw new CodeCommitSourceLimitError({
				kind: "fileBytes",
				limit: CODECOMMIT_SOURCE_LIMITS.fileBytes,
				actual: file.bytes,
				relativePath: file.relativePath,
			});
		}
		totalBytes += file.bytes;
	}
	if (totalBytes > CODECOMMIT_SOURCE_LIMITS.totalBytes) {
		throw new CodeCommitSourceLimitError({
			kind: "totalBytes",
			limit: CODECOMMIT_SOURCE_LIMITS.totalBytes,
			actual: totalBytes,
		});
	}
	return totalBytes;
}

export function analyzeCodeCommitSource(
	options: AnalyzeCodeCommitSourceOptions,
): CodeCommitSourceAnalysis {
	const sourcePath = path.resolve(options.sourcePath);
	const sourceMetadata = lstatSync(sourcePath);
	if (!sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink()) {
		throw new TypeError("CodeCommit sourcePath must be a real directory");
	}

	const assetExcludes = readRootGitIgnore(sourcePath);
	if (options.forceIncludePath !== undefined) {
		validateForceIncludePath(options.forceIncludePath);
		assetExcludes.push(
			`!/${options.forceIncludePath}/`,
			`!/${options.forceIncludePath}/**`,
		);
	}
	assetExcludes.push(...CODECOMMIT_SECURITY_EXCLUDES);
	const ignoreStrategy = IgnoreStrategy.git(sourcePath, assetExcludes);
	const files: CodeCommitSourceFile[] = [];
	const symlinkExcludes: string[] = [];

	function visit(absoluteDirectory: string, relativeDirectory: string): void {
		for (const name of readdirSync(absoluteDirectory).sort(comparePaths)) {
			const absolutePath = path.join(absoluteDirectory, name);
			const relativePath = relativeDirectory
				? `${relativeDirectory}/${name}`
				: name;
			const metadata = lstatSync(absolutePath);
			if (metadata.isSymbolicLink()) {
				symlinkExcludes.push(relativePath);
				continue;
			}
			if (metadata.isDirectory()) {
				if (!ignoreStrategy.completelyIgnores(absolutePath)) {
					visit(absolutePath, relativePath);
				}
				continue;
			}
			if (metadata.isFile() && !ignoreStrategy.ignores(absolutePath)) {
				files.push({
					absolutePath,
					relativePath,
					bytes: metadata.size,
				});
			}
		}
	}

	visit(sourcePath, "");
	files.sort((left, right) =>
		comparePaths(left.relativePath, right.relativePath),
	);
	symlinkExcludes.sort(comparePaths);
	assetExcludes.push(...symlinkExcludes);
	const totalBytes = validateFileLimits(files);
	return { files, assetExcludes, totalBytes };
}

function crc32(contents: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of contents) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function validateArchivePath(relativePath: string): void {
	const segments = relativePath.split("/");
	if (
		relativePath.length === 0 ||
		path.posix.isAbsolute(relativePath) ||
		path.win32.isAbsolute(relativePath) ||
		relativePath.includes("\\") ||
		relativePath.includes("\0") ||
		segments.some(
			(segment) => segment === "" || segment === "." || segment === "..",
		)
	) {
		throw new CodeCommitSourceLimitError({
			kind: "pathCharacters",
			limit: CODECOMMIT_SOURCE_LIMITS.pathCharacters,
			actual: relativePath.length,
			relativePath,
			reason: `Unsafe CodeCommit source path: ${JSON.stringify(relativePath)}`,
		});
	}
}

interface ArchiveEntry {
	readonly relativePath: string;
	readonly name: Buffer;
	readonly contents: Buffer;
	readonly compressed: Buffer;
	readonly crc: number;
}

function createLocalHeader(entry: ArchiveEntry): Buffer {
	const header = Buffer.alloc(30);
	header.writeUInt32LE(0x04034b50, 0);
	header.writeUInt16LE(20, 4);
	header.writeUInt16LE(0x0800, 6);
	header.writeUInt16LE(8, 8);
	header.writeUInt16LE(0, 10);
	header.writeUInt16LE(0x0021, 12);
	header.writeUInt32LE(entry.crc, 14);
	header.writeUInt32LE(entry.compressed.byteLength, 18);
	header.writeUInt32LE(entry.contents.byteLength, 22);
	header.writeUInt16LE(entry.name.byteLength, 26);
	header.writeUInt16LE(0, 28);
	return header;
}

function createCentralHeader(entry: ArchiveEntry, localOffset: number): Buffer {
	const header = Buffer.alloc(46);
	header.writeUInt32LE(0x02014b50, 0);
	header.writeUInt16LE(20, 4);
	header.writeUInt16LE(20, 6);
	header.writeUInt16LE(0x0800, 8);
	header.writeUInt16LE(8, 10);
	header.writeUInt16LE(0, 12);
	header.writeUInt16LE(0x0021, 14);
	header.writeUInt32LE(entry.crc, 16);
	header.writeUInt32LE(entry.compressed.byteLength, 20);
	header.writeUInt32LE(entry.contents.byteLength, 24);
	header.writeUInt16LE(entry.name.byteLength, 28);
	header.writeUInt16LE(0, 30);
	header.writeUInt16LE(0, 32);
	header.writeUInt16LE(0, 34);
	header.writeUInt16LE(0, 36);
	header.writeUInt32LE(0, 38);
	header.writeUInt32LE(localOffset, 42);
	return header;
}

function createEndOfCentralDirectory(
	entries: number,
	centralBytes: number,
	centralOffset: number,
): Buffer {
	const footer = Buffer.alloc(22);
	footer.writeUInt32LE(0x06054b50, 0);
	footer.writeUInt16LE(0, 4);
	footer.writeUInt16LE(0, 6);
	footer.writeUInt16LE(entries, 8);
	footer.writeUInt16LE(entries, 10);
	footer.writeUInt32LE(centralBytes, 12);
	footer.writeUInt32LE(centralOffset, 16);
	footer.writeUInt16LE(0, 20);
	return footer;
}

export function createCodeCommitSourceArchive(options: {
	readonly analysis: CodeCommitSourceAnalysis;
	readonly outputDirectory: string;
}): { readonly archivePath: string; readonly bytes: number } {
	const sortedFiles = [...options.analysis.files].sort((left, right) =>
		comparePaths(left.relativePath, right.relativePath),
	);
	validateFileLimits(sortedFiles);
	const seenPaths = new Set<string>();
	const hash = createHash("sha256");
	const entries: ArchiveEntry[] = [];
	let actualTotalBytes = 0;

	for (const file of sortedFiles) {
		validateArchivePath(file.relativePath);
		if (seenPaths.has(file.relativePath)) {
			throw new TypeError(
				`Duplicate CodeCommit source path: ${JSON.stringify(file.relativePath)}`,
			);
		}
		seenPaths.add(file.relativePath);
		const contents = readRegularFileWithoutFollowingSymlinks(file.absolutePath);
		if (contents.byteLength > CODECOMMIT_SOURCE_LIMITS.fileBytes) {
			throw new CodeCommitSourceLimitError({
				kind: "fileBytes",
				limit: CODECOMMIT_SOURCE_LIMITS.fileBytes,
				actual: contents.byteLength,
				relativePath: file.relativePath,
			});
		}
		actualTotalBytes += contents.byteLength;
		if (actualTotalBytes > CODECOMMIT_SOURCE_LIMITS.totalBytes) {
			throw new CodeCommitSourceLimitError({
				kind: "totalBytes",
				limit: CODECOMMIT_SOURCE_LIMITS.totalBytes,
				actual: actualTotalBytes,
			});
		}
		const name = Buffer.from(file.relativePath, "utf8");
		const compressed = deflateRawSync(contents, { level: 9 });
		hash.update(Buffer.from(`${name.byteLength}:`));
		hash.update(name);
		hash.update(Buffer.from(`${contents.byteLength}:`));
		hash.update(contents);
		entries.push({
			relativePath: file.relativePath,
			name,
			contents,
			compressed,
			crc: crc32(contents),
		});
	}

	const localParts: Buffer[] = [];
	const centralParts: Buffer[] = [];
	let localOffset = 0;
	for (const entry of entries) {
		const localHeader = createLocalHeader(entry);
		localParts.push(localHeader, entry.name, entry.compressed);
		centralParts.push(createCentralHeader(entry, localOffset), entry.name);
		localOffset +=
			localHeader.byteLength +
			entry.name.byteLength +
			entry.compressed.byteLength;
	}
	const centralBytes = centralParts.reduce(
		(total, part) => total + part.byteLength,
		0,
	);
	const archive = Buffer.concat([
		...localParts,
		...centralParts,
		createEndOfCentralDirectory(entries.length, centralBytes, localOffset),
	]);
	mkdirSync(options.outputDirectory, { recursive: true });
	const archivePath = path.join(
		options.outputDirectory,
		`codecommit-source-${hash.digest("hex")}.zip`,
	);
	writeFileSync(archivePath, archive, { flag: "w" });
	const bytes = statSync(archivePath).size;
	if (bytes > CODECOMMIT_SOURCE_LIMITS.archiveBytes) {
		rmSync(archivePath, { force: true });
		throw new CodeCommitSourceLimitError({
			kind: "archiveBytes",
			limit: CODECOMMIT_SOURCE_LIMITS.archiveBytes,
			actual: bytes,
		});
	}
	return { archivePath, bytes };
}
