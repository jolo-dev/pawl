import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertEmptyTargetDir } from "../src/scaffold/filesystem";

describe("assertEmptyTargetDir", () => {
	test("allows an empty directory", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-init-empty-"));
		await expect(assertEmptyTargetDir(dir)).resolves.toBeUndefined();
	});

	test("allows a missing directory", async () => {
		const dir = path.join(tmpdir(), `pawl-missing-${randomUUID()}`);
		await expect(assertEmptyTargetDir(dir)).resolves.toBeUndefined();
	});

	test("throws when the directory already has files", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pawl-init-nonempty-"));
		writeFileSync(path.join(dir, "README.md"), "existing file");
		await expect(assertEmptyTargetDir(dir)).rejects.toThrow(/not empty/i);
	});
});
