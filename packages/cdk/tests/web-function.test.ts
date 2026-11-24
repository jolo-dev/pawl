import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Aspects } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import type { StackProps } from "aws-cdk-lib/core";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { type Construct, Stack } from "../../cdk/src/stack";
import type { PolicyStatement } from "../src/basic-construct";
import {
	WebFunction,
	WebFunctionAuthType,
	WebFunctionEndpointType,
} from "../src/web-function";
import { createTestApp } from "./utils";

const fixtureDirectory = mkdtempSync(
	path.join(os.tmpdir(), "pawl-web-function-"),
);
process.on("exit", () => {
	rmSync(fixtureDirectory, { recursive: true, force: true });
});
const entry = path.join(fixtureDirectory, "http.ts");
writeFileSync(
	entry,
	"export const handler = async (): Promise<Response> => new Response('ok');\n",
);

class WebFunctionTestStack extends Stack {
	readonly webFunction: WebFunction;

	constructor(
		scope: Construct,
		id: string,
		props?: StackProps,
		webFunctionProps: Partial<
			ConstructorParameters<typeof WebFunction>[2]
		> = {},
	) {
		super(scope, id, props);
		this.webFunction = new WebFunction(this, "TestWebFunction", {
			functionName: "my-web-function",
			authType: WebFunctionAuthType.APPLICATION_MANAGED,
			entry,
			endpointType: WebFunctionEndpointType.HOME_REGION,
			endpointName: "dev",
			...webFunctionProps,
		});
	}
}

test("bundles the entry for Node and zips the bundle at the archive root", () => {
	const app = createTestApp();
	const stack = new WebFunctionTestStack(app, "TestStack");
	const assembly = app.synth();
	const template = Template.fromStack(stack);

	template.resourceCountIs("AWS::Lambda::WebFunction", 1);
	template.resourceCountIs("AWS::Lambda::WebFunctionEndpoint", 1);
	template.resourceCountIs("AWS::Lambda::WebFunctionRevision", 1);
	template.resourceCountIs("AWS::S3::Bucket", 1);
	template.hasResourceProperties("AWS::S3::Bucket", {
		VersioningConfiguration: { Status: "Enabled" },
	});
	template.hasResourceProperties("AWS::S3::BucketPolicy", {
		PolicyDocument: Match.objectLike({
			Statement: Match.arrayWith([
				Match.objectLike({
					Effect: "Allow",
					Principal: { Service: "lambda.amazonaws.com" },
					Action: Match.arrayWith(["s3:GetObject", "s3:GetObjectVersion"]),
				}),
			]),
		}),
	});
	const bucketPolicy = Object.values(
		template.findResources("AWS::S3::BucketPolicy"),
	)[0];
	const lambdaReadStatement =
		bucketPolicy?.Properties?.PolicyDocument?.Statement?.find(
			(statement: { Principal?: { Service?: string } }) =>
				statement.Principal?.Service === "lambda.amazonaws.com",
		);
	expect(lambdaReadStatement?.Condition?.StringEquals).toEqual({
		"aws:SourceAccount": { Ref: "AWS::AccountId" },
	});
	expect(lambdaReadStatement?.Condition?.ArnEquals).toBeUndefined();

	const endpoint = Object.values(
		template.findResources("AWS::Lambda::WebFunctionEndpoint"),
	)[0];
	const revisionLogicalId = Object.keys(
		template.findResources("AWS::Lambda::WebFunctionRevision"),
	)[0];
	const endpointDependencies = Array.isArray(endpoint?.DependsOn)
		? endpoint.DependsOn
		: [endpoint?.DependsOn];
	expect(endpointDependencies).toContain(revisionLogicalId);
	expect(endpoint?.Properties?.RevisionWeights).toEqual([
		{
			RevisionId: {
				"Fn::GetAtt": [revisionLogicalId, "RevisionId"],
			},
			Weight: 100,
		},
	]);

	template.hasResourceProperties("Custom::CDKBucketDeployment", {
		Extract: false,
		RetainOnDelete: false,
	});

	const assets = stack.node
		.findAll()
		.filter((child): child is Asset => child instanceof Asset);
	const zipAsset = assets.find((asset) => {
		if (!asset.assetPath.endsWith(".zip")) return false;
		try {
			return (
				execFileSync(
					"unzip",
					["-Z1", path.join(assembly.directory, asset.assetPath)],
					{ encoding: "utf8" },
				).trim() === "index.js"
			);
		} catch {
			return false;
		}
	});
	if (zipAsset === undefined) throw new Error("Expected WebFunction ZIP asset");
	expect(
		execFileSync(
			"unzip",
			["-Z1", path.join(assembly.directory, zipAsset.assetPath)],
			{ encoding: "utf8" },
		)
			.trim()
			.split("\n"),
	).toEqual(["index.js"]);
	const bundledCode = execFileSync(
		"unzip",
		["-p", path.join(assembly.directory, zipAsset.assetPath), "index.js"],
		{ encoding: "utf8" },
	);
	expect(bundledCode).toContain("new Response");
	expect(bundledCode).not.toContain(": Promise<Response>");

	const revision = Object.values(
		template.findResources("AWS::Lambda::WebFunctionRevision"),
	)[0];
	if (revision === undefined)
		throw new Error("Expected WebFunction revision resource");
	const s3Object = revision.Properties?.BuildConfig?.CodeConfig?.S3Object;
	const deploymentResources = template.findResources(
		"Custom::CDKBucketDeployment",
	);
	const deployment = Object.values(deploymentResources)[0];
	const deploymentLogicalId = Object.keys(deploymentResources)[0];
	if (deployment === undefined || deploymentLogicalId === undefined)
		throw new Error("Expected WebFunction code deployment");
	expect(deployment.Properties?.DestinationBucketKeyPrefix).toBeUndefined();
	expect(s3Object?.Bucket).toEqual(
		deployment.Properties?.DestinationBucketName,
	);
	expect(s3Object?.Key).toEqual({
		"Fn::Select": [
			0,
			{
				"Fn::GetAtt": [deploymentLogicalId, "SourceObjectKeys"],
			},
		],
	});
	expect(s3Object?.VersionId).toEqual({
		"Fn::Select": [
			0,
			{
				"Fn::GetAtt": [deploymentLogicalId, "SourceObjectVersionIds"],
			},
		],
	});

	expect(existsSync(`${path.resolve(entry)}.zip`)).toBe(false);
});

for (const effect of ["allow", "deny"] as const) {
	for (const duringConstruction of [true, false]) {
		test(`applies ${effect} permissions to the revision execution role ${duringConstruction ? "during construction" : "after construction"}`, () => {
			const app = createTestApp();
			const policy: PolicyStatement = {
				effect,
				actions: ["s3:GetObject"],
				resource: "arn:aws:s3:::test-data/item.json",
			};
			const stack = new WebFunctionTestStack(
				app,
				"PermissionsStack",
				undefined,
				{
					permissions: duringConstruction ? [[app, policy]] : undefined,
				},
			);
			if (!duringConstruction) stack.webFunction.grantPermission(stack, policy);

			const template = Template.fromStack(stack);
			const revision = Object.values(
				template.findResources("AWS::Lambda::WebFunctionRevision"),
			)[0];
			const roleId =
				revision?.Properties?.ServiceConfig?.ExecutionRoleArn["Fn::GetAtt"][0];
			expect(roleId).toBeString();
			template.hasResourceProperties("AWS::IAM::Policy", {
				Roles: [{ Ref: roleId }],
				PolicyDocument: {
					Version: "2012-10-17",
					Statement: Match.arrayWith([
						{
							Action: "s3:GetObject",
							Effect: effect === "allow" ? "Allow" : "Deny",
							Resource: policy.resource,
						},
					]),
				},
			});
		});
	}
}

test("defaults permission resources to the WebFunction ARN", () => {
	const stack = new WebFunctionTestStack(
		createTestApp(),
		"DefaultResourceStack",
	);
	stack.webFunction.grantPermission(stack, {
		effect: "allow",
		actions: ["lambda:InvokeWebFunction"],
	});
	const template = Template.fromStack(stack);
	const functionId = Object.keys(
		template.findResources("AWS::Lambda::WebFunction"),
	)[0];
	template.hasResourceProperties("AWS::IAM::Policy", {
		PolicyDocument: Match.objectLike({
			Statement: Match.arrayWith([
				{
					Action: "lambda:InvokeWebFunction",
					Effect: "Allow",
					Resource: { Ref: functionId },
				},
			]),
		}),
	});
});

test("monitors endpoint request metrics and alarms on sparse 5xx responses", () => {
	const stack = new WebFunctionTestStack(createTestApp(), "MonitoringStack");
	const template = Template.fromStack(stack);
	template.hasResourceProperties("AWS::CloudWatch::Alarm", {
		Namespace: "AWS/Lambda/Web",
		MetricName: "HTTPResponseStatusClass5XX",
		Dimensions: [
			{ Name: "EndpointName", Value: "dev" },
			{ Name: "FunctionName", Value: "my-web-function" },
		],
		Statistic: "Sum",
		Period: 300,
		Threshold: 5,
		ComparisonOperator: "GreaterThanThreshold",
		EvaluationPeriods: 1,
		TreatMissingData: "notBreaching",
	});
	const dashboards = JSON.stringify(
		template.findResources("AWS::CloudWatch::Dashboard"),
	);
	for (const metricName of [
		"ExecutedRequests",
		"HTTPResponseStatusClass4XX",
		"HTTPResponseStatusClass5XX",
	]) {
		expect(dashboards).toContain(metricName);
	}
});

test("passes AwsSolutions checks with documented deployment-helper suppressions", () => {
	const stack = new WebFunctionTestStack(createTestApp(), "ComplianceStack");
	stack.webFunction.grantPermission(stack, {
		effect: "allow",
		actions: ["s3:GetObject"],
		resource: "arn:aws:s3:::test-data/item.json",
	});
	NagSuppressions.addResourceSuppressions(
		stack.webFunction.node.findChild(
			"TestWebFunction-web-function-code-bucket",
		),
		[
			{
				id: "AwsSolutions-S1",
				reason:
					"The isolated fixture's code-artifact bucket has no separate access-log bucket; runtime data is not stored here.",
			},
		],
		true,
	);
	const deploymentProvider = stack.node.children.find((child) =>
		child.node.id.startsWith("Custom::CDKBucketDeployment"),
	);
	if (!deploymentProvider) throw new Error("Expected CDK deployment provider");
	NagSuppressions.addResourceSuppressions(
		deploymentProvider,
		[
			{
				id: "AwsSolutions-L1",
				reason:
					"The BucketDeployment provider's Python runtime is selected and maintained by CDK, not the WebFunction.",
			},
			{
				id: "AwsSolutions-IAM4",
				reason:
					"The CDK-managed deployment provider uses AWSLambdaBasicExecutionRole for its own logging.",
			},
			{
				id: "AwsSolutions-IAM5",
				reason:
					"The CDK-managed deployment provider needs S3 read/write action families and object wildcards to copy assets; the WebFunction execution role is not suppressed.",
			},
		],
		true,
	);
	NagSuppressions.addResourceSuppressions(
		stack.webFunction.node.findChild(
			"TestWebFunction-web-function-revision-role",
		),
		[
			{
				id: "AwsSolutions-IAM5",
				reason:
					"CloudWatch Logs stream names are generated at runtime; access is restricted to this function's log groups.",
			},
		],
		true,
	);
	Aspects.of(stack).add(new AwsSolutionsChecks());
	stack.node.root.synth();
	expect(
		Annotations.fromStack(stack).findError(
			"*",
			Match.stringLikeRegexp("AwsSolutions-.*"),
		),
	).toEqual([]);
});
