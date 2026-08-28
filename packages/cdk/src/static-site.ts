import { CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import {
	type CfnDistribution,
	Distribution,
	HeadersFrameOption,
	HeadersReferrerPolicy,
	ResponseHeadersPolicy,
	SecurityPolicyProtocol,
	ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import type { IUserPool, IUserPoolClient } from "aws-cdk-lib/aws-cognito";
import {
	BlockPublicAccess,
	Bucket,
	BucketEncryption,
	ObjectOwnership,
} from "aws-cdk-lib/aws-s3";
import { NagSuppressions } from "cdk-nag";
import type { Construct } from "constructs";
import { z } from "zod";
import {
	BasicConstruct,
	type BasicConstructProps,
	type PolicyStatement,
} from "./basic-construct";
import type { Stack } from "./stack";

const cognitoReferenceSchema = z.object({
	userPool: z.custom<IUserPool>(
		(value) =>
			typeof value === "object" && value !== null && "userPoolId" in value,
		"A Cognito user pool reference is required",
	),
	userPoolClient: z.custom<IUserPoolClient>(
		(value) =>
			typeof value === "object" &&
			value !== null &&
			"userPoolClientId" in value,
		"A Cognito user pool client reference is required",
	),
});

/** Runtime-validated configuration accepted by {@link StaticSite}. */
export const StaticSitePropsSchema = z.object({
	indexDocument: z
		.string()
		.min(1)
		.max(255, "indexDocument must be at most 255 characters")
		.regex(
			/^[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/,
			"indexDocument contains characters CloudFront does not allow",
		)
		.regex(/^[^/].*$/, "indexDocument must not start with a slash")
		.default("index.html"),
	cognito: cognitoReferenceSchema.optional(),
});

/** Cognito identifiers that can be supplied to frontend/runtime/API integration. */
export interface StaticSiteCognitoConfiguration {
	readonly userPoolId: string;
	readonly userPoolClientId: string;
	readonly userPoolProviderUrl: string;
}
export type StaticSiteProps = z.input<typeof StaticSitePropsSchema> &
	BasicConstructProps;

/**
 * A private S3-backed single-page application served through CloudFront OAC.
 *
 * Supplying `cognito` exposes existing Cognito identifiers for frontend, runtime,
 * or API integration. It does not make CloudFront viewer requests authenticated;
 * CloudFront remains publicly reachable unless a separate viewer-authentication
 * solution is added.
 */
export class StaticSite extends BasicConstruct {
	readonly bucket: Bucket;
	readonly accessLogsBucket: Bucket;
	readonly distribution: Distribution;
	readonly applicationUrl: string;
	readonly bucketName: string;
	readonly distributionId: string;
	readonly cognitoConfiguration?: StaticSiteCognitoConfiguration;

	constructor(scope: Stack, id: string, props: StaticSiteProps = {}) {
		const { permissions, ...siteProps } = props;
		const config = StaticSitePropsSchema.parse(siteProps);
		super(scope, id);

		this.accessLogsBucket = new Bucket(this, "AccessLogsBucket", {
			blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
			encryption: BucketEncryption.S3_MANAGED,
			enforceSSL: true,
			objectOwnership: ObjectOwnership.OBJECT_WRITER,
			removalPolicy: RemovalPolicy.RETAIN,
		});
		NagSuppressions.addResourceSuppressions(this.accessLogsBucket, [
			{
				id: "AwsSolutions-S1",
				reason:
					"The access-log destination cannot log to itself; it is dedicated to receiving CloudFront and S3 access logs.",
			},
		]);
		this.bucket = new Bucket(this, "SiteBucket", {
			blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
			encryption: BucketEncryption.S3_MANAGED,
			enforceSSL: true,
			removalPolicy: RemovalPolicy.RETAIN,
			serverAccessLogsBucket: this.accessLogsBucket,
			versioned: true,
		});

		const responseHeadersPolicy = new ResponseHeadersPolicy(
			this,
			"SecurityHeaders",
			{
				securityHeadersBehavior: {
					contentTypeOptions: { override: true },
					frameOptions: {
						frameOption: HeadersFrameOption.DENY,
						override: true,
					},
					referrerPolicy: {
						referrerPolicy:
							HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
						override: true,
					},
					strictTransportSecurity: {
						accessControlMaxAge: Duration.days(365),
						includeSubdomains: true,
						override: true,
						preload: true,
					},
				},
			},
		);

		this.distribution = new Distribution(this, "Distribution", {
			defaultBehavior: {
				origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
				responseHeadersPolicy,
				viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
			},
			defaultRootObject: config.indexDocument,
			errorResponses: [
				{
					httpStatus: 403,
					responseHttpStatus: 200,
					responsePagePath: `/${config.indexDocument}`,
				},
				{
					httpStatus: 404,
					responseHttpStatus: 200,
					responsePagePath: `/${config.indexDocument}`,
				},
			],
			minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
			enableLogging: true,
			logBucket: this.accessLogsBucket,
		});
		const distributionResource = this.distribution.node
			.defaultChild as CfnDistribution;
		distributionResource.addPropertyOverride(
			"DistributionConfig.ViewerCertificate.CloudFrontDefaultCertificate",
			true,
		);
		distributionResource.addPropertyOverride(
			"DistributionConfig.ViewerCertificate.MinimumProtocolVersion",
			SecurityPolicyProtocol.TLS_V1_2_2021,
		);
		NagSuppressions.addResourceSuppressions(this.distribution, [
			{
				id: "AwsSolutions-CFR4",
				reason:
					"The default CloudFront certificate's TLS policy is set to TLSv1.2_2021 through the required L1 override because the L2 does not render it for the default certificate.",
			},
		]);

		this.applicationUrl = `https://${this.distribution.distributionDomainName}`;
		this.bucketName = this.bucket.bucketName;
		this.distributionId = this.distribution.distributionId;
		this.cognitoConfiguration = config.cognito
			? {
					userPoolClientId: config.cognito.userPoolClient.userPoolClientId,
					userPoolId: config.cognito.userPool.userPoolId,
					userPoolProviderUrl: `https://cognito-idp.${this.stack.region}.${this.stack.urlSuffix}/${config.cognito.userPool.userPoolId}`,
				}
			: undefined;

		new CfnOutput(this, "ApplicationUrl", {
			value: this.applicationUrl,
			description: "CloudFront URL for the static application",
		});
		new CfnOutput(this, "BucketName", {
			value: this.bucketName,
			description: "Private S3 bucket that stores static application assets",
		});
		new CfnOutput(this, "DistributionId", {
			value: this.distributionId,
			description: "CloudFront distribution ID for the static application",
		});

		if (this.cognitoConfiguration) {
			new CfnOutput(this, "CognitoUserPoolId", {
				value: this.cognitoConfiguration.userPoolId,
				description:
					"Cognito user pool ID for frontend/runtime/API integration; does not authenticate CloudFront",
			});
			new CfnOutput(this, "CognitoUserPoolClientId", {
				value: this.cognitoConfiguration.userPoolClientId,
				description:
					"Cognito app client ID for frontend/runtime/API integration; does not authenticate CloudFront",
			});
		}

		if (permissions) {
			this.grantPermissions(permissions);
		}
	}

	createAlarm(_stack: Stack): void {}

	protected applyPermissionPolicy(
		_construct: Construct,
		_policyStatement: PolicyStatement,
	): void {
		throw new Error("StaticSite does not support generic permission grants");
	}
}
