import { createHash } from "node:crypto";
import { PipelineDefinitionError } from "./errors";

const MAX_NAME_LENGTH = 100;
const TRUNCATED_PREFIX_LENGTH = 91;
const HASH_LENGTH = 8;
const STAGE_NAME_PATTERN = /^[A-Za-z0-9.@_-]+$/;
const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

function truncateWithHash(value: string): string {
	if (value.length <= MAX_NAME_LENGTH) return value;
	const hash = createHash("sha256")
		.update(value)
		.digest("hex")
		.slice(0, HASH_LENGTH);
	return `${value.slice(0, TRUNCATED_PREFIX_LENGTH)}-${hash}`;
}

function sanitizeStageName(value: string): string {
	return value
		.replace(/[^A-Za-z0-9.@_-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[.@_-]+|[.@_-]+$/g, "");
}

function sanitizeArtifactName(value: string): string {
	return value
		.replace(/[^A-Za-z0-9_-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[_-]+|[_-]+$/g, "");
}

export function validateStageName(name: string, path: string): string {
	if (name.length > MAX_NAME_LENGTH || !STAGE_NAME_PATTERN.test(name)) {
		throw new PipelineDefinitionError(
			"STAGE_NAME_CONFLICT",
			"Stage name must be 1-100 characters and contain only letters, numbers, '.', '@', '_', or '-'",
			path,
		);
	}
	return name;
}

export function deriveStageName(
	actionNames: readonly string[],
	path: string,
): string {
	const sanitized = sanitizeStageName(actionNames.join("-"));
	if (sanitized.length === 0) {
		throw new PipelineDefinitionError(
			"STAGE_NAME_CONFLICT",
			"Derived stage name cannot be empty",
			path,
		);
	}
	return truncateWithHash(sanitized);
}

export function validateArtifactName(name: string, path: string): string {
	if (name.length > MAX_NAME_LENGTH || !ARTIFACT_NAME_PATTERN.test(name)) {
		throw new PipelineDefinitionError(
			"ARTIFACT_NAME_CONFLICT",
			"Artifact name must be 1-100 characters and contain only letters, numbers, '_', or '-'",
			path,
		);
	}
	return name;
}

export function deriveDefaultArtifactName(
	actionName: string,
	path: string,
): string {
	const sanitizedActionName = sanitizeArtifactName(actionName);
	if (sanitizedActionName.length === 0) {
		throw new PipelineDefinitionError(
			"ARTIFACT_NAME_CONFLICT",
			"Derived artifact name cannot be empty",
			path,
		);
	}
	return truncateWithHash(`${sanitizedActionName}Output`);
}
