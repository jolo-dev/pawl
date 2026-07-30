import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Template } from "aws-cdk-lib/assertions";
import { App, CodeCommit, Stack } from "../index";

const temporaryDirectories: string[] = [];
const sourceAssetHash = "a".repeat(64);

function temporaryDirectory(prefix: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

function createSource(contents = "seed contents\n"): string {
	const sourcePath = temporaryDirectory("pawl-codecommit-identity-seed-");
	writeFileSync(path.join(sourcePath, "seed.txt"), contents);
	return sourcePath;
}

function createStack(id: string): Stack {
	const app = new App({
		outdir: temporaryDirectory("pawl-codecommit-identity-cdk-out-"),
		context: { team: "review-team", stage: "test" },
	});
	return new Stack(app, id, {
		env: { account: "123456789012", region: "eu-west-1" },
	});
}

interface SynthesizedRepositoryCode {
	readonly BranchName: string;
	readonly S3: {
		readonly Bucket: unknown;
		readonly Key: string;
	};
}

function repositoryCode(stack: Stack): SynthesizedRepositoryCode | undefined {
	const resources = Template.fromStack(stack).findResources(
		"AWS::CodeCommit::Repository",
	) as Record<
		string,
		{ readonly Properties?: { readonly Code?: SynthesizedRepositoryCode } }
	>;
	return Object.values(resources)[0]?.Properties?.Code;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("CodeCommit seed asset identity migration", () => {
	test.each([
		"",
		"a".repeat(63),
		"a".repeat(65),
		"A".repeat(64),
		`${"a".repeat(63)}g`,
	])("rejects invalid sourceAssetHash %p", (invalidHash) => {
		const stack = createStack(`InvalidAssetHash${invalidHash.length}Stack`);
		expect(
			() =>
				new CodeCommit(stack, "Code", {
					repositoryName: "invalid-asset-hash-repository",
					create: {
						sourcePath: createSource(),
						sourceAssetHash: invalidHash,
					},
				}),
		).toThrow(/sourceAssetHash|64-character lowercase hex/i);
	});

	test("requires sourcePath when sourceAssetHash is present", () => {
		const stack = createStack("AssetHashWithoutSourceStack");
		expect(
			() =>
				new CodeCommit(stack, "Code", {
					repositoryName: "asset-hash-without-source-repository",
					create: { sourceAssetHash },
				}),
		).toThrow(/sourceAssetHash requires sourcePath/i);
	});

	test("keeps default seed assets content-hashed", () => {
		const firstStack = createStack("FirstContentHashStack");
		new CodeCommit(firstStack, "Code", {
			repositoryName: "first-content-hash-repository",
			create: { sourcePath: createSource("first contents\n") },
		});
		const secondStack = createStack("SecondContentHashStack");
		new CodeCommit(secondStack, "Code", {
			repositoryName: "second-content-hash-repository",
			create: { sourcePath: createSource("second contents\n") },
		});

		const firstKey = repositoryCode(firstStack)?.S3.Key;
		const secondKey = repositoryCode(secondStack)?.S3.Key;
		expect(firstKey).toMatch(/^[0-9a-f]{64}\.zip$/);
		expect(secondKey).toMatch(/^[0-9a-f]{64}\.zip$/);
		expect(firstKey).not.toBe(secondKey);
	});

	test("reuses the exact source asset hash without changing branch or bucket structure", () => {
		const defaultStack = createStack("DefaultIdentityStack");
		const sourcePath = createSource();
		new CodeCommit(defaultStack, "Code", {
			repositoryName: "default-identity-repository",
			create: { sourcePath, branchName: "develop" },
		});
		const overrideStack = createStack("OverrideIdentityStack");
		new CodeCommit(overrideStack, "Code", {
			repositoryName: "override-identity-repository",
			create: { sourcePath, branchName: "develop", sourceAssetHash },
		});

		const defaultCode = repositoryCode(defaultStack);
		const overrideCode = repositoryCode(overrideStack);
		expect(overrideCode?.S3.Key).toBe(`${sourceAssetHash}.zip`);
		expect(overrideCode?.S3.Key).not.toBe(defaultCode?.S3.Key);
		expect(overrideCode?.BranchName).toBe(defaultCode?.BranchName);
		expect(overrideCode?.S3.Bucket).toEqual(defaultCode?.S3.Bucket);
	});

	test("does not add seed code when create or sourcePath is absent", () => {
		const importedStack = createStack("ImportedWithoutSeedStack");
		new CodeCommit(importedStack, "Code", {
			repositoryName: "imported-without-seed-repository",
		});
		expect(repositoryCode(importedStack)).toBeUndefined();
		Template.fromStack(importedStack).resourceCountIs(
			"AWS::CodeCommit::Repository",
			0,
		);

		const emptyStack = createStack("CreatedWithoutSeedStack");
		new CodeCommit(emptyStack, "Code", {
			repositoryName: "created-without-seed-repository",
			create: {},
		});
		expect(repositoryCode(emptyStack)).toBeUndefined();
	});
});
