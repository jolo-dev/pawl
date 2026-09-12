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

/**
 * Reports an invalid fluent pipeline definition. Contains the code, optional path,
 * and Error name/message; it does not implement the validators. The diagram shows
 * contained error state, not deployed AWS resources. The undirected edge denotes
 * error details.
 *
 * ```mermaid
 * architecture-beta
 *   group errorGroup(server)[Contained error state]
 *   service error(server)[Pipeline definition error] in errorGroup
 *   service details(disk)[Code message and optional path] in errorGroup
 *   error:R -- L:details
 * ```
 */
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
