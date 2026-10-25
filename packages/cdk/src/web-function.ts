import { CfnOutput } from "aws-cdk-lib";
import {
	CfnWebFunction,
	CfnWebFunctionEndpoint,
	type CfnWebFunctionEndpointProps,
	CfnWebFunctionRevision,
	type CfnWebFunctionRevisionProps,
} from "aws-cdk-lib/aws-lambda";
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import type { Construct } from "constructs";
import { z } from "zod";
import {
	BasicConstruct,
	type BasicConstructProps,
	type PolicyStatement,
} from "./basic-construct";
import type { Stack } from "./stack";

const EndpointType = z.enum(["HOME_REGION", "MULTI_REGION", "PER_REGION"]);
const AuthType = z.enum(["AWS_IAM", "APPLICATION_MANAGED"]);

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";

const webFunctionArchiveDirectory = mkdtempSync(
	path.join(tmpdir(), "pawl-web-function-"),
);
process.on("exit", () => {
	rmSync(webFunctionArchiveDirectory, { recursive: true, force: true });
});

const WebFunctionEndpointProps = z.object({}).loose();

const WebFunctionPropsSchema = z
	.object({
		entry: z.string(),
		endpointType: EndpointType,
		endpointName: z.string(),
		functionName: z.string(),
		authType: AuthType,
	})
	.loose();

type WebFunctionProps = z.infer<typeof WebFunctionPropsSchema> &
	Omit<
		CfnWebFunctionEndpointProps,
		"functionName" | "authType" | "endpointType" | "endpointName"
	> &
	Omit<
		CfnWebFunctionRevisionProps,
		"functionName" | "buildConfig" | "serviceConfig"
	> &
	BasicConstructProps;

export class WebFunction extends BasicConstruct {
	readonly id: string;

	constructor(scope: Stack, id: string, props: WebFunctionProps) {
		super(scope, id, props);

		this.id = id;
		// The actual WebFunction
		const webProps = WebFunctionPropsSchema.parse(props);
		const webFunction = new CfnWebFunction(this, `${id}-web-function`, {
			functionName: props.functionName,
		});

		// The Endpoint of the WebFunction
		// Extract only endpoint base props (runtime validation)
		const endpointBase = WebFunctionEndpointProps.parse(webProps);
		const webFunctionEndpoint = new CfnWebFunctionEndpoint(
			this,
			`${id}-web-function-endpoint`,
			{
				authType: props.authType,
				endpointName: props.endpointName,
				endpointType: props.endpointType,
				functionName: webFunction.webFunctionRef.functionArn,
				...endpointBase,
			},
		);

		// The Code of the HTTP server for the WebFunction it is called revision
		this.uploadToS3(props.entry, webFunction);

		new CfnOutput(this, "webFunctionUrl", {
			value: webFunction.webFunctionRef.functionArn,
			exportName: `${id}-webFunctionArn`,
		});

		new CfnOutput(this, "webFunctionEndpointUrl", {
			value: webFunctionEndpoint.attrDomainName,
			exportName: `${id}-webFunctionDomainName`,
		});
	}

	private uploadToS3(folder: string, webFunction: CfnWebFunction) {
		const zipFile = this.#zipFolder(folder);
		const asset = new Asset(this, "WebFunctionCode", { path: zipFile });
		const iamRole = new Role(this, `${this.id}-web-function-revision-role`, {
			assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
		});
		const cfnWebFunctionRevision = new CfnWebFunctionRevision(
			this,
			`${this.id}-web-function-revision`,
			{
				functionName: webFunction.webFunctionRef.functionArn,
				buildConfig: {
					codeConfig: {
						s3Object: {
							bucket: asset.s3BucketName,
							key: asset.s3ObjectKey,
						},
					},
					runtimeConfig: {
						runtime: "NODEJS_24_X",
					},
				},
				serviceConfig: {
					executionRoleArn: iamRole.roleArn,
				},
			},
		);
		return cfnWebFunctionRevision;
	}
	#zipFolder(folder: string): string {
		const outputZip = path.join(
			webFunctionArchiveDirectory,
			`${this.node.addr}.zip`,
		);
		rmSync(outputZip, { force: true });
		try {
			execFileSync("zip", ["-r", outputZip, folder]);
		} catch (err) {
			throw new Error(`Failed to zip folder "${folder}"`, { cause: err });
		}
		return outputZip;
	}
	protected applyPermissionPolicy(
		_construct: Construct,
		_policyStatement: PolicyStatement,
	): void {
		throw new Error("Method not implemented.");
	}
	createAlarm(_scope: Stack): void {
		throw new Error("Method not implemented.");
	}
}
