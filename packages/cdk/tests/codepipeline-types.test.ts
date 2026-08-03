import type { IRepository } from "aws-cdk-lib/aws-codecommit";
import type { Artifact, IAction } from "aws-cdk-lib/aws-codepipeline";
import type { IRole } from "aws-cdk-lib/aws-iam";
import type { IBucket } from "aws-cdk-lib/aws-s3";
import type { CodeBuildProject } from "../src/codebuild-project";
import type { DurableLambdaFunction } from "../src/durable-lambda-function";
import type { LambdaFunction } from "../src/lambda-function";
import type {
	ApprovalActionDefinition,
	CloudFormationDeployActionDefinition,
	CodeBuildActionDefinition,
	CustomActionDefinition,
	LambdaActionDefinition,
	PipelineActionBase,
	PipelineActionDefinition,
	S3DeployActionDefinition,
} from "../src/pipeline/actions";
import type { CodeCommitPipelineSource } from "../src/pipeline/source";

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
	action: IAction,
): void {
	const common: PipelineActionBase = {
		name: "Common",
		role: deploymentRole,
		region: "eu-west-1",
		variablesNamespace: "CommonVariables",
	};
	const build: CodeBuildActionDefinition = {
		type: "codebuild",
		name: "Build",
		role: deploymentRole,
		region: "eu-west-1",
		variablesNamespace: "BuildVariables",
		project,
	};
	const approval: ApprovalActionDefinition = {
		type: "approval",
		name: "Approve",
		role: deploymentRole,
		region: "eu-west-1",
		variablesNamespace: "ApprovalVariables",
		notifyEmails: [],
	};
	const s3Deploy: S3DeployActionDefinition = {
		type: "s3Deploy",
		name: "Publish",
		role: deploymentRole,
		region: "eu-west-1",
		variablesNamespace: "PublishVariables",
		bucket,
	};
	const custom: CustomActionDefinition = {
		type: "custom",
		name: "Custom",
		action,
	};
	const objectParameters: LambdaActionDefinition = {
		type: "lambda",
		name: "Invoke",
		role: deploymentRole,
		region: "eu-west-1",
		variablesNamespace: "LambdaVariables",
		handler,
		userParameters: { enabled: true },
	};
	const stringParameters: LambdaActionDefinition = {
		type: "lambda",
		name: "InvokeString",
		handler,
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
		templatePath: "template.json",
		deploymentRole,
		extraInputs: [],
	};
	const allDefinitions: readonly PipelineActionDefinition[] = [
		build,
		approval,
		objectParameters,
		s3Deploy,
		deployment,
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
		approval,
		s3Deploy,
		custom,
		allDefinitions,
		objectParameters,
		stringParameters,
		durableAction,
		conflictingParameters,
		missingDeploymentRole,
		deployment,
		adminWithRole,
		hiddenActionName,
		hiddenRunOrder,
		hiddenArtifact,
	];
}

void verifyCodeCommitPipelineSourceTypes;
void verifyPipelineActionTypes;
