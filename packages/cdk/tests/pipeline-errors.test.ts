import { describe, expect, test } from "bun:test";
import {
	PipelineDefinitionError,
	type PipelineDefinitionErrorCode,
} from "../src/pipeline/errors";

const errorCodes: Record<PipelineDefinitionErrorCode, true> = {
	SOURCE_REQUIRED: true,
	SOURCE_ALREADY_DEFINED: true,
	SOURCE_AFTER_STAGE: true,
	STAGE_REQUIRED: true,
	STAGE_EMPTY: true,
	STAGE_NAME_CONFLICT: true,
	ACTION_NAME_CONFLICT: true,
	ARTIFACT_NAME_CONFLICT: true,
	ARTIFACT_NOT_FOUND: true,
	ARTIFACT_INPUT_AMBIGUOUS: true,
	SOURCE_OWNERSHIP_CONFLICT: true,
	AUTO_REVIEW_SOURCE_UNSUPPORTED: true,
	RESERVED_VARIABLE_CONFLICT: true,
	PIPELINE_PROP_CONFLICT: true,
};

describe("PipelineDefinitionError", () => {
	test("exposes the complete stable error code contract", () => {
		expect(Object.keys(errorCodes)).toEqual([
			"SOURCE_REQUIRED",
			"SOURCE_ALREADY_DEFINED",
			"SOURCE_AFTER_STAGE",
			"STAGE_REQUIRED",
			"STAGE_EMPTY",
			"STAGE_NAME_CONFLICT",
			"ACTION_NAME_CONFLICT",
			"ARTIFACT_NAME_CONFLICT",
			"ARTIFACT_NOT_FOUND",
			"ARTIFACT_INPUT_AMBIGUOUS",
			"SOURCE_OWNERSHIP_CONFLICT",
			"AUTO_REVIEW_SOURCE_UNSUPPORTED",
			"RESERVED_VARIABLE_CONFLICT",
			"PIPELINE_PROP_CONFLICT",
		]);
	});

	test("preserves its human-readable message and exposes code and path", () => {
		const message = "Stage name is already in use";
		const error = new PipelineDefinitionError(
			"STAGE_NAME_CONFLICT",
			message,
			"stages[1].name",
		);

		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("PipelineDefinitionError");
		expect(error.message).toBe(message);
		expect(error.code).toBe("STAGE_NAME_CONFLICT");
		expect(error.path).toBe("stages[1].name");
	});

	test("allows the caller path to be omitted", () => {
		const error = new PipelineDefinitionError(
			"SOURCE_REQUIRED",
			"A source is required",
		);

		expect(error.path).toBeUndefined();
		expect(error.message).toBe("A source is required");
	});
});
