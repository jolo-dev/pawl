import { describe, expect, test } from "bun:test";
import path from "node:path";
import { App, CfnCapabilities, Duration } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { BuildEnvironmentVariableType } from "aws-cdk-lib/aws-codebuild";
import {
	ActionCategory,
	Artifact,
	type IAction,
	Pipeline,
} from "aws-cdk-lib/aws-codepipeline";
import {
	CodeBuildAction,
	CodeBuildActionType,
	ManualApprovalAction,
	S3SourceAction,
} from "aws-cdk-lib/aws-codepipeline-actions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { Bucket, BucketAccessControl } from "aws-cdk-lib/aws-s3";
import { Topic } from "aws-cdk-lib/aws-sns";
import { CodeBuildProject } from "../src/codebuild-project";
import { LambdaFunction } from "../src/lambda-function";
import {
	parsePipelineActionDefinition,
	planPipelineAction,
} from "../src/pipeline/actions";
import { PipelineDefinitionError } from "../src/pipeline/errors";
import { Stack } from "../src/stack";

process.env.LOCAL = "1";

const publicTestNetwork = {
	mode: "public-test" as const,
	packageAccess: {
		mode: "approved-registry" as const,
		endpoint: "https://registry.npmjs.org/",
	},
};

interface SynthesizedAction {
	readonly Name: string;
	readonly ActionTypeId: {
		readonly Category: string;
		readonly Owner: string;
		readonly Provider: string;
	};
	readonly Configuration?: Readonly<Record<string, unknown>>;
	readonly InputArtifacts?: readonly { readonly Name: string }[];
	readonly OutputArtifacts?: readonly { readonly Name: string }[];
	readonly Namespace?: string;
}

function createStack(id: string): Stack {
	const app = new App();
	app.node.setContext("team", "pipeline");
	app.node.setContext("stage", "test");
	return new Stack(app, id, {
		env: { account: "123456789012", region: "eu-west-1" },
	});
}

function createProject(stack: Stack, id = "Project"): CodeBuildProject {
	return new CodeBuildProject(stack, id, {
		pipelineMode: true,
		networkPolicy: publicTestNetwork,
	});
}

function createHandler(stack: Stack, id = "Handler"): LambdaFunction {
	return new LambdaFunction(stack, id, {
		entry: path.join(import.meta.dir, "lambda", "test-lambda.ts"),
	});
}

function addMaterializedAction(
	stack: Stack,
	definition: Parameters<typeof planPipelineAction>[0],
	inputNames: readonly string[],
	outputNames: readonly string[],
): { readonly action: IAction; readonly synthesized: SynthesizedAction } {
	const pipeline = new Pipeline(stack, "Pipeline");
	const sourceBucket = new Bucket(stack, "SourceBucket");
	const inputs = inputNames.map((name) => new Artifact(name));
	const outputs = outputNames.map((name) => new Artifact(name));
	const sourceOutputs =
		inputs.length > 0 ? inputs : [new Artifact("UnusedSource")];
	pipeline.addStage({
		stageName: "Sources",
		actions: sourceOutputs.map(
			(input, index) =>
				new S3SourceAction({
					actionName: `Source${index}`,
					bucket: sourceBucket,
					bucketKey: `source-${index}.zip`,
					output: input,
				}),
		),
	});
	const planned = planPipelineAction(definition, "stages[Test].actions[0]");
	const action = planned.materialize({ inputs, outputs });
	pipeline.addStage({ stageName: "Test", actions: [action] });
	const resources = Template.fromStack(stack).findResources(
		"AWS::CodePipeline::Pipeline",
	);
	const resource = Object.values(resources)[0] as {
		readonly Properties: {
			readonly Stages: readonly {
				readonly Name: string;
				readonly Actions: readonly SynthesizedAction[];
			}[];
		};
	};
	const synthesized = resource.Properties.Stages.flatMap(
		(stage) => stage.Actions,
	).find((candidate) => candidate.Name === definition.name);
	if (synthesized === undefined)
		throw new Error("Synthesized action not found");
	return { action, synthesized };
}

function expectDefinitionError(callback: () => unknown, path?: string): void {
	try {
		callback();
	} catch (error) {
		expect(error).toBeInstanceOf(PipelineDefinitionError);
		if (error instanceof PipelineDefinitionError && path !== undefined) {
			expect(error.path).toBe(path);
		}
		return;
	}
	throw new Error("Expected PipelineDefinitionError");
}

function parseCast(value: unknown): void {
	parsePipelineActionDefinition(
		value as Parameters<typeof parsePipelineActionDefinition>[0],
	);
}

describe("pipeline action runtime validation", () => {
	test("strictly rejects unknown and conflicting fields", () => {
		const stack = createStack("StrictActionStack");
		const handler = createHandler(stack);
		const role = new Role(stack, "DeployRole", {
			assumedBy: new ServicePrincipal("cloudformation.amazonaws.com"),
		});
		for (const value of [
			{ type: "approval", name: "Approve", runOrder: 2 },
			{ type: "approval", name: "Approve", actionName: "Raw" },
			{
				type: "lambda",
				name: "Invoke",
				handler,
				userParameters: {},
				userParametersString: "both",
			},
			{
				type: "cloudFormationDeploy",
				name: "Deploy",
				stackName: "Application",
				templatePath: "template.json",
				adminPermissions: true,
				deploymentRole: role,
			},
		]) {
			expectDefinitionError(() => parseCast(value));
		}
	});

	test("rejects shallow construct lookalikes", () => {
		for (const value of [
			{ type: "codebuild", name: "Build", project: { project: {} } },
			{ type: "lambda", name: "Invoke", handler: { lambda: {} } },
			{ type: "s3Deploy", name: "Deploy", bucket: {}, objectKey: "site.zip" },
		]) {
			expectDefinitionError(() => parseCast(value));
		}
	});

	test("rejects empty artifact lists and invalid cardinality before materialization", () => {
		const stack = createStack("CardinalityStack");
		const handler = createHandler(stack);
		const deploymentRole = new Role(stack, "DeploymentRole", {
			assumedBy: new ServicePrincipal("cloudformation.amazonaws.com"),
		});
		for (const value of [
			{ type: "lambda", name: "EmptyInputs", handler, inputs: [] },
			{ type: "lambda", name: "EmptyOutputs", handler, outputs: [] },
			{
				type: "lambda",
				name: "TooManyInputs",
				handler,
				inputs: ["One", "Two", "Three", "Four", "Five", "Six"],
			},
			{
				type: "codebuild",
				name: "EmptyBuildOutputs",
				project: createProject(stack),
				outputs: [],
			},
			{
				type: "codebuild",
				name: "TooManyBuildOutputs",
				project: createProject(stack, "OutputProject"),
				outputs: ["One", "Two", "Three", "Four", "Five", "Six"],
			},
			{
				type: "codebuild",
				name: "TooManyBuildInputs",
				project: createProject(stack, "InputProject"),
				extraInputs: ["Two", "Three", "Four", "Five", "Six"],
			},
			{
				type: "cloudFormationDeploy",
				name: "TooManyDeployInputs",
				stackName: "Application",
				templatePath: "template.json",
				extraInputs: [
					"Two",
					"Three",
					"Four",
					"Five",
					"Six",
					"Seven",
					"Eight",
					"Nine",
					"Ten",
					"Eleven",
				],
				deploymentRole,
			},
		]) {
			expectDefinitionError(() => planPipelineAction(value as never, "action"));
		}
	});
});

describe("CodeBuild action adapter", () => {
	test("plans inferred primary, extra inputs, and default output", () => {
		const stack = createStack("CodeBuildPlanStack");
		const planned = planPipelineAction(
			{
				type: "codebuild",
				name: "Compile",
				project: createProject(stack),
				extraInputs: ["Dependencies"],
			},
			"action",
		);

		expect(planned.artifactPlan).toEqual({
			name: "Compile",
			input: { mode: "required" },
			additionalInputs: ["Dependencies"],
			outputs: ["CompileOutput"],
		});
	});

	test("materializes provider, category, variables, environment, and multiple artifacts", () => {
		const stack = createStack("CodeBuildMaterializeStack");
		const { synthesized } = addMaterializedAction(
			stack,
			{
				type: "codebuild",
				name: "Compile",
				project: createProject(stack),
				input: "Source",
				extraInputs: ["Dependencies"],
				outputs: ["Application", "Manifest"],
				actionType: CodeBuildActionType.TEST,
				environmentVariables: {
					MODE: {
						value: "verify",
						type: BuildEnvironmentVariableType.PLAINTEXT,
					},
				},
				checkSecretsInPlainTextEnvVariables: false,
				executeBatchBuild: true,
				combineBatchBuildArtifacts: true,
				variablesNamespace: "BuildVariables",
			},
			["Source", "Dependencies"],
			["Application", "Manifest"],
		);

		expect(synthesized.ActionTypeId).toMatchObject({
			Category: "Test",
			Owner: "AWS",
			Provider: "CodeBuild",
		});
		expect(synthesized.InputArtifacts?.map(({ Name }) => Name)).toEqual([
			"Source",
			"Dependencies",
		]);
		expect(synthesized.OutputArtifacts?.map(({ Name }) => Name)).toEqual([
			"Application",
			"Manifest",
		]);
		expect(synthesized.Namespace).toBe("BuildVariables");
		expect(synthesized.Configuration).toMatchObject({
			BatchEnabled: "true",
			CombineArtifacts: "true",
			EnvironmentVariables: expect.stringContaining("MODE"),
		});
	});

	test("rejects a duplicate explicit primary and extra input", () => {
		const stack = createStack("CodeBuildDuplicateInputStack");
		expectDefinitionError(() =>
			planPipelineAction(
				{
					type: "codebuild",
					name: "Compile",
					project: createProject(stack),
					input: "Source",
					extraInputs: ["Source"],
				},
				"action",
			),
		);
	});

	test("supports disabling outputs", () => {
		const stack = createStack("CodeBuildNoOutputStack");
		const project = createProject(stack);
		const planned = planPipelineAction(
			{ type: "codebuild", name: "Verify", project, outputs: false },
			"action",
		);
		expect(planned.artifactPlan.outputs).toEqual([]);
		const { synthesized } = addMaterializedAction(
			stack,
			{ type: "codebuild", name: "VerifyBound", project, outputs: false },
			["Source"],
			[],
		);
		expect(synthesized.OutputArtifacts).toBeUndefined();
	});
});

describe("approval and Lambda action adapters", () => {
	test("maps approval properties without artifacts", () => {
		const stack = createStack("ApprovalStack");
		const topic = new Topic(stack, "Topic");
		const { synthesized } = addMaterializedAction(
			stack,
			{
				type: "approval",
				name: "Approve",
				description: "Review this release",
				notificationTopic: topic,
				notifyEmails: ["reviewer@example.com"],
				externalEntityLink: "https://example.com/release",
				timeout: Duration.minutes(10),
			},
			[],
			[],
		);
		expect(synthesized.ActionTypeId).toMatchObject({
			Category: "Approval",
			Owner: "AWS",
			Provider: "Manual",
		});
		expect(synthesized.Configuration).toMatchObject({
			CustomData: "Review this release",
			ExternalEntityLink: "https://example.com/release",
		});
		expect(synthesized.InputArtifacts).toBeUndefined();
		expect(synthesized.OutputArtifacts).toBeUndefined();
	});

	test("plans Lambda default, false, and explicit inputs and optional outputs", () => {
		const stack = createStack("LambdaPlanStack");
		const handler = createHandler(stack);
		expect(
			planPipelineAction({ type: "lambda", name: "Default", handler }, "action")
				.artifactPlan,
		).toEqual({
			name: "Default",
			input: { mode: "optional" },
			outputs: [],
		});
		expect(
			planPipelineAction(
				{ type: "lambda", name: "None", handler, inputs: false },
				"action",
			).artifactPlan.input,
		).toEqual({ mode: "optional", explicit: false });
		expect(
			planPipelineAction(
				{
					type: "lambda",
					name: "Explicit",
					handler,
					inputs: ["Source", "Manifest"],
					outputs: ["Reviewed"],
				},
				"action",
			).artifactPlan,
		).toMatchObject({
			input: { mode: "optional", explicit: ["Source", "Manifest"] },
			outputs: ["Reviewed"],
		});
	});

	test("materializes Lambda inputs, outputs, and string parameters", () => {
		const stack = createStack("LambdaMaterializeStack");
		const { synthesized } = addMaterializedAction(
			stack,
			{
				type: "lambda",
				name: "Invoke",
				handler: createHandler(stack),
				inputs: ["Source", "Manifest"],
				outputs: ["Reviewed"],
				userParametersString: "opaque",
				variablesNamespace: "LambdaVariables",
			},
			["Source", "Manifest"],
			["Reviewed"],
		);
		expect(synthesized.ActionTypeId).toMatchObject({
			Category: "Invoke",
			Owner: "AWS",
			Provider: "Lambda",
		});
		expect(synthesized.Configuration).toMatchObject({
			UserParameters: "opaque",
		});
		expect(synthesized.OutputArtifacts).toEqual([{ Name: "Reviewed" }]);
	});

	test("rejects direct durable handlers with a clear planning error", () => {
		const stack = createStack("DurableRejectionStack");
		const handler = createHandler(stack) as LambdaFunction & {
			readonly durableFunctionArn: string;
		};
		Object.defineProperty(handler, "durableFunctionArn", {
			value: "arn:durable",
		});
		expectDefinitionError(
			() =>
				planPipelineAction(
					{ type: "lambda", name: "Durable", handler } as never,
					"stages[Review].actions[0]",
				),
			"stages[Review].actions[0].handler",
		);
	});
});

describe("S3 and CloudFormation action adapters", () => {
	test("infers S3 input and maps deploy properties", () => {
		const stack = createStack("S3DeployStack");
		const bucket = new Bucket(stack, "Destination");
		const encryptionKey = new Key(stack, "DestinationKey");
		const planned = planPipelineAction(
			{
				type: "s3Deploy",
				name: "Publish",
				bucket,
				extract: false,
				objectKey: "site.zip",
				accessControl: BucketAccessControl.PRIVATE,
				cacheControl: [],
				encryptionKey,
			},
			"action",
		);
		expect(planned.artifactPlan.input).toEqual({ mode: "required" });
		const { synthesized } = addMaterializedAction(
			stack,
			{
				type: "s3Deploy",
				name: "PublishBound",
				bucket,
				extract: false,
				objectKey: "site.zip",
				accessControl: BucketAccessControl.PRIVATE,
				encryptionKey,
			},
			["Site"],
			[],
		);
		expect(synthesized.ActionTypeId).toMatchObject({
			Category: "Deploy",
			Provider: "S3",
		});
		expect(synthesized.Configuration).toMatchObject({
			Extract: "false",
			ObjectKey: "site.zip",
		});
	});

	test("plans and maps CloudFormation primary, configuration, extras, role, and output", () => {
		const stack = createStack("CloudFormationDeployStack");
		const deploymentRole = new Role(stack, "DeploymentRole", {
			assumedBy: new ServicePrincipal("cloudformation.amazonaws.com"),
		});
		const definition = {
			type: "cloudFormationDeploy" as const,
			name: "Deploy",
			stackName: "Application",
			input: "Template",
			templatePath: "template.json",
			templateConfiguration: { input: "Configuration", path: "config.json" },
			extraInputs: ["Parameters"],
			capabilities: [CfnCapabilities.NAMED_IAM],
			parameterOverrides: { ImageTag: "latest" },
			replaceOnFailure: true,
			output: { fileName: "result.json" },
			deploymentRole,
			account: "123456789012",
			region: "eu-west-1",
			variablesNamespace: "DeployVariables",
		};
		const planned = planPipelineAction(definition, "action");
		expect(planned.artifactPlan).toEqual({
			name: "Deploy",
			input: { mode: "required", explicit: ["Template"] },
			additionalInputs: ["Configuration", "Parameters"],
			outputs: ["DeployOutput"],
		});
		const { synthesized } = addMaterializedAction(
			stack,
			definition,
			["Template", "Configuration", "Parameters"],
			["DeployOutput"],
		);
		expect(synthesized.ActionTypeId).toMatchObject({
			Category: "Deploy",
			Provider: "CloudFormation",
		});
		expect(synthesized.Configuration).toMatchObject({
			ActionMode: "REPLACE_ON_FAILURE",
			Capabilities: "CAPABILITY_NAMED_IAM",
			OutputFileName: "result.json",
			StackName: "Application",
			TemplateConfiguration: "Configuration::config.json",
			TemplatePath: "Template::template.json",
		});
		expect(synthesized.OutputArtifacts).toEqual([{ Name: "DeployOutput" }]);
	});

	test("defaults template configuration to primary and supports admin permissions", () => {
		const stack = createStack("CloudFormationAdminStack");
		const definition = {
			type: "cloudFormationDeploy" as const,
			name: "AdminDeploy",
			stackName: "Application",
			templatePath: "template.json",
			templateConfiguration: { path: "config.json" },
			adminPermissions: true as const,
		};
		const planned = planPipelineAction(definition, "action");
		expect(planned.artifactPlan.additionalInputs).toEqual([]);
		const { synthesized } = addMaterializedAction(
			stack,
			definition,
			["Template"],
			[],
		);
		expect(synthesized.Configuration).toMatchObject({
			TemplateConfiguration: "Template::config.json",
		});
	});
});

describe("custom action adapter", () => {
	test("preserves action and artifact identities", () => {
		const stack = createStack("CustomActionStack");
		const project = createProject(stack);
		const input = new Artifact("CustomInput");
		const output = new Artifact("CustomOutput");
		const action = new CodeBuildAction({
			actionName: "CustomBuild",
			project: project.project,
			input,
			outputs: [output],
		});
		const planned = planPipelineAction(
			{ type: "custom", name: "CustomBuild", action },
			"action",
		);

		expect(planned.artifactPlan).toEqual({
			name: "CustomBuild",
			input: { mode: "required", explicit: ["CustomInput"] },
			outputs: ["CustomOutput"],
		});
		expect(planned.existingArtifacts?.get("CustomInput")).toBe(input);
		expect(planned.existingArtifacts?.get("CustomOutput")).toBe(output);
		expect(planned.materialize({ inputs: [input], outputs: [output] })).toBe(
			action,
		);
	});

	test("rejects mismatched names, non-default run order, and unnamed artifacts", () => {
		const stack = createStack("InvalidCustomActionStack");
		const project = createProject(stack);
		const input = new Artifact("Input");
		const cases = [
			{
				name: "Different",
				action: new CodeBuildAction({
					actionName: "Actual",
					project: project.project,
					input,
				}),
			},
			{
				name: "Ordered",
				action: new CodeBuildAction({
					actionName: "Ordered",
					runOrder: 2,
					project: project.project,
					input,
				}),
			},
			{
				name: "Unnamed",
				action: new CodeBuildAction({
					actionName: "Unnamed",
					project: project.project,
					input: new Artifact(),
				}),
			},
			{
				name: "TooManyOutputs",
				action: new CodeBuildAction({
					actionName: "TooManyOutputs",
					project: project.project,
					input,
					outputs: [
						new Artifact("One"),
						new Artifact("Two"),
						new Artifact("Three"),
						new Artifact("Four"),
						new Artifact("Five"),
						new Artifact("Six"),
					],
				}),
			},
		];
		for (const value of cases) {
			expectDefinitionError(() =>
				planPipelineAction({ type: "custom", ...value }, "action"),
			);
		}
	});

	test("accepts an ordinary approval IAction as custom", () => {
		const action = new ManualApprovalAction({ actionName: "External" });
		const planned = planPipelineAction(
			{ type: "custom", name: "External", action },
			"action",
		);
		expect(planned.artifactPlan.input).toEqual({ mode: "none" });
		expect(action.actionProperties.category).toBe(ActionCategory.APPROVAL);
	});
});
