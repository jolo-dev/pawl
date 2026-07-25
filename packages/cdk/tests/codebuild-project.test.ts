import { describe, expect, expectTypeOf, test } from "bun:test";
import path from "node:path";
import { Arn, ArnFormat, Aspects, type CfnResource } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { Repository } from "aws-cdk-lib/aws-codecommit";
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

	test("preserves a supplied repository and uses it as the CodeBuild source", () => {
		const stack = new Stack(createTestApp(), "SharedRepositoryStack");
		const repository = new Repository(stack, "SharedRepository", {
			repositoryName: "shared-review-target",
		});
		const construct = new CodeBuildProject(stack, "Build", {
			repository,
			networkPolicy: publicTestPolicy,
		});
		const template = Template.fromStack(stack);
		const repositoryId = stack.getLogicalId(
			repository.node.defaultChild as CfnResource,
		);

		expect(construct.repository).toBe(repository);
		expectTypeOf(construct.repository).toEqualTypeOf<Repository>();
		template.hasResourceProperties("AWS::CodeBuild::Project", {
			Source: {
				Location: { "Fn::GetAtt": [repositoryId, "CloneUrlHttp"] },
				Type: "CODECOMMIT",
			},
		});
	});

	test("rejects missing or ambiguous repository targets before child resources", () => {
		for (const [id, target] of [
			["Missing", {}],
			[
				"Ambiguous",
				{
					repositoryName: "review-target",
					repository: new Repository(
						new Stack(createTestApp(), "OtherRepositoryStack"),
						"Repository",
						{ repositoryName: "other-target" },
					),
				},
			],
		] as const) {
			const stack = new Stack(createTestApp(), `${id}Stack`);
			expect(
				() =>
					new CodeBuildProject(stack, "Build", {
						...target,
						networkPolicy: publicTestPolicy,
					} as CodeBuildProjectProps),
			).toThrow(/exactly one/);
			expect(Template.fromStack(stack).findResources("AWS::KMS::Key")).toEqual(
				{},
			);
			expect(
				Template.fromStack(stack).findResources("AWS::CodeBuild::Project"),
			).toEqual({});
		}
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

	test("grants the project exact cross-account CodeArtifact access in a dedicated policy", () => {
		const { stack, construct, template } = createProject();
		const projectRoleId = stack.getLogicalId(
			construct.project.role?.node.defaultChild as CfnResource,
		);
		const policies = Object.values(template.findResources("AWS::IAM::Policy"));
		const codeArtifactPolicies = policies.filter(({ Properties }) =>
			(
				Properties.PolicyDocument.Statement as Array<{
					Action: string | string[];
				}>
			).some(({ Action }) =>
				(Array.isArray(Action) ? Action : [Action]).includes(
					"codeartifact:GetAuthorizationToken",
				),
			),
		);

		expect(codeArtifactPolicies).toHaveLength(1);
		expect(codeArtifactPolicies[0]?.Properties.Roles).toEqual([
			{ Ref: projectRoleId },
		]);
		expect(
			codeArtifactPolicies[0]?.Properties.PolicyDocument.Statement,
		).toEqual([
			{
				Action: "codeartifact:GetAuthorizationToken",
				Effect: "Allow",
				Resource: stack.resolve(
					Arn.format(
						{
							account: "123456789012",
							arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
							partition: stack.partition,
							region: stack.region,
							resource: "domain",
							resourceName: "pawl-domain",
							service: "codeartifact",
						},
						stack,
					),
				),
			},
			{
				Action: [
					"codeartifact:GetRepositoryEndpoint",
					"codeartifact:ReadFromRepository",
				],
				Effect: "Allow",
				Resource: stack.resolve(
					Arn.format(
						{
							account: "123456789012",
							arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
							partition: stack.partition,
							region: stack.region,
							resource: "repository",
							resourceName: "pawl-domain/approved-packages",
							service: "codeartifact",
						},
						stack,
					),
				),
			},
			{
				Action: "sts:GetServiceBearerToken",
				Condition: {
					StringEquals: {
						"sts:AWSServiceName": "codeartifact.amazonaws.com",
					},
				},
				Effect: "Allow",
				Resource: "*",
			},
		]);
		const codeArtifactPolicy =
			construct.node.tryFindChild("CodeArtifactPolicy");
		const suppressions = (
			codeArtifactPolicy?.node.defaultChild as CfnResource | undefined
		)?.getMetadata("cdk_nag") as
			| {
					rules_to_suppress: Array<{
						applies_to?: unknown[];
						id: string;
					}>;
			  }
			| undefined;
		expect(suppressions?.rules_to_suppress).toEqual([
			expect.objectContaining({
				applies_to: ["Resource::*"],
				id: "AwsSolutions-IAM5",
			}),
		]);
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

	test("grants exact run and log-read permissions in one idempotent reviewer-only policy", () => {
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
		const dedicatedPolicies = reviewerPolicies.filter(({ Properties }) =>
			(
				Properties.PolicyDocument.Statement as Array<{
					Action: string | string[];
				}>
			).some(({ Action }) =>
				(Array.isArray(Action) ? Action : [Action]).includes(
					"codebuild:StartBuild",
				),
			),
		);

		expect(dedicatedPolicies).toHaveLength(1);
		expect(dedicatedPolicies[0]?.Properties.Roles).toEqual([
			{ Ref: reviewerRoleId },
		]);
		expect(dedicatedPolicies[0]?.Properties.PolicyDocument.Statement).toEqual([
			{
				Action: "codebuild:StartBuild",
				Effect: "Allow",
				Resource: stack.resolve(construct.projectArn),
			},
			{
				Action: "codebuild:BatchGetBuilds",
				Effect: "Allow",
				Resource: stack.resolve(construct.projectArn),
			},
			{
				Action: [
					"logs:DescribeLogStreams",
					"logs:GetLogEvents",
					"logs:FilterLogEvents",
				],
				Effect: "Allow",
				Resource: [
					stack.resolve(construct.logGroupArn),
					stack.resolve(`${construct.logGroupArn}:*`),
				],
			},
		]);
		expect(JSON.stringify(unrelatedPolicies)).not.toContain(
			"codebuild:StartBuild",
		);

		const reviewerDefaultPolicy =
			reviewer.lambda.role?.node.tryFindChild("DefaultPolicy");
		expect(reviewerDefaultPolicy?.node.metadata).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					data: expect.objectContaining({
						rules_to_suppress: expect.arrayContaining([
							expect.objectContaining({ id: "AwsSolutions-IAM5" }),
						]),
					}),
					type: "cdk_nag",
				}),
			]),
		);
		const dedicatedPolicy = construct.node.children.find((child) =>
			child.node.id.startsWith("ReviewerRunAndReadPolicy"),
		);
		const dedicatedSuppressions = (
			dedicatedPolicy?.node.defaultChild as CfnResource | undefined
		)?.getMetadata("cdk_nag") as
			| {
					rules_to_suppress: Array<{
						applies_to?: unknown[];
						id: string;
					}>;
			  }
			| undefined;
		expect(dedicatedSuppressions?.rules_to_suppress).toHaveLength(2);
		expect(dedicatedSuppressions?.rules_to_suppress).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					applies_to: expect.arrayContaining([
						expect.objectContaining({ regex: expect.any(String) }),
					]),
					id: "AwsSolutions-IAM5",
				}),
			]),
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
			"VPC id with the wrong prefix",
			{ networkPolicy: { ...privatePolicy, vpcId: "subnet-01234567" } },
		],
		[
			"VPC id with a short suffix",
			{ networkPolicy: { ...privatePolicy, vpcId: "vpc-0123456" } },
		],
		[
			"VPC id with a long suffix",
			{
				networkPolicy: {
					...privatePolicy,
					vpcId: "vpc-0123456789abcdef01",
				},
			},
		],
		[
			"subnet id with the wrong prefix",
			{
				networkPolicy: {
					...privatePolicy,
					privateSubnetIds: ["vpc-01234567"],
				},
			},
		],
		[
			"security group id with the wrong prefix",
			{
				networkPolicy: {
					...privatePolicy,
					packageAccess: {
						...privatePolicy.packageAccess,
						endpointSecurityGroupIds: ["pl-01234567"],
					},
				},
			},
		],
		[
			"prefix list id with the wrong prefix",
			{
				networkPolicy: {
					...privatePolicy,
					packageAccess: {
						...privatePolicy.packageAccess,
						prefixListIds: ["sg-01234567"],
					},
				},
			},
		],
		[
			"non-12-digit domain owner",
			{
				networkPolicy: {
					...privatePolicy,
					packageAccess: {
						...privatePolicy.packageAccess,
						domainOwner: "12345678901a",
					},
				},
			},
		],
		[
			"uppercase CodeArtifact domain",
			{
				networkPolicy: {
					...privatePolicy,
					packageAccess: {
						...privatePolicy.packageAccess,
						domain: "Pawl-domain",
					},
				},
			},
		],
		[
			"single-character CodeArtifact domain",
			{
				networkPolicy: {
					...privatePolicy,
					packageAccess: {
						...privatePolicy.packageAccess,
						domain: "a",
					},
				},
			},
		],
		[
			"overlength CodeArtifact domain",
			{
				networkPolicy: {
					...privatePolicy,
					packageAccess: {
						...privatePolicy.packageAccess,
						domain: `a${"b".repeat(50)}`,
					},
				},
			},
		],
		[
			"invalid CodeArtifact repository",
			{
				networkPolicy: {
					...privatePolicy,
					packageAccess: {
						...privatePolicy.packageAccess,
						repository: "bad/repository",
					},
				},
			},
		],
		[
			"overlength CodeArtifact repository",
			{
				networkPolicy: {
					...privatePolicy,
					packageAccess: {
						...privatePolicy.packageAccess,
						repository: `A${"b".repeat(100)}`,
					},
				},
			},
		],
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

	test("accepts identifier and CodeArtifact name boundaries without constraining availability-zone partitions", () => {
		const config = CodeBuildProjectConfigSchema.parse({
			repositoryName: "review-target",
			networkPolicy: {
				mode: "private",
				vpcId: `vpc-${"a".repeat(8)}`,
				availabilityZones: ["provider-specific-zone"],
				privateSubnetIds: [`subnet-${"b".repeat(17)}`],
				packageAccess: {
					mode: "codeartifact",
					domain: `a${"b".repeat(49)}`,
					domainOwner: "123456789012",
					repository: `A${"b".repeat(99)}`,
					endpointSecurityGroupIds: [`sg-${"c".repeat(8)}`],
					prefixListIds: [`pl-${"d".repeat(17)}`],
				},
			},
		});
		expect(config.networkPolicy).toEqual(
			expect.objectContaining({
				availabilityZones: ["provider-specific-zone"],
				vpcId: "vpc-aaaaaaaa",
			}),
		);
	});

	test.each([
		["a slash", "bad/team", "bar", "Build"],
		["a prefix-inclusive overlength", "foo", "bar", "a".repeat(238)],
	])("rejects a final project name containing %s before project creation", (_name, team, stage, id) => {
		const app = createTestApp();
		app.node.setContext("team", team);
		app.node.setContext("stage", stage);
		const stack = new Stack(app, "InvalidNameStack");
		expect(
			() =>
				new CodeBuildProject(stack, id, {
					repositoryName: "review-target",
					networkPolicy: publicTestPolicy,
				}),
		).toThrow();
		expect(
			Object.keys(
				Template.fromStack(stack).findResources("AWS::CodeBuild::Project"),
			),
		).toHaveLength(0);
	});

	test("exports a repository-free schema with secure defaults and supported retention values", () => {
		const config = CodeBuildProjectConfigSchema.parse({
			networkPolicy: publicTestPolicy,
		});
		expect(config.timeoutMinutes).toBe(30);
		expect(config.computeSize).toBe("SMALL");
		expect(config.logRetentionDays).toBe(30);
		expect(
			CodeBuildProjectConfigSchema.safeParse({
				logRetentionDays: 2,
				networkPolicy: publicTestPolicy,
			}).success,
		).toBe(false);
		expect(
			CodeBuildProjectConfigSchema.safeParse({
				logRetentionDays: 90,
				networkPolicy: publicTestPolicy,
			}).success,
		).toBe(true);
	});

	test("passes AwsSolutions checks for private CodeArtifact with narrow wildcard suppressions", () => {
		const stack = new Stack(createTestApp(), "NagStack");
		const reviewer = new LambdaFunction(stack, "Reviewer", {
			entry: lambdaEntry,
		});
		const construct = new CodeBuildProject(stack, "Build", {
			repositoryName: "review-target",
			networkPolicy: privatePolicy,
		});
		construct.grantRunAndRead(reviewer);
		suppressLambdaFixtureFindings(reviewer);
		NagSuppressions.addResourceSuppressions(
			construct.project.node.tryFindChild("PolicyDocument") as Construct,
			[
				{
					id: "AwsSolutions-IAM5",
					reason:
						"The CodeBuild L2 requires wildcard EC2 describe and network-interface lifecycle APIs for VPC attachment.",
					appliesTo: ["Resource::*"],
				},
			],
		);
		NagSuppressions.addResourceSuppressions(
			construct.project.role?.node.tryFindChild("DefaultPolicy") as Construct,
			[
				{
					id: "AwsSolutions-IAM5",
					reason:
						"The CodeBuild L2 conditions network-interface permission creation to this project's subnets and the CodeBuild service.",
					appliesTo: [
						{
							regex:
								"/^Resource::arn:<AWS::Partition>:ec2:<AWS::Region>:<AWS::AccountId>:network-interface/\\*$/",
						},
					],
				},
			],
		);

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
