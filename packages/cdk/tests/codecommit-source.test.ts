import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import {
	analyzeCodeCommitSource,
	CODECOMMIT_SECURITY_EXCLUDES,
	CODECOMMIT_SOURCE_LIMITS,
	type CodeCommitSourceAnalysis,
	CodeCommitSourceLimitError,
	createCodeCommitSourceArchive,
} from "../index";

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
	const directory = mkdtempSync(path.join(tmpdir(), "pawl-codecommit-source-"));
	temporaryDirectories.push(directory);
	return directory;
}

function write(
	root: string,
	relativePath: string,
	contents: string | Buffer,
): void {
	const absolutePath = path.join(root, ...relativePath.split("/"));
	mkdirSync(path.dirname(absolutePath), { recursive: true });
	writeFileSync(absolutePath, contents);
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

interface ParsedZipEntry {
	readonly contents: Buffer;
	readonly crc: number;
}

function parseZip(archivePath: string): Map<string, ParsedZipEntry> {
	const archive = readFileSync(archivePath);
	const entries = new Map<string, ParsedZipEntry>();
	let offset = 0;
	while (archive.readUInt32LE(offset) === 0x04034b50) {
		const flags = archive.readUInt16LE(offset + 6);
		const method = archive.readUInt16LE(offset + 8);
		const expectedCrc = archive.readUInt32LE(offset + 14);
		const compressedBytes = archive.readUInt32LE(offset + 18);
		const nameBytes = archive.readUInt16LE(offset + 26);
		const extraBytes = archive.readUInt16LE(offset + 28);
		expect(flags & 0x0800).toBe(0x0800);
		expect(method).toBe(8);
		const nameStart = offset + 30;
		const name = archive
			.subarray(nameStart, nameStart + nameBytes)
			.toString("utf8");
		const dataStart = nameStart + nameBytes + extraBytes;
		const contents = inflateRawSync(
			archive.subarray(dataStart, dataStart + compressedBytes),
		);
		expect(crc32(contents)).toBe(expectedCrc);
		entries.set(name, { contents, crc: expectedCrc });
		offset = dataStart + compressedBytes;
	}
	expect(archive.readUInt32LE(offset)).toBe(0x02014b50);
	return entries;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("analyzeCodeCommitSource", () => {
	test("honors root ignores, force-includes infrastructure, then reapplies immutable denies", () => {
		const root = makeTemporaryDirectory();
		write(root, ".gitignore", "ignored.txt\ninfra/\n");
		write(root, "app.ts", "app");
		write(root, "ignored.txt", "ignored");
		write(root, "infra/stacks/codecommit-stack.ts", "stack");
		write(root, "infra/node_modules/pkg/index.js", "dependency");
		write(root, "infra/cdk.out/template.json", "output");
		write(root, "infra/.cdk.staging/asset/file.ts", "staging");
		write(root, "infra/.env.example", "SECRET=example");
		write(root, "infra/nested/.env", "SECRET=value");
		write(root, "infra/nested/.aws/credentials", "credential");
		write(root, "infra/nested/.aws/config", "config");
		write(root, "infra/nested/server.pem", "pem");
		write(root, "infra/nested/server.key", "key");
		write(root, "infra/nested/server.p12", "p12");
		write(root, "infra/nested/server.pfx", "pfx");
		write(root, "infra/nested/id_rsa", "rsa");
		write(root, "infra/nested/id_ed25519", "ed25519");
		write(root, "infra/nested/.git/config", "git config");
		write(root, "infra/worktree/.git", "gitdir: /external/worktree");

		const result = analyzeCodeCommitSource({
			sourcePath: root,
			forceIncludePath: "infra",
		});
		const paths = result.files.map(({ relativePath }) => relativePath);

		expect(paths).toEqual([
			".gitignore",
			"app.ts",
			"infra/stacks/codecommit-stack.ts",
		]);
		expect(result.totalBytes).toBe(
			Buffer.byteLength("ignored.txt\ninfra/\n") +
				Buffer.byteLength("app") +
				Buffer.byteLength("stack"),
		);
		expect(result.assetExcludes).toEqual([
			"ignored.txt",
			"infra/",
			"!/infra/",
			"!/infra/**",
			...CODECOMMIT_SECURITY_EXCLUDES,
		]);
	});

	test("omits all symlinks without reading external targets and reports POSIX sorted paths", () => {
		const root = makeTemporaryDirectory();
		const external = makeTemporaryDirectory();
		write(root, "z-last.txt", "last");
		write(root, "nested/a-first.txt", "first");
		write(external, "external-secret.txt", "DO-NOT-READ-EXTERNAL-CONTENT");
		symlinkSync(
			path.join(external, "external-secret.txt"),
			path.join(root, "external-link"),
		);
		symlinkSync(path.join(external, "missing"), path.join(root, "broken-link"));
		symlinkSync(external, path.join(root, "directory-link"), "dir");

		const result = analyzeCodeCommitSource({ sourcePath: root });

		expect(result.files.map(({ relativePath }) => relativePath)).toEqual([
			"nested/a-first.txt",
			"z-last.txt",
		]);
		expect(
			result.files.every(({ relativePath }) => !relativePath.includes("\\")),
		).toBe(true);
		expect(result.assetExcludes.slice(-3)).toEqual([
			"broken-link",
			"directory-link",
			"external-link",
		]);
		expect(JSON.stringify(result)).not.toContain(
			"DO-NOT-READ-EXTERNAL-CONTENT",
		);
	});

	test("requires the source itself to be a real directory", () => {
		const root = makeTemporaryDirectory();
		const directory = path.join(root, "directory");
		mkdirSync(directory);
		write(root, "file.txt", "file");
		symlinkSync(directory, path.join(root, "directory-link"), "dir");

		expect(() =>
			analyzeCodeCommitSource({ sourcePath: path.join(root, "file.txt") }),
		).toThrow(/directory/i);
		expect(() =>
			analyzeCodeCommitSource({
				sourcePath: path.join(root, "directory-link"),
			}),
		).toThrow(/directory/i);
	});

	test("rejects an empty source", () => {
		const root = makeTemporaryDirectory();
		expect(() => analyzeCodeCommitSource({ sourcePath: root })).toThrow(
			CodeCommitSourceLimitError,
		);
	});

	test("rejects 101 included files with structured count metadata", () => {
		const root = makeTemporaryDirectory();
		for (let index = 0; index < 101; index += 1) {
			write(root, `file-${index.toString().padStart(3, "0")}.txt`, "x");
		}

		try {
			analyzeCodeCommitSource({ sourcePath: root });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(CodeCommitSourceLimitError);
			if (!(error instanceof CodeCommitSourceLimitError)) throw error;
			expect(error.limit).toBe(CODECOMMIT_SOURCE_LIMITS.files);
			expect(error.actual).toBe(101);
			expect(error.relativePath).toBeUndefined();
		}
	});

	test("rejects an individual file larger than 6,000,000 decimal bytes", () => {
		const root = makeTemporaryDirectory();
		write(root, "too-large.bin", Buffer.alloc(6_000_001, 0x73));

		try {
			analyzeCodeCommitSource({ sourcePath: root });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(CodeCommitSourceLimitError);
			if (!(error instanceof CodeCommitSourceLimitError)) throw error;
			expect(error.kind).toBe("fileBytes");
			expect(error.limit).toBe(6_000_000);
			expect(error.actual).toBe(6_000_001);
			expect(error.relativePath).toBe("too-large.bin");
			expect(JSON.stringify(error)).not.toContain("ssssssss");
		}
	});

	test("rejects aggregate source bytes larger than 20,000,000 decimal bytes", () => {
		const root = makeTemporaryDirectory();
		for (let index = 0; index < 4; index += 1) {
			write(
				root,
				`aggregate-${index}.bin`,
				Buffer.alloc(index === 3 ? 5_000_001 : 5_000_000, index),
			);
		}

		try {
			analyzeCodeCommitSource({ sourcePath: root });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(CodeCommitSourceLimitError);
			if (!(error instanceof CodeCommitSourceLimitError)) throw error;
			expect(error.kind).toBe("totalBytes");
			expect(error.limit).toBe(20_000_000);
			expect(error.actual).toBe(20_000_001);
		}
	});
});

describe("createCodeCommitSourceArchive", () => {
	test("writes a deterministic exact ZIP whose UTF-8 paths, bytes, and CRCs round-trip", () => {
		const root = makeTemporaryDirectory();
		const output = makeTemporaryDirectory();
		write(root, "z.txt", "last");
		write(root, "nested/å.txt", Buffer.from([0, 1, 2, 255]));
		write(root, "nested/.env", "SECRET=not-archived");
		symlinkSync(path.join(root, "z.txt"), path.join(root, "linked.txt"));
		const analysis = analyzeCodeCommitSource({ sourcePath: root });

		const first = createCodeCommitSourceArchive({
			analysis,
			outputDirectory: output,
		});
		const firstBytes = readFileSync(first.archivePath);
		const second = createCodeCommitSourceArchive({
			analysis,
			outputDirectory: output,
		});
		const entries = parseZip(first.archivePath);

		expect(second.archivePath).toBe(first.archivePath);
		expect(readFileSync(second.archivePath)).toEqual(firstBytes);
		expect(first.bytes).toBe(firstBytes.byteLength);
		expect(readdirSync(output)).toEqual([path.basename(first.archivePath)]);
		expect([...entries.keys()]).toEqual(["nested/å.txt", "z.txt"]);
		expect(entries.get("nested/å.txt")?.contents).toEqual(
			Buffer.from([0, 1, 2, 255]),
		);
		expect(entries.get("z.txt")?.contents.toString()).toBe("last");
		for (const entry of entries.values()) {
			expect(entry.crc).toBe(crc32(entry.contents));
		}
	});

	test("defensively rejects absolute, traversal, and overlong archive paths", () => {
		const root = makeTemporaryDirectory();
		const output = makeTemporaryDirectory();
		write(root, "safe.txt", "safe");
		const analyzed = analyzeCodeCommitSource({ sourcePath: root });
		const baseFile = analyzed.files[0];
		if (baseFile === undefined)
			throw new Error("Expected analyzed fixture file");

		for (const relativePath of [
			"/absolute.txt",
			"../traversal.txt",
			"nested/../../traversal.txt",
			`nested/${"a".repeat(4_090)}.txt`,
		]) {
			const analysis: CodeCommitSourceAnalysis = {
				...analyzed,
				files: [{ ...baseFile, relativePath }],
			};
			expect(() =>
				createCodeCommitSourceArchive({ analysis, outputDirectory: output }),
			).toThrow(CodeCommitSourceLimitError);
		}
	});

	test("rejects an exact incompressible ZIP larger than 4,000,000 decimal bytes", () => {
		const root = makeTemporaryDirectory();
		const output = makeTemporaryDirectory();
		write(root, "incompressible.bin", randomBytes(4_050_000));
		const analysis = analyzeCodeCommitSource({ sourcePath: root });

		try {
			createCodeCommitSourceArchive({ analysis, outputDirectory: output });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(CodeCommitSourceLimitError);
			if (!(error instanceof CodeCommitSourceLimitError)) throw error;
			expect(error.kind).toBe("archiveBytes");
			expect(error.limit).toBe(4_000_000);
			expect(error.actual).toBeGreaterThan(4_000_000);
			expect(error.relativePath).toBeUndefined();
		}
		expect(readdirSync(output)).toEqual([]);
	});
});
