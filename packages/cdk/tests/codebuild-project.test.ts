import { describe, expect, test } from "bun:test";
import path from "node:path";
import { Aspects, type CfnResource } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import {
	CodeBuildProject,
	CodeBuildProjectConfigSchema,
	type CodeBuildProjectProps,
} from "../src/codebuild-project";
import { LambdaFunction } from "../src/lambda-function";
import { Stack } from "../src/stack";
import { createTestApp } from "./utils";

const lambdaEntry = path.join(__dirname, "lambda", "test-lambda.ts");

const privatePolicy: CodeBuildProjectProps["networkPolicy"] = {
	mode: "private",
	vpcId: "vpc-0123456789abcdef0",
	availabilityZones: ["eu-west-1a", "eu-west-1b"],
	privateSubnetIds: ["subnet-0123456789abcdef0", "subnet-0fedcba9876543210"],
	packageAccess: {
		mode: "codeartifact",
		domain: "pawl-domain",
		domainOwner: "123456789012",
		repository: "approved-packages",
		endpointSecurityGroupIds: ["sg-0123456789abcdef0"],
		prefixListIds: ["pl-0123456789abcdef0"],
	},
};

const publicTestPolicy: CodeBuildProjectProps["networkPolicy"] = {
	mode: "public-test",
	packageAccess: {
		mode: "approved-registry",
		endpoint: "https://registry.npmjs.org/",
	},
};

function createProject(
	id = "ReviewerBuild",
	props: Partial<CodeBuildProjectProps> = {},
): { stack: Stack; construct: CodeBuildProject; template: Template } {
	const stack = new Stack(createTestApp(), `${id}Stack`);
	const construct = new CodeBuildProject(stack, id, {
		repositoryName: "review-target",
		networkPolicy: privatePolicy,
		...props,
	});
	return { stack, construct, template: Template.fromStack(stack) };
}

function suppressLambdaFixtureFindings(lambdaFunction: LambdaFunction): void {
	NagSuppressions.addResourceSuppressions(
		lambdaFunction.lambda,
		[
			{
				id: "AwsSolutions-IAM4",
				reason:
					"The isolated reviewer fixture uses the Lambda L2 logging policy.",
			},
			{
				id: "AwsSolutions-L1",
				reason: "Pawl pins its supported Node.js 22 runtime.",
			},
			{
				id: "AwsSolutions-Lambda1",
				reason: "The isolated reviewer fixture does not require VPC access.",
			},
			{
				id: "AwsSolutions-Lambda4",
				reason: "The isolated reviewer fixture has no workload DLQ.",
			},
			{
				id: "AwsSolutions-Lambda5",
				reason:
					"The isolated reviewer fixture leaves concurrency to its consumer.",
			},
		],
		true,
	);
}

describe("CodeBuildProject", () => {
	test("uses an imported CodeCommit source and bounded non-privileged defaults", () => {
		const { template } = createProject();

		template.hasResourceProperties("AWS::CodeBuild::Project", {
			Artifacts: { Type: "NO_ARTIFACTS" },
			Environment: {
				ComputeType: "BUILD_GENERAL1_SMALL",
				Image: Match.stringLikeRegexp("aws/codebuild/standard:7\\.0"),
				PrivilegedMode: false,
				Type: "LINUX_CONTAINER",
				EnvironmentVariables: Match.arrayWith([
					{
						Name: "PAWL_PACKAGE_ACCESS_MODE",
						Type: "PLAINTEXT",
						Value: "codeartifact",
					},
					{
						Name: "CODEARTIFACT_DOMAIN",
						Type: "PLAINTEXT",
						Value: "pawl-domain",
					},
					{
						Name: "CODEARTIFACT_DOMAIN_OWNER",
						Type: "PLAINTEXT",
						Value: "123456789012",
					},
					{
						Name: "CODEARTIFACT_REPOSITORY",
						Type: "PLAINTEXT",
						Value: "approved-packages",
					},
				]),
			},
			Source: {
				BuildSpec: Match.stringLikeRegexp("No approved buildspec was supplied"),
				Location: Match.anyValue(),
				Type: "CODECOMMIT",
			},
			TimeoutInMinutes: 30,
		});

		const [resource] = Object.values(
			template.findResources("AWS::CodeBuild::Project"),
		);
		const variables = resource.Properties.Environment
			.EnvironmentVariables as Array<{
			Name: string;
			Type: string;
		}>;
		expect(variables.every(({ Type }) => Type === "PLAINTEXT")).toBe(true);
		expect(variables.map(({ Name }) => Name).sort()).toEqual([
			"CODEARTIFACT_DOMAIN",
			"CODEARTIFACT_DOMAIN_OWNER",
			"CODEARTIFACT_REPOSITORY",
			"PAWL_PACKAGE_ACCESS_MODE",
		]);
		expect(JSON.stringify(resource)).not.toContain("SECRETS_MANAGER");
		expect(JSON.stringify(resource)).not.toContain("PARAMETER_STORE");
	});

	test("honors bounded timeout and compute selections", () => {
		const { template } = createProject("Sized", {
			timeoutMinutes: 60,
			computeSize: "LARGE",
		});
		template.hasResourceProperties("AWS::CodeBuild::Project", {
			Environment: { ComputeType: "BUILD_GENERAL1_LARGE" },
			TimeoutInMinutes: 60,
		});
	});

	test("imports private networking and permits only configured HTTPS destinations", () => {
		const { template } = createProject();

		template.hasResourceProperties("AWS::CodeBuild::Project", {
			VpcConfig: {
				SecurityGroupIds: Match.anyValue(),
				Subnets: ["subnet-0123456789abcdef0", "subnet-0fedcba9876543210"],
				VpcId: "vpc-0123456789abcdef0",
			},
		});
		template.hasResourceProperties("AWS::EC2::SecurityGroup", {
			GroupDescription: Match.anyValue(),
			SecurityGroupEgress: Match.arrayWith([
				Match.objectLike({
					DestinationSecurityGroupId: "sg-0123456789abcdef0",
					FromPort: 443,
					IpProtocol: "tcp",
					ToPort: 443,
				}),
			]),
			VpcId: "vpc-0123456789abcdef0",
		});
		template.hasResourceProperties("AWS::EC2::SecurityGroupEgress", {
			DestinationPrefixListId: "pl-0123456789abcdef0",
			FromPort: 443,
			IpProtocol: "tcp",
			ToPort: 443,
		});
		const [securityGroup] = Object.values(
			template.findResources("AWS::EC2::SecurityGroup"),
		);
		const serialized = JSON.stringify(securityGroup);
		expect(serialized).not.toContain("0.0.0.0/0");
		expect(serialized).not.toContain("::/0");
	});

	test("creates retained encrypted logs and a rotating retained KMS key", () => {
		const { template } = createProject("Encrypted", { logRetentionDays: 90 });

		template.hasResource("AWS::KMS::Key", {
			DeletionPolicy: "Retain",
			UpdateReplacePolicy: "Retain",
			Properties: { EnableKeyRotation: true },
		});
		template.hasResource("AWS::Logs::LogGroup", {
			DeletionPolicy: "Retain",
			UpdateReplacePolicy: "Retain",
			Properties: {
				KmsKeyId: Match.anyValue(),
				RetentionInDays: 90,
			},
		});
		template.hasResourceProperties("AWS::CodeBuild::Project", {
			EncryptionKey: Match.anyValue(),
			LogsConfig: {
				CloudWatchLogs: {
					GroupName: Match.anyValue(),
					Status: "ENABLED",
				},
			},
		});
		for (const role of Object.values(
			template.findResources("AWS::IAM::Role"),
		)) {
			expect(role.Properties.ManagedPolicyArns).toBeUndefined();
		}
	});

	test("requires explicit public-test configuration and rejects it in prod", () => {
		const outsideProd = new Stack(createTestApp(), "PublicTestStack");
		new CodeBuildProject(outsideProd, "PublicTest", {
			repositoryName: "review-target",
			networkPolicy: publicTestPolicy,
		});
		const outsideTemplate = Template.fromStack(outsideProd);
		outsideTemplate.hasResourceProperties("AWS::CodeBuild::Project", {
			Environment: {
				EnvironmentVariables: Match.arrayWith([
					{
						Name: "PAWL_PACKAGE_ACCESS_MODE",
						Type: "PLAINTEXT",
						Value: "approved-registry",
					},
					{
						Name: "PAWL_APPROVED_REGISTRY_ENDPOINT",
						Type: "PLAINTEXT",
						Value: "https://registry.npmjs.org/",
					},
				]),
			},
		});
		expect(outsideTemplate.findResources("AWS::EC2::SecurityGroup")).toEqual(
			{},
		);

		const prodApp = createTestApp();
		prodApp.node.setContext("stage", "prod");
		const prodStack = new Stack(prodApp, "ProdStack");
		expect(
			() =>
				new CodeBuildProject(prodStack, "RejectedPublic", {
					repositoryName: "review-target",
					networkPolicy: publicTestPolicy,
				}),
		).toThrow(/public-test.*prod/i);
	});

	test("grants exact run and log-read permissions only to the reviewer role", () => {
		const stack = new Stack(createTestApp(), "GrantStack");
		const reviewer = new LambdaFunction(stack, "Reviewer", {
			entry: lambdaEntry,
		});
		const unrelated = new LambdaFunction(stack, "Unrelated", {
			entry: lambdaEntry,
		});
		const construct = new CodeBuildProject(stack, "Build", {
			repositoryName: "review-target",
			networkPolicy: publicTestPolicy,
		});

		expect(construct.grantRunAndRead(reviewer)).toBe(construct);
		construct.grantRunAndRead(reviewer);
		const template = Template.fromStack(stack);
		const reviewerRoleId = stack.getLogicalId(
			reviewer.lambda.role?.node.defaultChild as CfnResource,
		);
		const unrelatedRoleId = stack.getLogicalId(
			unrelated.lambda.role?.node.defaultChild as CfnResource,
		);
		const policies = Object.values(template.findResources("AWS::IAM::Policy"));
		const reviewerPolicies = policies.filter(({ Properties }) =>
			(Properties.Roles as Array<{ Ref: string }> | undefined)?.some(
				(role) => role.Ref === reviewerRoleId,
			),
		);
		const unrelatedPolicies = policies.filter(({ Properties }) =>
			(Properties.Roles as Array<{ Ref: string }> | undefined)?.some(
				(role) => role.Ref === unrelatedRoleId,
			),
		);
		const reviewerStatements = reviewerPolicies.flatMap(
			({ Properties }) => Properties.PolicyDocument.Statement,
		);
		const grantedStatements = reviewerStatements.filter(
			(statement) =>
				JSON.stringify(statement).includes("codebuild:StartBuild") ||
				JSON.stringify(statement).includes("logs:DescribeLogStreams"),
		);

		expect(grantedStatements).toHaveLength(2);
		expect(
			grantedStatements.map(({ Action, Effect }) => ({ Action, Effect })),
		).toEqual(
			expect.arrayContaining([
				{
					Action: ["codebuild:StartBuild", "codebuild:BatchGetBuilds"],
					Effect: "Allow",
				},
				{
					Action: [
						"logs:DescribeLogStreams",
						"logs:GetLogEvents",
						"logs:FilterLogEvents",
					],
					Effect: "Allow",
				},
			]),
		);
		const grantedJson = JSON.stringify(grantedStatements);
		expect(grantedJson).not.toContain('"Resource":"*"');
		expect(grantedJson).toContain("BuildProject");
		expect(grantedJson).toContain("BuildLogGroup");
		expect(JSON.stringify(unrelatedPolicies)).not.toContain(
			"codebuild:StartBuild",
		);
	});

	test("applies generic permissions after creation and preserves effect/resource overrides", () => {
		const stack = new Stack(createTestApp(), "GenericGrantStack");
		const reviewer = new LambdaFunction(stack, "Reviewer", {
			entry: lambdaEntry,
		});
		const resourceOverride =
			"arn:aws:codebuild:eu-west-1:123456789012:project/override";
		const construct = new CodeBuildProject(stack, "Build", {
			repositoryName: "review-target",
			networkPolicy: publicTestPolicy,
			permissions: [
				[
					reviewer,
					{
						effect: "deny",
						actions: ["codebuild:StopBuild"],
						resource: resourceOverride,
					},
				],
			],
		});
		construct.grantPermission(reviewer, {
			effect: "allow",
			actions: ["codebuild:BatchGetProjects"],
		});

		const template = Template.fromStack(stack);
		const serialized = JSON.stringify(
			template.findResources("AWS::IAM::Policy"),
		);
		expect(serialized).toContain("codebuild:StopBuild");
		expect(serialized).toContain(resourceOverride);
		expect(serialized).toContain('"Effect":"Deny"');
		expect(serialized).toContain("codebuild:BatchGetProjects");
		expect(serialized).toContain("BuildProject");
		expect(() =>
			construct.grantPermission(new Construct(stack, "NotLambda"), {
				effect: "allow",
				actions: ["codebuild:StartBuild"],
			}),
		).toThrow(/LambdaFunction/);
	});

	test("exposes resources and identifiers and registers monitoring", () => {
		const stack = new Stack(createTestApp(), "MonitoringStack");
		const monitored: unknown[] = [];
		stack.monitoring.monitorCodeBuildProject = (props) => {
			monitored.push(props.project);
			return stack.monitoring;
		};
		const construct = new CodeBuildProject(stack, "Build", {
			repositoryName: "review-target",
			networkPolicy: privatePolicy,
		});

		expect(construct.project).toBeDefined();
		expect(construct.repository.repositoryName).toBe("review-target");
		expect(construct.logGroup).toBeDefined();
		expect(construct.projectName).toBe(construct.project.projectName);
		expect(construct.projectArn).toBe(construct.project.projectArn);
		expect(construct.logGroupName).toBe(construct.logGroup.logGroupName);
		expect(construct.logGroupArn).toBe(construct.logGroup.logGroupArn);
		expect(construct.projectSecurityGroup).toBeDefined();
		expect(monitored).toEqual([construct.project]);
	});

	test.each([
		["empty repository", { repositoryName: "" }],
		["blank repository", { repositoryName: "   " }],
		["timeout below minimum", { timeoutMinutes: 4 }],
		["timeout above maximum", { timeoutMinutes: 61 }],
		["invalid compute", { computeSize: "XLARGE" }],
		["unsupported retention", { logRetentionDays: 2 }],
		["empty VPC id", { networkPolicy: { ...privatePolicy, vpcId: "" } }],
		[
			"no availability zones",
			{ networkPolicy: { ...privatePolicy, availabilityZones: [] } },
		],
		[
			"no private subnets",
			{ networkPolicy: { ...privatePolicy, privateSubnetIds: [] } },
		],
		[
			"no private destinations",
			{
				networkPolicy: {
					...privatePolicy,
					packageAccess: {
						...privatePolicy.packageAccess,
						endpointSecurityGroupIds: [],
						prefixListIds: [],
					},
				},
			},
		],
		[
			"non-HTTPS registry",
			{
				networkPolicy: {
					mode: "public-test",
					packageAccess: {
						mode: "approved-registry",
						endpoint: "http://registry.example.com/",
					},
				},
			},
		],
	])("rejects %s", (_name, overrides) => {
		expect(() =>
			createProject("Invalid", overrides as Partial<CodeBuildProjectProps>),
		).toThrow();
	});

	test("exports a schema that applies secure defaults", () => {
		const config = CodeBuildProjectConfigSchema.parse({
			repositoryName: "review-target",
			networkPolicy: publicTestPolicy,
		});
		expect(config.timeoutMinutes).toBe(30);
		expect(config.computeSize).toBe("SMALL");
		expect(config.logRetentionDays).toBe(30);
	});

	test("passes AwsSolutions checks without suppressing security controls", () => {
		const stack = new Stack(createTestApp(), "NagStack");
		const reviewer = new LambdaFunction(stack, "Reviewer", {
			entry: lambdaEntry,
		});
		const construct = new CodeBuildProject(stack, "Build", {
			repositoryName: "review-target",
			networkPolicy: publicTestPolicy,
		});
		construct.grantRunAndRead(reviewer);
		suppressLambdaFixtureFindings(reviewer);

		Aspects.of(stack).add(new AwsSolutionsChecks());
		stack.node.root.synth();
		const errors = Annotations.fromStack(stack).findError(
			"*",
			Match.stringLikeRegexp("AwsSolutions-.*"),
		);
		expect(errors).toEqual([]);
		for (const id of [
			"AwsSolutions-CB3",
			"AwsSolutions-CB4",
			"AwsSolutions-CB5",
			"AwsSolutions-KMS5",
			"AwsSolutions-LG1",
		]) {
			expect(
				Annotations.fromStack(stack).findInfo("*", Match.stringLikeRegexp(id)),
			).toEqual([]);
		}
	});
});
