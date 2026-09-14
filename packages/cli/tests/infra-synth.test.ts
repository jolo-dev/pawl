import { describe, expect, test } from "bun:test";
import {
	type CdkManifest,
	PHYSICAL_NAME_PROPERTIES,
	parseManifest,
	parseTemplate,
	type TemplateDocument,
} from "../src/infra/synth";

describe("parseTemplate", () => {
	test("extracts logical id, kind and the pinned physical name", () => {
		const template: TemplateDocument = {
			Resources: {
				MyApiLambdaFunction1A2B3C: {
					Type: "AWS::Lambda::Function",
					Properties: { FunctionName: "platform-dev-myapi-lambda" },
				},
			},
		};

		expect(parseTemplate("PawlStack", template)).toEqual([
			{
				stackName: "PawlStack",
				logicalId: "MyApiLambdaFunction1A2B3C",
				resourceKind: "AWS::Lambda::Function",
				physicalName: "platform-dev-myapi-lambda",
			},
		]);
	});

	test("omits a physical name that is not a plain string", () => {
		const template: TemplateDocument = {
			Resources: {
				SiteBucket: {
					Type: "AWS::S3::Bucket",
					// CDK leaves an unresolved token here, so no name can be read.
					Properties: { BucketName: { Ref: "SomeParameter" } },
				},
				Imported: {
					Type: "AWS::S3::Bucket",
					Properties: { BucketName: { "Fn::ImportValue": "shared" } },
				},
			},
		};

		const resources = parseTemplate("PawlStack", template);

		expect(resources).toHaveLength(2);
		expect(resources.every((r) => r.physicalName === undefined)).toBe(true);
	});

	test("omits a physical name for a kind with no pinned-name property", () => {
		const template: TemplateDocument = {
			Resources: {
				Key: { Type: "AWS::KMS::Key", Properties: { Description: "nope" } },
			},
		};

		expect(
			parseTemplate("PawlStack", template)[0]?.physicalName,
		).toBeUndefined();
	});

	test("ignores a resource without a type", () => {
		const template: TemplateDocument = {
			Resources: { Broken: { Properties: {} } },
		};

		expect(parseTemplate("PawlStack", template)).toEqual([]);
	});

	test("handles a template with no resources at all", () => {
		expect(parseTemplate("PawlStack", {})).toEqual([]);
	});
});

describe("parseManifest", () => {
	test("finds stack artifacts and their templates", () => {
		const manifest: CdkManifest = {
			artifacts: {
				PawlStack: {
					type: "aws:cloudformation:stack",
					properties: {
						stackName: "PawlStack",
						templateFile: "PawlStack.template.json",
					},
				},
			},
		};

		expect(parseManifest(manifest)).toEqual([
			{ stackName: "PawlStack", templateFile: "PawlStack.template.json" },
		]);
	});

	test("ignores non-stack artifacts such as asset directories", () => {
		const manifest: CdkManifest = {
			artifacts: {
				assetc1a2b3c: { type: "cdk:asset-manifest" },
				Tree: { type: "cdk:tree" },
			},
		};

		expect(parseManifest(manifest)).toEqual([]);
	});

	test("falls back to the artifact key when no stack name is recorded", () => {
		const manifest: CdkManifest = {
			artifacts: {
				PawlStack: {
					type: "aws:cloudformation:stack",
					properties: { templateFile: "PawlStack.template.json" },
				},
			},
		};

		expect(parseManifest(manifest)).toEqual([
			{ stackName: "PawlStack", templateFile: "PawlStack.template.json" },
		]);
	});
});

describe("PHYSICAL_NAME_PROPERTIES", () => {
	test("every entry names a real property and no value is empty", () => {
		for (const [kind, property] of Object.entries(PHYSICAL_NAME_PROPERTIES)) {
			expect(kind.startsWith("AWS::")).toBe(true);
			expect(property.length).toBeGreaterThan(0);
		}
	});
});
