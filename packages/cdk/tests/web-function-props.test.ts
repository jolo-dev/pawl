import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Stack } from "../src/stack";
import {
	WebFunction,
	WebFunctionAuthType,
	WebFunctionEndpointType,
	type WebFunctionProps,
} from "../src/web-function";
import { createTestApp } from "./utils";

const directory = mkdtempSync(path.join(tmpdir(), "web-function-props-"));
process.on("exit", () => rmSync(directory, { recursive: true, force: true }));
const entry = path.join(directory, "http.ts");
writeFileSync(
	entry,
	"import { createServer } from 'node:http'; createServer((req, res) => res.end('ok')).listen(8080);\n",
);
const defaults: WebFunctionProps = {
	entry,
	functionName: "web-function",
	endpointName: "prod",
	authType: WebFunctionAuthType.APPLICATION_MANAGED,
	endpointType: WebFunctionEndpointType.HOME_REGION,
};
function synth(props: Partial<WebFunctionProps> = {}) {
	const stack = new Stack(createTestApp(), "PropsStack");
	new WebFunction(stack, "Web", { ...defaults, ...props });
	return Template.fromStack(stack);
}

test("maps only endpoint options to the endpoint and revision options to the revision", () => {
	const template = synth({
		description: "API",
		regions: ["eu-west-1"],
		endpointType: WebFunctionEndpointType.MULTI_REGION,
		authType: WebFunctionAuthType.IAM_AUTH,
		scalingConfig: { maxEnvironments: 10 },
		throttleConfig: { rateLimit: 0 },
		maxConcurrencyPerEnvironment: 128,
		timeoutSeconds: 900,
		environmentVariables: { STAGE: "prod" },
		loggingConfig: {
			applicationLogLevel: "INFO",
			systemLogLevel: "WARN",
			logGroup: "/custom/web",
		},
	});
	template.hasResourceProperties("AWS::Lambda::WebFunctionEndpoint", {
		AuthType: "IamAuth",
		EndpointType: "MultiRegion",
		EndpointName: "prod",
		Description: "API",
		Regions: ["eu-west-1"],
		ScalingConfig: { MaxEnvironments: 10 },
		ThrottleConfig: { RateLimit: 0 },
	});
	template.hasResourceProperties("AWS::Lambda::WebFunctionRevision", {
		ServiceConfig: Match.objectLike({
			EnvironmentVariables: { STAGE: "prod" },
			MaxConcurrencyPerEnvironment: 128,
			TimeoutSeconds: 900,
			TelemetryConfig: {
				LoggingConfig: {
					ApplicationLogLevel: "INFO",
					SystemLogLevel: "WARN",
					LogGroup: "/custom/web",
				},
			},
		}),
	});
	template.resourceCountIs("AWS::Cognito::UserPool", 0);
	const endpoint = Object.values(
		template.findResources("AWS::Lambda::WebFunctionEndpoint"),
	)[0];
	expect(endpoint?.Properties?.Entry).toBeUndefined();
	expect(endpoint?.Properties?.EnvironmentVariables).toBeUndefined();
});

const invalid: Record<string, unknown>[] = [
	{ entry: "" },
	{ functionName: "" },
	{ endpointName: "" },
	{ authType: "ApplicationManaged" },
	{ endpointType: "HomeRegion" },
	{ scalingConfig: { maxEnvironments: 0 } },
	{ throttleConfig: { rateLimit: -1 } },
	{ maxConcurrencyPerEnvironment: 0 },
	{ maxConcurrencyPerEnvironment: 129 },
	{ timeoutSeconds: 2 },
	{ timeoutSeconds: 901 },
	{ timeoutSeconds: 3.5 },
	{ environmentVariables: { STAGE: 1 } },
	{ loggingConfig: { systemLogLevel: "ERROR" } },
	{ cognito: { domainPrefix: "UPPER", callbackUrls: ["https://example.com"] } },
	{ cognito: { domainPrefix: "valid", callbackUrls: [] } },
	{ cognito: { domainPrefix: "valid", callbackUrls: ["http://example.com"] } },
	{
		cognito: {
			domainPrefix: "valid",
			callbackUrls: ["https://example.com/#fragment"],
		},
	},
	{
		authType: WebFunctionAuthType.IAM_AUTH,
		cognito: { domainPrefix: "valid", callbackUrls: ["https://example.com"] },
	},
	...["COGNITO_USER_POOL_ID", "COGNITO_CLIENT_ID"].map((key) => ({
		cognito: { domainPrefix: "valid", callbackUrls: ["https://example.com"] },
		environmentVariables: { [key]: "override" },
	})),
];
for (const [index, props] of invalid.entries()) {
	test(`rejects invalid configuration ${index} before bundling`, () => {
		expect(() => synth(props as Partial<WebFunctionProps>)).toThrow();
	});
}

test("provisions optional retained Cognito login resources and injects managed IDs", () => {
	const template = synth({
		cognito: {
			domainPrefix: "my-web-login",
			callbackUrls: [
				"https://example.com/callback",
				"http://localhost:3000/callback",
			],
		},
		environmentVariables: { STAGE: "prod" },
	});
	template.hasResource("AWS::Cognito::UserPool", { DeletionPolicy: "Retain" });
	template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
		GenerateSecret: false,
		AllowedOAuthFlows: ["code"],
		CallbackURLs: [
			"https://example.com/callback",
			"http://localhost:3000/callback",
		],
		LogoutURLs: [
			"https://example.com/callback",
			"http://localhost:3000/callback",
		],
	});
	template.hasResourceProperties("AWS::Cognito::UserPoolDomain", {
		Domain: "my-web-login",
		ManagedLoginVersion: 2,
	});
	template.resourceCountIs("AWS::Cognito::ManagedLoginBranding", 1);
	template.hasResourceProperties("AWS::Lambda::WebFunctionRevision", {
		ServiceConfig: Match.objectLike({
			EnvironmentVariables: {
				STAGE: "prod",
				COGNITO_USER_POOL_ID: Match.anyValue(),
				COGNITO_CLIENT_ID: Match.anyValue(),
			},
		}),
	});
});
