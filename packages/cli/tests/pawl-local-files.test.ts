import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ensurePawlSubdirectory,
	PAWL_LOCAL_FILES_BLOCK,
	protectPawlLocalFiles,
} from "../src/pawl-local-files";
import { createSessionStore } from "../src/pi-runtime/session-store";
import { createProjectSettingsStore } from "../src/settings";

// All Git configuration is isolated to disposable fixtures, never the checkout
// or the user's home, and fixtures are never staged or committed.
function gitEnv(root: string): NodeJS.ProcessEnv {
	return {
		...process.env,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		HOME: root,
		XDG_CONFIG_HOME: root,
	};
}

/** check-ignore semantics: stdout lists ignored paths; exit 1 means none. */
function checkIgnore(
	project: string,
	root: string,
	...paths: readonly string[]
): string[] {
	const result = spawnSync(
		"git",
		["-C", project, "check-ignore", "--", ...paths],
		{ env: gitEnv(root), encoding: "utf8" },
	);
	if (result.status === 0) {
		return (result.stdout ?? "").trim().split("\n").filter(Boolean);
	}
	expect(result.status).toBe(1); // only "nothing ignored" may reach here
	return [];
}

const privateProbes = [
	".pawl/settings.json",
	".pawl/.settings-probe.tmp",
	".pawl/sessions",
	".pawl/.sessions-probe.tmp",
	".pawl/artifacts",
	".pawl/.artifacts-probe.tmp",
] as const;

function sessionIdentity() {
	return {
		accountId: "123456789012",
		region: "eu-central-1",
		principalArn: "arn:aws:iam::123456789012:user/jolo",
	};
}

const sessionModel = { id: "eu.amazon.nova-2-lite-v1:0", name: "Nova 2 Lite" };

async function snapshotRoot(path: string): Promise<unknown> {
	const stat = await lstat(path);
	if (stat.isSymbolicLink()) {
		return { kind: "symlink", target: await readlink(path) };
	}
	if (stat.isDirectory()) {
		const entries = await readdir(path);
		return {
			kind: "directory",
			entries: await Promise.all(
				entries
					.sort()
					.map(async (entry) => [entry, await snapshotRoot(join(path, entry))]),
			),
		};
	}
	return { kind: "file", content: await readFile(path, "utf8") };
}

describe("shared pawl local file protection", () => {
	let root: string;
	let project: string;
	let directory: string;
	let ignore: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "pawl-local-files-"));
		project = join(root, "project");
		directory = join(project, ".pawl");
		ignore = join(directory, ".gitignore");
		await mkdir(project);
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	test("the managed block is deterministic and covers all private families", () => {
		expect(PAWL_LOCAL_FILES_BLOCK.split("\n")).toEqual([
			"# pawl local private files (settings, sessions, artifacts)",
			"/settings.json",
			"/.settings-*.tmp",
			"/sessions/",
			"/.sessions-*.tmp",
			"/artifacts/",
			"/.artifacts-*.tmp",
		]);
		expect(PAWL_LOCAL_FILES_BLOCK).not.toMatch(
			/credential|secret|token|access.?key/i,
		);
	});

	test("appends the managed block once and preserves unrelated content", async () => {
		await mkdir(directory);
		await writeFile(ignore, "# user rules\n/build/\n");
		await protectPawlLocalFiles(directory);
		expect(await readFile(ignore, "utf8")).toBe(
			`# user rules\n/build/\n${PAWL_LOCAL_FILES_BLOCK}\n`,
		);
		const before = await lstat(ignore);
		// Repeated protection from settings/session/artifact callers never appends again.
		await protectPawlLocalFiles(directory);
		await protectPawlLocalFiles(directory);
		expect(await readFile(ignore, "utf8")).toBe(
			`# user rules\n/build/\n${PAWL_LOCAL_FILES_BLOCK}\n`,
		);
		expect((await lstat(ignore)).mtimeMs).toBe(before.mtimeMs);
	});

	test("is idempotent when the file already ends with the managed block", async () => {
		await mkdir(directory);
		await writeFile(ignore, `# keep\n${PAWL_LOCAL_FILES_BLOCK}\n`);
		const before = await lstat(ignore);
		await protectPawlLocalFiles(directory);
		expect(await readFile(ignore, "utf8")).toBe(
			`# keep\n${PAWL_LOCAL_FILES_BLOCK}\n`,
		);
		expect((await lstat(ignore)).mtimeMs).toBe(before.mtimeMs);
	});

	test("keeps effective precedence over prior negations", async () => {
		await mkdir(directory);
		await writeFile(
			ignore,
			"!/settings.json\n!/.settings-*.tmp\n!/sessions/\n!/.sessions-*.tmp\n!/artifacts/\n!/.artifacts-*.tmp\n",
		);
		await protectPawlLocalFiles(directory);
		execFileSync("git", ["-C", project, "init", "--quiet"], {
			env: gitEnv(root),
			encoding: "utf8",
		});
		await mkdir(join(directory, "sessions"), { recursive: true });
		await mkdir(join(directory, "artifacts"), { recursive: true });
		expect(checkIgnore(project, root, ...privateProbes)).toEqual([
			...privateProbes,
		]);
	});
});

describe("alternating writes, plans and git exclusion", () => {
	let root: string;
	let project: string;
	let directory: string;
	let ignore: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "pawl-local-files-git-"));
		project = join(root, "project");
		directory = join(project, ".pawl");
		ignore = join(directory, ".gitignore");
		await mkdir(project);
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	const git = (args: readonly string[]) =>
		execFileSync("git", ["-C", project, ...args], {
			env: gitEnv(root),
			encoding: "utf8",
		});

	test("alternating settings, session and artifact writes cause no ignore churn", async () => {
		const settingsStore = createProjectSettingsStore(project);
		const selection = {
			version: 1,
			profile: "jolo",
			region: "eu-central-1",
			modelId: "eu.amazon.nova-2-lite-v1:0",
			modelName: "Nova 2 Lite",
		};
		await settingsStore.save(selection);
		await ensurePawlSubdirectory(directory, "sessions");
		await ensurePawlSubdirectory(directory, "artifacts");
		const settled = await readFile(ignore, "utf8");
		expect(settled).toBe(`${PAWL_LOCAL_FILES_BLOCK}\n`);
		for (let round = 0; round < 4; round++) {
			await settingsStore.save(selection);
			await ensurePawlSubdirectory(directory, "sessions");
			await ensurePawlSubdirectory(directory, "artifacts");
		}
		expect(await readFile(ignore, "utf8")).toBe(settled);
	});

	test("plans stay trackable while private files are excluded and no credential content appears in git", async () => {
		git(["init", "--quiet"]);
		await mkdir(directory);
		await writeFile(join(directory, "plan.md"), "important plan\n");
		await writeFile(join(directory, "settings.json"), '{"token":"AWS-SECRET"}');
		await protectPawlLocalFiles(directory);
		await mkdir(join(directory, "sessions"));
		await mkdir(join(directory, "artifacts"));
		expect(checkIgnore(project, root, ...privateProbes)).toEqual([
			...privateProbes,
		]);
		expect(checkIgnore(project, root, ".pawl/plan.md")).toEqual([]);
		git(["add", "-A"]);
		expect(git(["ls-files"]).trim().split("\n")).toEqual([
			".pawl/.gitignore",
			".pawl/plan.md",
		]);
		// Credential-like content never reaches the index.
		expect(git(["status", "--porcelain"])).not.toContain("settings.json");
	});
});

describe("symlink refusal", () => {
	let root: string;
	let project: string;
	let directory: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "pawl-local-links-"));
		project = join(root, "project");
		directory = join(project, ".pawl");
		await mkdir(project);
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	interface LinkSetup {
		readonly name: string;
		readonly protectRefuses: boolean;
		readonly ensureRefuses: boolean;
		readonly ensureName?: string;
		setup(root: string, directory: string): Promise<void>;
	}

	const setups: readonly LinkSetup[] = [
		{
			name: ".pawl itself",
			protectRefuses: true,
			ensureRefuses: true,
			setup: (root: string, directory: string) => symlink(root, directory),
		},
		{
			name: "the ignore file",
			// The ignore-file symlink only blocks ignore-rule protection; creating
			// the sessions subdirectory does not involve it.
			protectRefuses: true,
			ensureRefuses: false,
			setup: async (root: string, directory: string) => {
				await mkdir(directory);
				await writeFile(join(root, "target.txt"), "outside content");
				await symlink(join(root, "target.txt"), join(directory, ".gitignore"));
			},
		},
		{
			name: "the sessions directory",
			protectRefuses: false,
			ensureRefuses: true,
			setup: async (root: string, directory: string) => {
				await mkdir(directory);
				await writeFile(join(root, "outside.txt"), "outside bytes");
				await symlink(join(root, "outside.txt"), join(directory, "sessions"));
			},
		},
		{
			name: "the artifacts directory",
			protectRefuses: false,
			ensureRefuses: true,
			ensureName: "artifacts",
			setup: async (root: string, directory: string) => {
				await mkdir(directory);
				await writeFile(join(root, "outside.txt"), "outside bytes");
				await symlink(join(root, "outside.txt"), join(directory, "artifacts"));
			},
		},
		{
			name: "a sessions target through a symlinked directory",
			protectRefuses: false,
			ensureRefuses: true,
			ensureName: "sessions",
			setup: async (root: string, directory: string) => {
				await mkdir(directory);
				await mkdir(join(root, "elsewhere"));
				await symlink(join(root, "elsewhere"), join(directory, "sessions"));
			},
		},
	];

	for (const {
		name,
		protectRefuses,
		ensureRefuses,
		ensureName,
		setup,
	} of setups) {
		test(`refuses ${name} without following it`, async () => {
			await setup(root, directory);
			if (protectRefuses) {
				await expect(protectPawlLocalFiles(directory)).rejects.toThrow(
					/symbolic link/i,
				);
			} else {
				await expect(protectPawlLocalFiles(directory)).resolves.toBeUndefined();
			}
			const before = await snapshotRoot(root);
			if (ensureRefuses) {
				await expect(
					ensurePawlSubdirectory(directory, ensureName ?? "sessions"),
				).rejects.toThrow(/symbolic link/i);
				expect(await snapshotRoot(root)).toEqual(before);
			}
		});
	}

	test("rejects a non-file ignore path and a non-directory target", async () => {
		await mkdir(directory);
		await mkdir(join(directory, ".gitignore"));
		await expect(protectPawlLocalFiles(directory)).rejects.toThrow(
			/Expected a file/,
		);
		await writeFile(join(directory, "sessions"), "not a directory");
		await expect(ensurePawlSubdirectory(directory, "sessions")).rejects.toThrow(
			/directory/,
		);
	});

	test("reports append permission failures with the ignore path", async () => {
		await mkdir(directory);
		const ignorePath = join(directory, ".gitignore");
		await writeFile(ignorePath, "# existing\n");
		await chmod(ignorePath, 0o400);
		try {
			await expect(protectPawlLocalFiles(directory)).rejects.toThrow(
				ignorePath,
			);
		} finally {
			await chmod(ignorePath, 0o600);
		}
	});
});

describe("private session and artifact directories", () => {
	let root: string;
	let project: string;
	let directory: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "pawl-local-dirs-"));
		project = join(root, "project");
		directory = join(project, ".pawl");
		await mkdir(project);
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	test("creates private 0700 subdirectories for sessions and artifacts", async () => {
		const sessions = await ensurePawlSubdirectory(directory, "sessions");
		const artifacts = await ensurePawlSubdirectory(directory, "artifacts");
		expect(sessions).toBe(await realpath(join(directory, "sessions")));
		expect((await lstat(sessions)).mode & 0o777).toBe(0o700);
		expect((await lstat(artifacts)).mode & 0o777).toBe(0o700);
		expect((await lstat(directory)).mode & 0o777).toBe(0o700);
	});

	test("keeps an existing subdirectory and its content untouched", async () => {
		await mkdir(join(directory, "sessions"), { recursive: true });
		await writeFile(join(directory, "sessions", "old.jsonl"), "keep\n");
		const path = await ensurePawlSubdirectory(directory, "sessions");
		expect(await readFile(join(path, "old.jsonl"), "utf8")).toBe("keep\n");
	});

	test("session creation refuses a symlinked .pawl without touching the target", async () => {
		await mkdir(join(root, "elsewhere"));
		await symlink(join(root, "elsewhere"), directory);
		await expect(
			createSessionStore({
				sessionId: "s1",
				projectPath: project,
				identity: sessionIdentity(),
				model: sessionModel,
			}),
		).rejects.toThrow(/symbolic link/i);
		// Nothing was created through or beside the link.
		expect(await readdir(join(root, "elsewhere"))).toEqual([]);
	});
});
