import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { expect, test } from "bun:test";
import { Template } from "aws-cdk-lib/assertions";
import type { StackProps } from "aws-cdk-lib/core";
import { type Construct, Stack } from "../../cdk/src/stack";
import { WebFunction } from "../src/web-function";
import { createTestApp } from "./utils";

const fixtureDirectory = mkdtempSync(path.join(os.tmpdir(), "pawl-web-function-"));
process.on("exit", () => {
	rmSync(fixtureDirectory, { recursive: true, force: true });
});
const entry = path.join(fixtureDirectory, "http.ts");
writeFileSync(entry, "export const handler = async () => new Response('ok');\n");

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
	template.resourceCountIs("AWS::S3::Bucket", 1);
	template.resourceCountIs("Custom::CDKBucketDeployment", 1);

	expect(existsSync(`${path.resolve(entry)}.zip`)).toBe(false);
});
