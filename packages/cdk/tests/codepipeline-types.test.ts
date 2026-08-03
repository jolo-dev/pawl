import type { CfnCapabilities, Duration } from "aws-cdk-lib";
import type { BuildEnvironmentVariable } from "aws-cdk-lib/aws-codebuild";
import type { IRepository } from "aws-cdk-lib/aws-codecommit";
import type {
	ActionProperties,
	Artifact,
	IAction,
} from "aws-cdk-lib/aws-codepipeline";
import type { CacheControl } from "aws-cdk-lib/aws-codepipeline-actions";
import type { IRole } from "aws-cdk-lib/aws-iam";
import type { IKey } from "aws-cdk-lib/aws-kms";
import type { BucketAccessControl, IBucket } from "aws-cdk-lib/aws-s3";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import type {
	ApprovalActionDefinition,
	CloudFormationDeployActionDefinition,
	CodeBuildActionDefinition,
	CodeBuildActionType,
	CodeCommitPipelineSource,
	CodePipeline,
	CodePipelineProps,
	CustomActionDefinition,
	LambdaActionDefinition,
	PipelineActionBase,
	PipelineActionDefinition,
	PipelineDefinitionErrorCode,
	PipelineStageDefinition,
	S3DeployActionDefinition,
} from "../index";
import type { CodeBuildProject } from "../src/codebuild-project";
import type { DurableLambdaFunction } from "../src/durable-lambda-function";
import type { LambdaFunction } from "../src/lambda-function";

function verifyCodeCommitPipelineSourceTypes(repository: IRepository): void {
	const createSource: CodeCommitPipelineSource = {
		origin: "codecommit",
		create: true,
		repositoryName: "created-repository",
		description: "Created repository",
		branchName: "develop",
		sync: ".",
	};
	const importSource: CodeCommitPipelineSource = {
		origin: "codecommit",
		create: false,
		repositoryName: "imported-repository",
		branchName: "main",
	};
	const suppliedSource: CodeCommitPipelineSource = {
		origin: "codecommit",
		repository,
		repositoryName: "literal-fallback",
		branchName: "release",
	};

	// @ts-expect-error sync belongs only to create ownership
	const importWithSync: CodeCommitPipelineSource = {
		origin: "codecommit",
		create: false,
		repositoryName: "imported-repository",
		sync: ".",
	};

	// @ts-expect-error supplied repository ownership cannot also request creation
	const repositoryWithCreate: CodeCommitPipelineSource = {
		origin: "codecommit",
		repository,
		create: true,
		repositoryName: "created-repository",
	};

	// @ts-expect-error CodeCommit sources must select create, import, or supplied ownership
	const missingOwnership: CodeCommitPipelineSource = {
		origin: "codecommit",
	};

	void [
		createSource,
		importSource,
		suppliedSource,
		importWithSync,
		repositoryWithCreate,
		missingOwnership,
	];
}

function verifyPipelineActionTypes(
	project: CodeBuildProject,
	handler: LambdaFunction,
	durable: DurableLambdaFunction,
	deploymentRole: IRole,
	artifact: Artifact,
	bucket: IBucket,
	topic: ITopic,
	encryptionKey: IKey,
	action: IAction,
	regionalAction: IAction & {
		readonly actionProperties: ActionProperties & { readonly region: string };
	},
	timeout: Duration,
	capability: CfnCapabilities,
	actionType: CodeBuildActionType,
	environmentVariable: BuildEnvironmentVariable,
	accessControl: BucketAccessControl,
	cacheControl: CacheControl,
): void {
	const common: PipelineActionBase = {
		name: "Common",
		role: deploymentRole,
		variablesNamespace: "CommonVariables",
	};
	const build: CodeBuildActionDefinition = {
		type: "codebuild",
		name: "Build",
		role: deploymentRole,
		// @ts-expect-error CodeBuild actions do not support a region override
		region: "eu-west-1",
		variablesNamespace: "BuildVariables",
		project,
		input: "Source",
		extraInputs: ["Dependencies"],
		outputs: ["Application"],
		actionType,
		environmentVariables: { MODE: environmentVariable },
		checkSecretsInPlainTextEnvVariables: false,
		executeBatchBuild: true,
		combineBatchBuildArtifacts: true,
	};
	const buildWithoutOutputs: CodeBuildActionDefinition = {
		type: "codebuild",
		name: "Verify",
		project,
		outputs: false,
	};
	const approval: ApprovalActionDefinition = {
		type: "approval",
		name: "Approve",
		role: deploymentRole,
		// @ts-expect-error approval actions do not support a region override
		region: "eu-west-1",
		variablesNamespace: "ApprovalVariables",
		description: "Review the release",
		notificationTopic: topic,
		notifyEmails: ["reviewer@example.com"],
		externalEntityLink: "https://example.com/release",
		timeout,
	};
	const s3Deploy: S3DeployActionDefinition = {
		type: "s3Deploy",
		name: "Publish",
		role: deploymentRole,
		// @ts-expect-error S3 deploy actions do not support a region override
		region: "eu-west-1",
		variablesNamespace: "PublishVariables",
		bucket,
		input: "Application",
		extract: false,
		objectKey: "application.zip",
		accessControl,
		cacheControl: [cacheControl],
		encryptionKey,
	};
	const custom: CustomActionDefinition = {
		type: "custom",
		name: "Custom",
		action: regionalAction,
	};
	const customWithRegionOverride: CustomActionDefinition = {
		type: "custom",
		name: "CustomOverride",
		action,
		// @ts-expect-error custom actions preserve IAction region and do not support an override
		region: "eu-west-1",
	};
	const objectParameters: LambdaActionDefinition = {
		type: "lambda",
		name: "Invoke",
		role: deploymentRole,
		// @ts-expect-error Lambda actions do not support a region override
		region: "eu-west-1",
		variablesNamespace: "LambdaVariables",
		handler,
		inputs: ["Application"],
		outputs: ["Reviewed"],
		userParameters: { enabled: true },
	};
	const stringParameters: LambdaActionDefinition = {
		type: "lambda",
		name: "InvokeString",
		handler,
		inputs: false,
		userParametersString: "opaque",
	};

	const durableAction: LambdaActionDefinition = {
		type: "lambda",
		name: "Durable",
		// @ts-expect-error durable Lambda functions cannot be invoked directly
		handler: durable,
	};
	// @ts-expect-error Lambda parameter forms are mutually exclusive
	const conflictingParameters: LambdaActionDefinition = {
		type: "lambda",
		name: "Conflicting",
		handler,
		userParameters: {},
		userParametersString: "opaque",
	};
	// @ts-expect-error non-admin CloudFormation deployments require a role
	const missingDeploymentRole: CloudFormationDeployActionDefinition = {
		type: "cloudFormationDeploy",
		name: "Deploy",
		stackName: "Application",
		templatePath: "template.json",
	};
	const deployment: CloudFormationDeployActionDefinition = {
		type: "cloudFormationDeploy",
		name: "DeployWithRole",
		role: deploymentRole,
		region: "eu-west-1",
		variablesNamespace: "DeployVariables",
		stackName: "Application",
		input: "Template",
		templatePath: "template.json",
		templateConfiguration: { input: "Configuration", path: "config.json" },
		extraInputs: ["Parameters"],
		capabilities: [capability],
		parameterOverrides: { ImageTag: "latest" },
		replaceOnFailure: true,
		output: { name: "DeploymentResult", fileName: "result.json" },
		account: "123456789012",
		adminPermissions: false,
		deploymentRole,
	};
	const adminDeployment: CloudFormationDeployActionDefinition = {
		type: "cloudFormationDeploy",
		name: "AdminDeploy",
		stackName: "AdminApplication",
		templatePath: "template.json",
		adminPermissions: true,
	};
	const allDefinitions: readonly PipelineActionDefinition[] = [
		build,
		buildWithoutOutputs,
		approval,
		objectParameters,
		stringParameters,
		s3Deploy,
		deployment,
		adminDeployment,
		custom,
	];
	// @ts-expect-error admin CloudFormation deployments cannot supply a role
	const adminWithRole: CloudFormationDeployActionDefinition = {
		type: "cloudFormationDeploy",
		name: "AdminDeploy",
		stackName: "Application",
		templatePath: "template.json",
		adminPermissions: true,
		deploymentRole,
	};
	const hiddenActionName: CodeBuildActionDefinition = {
		...build,
		// @ts-expect-error built-ins derive AWS actionName from name
		actionName: "RawName",
	};
	const hiddenRunOrder: CodeBuildActionDefinition = {
		...build,
		// @ts-expect-error fluent stages own run order
		runOrder: 2,
	};
	const hiddenArtifact: CodeBuildActionDefinition = {
		...build,
		// @ts-expect-error built-ins expose artifact names, not raw Artifact objects
		input: artifact,
	};

	void [
		common,
		build,
		buildWithoutOutputs,
		approval,
		s3Deploy,
		custom,
		customWithRegionOverride,
		allDefinitions,
		objectParameters,
		stringParameters,
		durableAction,
		conflictingParameters,
		missingDeploymentRole,
		deployment,
		adminDeployment,
		adminWithRole,
		hiddenActionName,
		hiddenRunOrder,
		hiddenArtifact,
	];
}

function verifyFluentCodePipelineTypes(
	pipeline: CodePipeline,
	source: CodeCommitPipelineSource,
	action: PipelineActionDefinition,
): void {
	const errorCode: PipelineDefinitionErrorCode = "SOURCE_REQUIRED";
	const props: CodePipelineProps = {
		onPullRequest: true,
		variables: [],
		pipelineNaming: { mode: "pawl" },
	};
	const stage: PipelineStageDefinition = { actions: [action] };
	const samePipeline: CodePipeline = pipeline
		.source(source)
		.stage(stage)
		.stage([
			{ name: "First", actions: [action] },
			{ name: "Second", actions: [action] },
		]);

	// @ts-expect-error fluent stage batches must not be empty
	pipeline.stage([]);
	// @ts-expect-error fluent stages must contain at least one action
	pipeline.stage({ name: "Empty", actions: [] });
	// @ts-expect-error source is configured through source()
	const oldSource: CodePipelineProps = { source };
	// @ts-expect-error stages are configured through stage()
	const oldStages: CodePipelineProps = { stages: [stage] };
	// @ts-expect-error BasicConstruct context owns team
	const oldTeam: CodePipelineProps = { team: "platform" };
	// @ts-expect-error BasicConstruct context owns stage
	const oldStage: CodePipelineProps = { stage: "production" };
	const oldAutoReview: CodePipelineProps = {
		// @ts-expect-error autoReview was renamed to autoReviewer
		autoReview: { modelId: "eu.anthropic.claude-sonnet-4-6" },
	};
	// @ts-expect-error CodePipeline always uses V2
	const oldPipelineType: CodePipelineProps = { pipelineType: "V1" };
	// @ts-expect-error raw Pipeline triggers are not part of the fluent contract
	const oldTriggers: CodePipelineProps = { triggers: [] };

	void [
		errorCode,
		props,
		stage,
		samePipeline,
		oldSource,
		oldStages,
		oldTeam,
		oldStage,
		oldAutoReview,
		oldPipelineType,
		oldTriggers,
	];
}

void verifyCodeCommitPipelineSourceTypes;
void verifyPipelineActionTypes;
void verifyFluentCodePipelineTypes;
