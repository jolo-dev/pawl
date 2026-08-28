import { describe, expect, test } from "bun:test";
import { Aspects } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import { UserPool } from "../src/cognito";
import { Stack } from "../src/stack";
import { StaticSite, StaticSitePropsSchema } from "../src/static-site";
import { createTestApp } from "./utils";

describe("StaticSite", () => {
	test("synthesizes a private encrypted SPA bucket behind an OAC CloudFront distribution", () => {
		const stack = new Stack(createTestApp(), "StaticSiteStack");
		new StaticSite(stack, "Frontend", {});
		const template = Template.fromStack(stack);

		template.hasResourceProperties("AWS::S3::Bucket", {
			BucketEncryption: {
				ServerSideEncryptionConfiguration: [
					{
						ServerSideEncryptionByDefault: {
							SSEAlgorithm: "AES256",
						},
					},
				],
			},
			PublicAccessBlockConfiguration: {
				BlockPublicAcls: true,
				BlockPublicPolicy: true,
				IgnorePublicAcls: true,
				RestrictPublicBuckets: true,
			},
		});
		template.hasResourceProperties("AWS::CloudFront::OriginAccessControl", {
			OriginAccessControlConfig: {
				OriginAccessControlOriginType: "s3",
				SigningBehavior: "always",
				SigningProtocol: "sigv4",
			},
		});
		template.hasResourceProperties("AWS::CloudFront::Distribution", {
			DistributionConfig: {
				DefaultRootObject: "index.html",
				DefaultCacheBehavior: Match.objectLike({
					ViewerProtocolPolicy: "redirect-to-https",
				}),
				CustomErrorResponses: [
					{
						ErrorCode: 403,
						ResponseCode: 200,
						ResponsePagePath: "/index.html",
					},
					{
						ErrorCode: 404,
						ResponseCode: 200,
						ResponsePagePath: "/index.html",
					},
				],
				Origins: [
					Match.objectLike({
						OriginAccessControlId: Match.anyValue(),
					}),
				],
				ViewerCertificate: Match.objectLike({
					MinimumProtocolVersion: "TLSv1.2_2021",
				}),
			},
		});
		template.hasResourceProperties("AWS::S3::BucketPolicy", {
			PolicyDocument: {
				Statement: Match.arrayWith([
					Match.objectLike({
						Effect: "Deny",
						Condition: {
							Bool: { "aws:SecureTransport": "false" },
						},
					}),
					Match.objectLike({
						Effect: "Allow",
						Principal: { Service: "cloudfront.amazonaws.com" },
						Action: "s3:GetObject",
						Condition: Match.objectLike({
							StringEquals: Match.objectLike({
								"AWS:SourceArn": Match.anyValue(),
							}),
						}),
					}),
				]),
			},
		});
		const outputs = Object.values(template.toJSON().Outputs ?? {});
		expect(outputs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					Description: "CloudFront URL for the static application",
				}),
				expect.objectContaining({
					Description:
						"Private S3 bucket that stores static application assets",
				}),
				expect.objectContaining({
					Description: "CloudFront distribution ID for the static application",
				}),
			]),
		);
	});

	test("accepts a CloudFront-compatible default root object path", () => {
		expect(
			StaticSitePropsSchema.parse({
				indexDocument: "assets/~index!$&'()*+,;=:@-_.html",
			}).indexDocument,
		).toBe("assets/~index!$&'()*+,;=:@-_.html");
	});

	test("rejects an index document longer than CloudFront allows", () => {
		expect(() =>
			StaticSitePropsSchema.parse({ indexDocument: "a".repeat(256) }),
		).toThrow();
	});

	test("rejects an index document containing a character CloudFront does not allow", () => {
		expect(() =>
			StaticSitePropsSchema.parse({ indexDocument: "index file.html" }),
		).toThrow();
	});

	test("passes AwsSolutions checks with documented log bucket and default-certificate suppressions", () => {
		const stack = new Stack(createTestApp(), "StaticSiteNagStack");
		new StaticSite(stack, "Frontend", {});
		Aspects.of(stack).add(new AwsSolutionsChecks());
		stack.node.root.synth();

		const errors = Annotations.fromStack(stack).findError(
			"*",
			Match.stringLikeRegexp("AwsSolutions-.*"),
		);
		expect(errors).toEqual([]);
	});

	test("exposes supplied Cognito configuration without claiming CloudFront authentication", () => {
		const stack = new Stack(createTestApp(), "StaticSiteCognitoStack");
		const userPool = new UserPool(stack, "Users");
		const userPoolClient = userPool.addClient("WebClient");
		const site = new StaticSite(stack, "Frontend", {
			cognito: { userPool, userPoolClient },
		});

		expect(site.cognitoConfiguration).toEqual({
			userPoolClientId: userPoolClient.userPoolClientId,
			userPoolId: userPool.userPoolId,
			userPoolProviderUrl: `https://cognito-idp.${stack.region}.${stack.urlSuffix}/${userPool.userPoolId}`,
		});
		const outputs = Object.values(
			Template.fromStack(stack).toJSON().Outputs ?? {},
		);
		expect(outputs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					Description:
						"Cognito user pool ID for frontend/runtime/API integration; does not authenticate CloudFront",
				}),
			]),
		);
	});

	test("rejects partial Cognito configuration", () => {
		const stack = new Stack(createTestApp(), "StaticSiteInvalidCognitoStack");
		const userPool = new UserPool(stack, "Users");

		expect(
			() =>
				new StaticSite(stack, "Frontend", {
					cognito: { userPool },
				} as never),
		).toThrow();
	});
});
