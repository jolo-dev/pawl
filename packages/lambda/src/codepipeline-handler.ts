import type { Logger } from "@aws-lambda-powertools/logger";
import { handlerFactory } from "./base/handler-factory";
import type { HandlerWithHooks } from "./base/hooks";

export interface CodePipelineActionTypeId {
	category?: string;
	owner?: string;
	provider?: string;
	version?: string;
	[key: string]: unknown;
}

export interface CodePipelineArtifactLocation {
	type?: string;
	[key: string]: unknown;
}

export interface CodePipelineArtifact {
	name?: string;
	location?: CodePipelineArtifactLocation;
	[key: string]: unknown;
}

export interface CodePipelineArtifactCredentials {
	accessKeyId?: string;
	secretAccessKey?: string;
	sessionToken?: string;
	[key: string]: unknown;
}

export interface CodePipelineActionConfiguration {
	configuration?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface CodePipelineJobData {
	actionTypeId?: CodePipelineActionTypeId;
	actionConfiguration?: CodePipelineActionConfiguration;
	inputArtifacts?: CodePipelineArtifact[];
	outputArtifacts?: CodePipelineArtifact[];
	artifactCredentials?: CodePipelineArtifactCredentials;
	[key: string]: unknown;
}

export interface CodePipelineJob {
	id: string;
	accountId?: string;
	data: CodePipelineJobData;
	[key: string]: unknown;
}

export interface CodePipelineJobEvent {
	"CodePipeline.job": CodePipelineJob;
	[key: string]: unknown;
}

export type CodePipelineHandler = (
	event: CodePipelineJobEvent,
) => Promise<void>;

interface CodePipelineMetadata {
	jobId: string;
	actionType?: {
		category?: string;
		owner?: string;
		provider?: string;
		version?: string;
	};
	inputArtifactCount: number;
	outputArtifactCount: number;
}

function projectCodePipelineMetadata(
	event: CodePipelineJobEvent,
): CodePipelineMetadata {
	const job = event["CodePipeline.job"];
	const actionTypeId = job.data.actionTypeId;

	return {
		jobId: job.id,
		...(actionTypeId
			? {
					actionType: {
						category: actionTypeId.category,
						owner: actionTypeId.owner,
						provider: actionTypeId.provider,
						version: actionTypeId.version,
					},
				}
			: {}),
		inputArtifactCount: job.data.inputArtifacts?.length ?? 0,
		outputArtifactCount: job.data.outputArtifacts?.length ?? 0,
	};
}

export function useCodePipelineHandler(
	serviceName: string,
	handleRequest: (event: CodePipelineJobEvent, logger: Logger) => Promise<void>,
): HandlerWithHooks<CodePipelineHandler, CodePipelineJobEvent> {
	return handlerFactory<CodePipelineJobEvent>(serviceName, handleRequest, {
		logging: "metadata",
		metadataProjector: projectCodePipelineMetadata,
	});
}
