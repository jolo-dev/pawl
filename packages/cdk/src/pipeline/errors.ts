export type PipelineDefinitionErrorCode =
	| "SOURCE_REQUIRED"
	| "SOURCE_ALREADY_DEFINED"
	| "SOURCE_AFTER_STAGE"
	| "STAGE_REQUIRED"
	| "STAGE_EMPTY"
	| "STAGE_NAME_CONFLICT"
	| "ACTION_NAME_CONFLICT"
	| "ARTIFACT_NAME_CONFLICT"
	| "ARTIFACT_NOT_FOUND"
	| "ARTIFACT_INPUT_AMBIGUOUS"
	| "SOURCE_OWNERSHIP_CONFLICT"
	| "AUTO_REVIEW_SOURCE_UNSUPPORTED"
	| "RESERVED_VARIABLE_CONFLICT"
	| "PIPELINE_PROP_CONFLICT";

export class PipelineDefinitionError extends Error {
	readonly code: PipelineDefinitionErrorCode;
	readonly path?: string;

	constructor(
		code: PipelineDefinitionErrorCode,
		message: string,
		path?: string,
	) {
		super(message);
		this.name = "PipelineDefinitionError";
		this.code = code;
		this.path = path;
	}
}
