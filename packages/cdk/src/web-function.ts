import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CfnOutput, Duration, Fn, RemovalPolicy } from "aws-cdk-lib";
import {
	ComparisonOperator,
	Metric,
	TreatMissingData,
	Unit,
} from "aws-cdk-lib/aws-cloudwatch";
import {
	Effect,
	PolicyStatement as IamPolicyStatement,
	Role,
	ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import {
	CfnWebFunction,
	CfnWebFunctionEndpoint,
	type CfnWebFunctionEndpointProps,
	CfnWebFunctionRevision,
	type CfnWebFunctionRevisionProps,
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

const webFunctionArchiveDirectory = mkdtempSync(
	path.join(tmpdir(), "pawl-web-function-"),
);
process.on("exit", () => {
	rmSync(webFunctionArchiveDirectory, { recursive: true, force: true });
});

const EndpointType = z.enum(["HomeRegion", "MultiRegion", "PerRegion"]);
const AuthType = z.enum(["IamAuth", "ApplicationManaged"]);
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
		| "functionName"
		| "authType"
		| "endpointType"
		| "endpointName"
		| "revisionWeights"
	> &
	Omit<
		CfnWebFunctionRevisionProps,
		"functionName" | "buildConfig" | "serviceConfig"
	> &
	BasicConstructProps;

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
			functionName: props.functionName,
		});
		this.webFunction = webFunction;
		this.executionRole = new Role(this, `${id}-web-function-revision-role`, {
			assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
		});

		// Extract only endpoint base props (runtime validation)
		const endpointBase = WebFunctionEndpointProps.parse(webProps);
		// The Code of the HTTP server for the WebFunction it is called revision
		const webFunctionRevision = this.uploadToS3(props.entry, webFunction);

		// Route the endpoint to the revision created above, not a guessed revision ID.
		const webFunctionEndpoint = new CfnWebFunctionEndpoint(
			this,
			`${id}-web-function-endpoint`,
			{
				authType: props.authType,
				endpointName: props.endpointName,
				endpointType: props.endpointType,
				functionName: webFunction.webFunctionRef.functionArn,
				...endpointBase,
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

	private uploadToS3(entry: string, webFunction: CfnWebFunction) {
		const bundleFile = this.#bundleEntry(entry);
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
				},
			},
		);
		cfnWebFunctionRevision.node.addDependency(codeDeployment);
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
