import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
	createProjectSettingsStore,
	type ProjectSettings,
	SettingsError,
	type SettingsLoad,
} from "../src/settings";

const selection = {
	version: 1,
	profile: "jolo",
	region: "eu-central-1",
	modelId: "eu.amazon.nova-2-lite-v1:0",
	modelName: "Nova 2 Lite",
} satisfies ProjectSettings;

// Record content and metadata, but not access times changed by our own reads.
async function snapshot(path: string): Promise<unknown> {
	const stat = await lstat(path);
	const metadata = { mode: stat.mode, mtime: stat.mtimeMs };
	if (stat.isSymbolicLink()) {
		return { ...metadata, target: await readlink(path) };
	}
	if (stat.isDirectory()) {
		const entries = await readdir(path);
		return {
			...metadata,
			entries: await Promise.all(
				entries
					.sort()
					.map(async (entry) => [entry, await snapshot(join(path, entry))]),
			),
		};
	}
	return { ...metadata, content: await readFile(path, "utf8") };
}

function unusable(result: SettingsLoad, path: string): string {
	expect(result.kind).toBe("unusable");
	if (result.kind !== "unusable") throw new Error("Expected unusable settings");
	expect(result.reason).toContain(path);
	expect(result.reason).toMatch(/check|remove|replace|repair|permission/i);
	return result.reason;
}

describe("project settings loading", () => {
	let root: string;
	let project: string;
	let directory: string;
	let file: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "pawl-settings-"));
		project = join(root, "project");
		directory = join(project, ".pawl");
		file = join(directory, "settings.json");
		await mkdir(project);
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	async function fixture(value: unknown = selection) {
		await mkdir(directory, { recursive: true });
		await writeFile(file, JSON.stringify(value));
	}

	async function loadUnchanged() {
		const before = await snapshot(root);
		const result = await createProjectSettingsStore(project).load();
		expect(await snapshot(root)).toEqual(before);
		return result;
	}

	test("missing .pawl does not create it or search ancestors", async () => {
		await mkdir(join(root, ".pawl"));
		await writeFile(
			join(root, ".pawl/settings.json"),
			JSON.stringify(selection),
		);
		expect(await loadUnchanged()).toEqual({ kind: "missing" });
	});

	test("missing settings preserves other .pawl files", async () => {
		await mkdir(directory);
		await writeFile(join(directory, "plan.md"), "keep this plan");
		expect(await loadUnchanged()).toEqual({ kind: "missing" });
	});

	test("loads valid v1 settings without rewriting them", async () => {
		await fixture();
		expect(await loadUnchanged()).toEqual({
			kind: "saved",
			settings: selection,
		});
	});

	test("trims plain spaces and accepts strings at their limits", async () => {
		const settings = {
			...selection,
			profile: "p".repeat(256),
			region: "r".repeat(64),
			modelId: "i".repeat(256),
			modelName: "n".repeat(256),
		};
		await fixture({ ...settings, profile: `  ${settings.profile}  ` });
		expect(await loadUnchanged()).toEqual({ kind: "saved", settings });
	});

	test("projects keep independent settings, including relative project paths", async () => {
		await fixture();
		const other = join(root, "other");
		await mkdir(join(other, ".pawl"), { recursive: true });
		const otherSelection = {
			...selection,
			profile: "other",
			modelId: "other-model",
		};
		await writeFile(
			join(other, ".pawl/settings.json"),
			JSON.stringify(otherSelection),
		);
		expect(await loadUnchanged()).toEqual({
			kind: "saved",
			settings: selection,
		});
		const before = await snapshot(root);
		expect(
			await createProjectSettingsStore(relative(process.cwd(), other)).load(),
		).toEqual({
			kind: "saved",
			settings: otherSelection,
		});
		expect(await snapshot(root)).toEqual(before);
	});

	test("invalid JSON has actionable diagnostics without raw contents", async () => {
		await fixture();
		await writeFile(file, '{"SECRET-MALFORMED-CONTENT":');
		const reason = unusable(await loadUnchanged(), file);
		expect(reason).toMatch(/JSON/i);
		expect(reason).not.toContain("SECRET-MALFORMED-CONTENT");
	});

	for (const [name, value] of [
		["unsupported version", { ...selection, version: 2 }],
		["missing version", { profile: "jolo" }],
		["unknown field", { ...selection, secret: "SECRET-CONTENT" }],
		["null", null],
		["array", [selection]],
	] as const) {
		test(`rejects ${name} without modifying it`, async () => {
			await fixture(value);
			expect(unusable(await loadUnchanged(), file)).not.toContain(
				"SECRET-CONTENT",
			);
		});
	}

	for (const [field, max] of [
		["profile", 256],
		["region", 64],
		["modelId", 256],
		["modelName", 256],
	] as const) {
		for (const [name, value] of [
			["empty", ""],
			["blank", "   "],
			["too long", "x".repeat(max + 1)],
			["wrong type", 123],
			["newline", "valid\n"],
			["tab", "\tvalid"],
			["escape", "valid\u001b[31m"],
			["NUL", "valid\u0000"],
			["DEL", "valid\u007f"],
			["C1", "valid\u0085"],
			["C1 upper bound", "valid\u009f"],
		] as const) {
			test(`rejects ${name} ${field} before trimming`, async () => {
				await fixture({ ...selection, [field]: value });
				unusable(await loadUnchanged(), file);
			});
		}
	}

	test("rejects a non-directory .pawl", async () => {
		await writeFile(directory, "not a directory");
		unusable(await loadUnchanged(), directory);
	});

	test("rejects a non-file settings path", async () => {
		await mkdir(file, { recursive: true });
		unusable(await loadUnchanged(), file);
	});

	for (const target of ["directory", "file"] as const) {
		test(`unreadable ${target} is unusable, not missing`, async () => {
			await fixture();
			const path = target === "directory" ? directory : file;
			const before = await snapshot(root);
			const mode = (await lstat(path)).mode;
			await chmod(path, 0);
			try {
				unusable(await createProjectSettingsStore(project).load(), path);
			} finally {
				await chmod(path, mode);
			}
			expect(await snapshot(root)).toEqual(before);
		});
	}

	for (const target of ["directory", "file"] as const) {
		for (const dangling of [false, true]) {
			test(`rejects ${dangling ? "dangling" : "valid"} symlinked ${target} without following it`, async () => {
				const external = join(root, "external");
				if (!dangling) {
					if (target === "directory") {
						await mkdir(external);
						await writeFile(
							join(external, "settings.json"),
							JSON.stringify(selection),
						);
					} else {
						await writeFile(external, JSON.stringify(selection));
					}
				}
				if (target === "file") await mkdir(directory);
				const path = target === "directory" ? directory : file;
				await symlink(external, path);
				expect(unusable(await loadUnchanged(), path)).toMatch(
					/symlink|symbolic link/i,
				);
			});
		}
	}
});

// The shared managed block from src/pawl-local-files.ts now covers settings,
// sessions and artifacts with one deterministic final block.
const ignoreBlock =
	"# pawl local private files (settings, sessions, artifacts)\n/settings.json\n/.settings-*.tmp\n/sessions/\n/.sessions-*.tmp\n/artifacts/\n/.artifacts-*.tmp\n";

describe("project settings saving", () => {
	let root: string;
	let project: string;
	let directory: string;
	let file: string;
	let ignore: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "pawl-settings-save-"));
		project = join(root, "project");
		directory = join(project, ".pawl");
		file = join(directory, "settings.json");
		ignore = join(directory, ".gitignore");
		await mkdir(project);
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	async function fixture() {
		await mkdir(directory);
		await writeFile(file, "previous settings bytes");
	}

	async function expectFailure(
		store = createProjectSettingsStore(project),
		path = file,
	) {
		try {
			await store.save(selection);
			throw new Error("Expected save to fail");
		} catch (error) {
			expect(error).toBeInstanceOf(SettingsError);
			if (!(error instanceof SettingsError)) throw error;
			expect(error.message).toContain(path);
			return error;
		}
	}

	async function expectNoTemps() {
		expect(
			(await readdir(directory)).filter((name) =>
				name.startsWith(".settings-"),
			),
		).toEqual([]);
	}

	test("writes exactly the allowed validated keys and a final newline", async () => {
		const extra = {
			...selection,
			version: 99,
			profile: "  jolo  ",
			credentials: "DO-NOT-SAVE",
			token: "SECRET",
		};
		await createProjectSettingsStore(project).save(extra);
		const contents = await readFile(file, "utf8");
		expect(JSON.parse(contents)).toEqual(selection);
		expect(contents.endsWith("\n")).toBe(true);
		expect(contents).not.toContain("SECRET");
		expect(await readFile(ignore, "utf8")).toBe(ignoreBlock);
		await expectNoTemps();
	});

	test.skipIf(process.platform === "win32")(
		"uses mode 0600 for new and replaced settings",
		async () => {
			const store = createProjectSettingsStore(project);
			await store.save(selection);
			expect((await lstat(file)).mode & 0o777).toBe(0o600);
			await chmod(file, 0o644);
			await store.save(selection);
			expect((await lstat(file)).mode & 0o777).toBe(0o600);
		},
	);

	for (const invalid of ["", "bad\n", "x".repeat(257)]) {
		test(`validates before creating or changing files (${JSON.stringify(invalid.slice(0, 8))})`, async () => {
			const before = await snapshot(root);
			await expect(
				createProjectSettingsStore(project).save({
					...selection,
					profile: invalid,
				}),
			).rejects.toBeInstanceOf(SettingsError);
			expect(await snapshot(root)).toEqual(before);
			await fixture();
			const existing = await snapshot(root);
			await expect(
				createProjectSettingsStore(project).save({
					...selection,
					profile: invalid,
				}),
			).rejects.toBeInstanceOf(SettingsError);
			expect(await snapshot(root)).toEqual(existing);
		});
	}

	for (const content of [
		"",
		"# keep me",
		"# keep me\n",
		"# keep me\r\n",
		`${ignoreBlock}!/settings.json\n!/.settings-*.tmp\n`,
	]) {
		test(`preserves ignore content and plans, appends a final block, and is idempotent (${JSON.stringify(content)})`, async () => {
			await fixture();
			await writeFile(ignore, content);
			const plan = join(directory, "plan.md");
			const rootIgnore = join(project, ".gitignore");
			await writeFile(plan, "important plan\n");
			await writeFile(rootIgnore, "# root rules\n");
			const beforePlan = await snapshot(plan);
			const beforeRootIgnore = await snapshot(rootIgnore);
			const store = createProjectSettingsStore(project);
			await store.save(selection);
			expect(await readFile(ignore, "utf8")).toBe(
				content +
					(content && !content.endsWith("\n") ? "\n" : "") +
					ignoreBlock,
			);
			const beforeIgnore = await snapshot(ignore);
			await store.save(selection);
			expect(await snapshot(ignore)).toEqual(beforeIgnore);
			expect(await snapshot(plan)).toEqual(beforePlan);
			expect(await snapshot(rootIgnore)).toEqual(beforeRootIgnore);
			expect(JSON.parse(await readFile(file, "utf8"))).toEqual(selection);
			await expectNoTemps();
		});
	}

	for (const ending of ["", "\n"]) {
		test(`does not rewrite an already final ignore block (ending ${JSON.stringify(ending)})`, async () => {
			await fixture();
			await writeFile(ignore, `# keep\n${ignoreBlock.trimEnd()}${ending}`);
			const before = await snapshot(ignore);
			await createProjectSettingsStore(project).save(selection);
			expect(await snapshot(ignore)).toEqual(before);
		});
	}

	for (const target of ["directory", "settings", "ignore"] as const) {
		for (const dangling of [false, true]) {
			test(`rejects ${dangling ? "dangling" : "valid"} symlinked ${target} without touching its target`, async () => {
				const external = join(root, "external");
				if (!dangling) {
					if (target === "directory") await mkdir(external);
					else await writeFile(external, "external bytes");
				}
				if (target !== "directory") await mkdir(directory);
				const path =
					target === "directory"
						? directory
						: target === "settings"
							? file
							: ignore;
				await symlink(external, path);
				const before = await snapshot(root);
				expect((await expectFailure(undefined, path)).message).toMatch(
					/symbolic link|symlink/i,
				);
				expect(await snapshot(root)).toEqual(before);
			});
		}
	}

	for (const target of ["directory", "settings", "ignore"] as const) {
		test(`rejects non-${target === "directory" ? "directory" : "file"} ${target}`, async () => {
			const path =
				target === "directory"
					? directory
					: target === "settings"
						? file
						: ignore;
			if (target === "directory") await writeFile(path, "not a directory");
			else await mkdir(path, { recursive: true });
			const before = await snapshot(root);
			await expectFailure(undefined, path);
			expect(await snapshot(root)).toEqual(before);
		});
	}

	test("ignore write failure preserves existing settings and creates no temp", async () => {
		await fixture();
		await writeFile(ignore, "# existing\n");
		await chmod(ignore, 0o400);
		const before = await snapshot(root);
		try {
			await expectFailure(undefined, ignore);
			expect(await snapshot(root)).toEqual(before);
		} finally {
			await chmod(ignore, 0o600);
		}
		await expectNoTemps();
	});

	test("temp creation failure leaves previous settings intact", async () => {
		await fixture();
		await writeFile(ignore, ignoreBlock);
		await chmod(directory, 0o500);
		try {
			const error = await expectFailure(undefined, directory);
			expect(error.message).toMatch(/creat|writ/i);
			expect(await readFile(file, "utf8")).toBe("previous settings bytes");
			await expectNoTemps();
		} finally {
			await chmod(directory, 0o700);
		}
	});

	test("renames only a completely written private sibling over the previous file", async () => {
		await fixture();
		let calls = 0;
		const store = createProjectSettingsStore(project, {
			rename: async (source, destination) => {
				calls++;
				expect(String(source)).toMatch(/\.settings-[0-9a-f-]{36}\.tmp$/);
				expect(String(destination)).toBe(file);
				expect(await readFile(source, "utf8")).toBe(
					`${JSON.stringify(selection, null, 2)}\n`,
				);
				expect((await lstat(source)).mode & 0o777).toBe(0o600);
				expect(await readFile(file, "utf8")).toBe("previous settings bytes");
				await rename(source, destination);
			},
		});
		await store.save(selection);
		expect(calls).toBe(1);
		await expectNoTemps();
	});

	test("failed rename preserves previous settings and removes only the owned temp", async () => {
		await fixture();
		const otherTemp = join(directory, ".settings-other.tmp");
		await writeFile(otherTemp, "not ours");
		const previous = await snapshot(file);
		const store = createProjectSettingsStore(project, {
			rename: async () => {
				throw new Error("injected rename failure");
			},
		});
		expect((await expectFailure(store)).message).toMatch(/rename/i);
		expect(await snapshot(file)).toEqual(previous);
		expect(await readFile(otherTemp, "utf8")).toBe("not ours");
		expect(
			(await readdir(directory)).filter((name) =>
				name.startsWith(".settings-"),
			),
		).toEqual([".settings-other.tmp"]);
	});

	test("reports cleanup failure along with rename failure", async () => {
		await fixture();
		const store = createProjectSettingsStore(project, {
			rename: async () => {
				await chmod(directory, 0o500);
				throw new Error("injected rename failure");
			},
		});
		try {
			const error = await expectFailure(store);
			expect(error.message).toMatch(/rename/i);
			expect(error.message).toMatch(/clean.*\.settings-/i);
			expect(await readFile(file, "utf8")).toBe("previous settings bytes");
			expect(
				(await readdir(directory)).filter((name) =>
					name.startsWith(".settings-"),
				).length,
			).toBe(1);
		} finally {
			await chmod(directory, 0o700);
		}
	});

	test("saves independently in explicit project directories without ancestor or home lookup", async () => {
		const other = join(root, "other");
		await mkdir(other);
		await mkdir(join(root, ".pawl"));
		await writeFile(
			join(root, ".pawl/settings.json"),
			"ancestor must remain untouched",
		);
		const ancestor = await snapshot(join(root, ".pawl"));
		await createProjectSettingsStore(project).save(selection);
		const otherSettings = { ...selection, profile: "other" };
		await createProjectSettingsStore(relative(process.cwd(), other)).save(
			otherSettings,
		);
		expect(await createProjectSettingsStore(project).load()).toEqual({
			kind: "saved",
			settings: selection,
		});
		expect(await createProjectSettingsStore(other).load()).toEqual({
			kind: "saved",
			settings: otherSettings,
		});
		expect(await snapshot(join(root, ".pawl"))).toEqual(ancestor);
	});

	test("Git ignores settings and temp files despite earlier negations, not plans", async () => {
		// All Git configuration is isolated to this disposable fixture, never the checkout or home.
		const env = {
			...process.env,
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_GLOBAL: "/dev/null",
			HOME: root,
			XDG_CONFIG_HOME: root,
		};
		const git = (...args: string[]) =>
			execFileSync("git", ["-C", project, ...args], { env, encoding: "utf8" });
		git("init", "--quiet");
		await fixture();
		await writeFile(
			ignore,
			`${ignoreBlock}!/settings.json\n!/.settings-*.tmp\n`,
		);
		await writeFile(join(directory, "plan.md"), "plan");
		await createProjectSettingsStore(project).save(selection);
		expect(
			git(
				"check-ignore",
				".pawl/settings.json",
				".pawl/.settings-probe.tmp",
				".pawl/plan.md",
			)
				.trim()
				.split("\n"),
		).toEqual([".pawl/settings.json", ".pawl/.settings-probe.tmp"]);
		expect(git("ls-files")).toBe("");
	});
});
