/**
 * Turning a project's synthesized output into `SynthesizedResource`s.
 *
 * `cdk synth` writes `cdk.out/manifest.json` plus one template per stack. The
 * manifest is the entry point because it names the templates; the templates hold
 * the resources. Reading the artifacts rather than parsing `cdk synth` stdout
 * avoids depending on its formatting.
 *
 * A resource's physical name is only usable when the template pins it *and* the
 * value is a plain string. CDK leaves unresolved tokens and cross-stack
 * references in place, and neither can be compared against an account.
 */

import type { ExecFn } from "../harness";
import type { SynthesizedResource } from "./drift";

export interface TemplateResource {
	readonly Type?: string;
	readonly Properties?: Record<string, unknown>;
}

export interface TemplateDocument {
	readonly Resources?: Record<string, TemplateResource>;
}

export interface CdkManifest {
	readonly artifacts?: Record<
		string,
		{
			readonly type?: string;
			readonly properties?: {
				readonly stackName?: string;
				readonly templateFile?: string;
			};
		}
	>;
}

/**
 * CloudFormation type -> the property that pins its physical name.
 *
 * Only kinds whose Pawl construct sets a name belong here. Kinds that let CDK
 * generate a name (`AWS::S3::Bucket` from `StaticSite`, `AWS::Events::EventBus`
 * from props) are present for completeness but will usually be undefined.
 */
export const PHYSICAL_NAME_PROPERTIES: Record<string, string> = {
	"AWS::Lambda::Function": "FunctionName",
	"AWS::DynamoDB::Table": "TableName",
	"AWS::SQS::Queue": "QueueName",
	"AWS::SNS::Topic": "TopicName",
	"AWS::ApiGatewayV2::Api": "Name",
	"AWS::ApiGateway::RestApi": "Name",
	"AWS::CodePipeline::Pipeline": "Name",
	"AWS::CodeBuild::Project": "Name",
	"AWS::S3::Bucket": "BucketName",
	"AWS::Events::EventBus": "Name",
	"AWS::Logs::LogGroup": "LogGroupName",
	"AWS::IAM::Role": "RoleName",
	"AWS::Cognito::UserPool": "UserPoolName",
	"AWS::BedrockAgentCore::Runtime": "Name",
};

const STACK_ARTIFACT_TYPE = "aws:cloudformation:stack";

/** Read one synthesized template into resources. */
export function parseTemplate(
	stackName: string,
	template: TemplateDocument,
): SynthesizedResource[] {
	const resources: SynthesizedResource[] = [];
	for (const [logicalId, resource] of Object.entries(
		template.Resources ?? {},
	)) {
		const resourceKind = resource.Type;
		if (!resourceKind) continue;

		const property = PHYSICAL_NAME_PROPERTIES[resourceKind];
		const candidate = property ? resource.Properties?.[property] : undefined;

		resources.push({
			stackName,
			logicalId,
			resourceKind,
			physicalName: typeof candidate === "string" ? candidate : undefined,
		});
	}
	return resources;
}

/** Find the stacks in a `cdk.out/manifest.json`. */
export function parseManifest(
	manifest: CdkManifest,
): { stackName: string; templateFile: string }[] {
	const stacks: { stackName: string; templateFile: string }[] = [];
	for (const [key, artifact] of Object.entries(manifest.artifacts ?? {})) {
		if (artifact.type !== STACK_ARTIFACT_TYPE) continue;
		const templateFile = artifact.properties?.templateFile;
		if (!templateFile) continue;
		stacks.push({
			stackName: artifact.properties?.stackName ?? key,
			templateFile,
		});
	}
	return stacks;
}

export interface SynthesizedProject {
	readonly resources: SynthesizedResource[];
	readonly stacks: string[];
}

export class SynthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SynthError";
	}
}

/**
 * Synthesize the project and read every stack's resources.
 *
 * A synthesis failure is thrown, never returned as an empty project: reporting
 * "no drift" because `cdk synth` broke would be the worst possible answer.
 */
export async function loadSynthesizedResources(options: {
	readonly cwd: string;
	readonly exec: ExecFn;
	/** Skip synthesis and read the existing `cdk.out`. */
	readonly skipSynth?: boolean;
}): Promise<SynthesizedProject> {
	const { cwd, exec } = options;

	if (!options.skipSynth) {
		try {
			await exec("npx", ["cdk", "synth", "--quiet"]);
		} catch (error: unknown) {
			throw new SynthError(
				`cdk synth failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	const manifestPath = `${cwd}/cdk.out/manifest.json`;
	let manifest: CdkManifest;
	try {
		const { stdout } = await exec("cat", [manifestPath]);
		manifest = JSON.parse(stdout) as CdkManifest;
	} catch (error: unknown) {
		throw new SynthError(
			`Could not read ${manifestPath}. Run \`cdk synth\` in the project first. (${error instanceof Error ? error.message : String(error)})`,
		);
	}

	const stacks = parseManifest(manifest);
	const resources: SynthesizedResource[] = [];
	for (const stack of stacks) {
		try {
			const { stdout } = await exec("cat", [
				`${cwd}/cdk.out/${stack.templateFile}`,
			]);
			resources.push(
				...parseTemplate(
					stack.stackName,
					JSON.parse(stdout) as TemplateDocument,
				),
			);
		} catch (error: unknown) {
			throw new SynthError(
				`Could not read template for ${stack.stackName}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	return { resources, stacks: stacks.map((stack) => stack.stackName) };
}
