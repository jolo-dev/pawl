import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import type { StackProps } from "aws-cdk-lib/core";
import { type Construct, Stack } from "../../cdk/src/stack";
import { WebFunction } from "../src/web-function";
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
	constructor(scope: Construct, id: string, props?: StackProps) {
		super(scope, id, props);
		new WebFunction(this, "TestWebFunction", {
			functionName: "my-web-function",
			authType: "ApplicationManaged",
			entry,
			endpointType: "HomeRegion",
			endpointName: "dev",
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
