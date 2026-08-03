import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { App, Lazy, Token } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { type IRepository, Repository } from "aws-cdk-lib/aws-codecommit";
import { PipelineDefinitionError } from "../src/pipeline/errors";
import {
	parseCodeCommitPipelineSource,
	planCodeCommitSource,
} from "../src/pipeline/source";
import { Stack } from "../src/stack";

const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string, parent = tmpdir()): string {
	const directory = mkdtempSync(path.join(parent, prefix));
	temporaryDirectories.push(directory);
	return directory;
}

function sourceDirectory(parent = tmpdir()): string {
	const directory = temporaryDirectory("pawl-pipeline-source-", parent);
	writeFileSync(path.join(directory, "README.md"), "# source\n");
	return directory;
}

function createStack(id: string): Stack {
	const app = new App({ outdir: temporaryDirectory("pawl-pipeline-cdk-out-") });
	return new Stack(app, id, {
		env: { account: "123456789012", region: "eu-west-1" },
	});
}

function expectSourceError(callback: () => unknown): PipelineDefinitionError {
	try {
		callback();
	} catch (error) {
		expect(error).toBeInstanceOf(PipelineDefinitionError);
		if (error instanceof PipelineDefinitionError) {
			expect(error.code).toBe("SOURCE_OWNERSHIP_CONFLICT");
			return error;
		}
		throw error;
	}
	throw new Error("Expected PipelineDefinitionError");
}

function parseCast(value: unknown): void {
	parseCodeCommitPipelineSource(
		value as Parameters<typeof parseCodeCommitPipelineSource>[0],
	);
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("CodeCommit pipeline source parsing", () => {
	test("parses each exact ownership branch", () => {
		const stack = createStack("ParseSourceStack");
		const repository = new Repository(stack, "SuppliedRepository", {
			repositoryName: "supplied-repository",
		});

		expect(
			parseCodeCommitPipelineSource({
				origin: "codecommit",
				create: true,
				repositoryName: "created-repository",
				description: "Created by the pipeline",
				branchName: "develop",
				sync: sourceDirectory(),
			}),
		).toMatchObject({ create: true, repositoryName: "created-repository" });
		expect(
			parseCodeCommitPipelineSource({
				origin: "codecommit",
				create: false,
				repositoryName: "imported-repository",
				branchName: "release",
			}),
		).toEqual({
			origin: "codecommit",
			create: false,
			repositoryName: "imported-repository",
			branchName: "release",
		});
		expect(
			parseCodeCommitPipelineSource({
				origin: "codecommit",
				repository,
				repositoryName: "supplied-repository",
			}),
		).toMatchObject({ repository });
	});

	test("rejects a cast object that only resembles a repository", () => {
		const repository = {
			repositoryName: "fake-repository",
		} as IRepository;

		expectSourceError(() =>
			planCodeCommitSource(
				{ origin: "codecommit", repository },
				{ requiresConcreteName: false },
			),
		);
	});

	test("rejects extra, conflicting, and missing ownership fields through casts", () => {
		const stack = createStack("RejectedSourceStack");
		const repository = new Repository(stack, "Repository", {
			repositoryName: "supplied-repository",
		});
		const invalidSources: unknown[] = [
			{
				origin: "codecommit",
				create: true,
				repositoryName: "created-repository",
				repository,
			},
			{
				origin: "codecommit",
				create: false,
				repositoryName: "imported-repository",
				sync: ".",
			},
			{
				origin: "codecommit",
				repository,
				create: true,
				repositoryName: "supplied-repository",
			},
			{ origin: "codecommit" },
		];

		for (const invalidSource of invalidSources) {
			expectSourceError(() => parseCast(invalidSource));
		}
	});
});

describe("CodeCommit pipeline source planning and materialization", () => {
	test("creates and seeds a repository on the requested branch from a cwd-relative sync path", () => {
		const stack = createStack("SyncedSourceStack");
		const sourcePath = sourceDirectory(process.cwd());
		const relativeSourcePath = path.relative(process.cwd(), sourcePath);
		const planned = planCodeCommitSource(
			{
				origin: "codecommit",
				create: true,
				repositoryName: "synced-repository",
				branchName: "develop",
				sync: relativeSourcePath,
			},
			{ requiresConcreteName: true },
		);

		const result = planned.materialize(stack, "Source");

		expect(result.repositoryName).toBe("synced-repository");
		expect(result.branchName).toBe("develop");
		Template.fromStack(stack).hasResourceProperties(
			"AWS::CodeCommit::Repository",
			{
				RepositoryName: "synced-repository",
				Code: { BranchName: "develop" },
			},
		);
	});

	test("creates an unseeded described repository while retaining the requested action branch", () => {
		const stack = createStack("UnseededSourceStack");
		const result = planCodeCommitSource(
			{
				origin: "codecommit",
				create: true,
				repositoryName: "unseeded-repository",
				description: "No initial seed",
				branchName: "release",
			},
			{ requiresConcreteName: true },
		).materialize(stack, "Source");
		const repositories = Template.fromStack(stack).findResources(
			"AWS::CodeCommit::Repository",
		);
		const repository = Object.values(repositories)[0];

		expect(result.branchName).toBe("release");
		expect(repository?.Properties).toMatchObject({
			RepositoryName: "unseeded-repository",
			RepositoryDescription: "No initial seed",
		});
		expect(repository?.Properties).not.toHaveProperty("Code");
	});

	test("imports by name without emitting a repository and defaults the branch to main", () => {
		const stack = createStack("ImportedSourceStack");
		const result = planCodeCommitSource(
			{
				origin: "codecommit",
				create: false,
				repositoryName: "imported-repository",
			},
			{ requiresConcreteName: true },
		).materialize(stack, "Source");

		expect(result.repository.repositoryName).toBe("imported-repository");
		expect(result.repositoryName).toBe("imported-repository");
		expect(result.branchName).toBe("main");
		Template.fromStack(stack).resourceCountIs("AWS::CodeCommit::Repository", 0);
	});

	test("reuses a supplied repository identity", () => {
		const stack = createStack("SuppliedSourceStack");
		const repository = new Repository(stack, "Repository", {
			repositoryName: "supplied-repository",
		});
		const result = planCodeCommitSource(
			{
				origin: "codecommit",
				repository,
				repositoryName: "supplied-repository",
				branchName: "feature/review",
			},
			{ requiresConcreteName: true },
		).materialize(stack, "Source");

		expect(result.repository).toBe(repository);
		expect(result.repositoryName).toBe("supplied-repository");
		expect(result.branchName).toBe("feature/review");
		Template.fromStack(stack).resourceCountIs("AWS::CodeCommit::Repository", 1);
	});

	test("rejects a concrete supplied-name mismatch during planning", () => {
		const stack = createStack("MismatchedSourceStack");
		const repository = Repository.fromRepositoryName(
			stack,
			"Repository",
			"actual-repository",
		);
		const childCount = stack.node.findAll().length;

		expectSourceError(() =>
			planCodeCommitSource(
				{
					origin: "codecommit",
					repository,
					repositoryName: "different-repository",
				},
				{ requiresConcreteName: true },
			),
		);
		expect(stack.node.findAll()).toHaveLength(childCount);
	});

	test("requires a literal fallback for a tokenized supplied name only when concrete names are required", () => {
		const stack = createStack("TokenSourceStack");
		const tokenName = Lazy.string({ produce: () => "resolved-repository" });
		expect(Token.isUnresolved(tokenName)).toBe(true);
		const repository = Repository.fromRepositoryName(
			stack,
			"TokenRepository",
			tokenName,
		);

		expectSourceError(() =>
			planCodeCommitSource(
				{ origin: "codecommit", repository },
				{ requiresConcreteName: true },
			),
		);

		const withoutConcreteRequirement = planCodeCommitSource(
			{ origin: "codecommit", repository },
			{ requiresConcreteName: false },
		).materialize(stack, "TokenSource");
		expect(withoutConcreteRequirement.repositoryName).toBe(tokenName);

		const withFallback = planCodeCommitSource(
			{
				origin: "codecommit",
				repository,
				repositoryName: "resolved-repository",
			},
			{ requiresConcreteName: true },
		).materialize(stack, "FallbackSource");
		expect(withFallback.repository).toBe(repository);
		expect(withFallback.repositoryName).toBe("resolved-repository");
	});

	test("rejects whitespace, missing, and file sync paths without materializing children", () => {
		const stack = createStack("InvalidSyncSourceStack");
		const directory = temporaryDirectory("pawl-pipeline-invalid-sync-");
		const filePath = path.join(directory, "source.txt");
		writeFileSync(filePath, "not a directory\n");
		const missingPath = path.join(directory, "missing");
		const childCount = stack.node.findAll().length;

		for (const sync of ["   ", missingPath, filePath]) {
			expectSourceError(() =>
				planCodeCommitSource(
					{
						origin: "codecommit",
						create: true,
						repositoryName: "invalid-sync-repository",
						sync,
					},
					{ requiresConcreteName: true },
				),
			);
			expect(stack.node.findAll()).toHaveLength(childCount);
		}
	});
});
