import { CfnCapabilities, Duration } from "aws-cdk-lib";
import {
	type BuildEnvironmentVariable,
	BuildEnvironmentVariableType,
} from "aws-cdk-lib/aws-codebuild";
import type {
	ActionProperties,
	Artifact,
	IAction,
} from "aws-cdk-lib/aws-codepipeline";
import {
	CacheControl,
	CloudFormationCreateUpdateStackAction,
	CodeBuildAction,
	CodeBuildActionType,
	LambdaInvokeAction,
	ManualApprovalAction,
	S3DeployAction,
} from "aws-cdk-lib/aws-codepipeline-actions";
import type { IRole } from "aws-cdk-lib/aws-iam";
import type { IKey } from "aws-cdk-lib/aws-kms";
import { BucketAccessControl, type IBucket } from "aws-cdk-lib/aws-s3";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";
import { z } from "zod";
import { CodeBuildProject } from "../codebuild-project";
import { LambdaFunction } from "../lambda-function";
import type { ArtifactActionPlan } from "./artifacts";
import { PipelineDefinitionError } from "./errors";
import { deriveDefaultArtifactName, validateArtifactName } from "./naming";

export { CodeBuildActionType } from "aws-cdk-lib/aws-codepipeline-actions";

export interface PipelineActionBase {
	readonly name: string;
	readonly role?: IRole;
	readonly variablesNamespace?: string;
}

type AwsActionBase = PipelineActionBase;

type CloudFormationActionBase = PipelineActionBase & {
	readonly region?: string;
};

type UnionKeys<T> = T extends T ? keyof T : never;
type StrictUnionHelper<T, TAll> = T extends unknown
	? T & Partial<Record<Exclude<UnionKeys<TAll>, keyof T>, never>>
	: never;
type StrictUnion<T> = StrictUnionHelper<T, T>;

export interface CodeBuildActionDefinition extends AwsActionBase {
	readonly type: "codebuild";
	readonly project: CodeBuildProject;
	readonly input?: string;
	readonly extraInputs?: readonly string[];
	readonly outputs?: readonly string[] | false;
	readonly actionType?: CodeBuildActionType;
	readonly environmentVariables?: Readonly<
		Record<string, BuildEnvironmentVariable>
	>;
	readonly checkSecretsInPlainTextEnvVariables?: boolean;
	readonly executeBatchBuild?: boolean;
	readonly combineBatchBuildArtifacts?: boolean;
}

export interface ApprovalActionDefinition extends AwsActionBase {
	readonly type: "approval";
	readonly description?: string;
	readonly notificationTopic?: ITopic;
	readonly notifyEmails?: readonly string[];
	readonly externalEntityLink?: string;
	readonly timeout?: Duration;
}

type OrdinaryLambdaFunction = LambdaFunction & {
	readonly durableFunctionArn?: never;
};

type LambdaParameters = StrictUnion<
	| {
			readonly userParameters?: Readonly<Record<string, unknown>>;
			readonly userParametersString?: never;
	  }
	| {
			readonly userParameters?: never;
			readonly userParametersString: string;
	  }
>;

export type LambdaActionDefinition = AwsActionBase &
	LambdaParameters & {
		readonly type: "lambda";
		readonly handler: OrdinaryLambdaFunction;
		readonly inputs?: readonly string[] | false;
		readonly outputs?: readonly string[];
	};

export interface S3DeployActionDefinition extends AwsActionBase {
	readonly type: "s3Deploy";
	readonly bucket: IBucket;
	readonly input?: string;
	readonly extract?: boolean;
	readonly objectKey?: string;
	readonly accessControl?: BucketAccessControl;
	readonly cacheControl?: readonly CacheControl[];
	readonly encryptionKey?: IKey;
}

type CloudFormationPermissions = StrictUnion<
	| {
			readonly adminPermissions: true;
			readonly deploymentRole?: never;
	  }
	| {
			readonly adminPermissions?: false;
			readonly deploymentRole: IRole;
	  }
>;

export type CloudFormationDeployActionDefinition = CloudFormationActionBase &
	CloudFormationPermissions & {
		readonly type: "cloudFormationDeploy";
		readonly stackName: string;
		readonly input?: string;
		readonly templatePath: string;
		readonly templateConfiguration?: {
			readonly input?: string;
			readonly path: string;
		};
		readonly extraInputs?: readonly string[];
		readonly capabilities?: readonly CfnCapabilities[];
		readonly parameterOverrides?: Readonly<Record<string, unknown>>;
		readonly replaceOnFailure?: boolean;
		readonly output?: {
			readonly name?: string;
			readonly fileName: string;
		};
		readonly account?: string;
	};

export interface CustomActionDefinition {
	readonly type: "custom";
	readonly name: string;
	readonly region?: string;
	readonly action: IAction;
}

export type PipelineActionDefinition =
	| CodeBuildActionDefinition
	| ApprovalActionDefinition
	| LambdaActionDefinition
	| S3DeployActionDefinition
	| CloudFormationDeployActionDefinition
	| CustomActionDefinition;

export interface PlannedActionAdapter {
	readonly artifactPlan: ArtifactActionPlan;
	readonly existingArtifacts?: ReadonlyMap<string, Artifact>;
	materialize(input: {
		readonly inputs: readonly Artifact[];
		readonly outputs: readonly Artifact[];
	}): IAction;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function hasFunction(value: Record<string, unknown>, name: string): boolean {
	return typeof value[name] === "function";
}

function isConstructWith(
	value: unknown,
	stringProperties: readonly string[],
	methods: readonly string[],
): boolean {
	if (!Construct.isConstruct(value) || !isRecord(value)) return false;
	return (
		stringProperties.every((property) => typeof value[property] === "string") &&
		methods.every((method) => hasFunction(value, method))
	);
}

const roleSchema = z.custom<IRole>(
	(value) =>
		isConstructWith(
			value,
			["roleArn", "roleName"],
			["grant", "grantPassRole", "grantAssumeRole"],
		),
	"role must be an AWS IAM IRole construct",
);

const bucketSchema = z.custom<IBucket>(
	(value) =>
		isConstructWith(
			value,
			["bucketArn", "bucketName"],
			["grantRead", "grantWrite"],
		),
	"bucket must be an AWS S3 IBucket construct",
);

const topicSchema = z.custom<ITopic>(
	(value) =>
		isConstructWith(
			value,
			["topicArn", "topicName"],
			["addSubscription", "grantPublish"],
		),
	"notificationTopic must be an AWS SNS ITopic construct",
);

const keySchema = z.custom<IKey>(
	(value) =>
		isConstructWith(
			value,
			["keyArn", "keyId"],
			["grantEncrypt", "grantDecrypt"],
		),
	"encryptionKey must be an AWS KMS IKey construct",
);

const projectSchema = z.custom<CodeBuildProject>(
	(value) =>
		value instanceof CodeBuildProject &&
		Construct.isConstruct(value) &&
		Construct.isConstruct(value.project),
	"project must be a Pawl CodeBuildProject construct",
);

const lambdaSchema = z.custom<OrdinaryLambdaFunction>(
	(value) =>
		value instanceof LambdaFunction &&
		Construct.isConstruct(value) &&
		Construct.isConstruct(value.lambda) &&
		!("durableFunctionArn" in value),
	"handler must be an ordinary Pawl LambdaFunction; durable functions cannot be invoked directly",
);

function isActionProperties(value: unknown): value is ActionProperties {
	if (!isRecord(value)) return false;
	const bounds = value.artifactBounds;
	return (
		typeof value.actionName === "string" &&
		typeof value.category === "string" &&
		typeof value.provider === "string" &&
		isRecord(bounds) &&
		["minInputs", "maxInputs", "minOutputs", "maxOutputs"].every(
			(property) => typeof bounds[property] === "number",
		) &&
		(value.inputs === undefined || Array.isArray(value.inputs)) &&
		(value.outputs === undefined || Array.isArray(value.outputs))
	);
}

const actionSchema = z.custom<IAction>(
	(value) =>
		isRecord(value) &&
		isActionProperties(value.actionProperties) &&
		hasFunction(value, "bind") &&
		hasFunction(value, "onStateChange"),
	"action must be a complete AWS CodePipeline IAction",
);

const nonemptyString = z.string().min(1);
const artifactName = nonemptyString;
const artifactNames = z.array(artifactName).min(1);
const commonAwsFields = {
	name: nonemptyString,
	role: roleSchema.optional(),
	region: nonemptyString.optional(),
	variablesNamespace: nonemptyString.optional(),
};
const environmentVariableSchema = z
	.object({
		value: z.unknown(),
		type: z.nativeEnum(BuildEnvironmentVariableType).optional(),
	})
	.strict();

const codeBuildSchema = z
	.object({
		type: z.literal("codebuild"),
		...commonAwsFields,
		project: projectSchema,
		input: artifactName.optional(),
		extraInputs: z.array(artifactName).max(4).optional(),
		outputs: z.union([artifactNames.max(5), z.literal(false)]).optional(),
		actionType: z.nativeEnum(CodeBuildActionType).optional(),
		environmentVariables: z
			.record(z.string(), environmentVariableSchema)
			.optional(),
		checkSecretsInPlainTextEnvVariables: z.boolean().optional(),
		executeBatchBuild: z.boolean().optional(),
		combineBatchBuildArtifacts: z.boolean().optional(),
	})
	.strict();

const approvalSchema = z
	.object({
		type: z.literal("approval"),
		...commonAwsFields,
		description: z.string().optional(),
		notificationTopic: topicSchema.optional(),
		notifyEmails: z.array(nonemptyString).optional(),
		externalEntityLink: nonemptyString.optional(),
		timeout: z
			.custom<Duration>((value) => value instanceof Duration)
			.optional(),
	})
	.strict();

const lambdaBaseFields = {
	type: z.literal("lambda"),
	...commonAwsFields,
	handler: lambdaSchema,
	inputs: z
		.union([z.array(artifactName).min(1).max(5), z.literal(false)])
		.optional(),
	outputs: z.array(artifactName).min(1).max(5).optional(),
};
const lambdaSchemaDefinition = z.union([
	z
		.object({
			...lambdaBaseFields,
			userParameters: z.record(z.string(), z.unknown()).optional(),
			userParametersString: z.never().optional(),
		})
		.strict(),
	z
		.object({
			...lambdaBaseFields,
			userParameters: z.never().optional(),
			userParametersString: z.string(),
		})
		.strict(),
]);

const s3DeploySchema = z
	.object({
		type: z.literal("s3Deploy"),
		...commonAwsFields,
		bucket: bucketSchema,
		input: artifactName.optional(),
		extract: z.boolean().optional(),
		objectKey: nonemptyString.optional(),
		accessControl: z.nativeEnum(BucketAccessControl).optional(),
		cacheControl: z
			.array(z.custom<CacheControl>((value) => value instanceof CacheControl))
			.optional(),
		encryptionKey: keySchema.optional(),
	})
	.strict()
	.refine((value) => value.extract !== false || value.objectKey !== undefined, {
		message: "objectKey is required when extract is false",
		path: ["objectKey"],
	});

const cloudFormationBaseFields = {
	type: z.literal("cloudFormationDeploy"),
	...commonAwsFields,
	stackName: nonemptyString,
	input: artifactName.optional(),
	templatePath: nonemptyString,
	templateConfiguration: z
		.object({ input: artifactName.optional(), path: nonemptyString })
		.strict()
		.optional(),
	extraInputs: z.array(artifactName).optional(),
	capabilities: z.array(z.nativeEnum(CfnCapabilities)).optional(),
	parameterOverrides: z.record(z.string(), z.unknown()).optional(),
	replaceOnFailure: z.boolean().optional(),
	output: z
		.object({ name: artifactName.optional(), fileName: nonemptyString })
		.strict()
		.optional(),
	account: nonemptyString.optional(),
};
const cloudFormationSchema = z.union([
	z
		.object({
			...cloudFormationBaseFields,
			adminPermissions: z.literal(true),
			deploymentRole: z.never().optional(),
		})
		.strict(),
	z
		.object({
			...cloudFormationBaseFields,
			adminPermissions: z.literal(false).optional(),
			deploymentRole: roleSchema,
		})
		.strict(),
]);

const customSchema = z
	.object({
		type: z.literal("custom"),
		name: nonemptyString,
		region: nonemptyString.optional(),
		action: actionSchema,
	})
	.strict();

export const PipelineActionDefinitionSchema = z.union([
	codeBuildSchema,
	approvalSchema,
	lambdaSchemaDefinition,
	s3DeploySchema,
	cloudFormationSchema,
	customSchema,
]);

function definitionError(
	message: string,
	path: string,
): PipelineDefinitionError {
	return new PipelineDefinitionError("PIPELINE_PROP_CONFLICT", message, path);
}

export function parsePipelineActionDefinition(
	value: PipelineActionDefinition,
	path = "action",
): PipelineActionDefinition {
	const result = PipelineActionDefinitionSchema.safeParse(value);
	if (!result.success) {
		const durableHandler =
			isRecord(value) &&
			value.type === "lambda" &&
			isRecord(value.handler) &&
			"durableFunctionArn" in value.handler;
		const message = durableHandler
			? "CodePipeline Lambda actions cannot invoke durable functions directly; use an ordinary bridge Lambda"
			: `Invalid pipeline action: ${z.prettifyError(result.error)}`;
		const errorPath = durableHandler ? `${path}.handler` : path;
		throw definitionError(message, errorPath);
	}
	return result.data as PipelineActionDefinition;
}

function validateActionName(name: string, path: string): string {
	if (name.length > 100 || !/^[A-Za-z0-9.@_-]+$/.test(name)) {
		throw new PipelineDefinitionError(
			"ACTION_NAME_CONFLICT",
			"Action name must be 1-100 characters and contain only letters, numbers, '.', '@', '_', or '-'",
			path,
		);
	}
	return name;
}

function validateNames(
	names: readonly string[],
	path: string,
): readonly string[] {
	const result: string[] = [];
	for (const [index, candidate] of names.entries()) {
		const name = validateArtifactName(candidate, `${path}[${index}]`);
		if (result.includes(name)) {
			throw definitionError(
				`Artifact '${name}' cannot be supplied more than once`,
				`${path}[${index}]`,
			);
		}
		result.push(name);
	}
	return result;
}

function requiredPrimary(input: string | undefined, path: string) {
	return input === undefined
		? ({ mode: "required" } as const)
		: ({
				mode: "required",
				explicit: [validateArtifactName(input, path)],
			} as const);
}

function optionalInputs(
	inputs: readonly string[] | false | undefined,
	path: string,
) {
	if (inputs === undefined) return { mode: "optional" } as const;
	if (inputs === false) return { mode: "optional", explicit: false } as const;
	return { mode: "optional", explicit: validateNames(inputs, path) } as const;
}

function requireArtifact(
	artifacts: readonly Artifact[],
	index: number,
	path: string,
): Artifact {
	const artifact = artifacts[index];
	if (artifact === undefined) {
		throw definitionError(
			`Missing materialized artifact at index ${index}`,
			path,
		);
	}
	return artifact;
}

function awsCommon(definition: AwsActionBase) {
	return {
		actionName: definition.name,
		role: definition.role,
		variablesNamespace: definition.variablesNamespace,
	};
}

function planCodeBuild(
	definition: CodeBuildActionDefinition,
	path: string,
): PlannedActionAdapter {
	if (
		definition.combineBatchBuildArtifacts === true &&
		definition.executeBatchBuild !== true
	) {
		throw definitionError(
			"combineBatchBuildArtifacts requires executeBatchBuild",
			`${path}.combineBatchBuildArtifacts`,
		);
	}
	const additionalInputs = validateNames(
		definition.extraInputs ?? [],
		`${path}.extraInputs`,
	);
	if (
		definition.input !== undefined &&
		additionalInputs.includes(definition.input)
	) {
		throw definitionError(
			`Artifact '${definition.input}' cannot be supplied more than once`,
			`${path}.extraInputs`,
		);
	}
	const outputs =
		definition.outputs === false
			? []
			: definition.outputs === undefined
				? [deriveDefaultArtifactName(definition.name, `${path}.outputs`)]
				: validateNames(definition.outputs, `${path}.outputs`);
	return {
		artifactPlan: {
			name: definition.name,
			input: requiredPrimary(definition.input, `${path}.input`),
			additionalInputs,
			outputs,
		},
		materialize({ inputs, outputs: materializedOutputs }) {
			return new CodeBuildAction({
				...awsCommon(definition),
				project: definition.project.project,
				input: requireArtifact(inputs, 0, `${path}.input`),
				extraInputs: inputs.length > 1 ? [...inputs.slice(1)] : undefined,
				outputs:
					materializedOutputs.length > 0 ? [...materializedOutputs] : undefined,
				type: definition.actionType,
				environmentVariables:
					definition.environmentVariables === undefined
						? undefined
						: { ...definition.environmentVariables },
				checkSecretsInPlainTextEnvVariables:
					definition.checkSecretsInPlainTextEnvVariables,
				executeBatchBuild: definition.executeBatchBuild,
				combineBatchBuildArtifacts: definition.combineBatchBuildArtifacts,
			});
		},
	};
}

function planApproval(
	definition: ApprovalActionDefinition,
): PlannedActionAdapter {
	return {
		artifactPlan: {
			name: definition.name,
			input: { mode: "none" },
			outputs: [],
		},
		materialize() {
			return new ManualApprovalAction({
				...awsCommon(definition),
				additionalInformation: definition.description,
				notificationTopic: definition.notificationTopic,
				notifyEmails:
					definition.notifyEmails === undefined
						? undefined
						: [...definition.notifyEmails],
				externalEntityLink: definition.externalEntityLink,
				timeout: definition.timeout,
			});
		},
	};
}

function planLambda(
	definition: LambdaActionDefinition,
	path: string,
): PlannedActionAdapter {
	const outputs = validateNames(definition.outputs ?? [], `${path}.outputs`);
	return {
		artifactPlan: {
			name: definition.name,
			input: optionalInputs(definition.inputs, `${path}.inputs`),
			outputs,
		},
		materialize({ inputs, outputs: materializedOutputs }) {
			return new LambdaInvokeAction({
				...awsCommon(definition),
				lambda: definition.handler.lambda,
				inputs: inputs.length > 0 ? [...inputs] : undefined,
				outputs:
					materializedOutputs.length > 0 ? [...materializedOutputs] : undefined,
				userParameters: definition.userParameters,
				userParametersString: definition.userParametersString,
			});
		},
	};
}

function planS3Deploy(
	definition: S3DeployActionDefinition,
	path: string,
): PlannedActionAdapter {
	return {
		artifactPlan: {
			name: definition.name,
			input: requiredPrimary(definition.input, `${path}.input`),
			outputs: [],
		},
		materialize({ inputs }) {
			return new S3DeployAction({
				...awsCommon(definition),
				bucket: definition.bucket,
				input: requireArtifact(inputs, 0, `${path}.input`),
				extract: definition.extract,
				objectKey: definition.objectKey,
				accessControl: definition.accessControl,
				cacheControl:
					definition.cacheControl === undefined ||
					definition.cacheControl.length === 0
						? undefined
						: [...definition.cacheControl],
				encryptionKey: definition.encryptionKey,
			});
		},
	};
}

function planCloudFormation(
	definition: CloudFormationDeployActionDefinition,
	path: string,
): PlannedActionAdapter {
	if (definition.role !== undefined && definition.account !== undefined) {
		throw definitionError(
			"CloudFormation action account cannot be used with role",
			`${path}.account`,
		);
	}
	const primaryName =
		definition.input === undefined
			? undefined
			: validateArtifactName(definition.input, `${path}.input`);
	const configurationInput = definition.templateConfiguration?.input;
	const declaredAdditional = [
		...(configurationInput !== undefined && configurationInput !== primaryName
			? [configurationInput]
			: []),
		...(definition.extraInputs ?? []),
	];
	const additionalInputs = validateNames(
		declaredAdditional,
		`${path}.additionalInputs`,
	);
	if (primaryName !== undefined && additionalInputs.includes(primaryName)) {
		throw definitionError(
			`Artifact '${primaryName}' cannot be supplied more than once`,
			`${path}.additionalInputs`,
		);
	}
	const outputs =
		definition.output === undefined
			? []
			: [
					definition.output.name === undefined
						? deriveDefaultArtifactName(definition.name, `${path}.output.name`)
						: validateArtifactName(
								definition.output.name,
								`${path}.output.name`,
							),
				];
	const materializedInputIndex = (
		name: string,
		inputs: readonly Artifact[],
	): number => {
		const index = inputs.findIndex(
			(artifact) => artifact.artifactName === name,
		);
		if (index < 0) {
			throw definitionError(`Artifact '${name}' is not planned`, path);
		}
		return index;
	};
	return {
		artifactPlan: {
			name: definition.name,
			input: requiredPrimary(primaryName, `${path}.input`),
			additionalInputs,
			deduplicateAdditionalInputWithInferredPrimary:
				primaryName === undefined ? configurationInput : undefined,
			maxInputs: 10,
			outputs,
		},
		materialize({ inputs, outputs: materializedOutputs }) {
			const primary = requireArtifact(inputs, 0, `${path}.input`);
			const templateConfiguration =
				definition.templateConfiguration === undefined
					? undefined
					: requireArtifact(
							inputs,
							definition.templateConfiguration.input === undefined
								? 0
								: materializedInputIndex(
										definition.templateConfiguration.input,
										inputs,
									),
							`${path}.templateConfiguration.input`,
						).atPath(definition.templateConfiguration.path);
			const extraInputs = (definition.extraInputs ?? []).map((name) =>
				requireArtifact(
					inputs,
					materializedInputIndex(name, inputs),
					`${path}.extraInputs`,
				),
			);
			const output =
				definition.output === undefined
					? undefined
					: requireArtifact(materializedOutputs, 0, `${path}.output`);
			return new CloudFormationCreateUpdateStackAction({
				...awsCommon(definition),
				region: definition.region,
				account: definition.account,
				stackName: definition.stackName,
				templatePath: primary.atPath(definition.templatePath),
				templateConfiguration,
				extraInputs: extraInputs.length > 0 ? extraInputs : undefined,
				cfnCapabilities:
					definition.capabilities === undefined
						? undefined
						: [...definition.capabilities],
				parameterOverrides: definition.parameterOverrides,
				replaceOnFailure: definition.replaceOnFailure,
				output,
				outputFileName: definition.output?.fileName,
				adminPermissions: definition.adminPermissions ?? false,
				deploymentRole: definition.deploymentRole,
			});
		},
	};
}

function customArtifactName(artifact: Artifact, path: string): string {
	const name = artifact.artifactName;
	if (name === undefined) {
		throw definitionError(
			"Custom action artifacts require a concrete name",
			path,
		);
	}
	return validateArtifactName(name, path);
}

function planCustom(
	definition: CustomActionDefinition,
	path: string,
): PlannedActionAdapter {
	const properties = definition.action.actionProperties;
	if (properties.actionName !== definition.name) {
		throw new PipelineDefinitionError(
			"ACTION_NAME_CONFLICT",
			`Custom action name '${definition.name}' must equal IAction name '${properties.actionName}'`,
			`${path}.name`,
		);
	}
	if (properties.runOrder !== undefined && properties.runOrder !== 1) {
		throw definitionError(
			"Custom action runOrder must be undefined or 1",
			`${path}.action.actionProperties.runOrder`,
		);
	}
	const declaredInputCount = properties.inputs?.length ?? 0;
	const declaredOutputCount = properties.outputs?.length ?? 0;
	const bounds = properties.artifactBounds;
	if (
		declaredInputCount < bounds.minInputs ||
		declaredInputCount > bounds.maxInputs ||
		declaredOutputCount < bounds.minOutputs ||
		declaredOutputCount > bounds.maxOutputs
	) {
		throw definitionError(
			"Custom action artifact counts must satisfy its declared AWS bounds",
			`${path}.action.actionProperties.artifactBounds`,
		);
	}
	const existingArtifacts = new Map<string, Artifact>();
	const inputs = (properties.inputs ?? []).map((artifact, index) => {
		const name = customArtifactName(
			artifact,
			`${path}.action.actionProperties.inputs[${index}]`,
		);
		if (existingArtifacts.has(name)) {
			throw definitionError(
				`Custom action artifact '${name}' is duplicated`,
				`${path}.action.actionProperties.inputs[${index}]`,
			);
		}
		existingArtifacts.set(name, artifact);
		return name;
	});
	const outputs = (properties.outputs ?? []).map((artifact, index) => {
		const name = customArtifactName(
			artifact,
			`${path}.action.actionProperties.outputs[${index}]`,
		);
		if (existingArtifacts.has(name)) {
			throw definitionError(
				`Custom action artifact '${name}' is duplicated`,
				`${path}.action.actionProperties.outputs[${index}]`,
			);
		}
		existingArtifacts.set(name, artifact);
		return name;
	});
	return {
		artifactPlan: {
			name: definition.name,
			input:
				inputs.length === 0
					? { mode: "none" }
					: { mode: "required", explicit: inputs },
			outputs,
		},
		existingArtifacts,
		materialize() {
			return definition.action;
		},
	};
}

export function planPipelineAction(
	definition: PipelineActionDefinition,
	path: string,
): PlannedActionAdapter {
	const parsed = parsePipelineActionDefinition(definition, path);
	if (
		parsed.type !== "cloudFormationDeploy" &&
		parsed.type !== "custom" &&
		"region" in parsed &&
		parsed.region !== undefined
	) {
		throw definitionError(
			`The ${parsed.type} action does not support region`,
			`${path}.region`,
		);
	}
	validateActionName(parsed.name, `${path}.name`);
	switch (parsed.type) {
		case "codebuild":
			return planCodeBuild(parsed, path);
		case "approval":
			return planApproval(parsed);
		case "lambda":
			return planLambda(parsed, path);
		case "s3Deploy":
			return planS3Deploy(parsed, path);
		case "cloudFormationDeploy":
			return planCloudFormation(parsed, path);
		case "custom":
			return planCustom(parsed, path);
	}
}
