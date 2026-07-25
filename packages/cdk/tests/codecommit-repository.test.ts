import { describe, expect, test } from "bun:test";
import { CfnParameter, Stack, Token } from "aws-cdk-lib";
import { type IRepository, Repository } from "aws-cdk-lib/aws-codecommit";
import {
	CodeCommitBranchNameSchema,
	CodeCommitRepositoryNameSchema,
	normalizeRepositoryTarget,
	type RepositoryTarget,
} from "../index";
import { createTestApp } from "./utils";

describe("CodeCommitRepositoryNameSchema", () => {
	test("trims valid names and accepts the length boundaries", () => {
		expect(
			CodeCommitRepositoryNameSchema.parse("  conventional.repo-1  "),
		).toBe("conventional.repo-1");
		expect(CodeCommitRepositoryNameSchema.safeParse("a").success).toBe(true);
		expect(
			CodeCommitRepositoryNameSchema.safeParse("a".repeat(100)).success,
		).toBe(true);
	});

	test.each([
		"",
		"a".repeat(101),
		"has space",
		"repo/name",
		"repo.git",
	])("rejects invalid repository name %p", (repositoryName) => {
		expect(
			CodeCommitRepositoryNameSchema.safeParse(repositoryName).success,
		).toBe(false);
	});
});

describe("CodeCommitBranchNameSchema", () => {
	test("accepts conventional branches and the length boundaries", () => {
		for (const branchName of [
			"a",
			"a".repeat(256),
			"feature/review",
			"review/pull-request_123-v2",
		]) {
			expect(CodeCommitBranchNameSchema.safeParse(branchName).success).toBe(
				true,
			);
		}
	});

	test.each([
		["empty", ""],
		["over 256 characters", "a".repeat(257)],
		["leading hyphen", "-feature"],
		["HEAD substring", "feature/HEAD-review"],
		["trailing .lock", "feature/review.lock"],
		["component ending .lock", "feature.lock/review"],
		["double dot", "feature..review"],
		["reflog marker", "feature@{review"],
		["lone at sign", "@"],
		["NUL control character", "feature\0review"],
		["unit separator control character", "feature\u001freview"],
		["DEL control character", "feature\u007freview"],
		["space", "feature review"],
		["tilde", "feature~review"],
		["caret", "feature^review"],
		["colon", "feature:review"],
		["question mark", "feature?review"],
		["asterisk", "feature*review"],
		["open bracket", "feature[review"],
		["backslash", "feature\\review"],
		["repeated slash", "feature//review"],
		["leading slash", "/feature"],
		["trailing slash", "feature/"],
		["leading dot", ".feature"],
		["component beginning dot", "feature/.hidden"],
		["trailing dot", "feature."],
	])("rejects %s", (_condition, branchName) => {
		expect(CodeCommitBranchNameSchema.safeParse(branchName).success).toBe(
			false,
		);
	});
});

describe("normalizeRepositoryTarget", () => {
	test("imports a repository name and returns its normalized identity", () => {
		const stack = new Stack(createTestApp(), "ImportedRepositoryStack");

		const normalized = normalizeRepositoryTarget(stack, "Target", {
			repositoryName: "  target-repository  ",
		});

		expect(normalized.repositoryName).toBe("target-repository");
		expect(normalized.repository.repositoryName).toBe("target-repository");
	});

	test("preserves a supplied repository instance", () => {
		const stack = new Stack(createTestApp(), "SuppliedRepositoryStack");
		const repository = Repository.fromRepositoryName(
			stack,
			"Repository",
			"supplied-repository",
		);

		const normalized = normalizeRepositoryTarget(stack, "Target", {
			repository,
		});

		expect(normalized).toEqual({
			repository,
			repositoryName: "supplied-repository",
		});
		expect(normalized.repository).toBe(repository);
	});

	test("rejects both or neither target at runtime", () => {
		const stack = new Stack(createTestApp(), "InvalidTargetStack");
		const repository = Repository.fromRepositoryName(
			stack,
			"Repository",
			"target-repository",
		);

		expect(() =>
			normalizeRepositoryTarget(stack, "Both", {
				repository,
				repositoryName: "target-repository",
			} as unknown as RepositoryTarget),
		).toThrow();
		expect(() =>
			normalizeRepositoryTarget(
				stack,
				"Neither",
				{} as unknown as RepositoryTarget,
			),
		).toThrow();
	});

	test("validates the name exposed by a supplied repository", () => {
		const stack = new Stack(createTestApp(), "InvalidResourceNameStack");
		const repository = { repositoryName: "invalid repository" } as IRepository;

		expect(() =>
			normalizeRepositoryTarget(stack, "Target", { repository }),
		).toThrow();
	});

	test("preserves an unresolved repository name token", () => {
		const stack = new Stack(createTestApp(), "TokenRepositoryStack");
		const repositoryName = new CfnParameter(stack, "RepositoryName")
			.valueAsString;
		const repository = Repository.fromRepositoryName(
			stack,
			"Repository",
			repositoryName,
		);

		const normalized = normalizeRepositoryTarget(stack, "Target", {
			repository,
		});

		expect(Token.isUnresolved(normalized.repositoryName)).toBe(true);
		expect(normalized.repositoryName).toBe(repositoryName);
		expect(normalized.repository).toBe(repository);
	});

	test("models repository targets as an exact-one union", () => {
		const stack = new Stack(createTestApp(), "TargetTypesStack");
		const repository = Repository.fromRepositoryName(
			stack,
			"Repository",
			"target-repository",
		);
		const byName: RepositoryTarget = { repositoryName: "target-repository" };
		const byResource: RepositoryTarget = { repository };
		expect([byName, byResource]).toHaveLength(2);

		// @ts-expect-error RepositoryTarget requires exactly one target.
		const neither: RepositoryTarget = {};
		// @ts-expect-error RepositoryTarget does not permit both targets.
		const both: RepositoryTarget = {
			repository,
			repositoryName: "target-repository",
		};
		void neither;
		void both;
	});
});
