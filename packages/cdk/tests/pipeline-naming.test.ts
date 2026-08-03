import { describe, expect, test } from "bun:test";
import { PipelineDefinitionError } from "../src/pipeline/errors";
import {
	deriveDefaultArtifactName,
	deriveStageName,
	validateArtifactName,
	validateStageName,
} from "../src/pipeline/naming";

function expectDefinitionError(
	callback: () => unknown,
	code: PipelineDefinitionError["code"],
	path: string,
) {
	try {
		callback();
	} catch (error) {
		expect(error).toBeInstanceOf(PipelineDefinitionError);
		if (!(error instanceof PipelineDefinitionError)) return;
		expect(error.code).toBe(code);
		expect(error.path).toBe(path);
		return;
	}
	throw new Error("Expected PipelineDefinitionError");
}

describe("stage naming", () => {
	test("accepts explicit stage names containing all supported characters", () => {
		expect(validateStageName("Build.v1@prod_test-1", "stages[0].name")).toBe(
			"Build.v1@prod_test-1",
		);
	});

	test("accepts an explicit stage name at the 100-character boundary", () => {
		const name = "S".repeat(100);

		expect(validateStageName(name, "stages[0].name")).toBe(name);
	});

	test("derives a stage name by joining effective action names", () => {
		expect(
			deriveStageName(["Compile", "UnitTests", "Deploy"], "stages[0]"),
		).toBe("Compile-UnitTests-Deploy");
	});

	test("sanitizes unsupported runs and trims generated separators", () => {
		expect(deriveStageName(["///Build///", " Test "], "stages[0]")).toBe(
			"Build-Test",
		);
	});

	test("deterministically truncates and hashes the complete sanitized stage name", () => {
		expect(deriveStageName(["A".repeat(101)], "stages[0]")).toBe(
			"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA-aac76dab",
		);
	});

	test("rejects invalid explicit stage names without rewriting them", () => {
		expectDefinitionError(
			() => validateStageName("Build Stage", "stages[0].name"),
			"STAGE_NAME_CONFLICT",
			"stages[0].name",
		);
		expectDefinitionError(
			() => validateStageName("S".repeat(101), "stages[0].name"),
			"STAGE_NAME_CONFLICT",
			"stages[0].name",
		);
	});

	test("rejects derived stage names that sanitize to empty", () => {
		expectDefinitionError(
			() => deriveStageName(["///"], "stages[0]"),
			"STAGE_NAME_CONFLICT",
			"stages[0]",
		);
	});
});

describe("artifact naming", () => {
	test("derives the default artifact name from the action name", () => {
		expect(deriveDefaultArtifactName("Build.App", "stages[0].actions[0]")).toBe(
			"Build-AppOutput",
		);
	});

	test("accepts an explicit artifact name at the 100-character boundary", () => {
		const name = "A".repeat(100);

		expect(validateArtifactName(name, "artifacts[0].name")).toBe(name);
	});

	test("deterministically truncates and hashes the complete sanitized default name", () => {
		expect(
			deriveDefaultArtifactName("B".repeat(96), "stages[0].actions[0]"),
		).toBe(
			"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB-736c41d8",
		);
	});

	test("validates explicit artifact names without rewriting them", () => {
		expect(validateArtifactName("Build_App-1", "artifacts[0].name")).toBe(
			"Build_App-1",
		);
		expectDefinitionError(
			() => validateArtifactName("Build.App", "artifacts[0].name"),
			"ARTIFACT_NAME_CONFLICT",
			"artifacts[0].name",
		);
		expectDefinitionError(
			() => validateArtifactName("A".repeat(101), "artifacts[0].name"),
			"ARTIFACT_NAME_CONFLICT",
			"artifacts[0].name",
		);
	});

	test("rejects explicit and derived artifact names that are empty", () => {
		expectDefinitionError(
			() => validateArtifactName("", "artifacts[0].name"),
			"ARTIFACT_NAME_CONFLICT",
			"artifacts[0].name",
		);
		expectDefinitionError(
			() => deriveDefaultArtifactName("///", "stages[0].actions[0]"),
			"ARTIFACT_NAME_CONFLICT",
			"stages[0].actions[0]",
		);
	});
});
