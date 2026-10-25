import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Template } from "aws-cdk-lib/assertions";
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
	"export const handler = async () => new Response('ok');\n",
);

class WebFunctionTestStack extends Stack {
	constructor(scope: Construct, id: string, props?: StackProps) {
		super(scope, id, props);
		new WebFunction(this, "TestWebFunction", {
			functionName: "my-web-function",
			authType: "APPLICATION_MANAGED",
			entry,
			endpointType: "HOME_REGION",
			endpointName: "dev",
		});
	}
}

test("creates WebFunction deployment resources synchronously", () => {
	const stack = new WebFunctionTestStack(createTestApp(), "TestStack");
	const template = Template.fromStack(stack);

	template.resourceCountIs("AWS::Lambda::WebFunction", 1);
	template.resourceCountIs("AWS::Lambda::WebFunctionEndpoint", 1);
	template.resourceCountIs("AWS::Lambda::WebFunctionRevision", 1);

	const assets = stack.node
		.findAll()
		.filter(
			(child): child is Asset =>
				child instanceof Asset &&
				child.node.path.endsWith("/DeployWebsite/Asset1"),
		);
	expect(assets).toHaveLength(1);
	const asset = assets[0];
	if (asset === undefined) throw new Error("Expected WebFunction ZIP asset");
	expect(asset.isZipArchive).toBe(true);

	const revision = Object.values(
		template.findResources("AWS::Lambda::WebFunctionRevision"),
	)[0];
	if (revision === undefined)
		throw new Error("Expected WebFunction revision resource");
	const s3Object = revision.Properties?.BuildConfig?.CodeConfig?.S3Object;
	expect(s3Object?.Bucket).toBe(stack.resolve(asset.s3BucketName));
	expect(s3Object?.Key).toBe(stack.resolve(asset.s3ObjectKey));

	expect(existsSync(`${path.resolve(entry)}.zip`)).toBe(false);
});
