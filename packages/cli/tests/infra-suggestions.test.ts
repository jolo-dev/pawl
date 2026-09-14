import { describe, expect, test } from "bun:test";
import type { DeployedResource, DriftEntry } from "../src/infra/drift";
import {
	CONSTRUCT_BY_RESOURCE_KIND,
	suggestConstructs,
	summarizeSuggestions,
} from "../src/infra/suggestions";

const deployed = (over: Partial<DeployedResource> = {}): DeployedResource => ({
	service: "lambda",
	resourceKind: "AWS::Lambda::Function",
	physicalName: "hand-made-function",
	tags: {},
	...over,
});

const entry = (over: Partial<DriftEntry> = {}): DriftEntry => ({
	status: "unmanaged",
	deployed: deployed(),
	basis: "none",
	reason: "reason",
	...over,
});

describe("suggestConstructs", () => {
	test("suggests the pawl construct for an undeclared resource", () => {
		const suggestions = suggestConstructs([entry()]);

		expect(suggestions).toEqual([
			{
				construct: "LambdaFunction",
				resourceKind: "AWS::Lambda::Function",
				service: "lambda",
				resourceName: "hand-made-function",
				rationale: expect.any(String),
				declaredInProject: false,
			},
		]);
	});

	test("suggests nothing for a resource already carrying pawl name provenance", () => {
		const suggestions = suggestConstructs([
			entry({
				deployed: deployed({ physicalName: "platform-dev-myapi-lambda" }),
				basis: "provenance",
				provenance: { source: "name", team: "platform", stage: "dev" },
			}),
		]);

		expect(suggestions).toEqual([]);
	});

	test("suggests nothing for a resource carrying pawl tags alone", () => {
		const suggestions = suggestConstructs([
			entry({
				deployed: deployed({
					service: "s3",
					resourceKind: "AWS::S3::Bucket",
					physicalName: "pawlstack-sitebucket-abc123",
					tags: { team: "platform", stage: "dev" },
				}),
				provenance: { source: "tags", team: "platform", stage: "dev" },
			}),
		]);

		expect(suggestions).toEqual([]);
	});

	test("the most valuable case: a resource the code already declares with a raw construct", () => {
		// A hand-rolled CDK app using aws-cdk-lib matches its own deployment, so
		// drift alone would say nothing — yet these are exactly the resources
		// worth migrating onto pawl.
		const suggestions = suggestConstructs([
			entry({
				status: "matched",
				basis: "logical-id",
				synthesized: {
					stackName: "MyStack",
					logicalId: "MyFunction1A2B",
					resourceKind: "AWS::Lambda::Function",
				},
			}),
		]);

		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]?.declaredInProject).toBe(true);
	});

	test("suggests nothing when there is no deployed side", () => {
		const suggestions = suggestConstructs([
			{
				status: "not-deployed",
				basis: "none",
				reason: "never deployed",
				synthesized: {
					stackName: "MyStack",
					logicalId: "MyFunction1A2B",
					resourceKind: "AWS::Lambda::Function",
				},
			},
		]);

		expect(suggestions).toEqual([]);
	});

	test("suggests nothing for a kind pawl has no construct for", () => {
		const suggestions = suggestConstructs([
			entry({
				deployed: deployed({
					service: "logs",
					resourceKind: "AWS::Logs::LogGroup",
					physicalName: "/aws/lambda/hand-made",
				}),
			}),
		]);

		expect(suggestions).toEqual([]);
	});

	test("carries the caveat when a suggestion only fits sometimes", () => {
		const suggestions = suggestConstructs([
			entry({
				deployed: deployed({
					service: "s3",
					resourceKind: "AWS::S3::Bucket",
					physicalName: "some-bucket",
				}),
			}),
		]);

		expect(suggestions[0]?.construct).toBe("StaticSite");
		expect(suggestions[0]?.caveat).toBeTruthy();
	});
});

describe("summarizeSuggestions", () => {
	test("groups by construct, most frequent first", () => {
		const suggestions = suggestConstructs([
			entry({ deployed: deployed({ physicalName: "fn-a" }) }),
			entry({ deployed: deployed({ physicalName: "fn-b" }) }),
			entry({
				deployed: deployed({
					service: "sqs",
					resourceKind: "AWS::SQS::Queue",
					physicalName: "queue-a",
				}),
			}),
		]);

		expect(summarizeSuggestions(suggestions)).toEqual([
			{ construct: "LambdaFunction", count: 2 },
			{ construct: "Sqs", count: 1 },
		]);
	});
});

describe("CONSTRUCT_BY_RESOURCE_KIND", () => {
	test("every entry names a construct and explains itself", () => {
		for (const [kind, recommendation] of Object.entries(
			CONSTRUCT_BY_RESOURCE_KIND,
		)) {
			expect(kind.startsWith("AWS::")).toBe(true);
			expect(recommendation.construct.length).toBeGreaterThan(0);
			expect(recommendation.rationale.length).toBeGreaterThan(0);
		}
	});

	test("does not recommend a construct for kinds pawl only re-exports", () => {
		// cognito.ts and secret.ts are pass-throughs of aws-cdk-lib, not
		// opinionated pawl constructs, so they must not appear here.
		expect(
			CONSTRUCT_BY_RESOURCE_KIND["AWS::Cognito::UserPool"],
		).toBeUndefined();
		expect(
			CONSTRUCT_BY_RESOURCE_KIND["AWS::SecretsManager::Secret"],
		).toBeUndefined();
	});
});
