import { describe, expect, test } from "bun:test";
import {
	formatCodeCommitInitHelp,
	parseCodeCommitInitArgs,
} from "../src/codecommit-init/cli";
import { validateCodeCommitInitConfig } from "../src/codecommit-init/config";

describe("parseCodeCommitInitArgs", () => {
	test("parses every scalar and positive boolean flag", () => {
		const parsed = parseCodeCommitInitArgs([
			"init",
			"codecommit",
			"--name",
			"repo",
			"--sync",
			".",
			"--directory",
			"infra",
			"--branch",
			"main",
			"--autoreviewer",
			"--model",
			"eu.anthropic.claude-sonnet-4-6",
			"--team",
			"platform",
			"--stage",
			"dev",
			"--install",
			"--deploy",
			"--aws-profile",
			"dev",
			"--region",
			"eu-central-1",
		]);

		expect(parsed).toEqual({
			repositoryName: "repo",
			syncPath: ".",
			directory: "infra",
			branchName: "main",
			autoReviewer: true,
			modelId: "eu.anthropic.claude-sonnet-4-6",
			team: "platform",
			stage: "dev",
			install: true,
			deploy: true,
			awsProfile: "dev",
			region: "eu-central-1",
		});
	});

	test("accepts arguments already sliced after init codecommit", () => {
		expect(parseCodeCommitInitArgs(["--sync", "."])).toEqual({
			syncPath: ".",
		});
	});

	test("preserves negative flags independently", () => {
		expect(
			parseCodeCommitInitArgs([
				"--no-sync",
				"--no-autoreviewer",
				"--no-install",
				"--no-deploy",
			]),
		).toEqual({
			noSync: true,
			noAutoReviewer: true,
			noInstall: true,
			noDeploy: true,
		});
	});

	test("preserves omitted boolean choices as omitted", () => {
		expect(parseCodeCommitInitArgs(["--name", "repo"])).toEqual({
			repositoryName: "repo",
		});
	});

	test("rejects unknown options and positionals", () => {
		expect(() => parseCodeCommitInitArgs(["--unknown"])).toThrow();
		expect(() => parseCodeCommitInitArgs(["repository"])).toThrow();
		expect(() =>
			parseCodeCommitInitArgs(["init", "other", "--name", "repo"]),
		).toThrow();
	});

	test("preserves contradictions for config normalization", () => {
		const parsed = parseCodeCommitInitArgs([
			"--sync",
			".",
			"--no-sync",
			"--autoreviewer",
			"--no-autoreviewer",
		]);
		expect(parsed).toMatchObject({
			syncPath: ".",
			noSync: true,
			autoReviewer: true,
			noAutoReviewer: true,
		});
	});

	test("records repeated flags so normalization rejects them", () => {
		const parsed = parseCodeCommitInitArgs([
			"--name",
			"first",
			"--name",
			"second",
		]);
		if ("kind" in parsed) throw new Error("Expected option flags");
		expect(() => validateCodeCommitInitConfig(parsed)).toThrow(/repeated/i);
	});

	test("returns a help bypass instead of option flags", () => {
		expect(parseCodeCommitInitArgs(["--help"])).toEqual({
			kind: "help",
			text: formatCodeCommitInitHelp(),
		});
	});
});

describe("formatCodeCommitInitHelp", () => {
	test("documents every flag, defaults, non-TTY requirements, and seeding", () => {
		const help = formatCodeCommitInitHelp();
		for (const flag of [
			"--name",
			"--sync",
			"--no-sync",
			"--directory",
			"--branch",
			"--autoreviewer",
			"--no-autoreviewer",
			"--model",
			"--team",
			"--stage",
			"--install",
			"--no-install",
			"--deploy",
			"--no-deploy",
			"--aws-profile",
			"--region",
			"--help",
		]) {
			expect(help).toContain(flag);
		}
		expect(help).toMatch(/default: main/i);
		expect(help).toMatch(/default: dev/i);
		expect(help).toMatch(/non-tty/i);
		expect(help).toMatch(/initial seed/i);
	});
});
