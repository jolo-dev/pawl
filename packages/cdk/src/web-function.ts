import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	ArnFormat,
	CfnOutput,
	Duration,
	Fn,
	RemovalPolicy,
	Token,
} from "aws-cdk-lib";
import {
	ComparisonOperator,
	Metric,
	TreatMissingData,
	Unit,
} from "aws-cdk-lib/aws-cloudwatch";
import {
	AccountRecovery,
	CfnManagedLoginBranding,
	FeaturePlan,
	ManagedLoginVersion,
	Mfa,
	OAuthScope,
	UserPool,
	UserPoolClientIdentityProvider,
} from "aws-cdk-lib/aws-cognito";
import {
	Effect,
	PolicyStatement as IamPolicyStatement,
	Role,
	ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import {
	CfnWebFunction,
	CfnWebFunctionEndpoint,
	CfnWebFunctionRevision,
} from "aws-cdk-lib/aws-lambda";
import {
	BlockPublicAccess,
	Bucket,
	BucketEncryption,
} from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";
import { z } from "zod";
import {
	BasicConstruct,
	type BasicConstructProps,
	type PolicyStatement,
} from "./basic-construct";
import type { Stack } from "./stack";
import {
	WebFunctionAuthType,
	WebFunctionEndpointType,
} from "./web-function-options";

export {
	WebFunctionAuthType,
	WebFunctionEndpointType,
} from "./web-function-options";

const webFunctionArchiveDirectory = mkdtempSync(
	path.join(tmpdir(), "pawl-web-function-"),
);
process.on("exit", () => {
	rmSync(webFunctionArchiveDirectory, { recursive: true, force: true });
});

const cognitoRedirectUrlSchema = z.string().refine((value) => {
	if (Token.isUnresolved(value)) return true;
	try {
		const url = new URL(value);
		const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		return (
			!url.hash &&
			!url.username &&
			!url.password &&
			(url.protocol === "https:" || (url.protocol === "http:" && loopback))
		);
	} catch {
		return false;
	}
}, "Cognito URLs must use HTTPS (or HTTP loopback), without credentials or fragments");

const WebFunctionPropsSchema = z
	.object({
		entry: z.string().min(1),
		functionName: z.string().min(1),
		authType: z
			.custom<WebFunctionAuthType>(
				(value) => value instanceof WebFunctionAuthType,
				{ message: "Expected an instance of WebFunctionAuthType" },
			)
			.transform((option) => option.value),
		endpointType: z
			.custom<WebFunctionEndpointType>(
				(value) => value instanceof WebFunctionEndpointType,
				{ message: "Expected an instance of WebFunctionEndpointType" },
			)
			.transform((option) => option.value),
		endpointName: z.string().min(1),
		description: z.string().optional(),
		regions: z.array(z.string()).optional(),
		scalingConfig: z
			.object({ maxEnvironments: z.number().int().positive().optional() })
			.optional(),
		throttleConfig: z
			.object({ rateLimit: z.number().int().nonnegative().optional() })
			.optional(),
		maxConcurrencyPerEnvironment: z.number().int().min(1).max(128).optional(),
		timeoutSeconds: z.number().int().min(3).max(900).optional(),
		environmentVariables: z.record(z.string(), z.string()).optional(),
		cognito: z
			.object({
				domainPrefix: z
					.string()
					.min(1)
					.max(63)
					.refine(
						(value) =>
							Token.isUnresolved(value) ||
							/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value),
						"Invalid Cognito domain prefix",
					),
				callbackUrls: z.array(cognitoRedirectUrlSchema).min(1),
				logoutUrls: z.array(cognitoRedirectUrlSchema).min(1).optional(),
			})
			.optional(),
		loggingConfig: z
			.object({
				applicationLogLevel: z
					.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"])
					.optional(),
				logGroup: z.string().min(1).optional(),
				systemLogLevel: z.enum(["DEBUG", "INFO", "WARN"]).optional(),
			})
			.optional(),
	})
	.superRefine((props, ctx) => {
		if (!props.cognito) return;
		if (props.authType !== WebFunctionAuthType.APPLICATION_MANAGED.value) {
			ctx.addIssue({
				code: "custom",
				path: ["cognito"],
				message: "Cognito requires APPLICATION_MANAGED authentication",
			});
		}
		for (const key of ["COGNITO_USER_POOL_ID", "COGNITO_CLIENT_ID"]) {
			if (props.environmentVariables?.[key] !== undefined) {
				ctx.addIssue({
					code: "custom",
					path: ["environmentVariables", key],
					message: `${key} is managed by the Cognito configuration`,
				});
			}
		}
	});

/** Validated WebFunction configuration. Cognito provisions login resources only;
 * APPLICATION_MANAGED applications must still validate tokens on protected requests.
 */
export type WebFunctionProps = z.input<typeof WebFunctionPropsSchema> &
	BasicConstructProps;
type ParsedWebFunctionProps = z.output<typeof WebFunctionPropsSchema>;

/**
 * Creates a Lambda WebFunction, endpoint, revision, and revision execution role.
 * The single TypeScript entry is bundled for Node.js, packaged as a ZIP, and copied
 * into a dedicated S3 bucket. A bucket policy grants the Lambda service read access
 * to that object while the CDK asset bucket remains private to deployment. The stack
 * owns the bucket and archive; outputs expose the function ARN and endpoint domain.
 *
 * ```mermaid
 * architecture-beta
 *   group functionGroup(logos:aws-lambda)[WebFunction deployment]
 *   service asset(disk)[Generated ZIP CDK asset] in functionGroup
 *   service deployment(logos:aws-s3)[Raw ZIP deployment] in functionGroup
 *   service bucket(logos:aws-s3)[Private code bucket and policy] in functionGroup
 *   service function(logos:aws-lambda)[WebFunction] in functionGroup
 *   service endpoint(logos:aws-lambda)[WebFunction endpoint] in functionGroup
 *   service revision(logos:aws-lambda)[WebFunction revision] in functionGroup
 *   service role(logos:aws-iam)[Revision execution role] in functionGroup
 *   service outputs(logos:aws-cloudformation)[Function and endpoint outputs] in functionGroup
 *   asset:R -- L:deployment
 *   deployment:R -- L:bucket
 *   bucket:R -- L:revision
 *   role:R -- L:revision
 *   function:R -- L:revision
 *   revision:R -- L:endpoint
 *   function:B -- T:outputs
 *   endpoint:R -- L:outputs
 * ```
 */
export class WebFunction extends BasicConstruct {
	readonly id: string;
	private readonly webFunction: CfnWebFunction;
	private readonly endpoint: CfnWebFunctionEndpoint;
	private readonly executionRole: Role;

	constructor(scope: Stack, id: string, props: WebFunctionProps) {
		super(scope, id);

		this.id = id;
		// The actual WebFunction
		const webProps = WebFunctionPropsSchema.parse(props);
		const webFunction = new CfnWebFunction(this, `${id}-web-function`, {
			functionName: webProps.functionName,
		});
		this.webFunction = webFunction;
		this.executionRole = new Role(this, `${id}-web-function-revision-role`, {
			assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
		});

		if (webProps.cognito) {
			const pool = new UserPool(this, "UserPool", {
				signInAliases: { email: true },
				autoVerify: { email: true },
				selfSignUpEnabled: false,
				accountRecovery: AccountRecovery.EMAIL_ONLY,
				mfa: Mfa.REQUIRED,
				mfaSecondFactor: { sms: false, otp: true },
				passwordPolicy: {
					minLength: 12,
					requireDigits: true,
					requireLowercase: true,
					requireUppercase: true,
					requireSymbols: true,
				},
				featurePlan: FeaturePlan.ESSENTIALS,
				removalPolicy: RemovalPolicy.RETAIN,
			});
			const client = pool.addClient("BrowserClient", {
				generateSecret: false,
				supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
				oAuth: {
					flows: { authorizationCodeGrant: true },
					scopes: [OAuthScope.OPENID, OAuthScope.PROFILE, OAuthScope.EMAIL],
					callbackUrls: webProps.cognito.callbackUrls,
					logoutUrls:
						webProps.cognito.logoutUrls ?? webProps.cognito.callbackUrls,
				},
				accessTokenValidity: Duration.minutes(10),
				idTokenValidity: Duration.minutes(10),
				refreshTokenValidity: Duration.days(7),
				enableTokenRevocation: true,
				refreshTokenRotationGracePeriod: Duration.seconds(10),
				preventUserExistenceErrors: true,
			});
			const domain = pool.addDomain("LoginDomain", {
				cognitoDomain: { domainPrefix: webProps.cognito.domainPrefix },
				managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
			});
			const branding = new CfnManagedLoginBranding(this, "LoginBranding", {
				userPoolId: pool.userPoolId,
				clientId: client.userPoolClientId,
				useCognitoProvidedValues: true,
			});
			branding.node.addDependency(domain);
			webProps.environmentVariables = {
				...webProps.environmentVariables,
				COGNITO_USER_POOL_ID: pool.userPoolId,
				COGNITO_CLIENT_ID: client.userPoolClientId,
			};
			new CfnOutput(this, "CognitoLoginDomain", { value: domain.baseUrl() });
			new CfnOutput(this, "CognitoUserPoolId", { value: pool.userPoolId });
			new CfnOutput(this, "CognitoClientId", {
				value: client.userPoolClientId,
			});
		}
		const webFunctionRevision = this.uploadToS3(webProps, webFunction);

		// Route the endpoint to the revision created above, not a guessed revision ID.
		const webFunctionEndpoint = new CfnWebFunctionEndpoint(
			this,
			`${id}-web-function-endpoint`,
			{
				authType: webProps.authType,
				endpointName: webProps.endpointName,
				endpointType: webProps.endpointType,
				functionName: webFunction.webFunctionRef.functionArn,
				description: webProps.description,
				regions: webProps.regions,
				scalingConfig: webProps.scalingConfig,
				throttleConfig: webProps.throttleConfig,
				revisionWeights: [
					{ revisionId: webFunctionRevision.attrRevisionId, weight: 100 },
				],
			},
		);
		this.endpoint = webFunctionEndpoint;
		webFunctionEndpoint.node.addDependency(webFunctionRevision);

		new CfnOutput(this, "webFunctionUrl", {
			value: webFunction.webFunctionRef.functionArn,
			exportName: `${id}-webFunctionArn`,
		});

		new CfnOutput(this, "webFunctionEndpointUrl", {
			value: webFunctionEndpoint.attrDomainName,
			exportName: `${id}-webFunctionDomainName`,
		});

		if (props.permissions) this.grantPermissions(props.permissions);
		this.createAlarm(this.stack);
	}

	private uploadToS3(
		props: ParsedWebFunctionProps,
		webFunction: CfnWebFunction,
	) {
		const bundleFile = this.#bundleEntry(props.entry);
		const zipFile = this.#zipBundle(bundleFile);
		const codeBucket = new Bucket(this, `${this.id}-web-function-code-bucket`, {
			autoDeleteObjects: true,
			blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
			encryption: BucketEncryption.S3_MANAGED,
			enforceSSL: true,
			removalPolicy: RemovalPolicy.DESTROY,
			versioned: true,
		});
		const codeDeployment = new BucketDeployment(
			this,
			`${this.id}-web-function-code-deployment`,
			{
				sources: [Source.asset(zipFile)],
				destinationBucket: codeBucket,
				extract: false,
				prune: false,
				retainOnDelete: false,
			},
		);
		const codeKey = Fn.select(0, codeDeployment.objectKeys);
		const bucketReadPolicy = codeBucket.addToResourcePolicy(
			new IamPolicyStatement({
				actions: ["s3:GetObject", "s3:GetObjectVersion"],
				effect: Effect.ALLOW,
				principals: [new ServicePrincipal("lambda.amazonaws.com")],
				resources: [codeBucket.arnForObjects(codeKey)],
				conditions: {
					StringEquals: { "aws:SourceAccount": codeBucket.stack.account },
				},
			}),
		);
		if (!bucketReadPolicy.statementAdded) {
			throw new Error("Failed to add Lambda WebFunction code bucket policy");
		}
		const logGroup =
			props.loggingConfig?.logGroup ?? `/aws/lambda/web/${props.functionName}`;
		const logPermissions = this.executionRole.addToPrincipalPolicy(
			new IamPolicyStatement({
				actions: [
					"logs:CreateLogGroup",
					"logs:CreateLogStream",
					"logs:PutLogEvents",
				],
				resources: [
					logGroup,
					`${logGroup}:*`,
					`${logGroup}.local`,
					`${logGroup}.local:*`,
				].map((name) =>
					this.stack.formatArn({
						service: "logs",
						resource: "log-group",
						resourceName: name,
						arnFormat: ArnFormat.COLON_RESOURCE_NAME,
					}),
				),
			}),
		);
		const cfnWebFunctionRevision = new CfnWebFunctionRevision(
			this,
			`${this.id}-web-function-revision`,
			{
				functionName: webFunction.webFunctionRef.functionArn,
				buildConfig: {
					codeConfig: {
						s3Object: {
							bucket: codeBucket.bucketName,
							key: codeKey,
							versionId: Fn.select(0, codeDeployment.objectVersionIds),
						},
					},
					runtimeConfig: {
						runtime: "nodejs24.x",
					},
				},
				serviceConfig: {
					executionRoleArn: this.executionRole.roleArn,
					environmentVariables: props.environmentVariables,
					maxConcurrencyPerEnvironment: props.maxConcurrencyPerEnvironment,
					timeoutSeconds: props.timeoutSeconds,
					telemetryConfig: props.loggingConfig
						? { loggingConfig: props.loggingConfig }
						: undefined,
				},
			},
		);
		cfnWebFunctionRevision.node.addDependency(codeDeployment);
		if (logPermissions.policyDependable) {
			cfnWebFunctionRevision.node.addDependency(
				logPermissions.policyDependable,
			);
		}
		if (bucketReadPolicy.policyDependable !== undefined) {
			cfnWebFunctionRevision.node.addDependency(
				bucketReadPolicy.policyDependable,
			);
		}
		return cfnWebFunctionRevision;
	}
	#bundleEntry(entry: string): string {
		const bundleDirectory = path.join(
			webFunctionArchiveDirectory,
			this.node.addr,
		);
		mkdirSync(bundleDirectory, { recursive: true });
		const bundleFile = path.join(bundleDirectory, "index.js");
		rmSync(bundleFile, { force: true });
		try {
			execFileSync("bun", [
				"build",
				path.resolve(entry),
				"--target=node",
				"--outfile",
				bundleFile,
			]);
		} catch (err) {
			throw new Error(`Failed to bundle entry "${entry}" for Node.js`, {
				cause: err,
			});
		}
		return bundleFile;
	}
	#zipBundle(bundleFile: string): string {
		const outputZip = path.join(
			webFunctionArchiveDirectory,
			`${this.node.addr}.zip`,
		);
		rmSync(outputZip, { force: true });
		try {
			execFileSync("zip", ["-q", outputZip, path.basename(bundleFile)], {
				cwd: path.dirname(bundleFile),
			});
		} catch (err) {
			throw new Error(`Failed to zip bundle "${bundleFile}"`, { cause: err });
		}
		return outputZip;
	}
	protected applyPermissionPolicy(
		_construct: Construct,
		policyStatement: PolicyStatement,
	): void {
		this.executionRole.addToPrincipalPolicy(
			new IamPolicyStatement({
				effect: policyStatement.effect === "allow" ? Effect.ALLOW : Effect.DENY,
				actions: policyStatement.actions,
				resources: [
					policyStatement.resource ??
						this.webFunction.webFunctionRef.functionArn,
				],
			}),
		);
	}

	createAlarm(stack: Stack): void {
		// Web Functions publish endpoint metrics separately from event-driven Lambdas.
		const metric = (metricName: string) =>
			new Metric({
				namespace: "AWS/Lambda/Web",
				metricName,
				dimensionsMap: {
					FunctionName: this.webFunction.functionName,
					EndpointName: this.endpoint.endpointName,
				},
				statistic: "Sum",
				unit: Unit.COUNT,
				period: Duration.minutes(5),
			});

		stack.monitoring.monitorCustom({
			alarmFriendlyName: `${this.node.id}-WebFunction`,
			humanReadableName: `${this.node.id} WebFunction`,
			metricGroups: [
				{
					title: `${this.node.id} WebFunction requests`,
					metrics: [
						metric("ExecutedRequests"),
						metric("HTTPResponseStatusClass4XX"),
						{
							metric: metric("HTTPResponseStatusClass5XX"),
							alarmFriendlyName: `${this.node.id}-WebFunction-5XX`,
							addAlarm: {
								Critical: {
									threshold: 5,
									comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
									datapointsToAlarm: 1,
									evaluationPeriods: 1,
									// No 5xx responses means no data points, not a failure.
									treatMissingDataOverride: TreatMissingData.NOT_BREACHING,
								},
							},
						},
					],
				},
			],
		});
	}
}
