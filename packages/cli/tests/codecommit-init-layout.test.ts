import { describe, expect, test } from "bun:test";
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { access, constants } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ValidatedCodeCommitInitConfig } from "../src/codecommit-init/config";
import { resolveCodeCommitInitLayout } from "../src/codecommit-init/layout";

function makeConfig(
	overrides: Partial<ValidatedCodeCommitInitConfig> = {},
): ValidatedCodeCommitInitConfig {
	return {
		repositoryName: "my-repo",
		syncPath: undefined,
		noSync: true,
		directory: undefined,
		branchName: "main",
		autoReviewer: false,
		team: "platform",
		stage: "dev",
		install: true,
		deploy: false,
		...overrides,
	};
}

function makeDir(): string {
	return mkdtempSync(join(tmpdir(), "pawl-layout-"));
}

async function isReadableDir(p: string): Promise<boolean> {
	try {
		const stat = lstatSync(p);
		if (!stat.isDirectory()) return false;
		await access(p, constants.R_OK);
		return true;
	} catch {
		return false;
	}
}

describe("resolveCodeCommitInitLayout — sync mode", () => {
	test("resolves sync dot with default infra child", async () => {
		const root = makeDir();
		writeFileSync(join(root, "package.json"), "{}");
		writeFileSync(join(root, ".gitignore"), "infra/\n");
		const layout = await resolveCodeCommitInitLayout(
			root,
			makeConfig({ syncPath: ".", noSync: undefined }),
		);
		expect(layout.sourceRoot).toBe(realpathSync(root));
		expect(layout.infrastructureName).toBe("infra");
		expect(layout.projectDir).toBe(join(layout.sourceRoot, "infra"));
		expect(layout.sourcePathFromStack).toBe("..");
	});

	test("resolves sync dot with custom child name", async () => {
		const root = makeDir();
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src", "index.ts"), "");
		const layout = await resolveCodeCommitInitLayout(
			root,
			makeConfig({ syncPath: ".", directory: "ci-infra", noSync: undefined }),
		);
		expect(layout.infrastructureName).toBe("ci-infra");
		expect(layout.projectDir).toBe(join(layout.sourceRoot, "ci-infra"));
		expect(layout.sourcePathFromStack).toBe("..");
	});

	test("rejects dot, dotdot, absolute, separators, and reserved child names", async () => {
		const root = makeDir();
		const bad = [
			"",
			".",
			"..",
			"/abs",
			"a/b",
			"a\\b",
			".git",
			"node_modules",
			"cdk.out",
			".cdk.staging",
			".cdk.staging-123",
		];
		for (const dir of bad) {
			await expect(
				resolveCodeCommitInitLayout(
					root,
					makeConfig({ syncPath: ".", directory: dir, noSync: undefined }),
				),
			).rejects.toThrow();
		}
	});

	test("rejects an existing destination file", async () => {
		const root = makeDir();
		writeFileSync(join(root, "infra"), "blocker");
		await expect(
			resolveCodeCommitInitLayout(
				root,
				makeConfig({ syncPath: ".", noSync: undefined }),
			),
		).rejects.toThrow(/already exists/i);
	});

	test("rejects an existing destination directory", async () => {
		const root = makeDir();
		mkdirSync(join(root, "infra"));
		await expect(
			resolveCodeCommitInitLayout(
				root,
				makeConfig({ syncPath: ".", noSync: undefined }),
			),
		).rejects.toThrow(/already exists/i);
	});

	test("rejects external symlink at destination", async () => {
		const root = makeDir();
		const target = makeDir();
		symlinkSync(target, join(root, "infra"));
		await expect(
			resolveCodeCommitInitLayout(
				root,
				makeConfig({ syncPath: ".", noSync: undefined }),
			),
		).rejects.toThrow();
	});

	test("rejects an unreadable or missing sync path", async () => {
		const root = makeDir();
		await expect(
			resolveCodeCommitInitLayout(
				root,
				makeConfig({ syncPath: join(root, "nonexistent"), noSync: undefined }),
			),
		).rejects.toThrow();
	});

	test("rejects a file as sync path instead of a directory", async () => {
		const root = makeDir();
		writeFileSync(join(root, "file.txt"), "data");
		await expect(
			resolveCodeCommitInitLayout(
				root,
				makeConfig({ syncPath: join(root, "file.txt"), noSync: undefined }),
			),
		).rejects.toThrow();
	});

	test("does not mutate the sync root or create the directory", async () => {
		const root = makeDir();
		writeFileSync(join(root, "README.md"), "unchanged");
		const before = readdirSync(root).sort();
		const layout = await resolveCodeCommitInitLayout(
			root,
			makeConfig({ syncPath: ".", noSync: undefined }),
		);
		const after = readdirSync(root).sort();
		expect(after).toEqual(before);
		await expect(isReadableDir(layout.projectDir)).resolves.toBe(false);
	});
});

describe("resolveCodeCommitInitLayout — no-sync mode", () => {
	test("defaults to ./{repositoryName} and the root itself does not exist", async () => {
		const cwd = makeDir();
		const layout = await resolveCodeCommitInitLayout(cwd, makeConfig());
		expect(layout.sourceRoot).toBe(cwd);
		expect(layout.infrastructureName).toBeUndefined();
		expect(layout.projectDir).toBe(join(cwd, "my-repo"));
		expect(layout.sourcePathFromStack).toBe("..");
		await expect(isReadableDir(layout.projectDir)).resolves.toBe(false);
	});

	test("accepts a custom output path under an existing parent", async () => {
		const cwd = makeDir();
		mkdirSync(join(cwd, "projects"));
		const layout = await resolveCodeCommitInitLayout(
			cwd,
			makeConfig({ directory: "projects/my-repo" }),
		);
		expect(layout.projectDir).toBe(join(cwd, "projects", "my-repo"));
		expect(layout.sourceRoot).toBe(cwd);
		expect(layout.sourcePathFromStack).toBe("..");
	});

	test("rejects an existing file at the destination", async () => {
		const cwd = makeDir();
		writeFileSync(join(cwd, "my-repo"), "blocker");
		await expect(
			resolveCodeCommitInitLayout(cwd, makeConfig()),
		).rejects.toThrow(/already exists/i);
	});

	test("rejects an existing empty directory at the destination", async () => {
		const cwd = makeDir();
		mkdirSync(join(cwd, "my-repo"));
		await expect(
			resolveCodeCommitInitLayout(cwd, makeConfig()),
		).rejects.toThrow(/already exists/i);
	});

	test("rejects an existing non-empty directory at the destination", async () => {
		const cwd = makeDir();
		mkdirSync(join(cwd, "my-repo"));
		writeFileSync(join(cwd, "my-repo", "file.txt"), "data");
		await expect(
			resolveCodeCommitInitLayout(cwd, makeConfig()),
		).rejects.toThrow(/already exists/i);
	});

	test("rejects a symlink at the destination", async () => {
		const cwd = makeDir();
		const target = makeDir();
		symlinkSync(target, join(cwd, "my-repo"));
		await expect(
			resolveCodeCommitInitLayout(cwd, makeConfig()),
		).rejects.toThrow();
	});

	test("does not create the destination or mutate cwd", async () => {
		const cwd = makeDir();
		const before = readdirSync(cwd);
		const layout = await resolveCodeCommitInitLayout(cwd, makeConfig());
		const after = readdirSync(cwd);
		expect(after).toEqual(before);
		await expect(isReadableDir(layout.projectDir)).resolves.toBe(false);
	});
});
