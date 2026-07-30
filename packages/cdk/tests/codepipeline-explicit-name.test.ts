import { describe, expect, test } from "bun:test";
import { Template } from "aws-cdk-lib/assertions";
import { Repository } from "aws-cdk-lib/aws-codecommit";
import { CodePipeline, type CodePipelineProps } from "../src/codepipeline";
import { Stack } from "../src/stack";
import { createTestApp } from "./utils";

type Resource = {
	readonly Type: string;
	readonly Properties?: Record<string, unknown>;
};

function createTemplate(props: Partial<CodePipelineProps> = {}) {
	const stack = new Stack(createTestApp(), "PipelineNameStack");
	const repository = new Repository(stack, "Repository", {
		repositoryName: "pipeline-name-repository",
	});
	new CodePipeline(stack, "Pipeline", {
		source: {
			type: "codecommit",
			repository,
			branchName: "main",
			repositoryName: "pipeline-name-repository",
		},
		...props,
	});
	return Template.fromStack(stack).toJSON();
}

function resources(template: ReturnType<typeof createTemplate>) {
	return template.Resources as Record<string, Resource>;
}

function resourcesByType(
	template: ReturnType<typeof createTemplate>,
	type: string,
) {
	return Object.values(resources(template)).filter(
		(resource) => resource.Type === type,
	);
}

describe("CodePipeline physical name", () => {
	test("uses an explicit pipeline name override", () => {
		const template = createTemplate({
			pipelineName: "existing-pipeline-ABC123",
		});
		const [pipeline] = resourcesByType(template, "AWS::CodePipeline::Pipeline");

		expect(pipeline.Properties?.Name).toBe("existing-pipeline-ABC123");
	});

	test("keeps Pawl explicit naming by default", () => {
		const template = createTemplate();
		const [pipeline] = resourcesByType(template, "AWS::CodePipeline::Pipeline");

		expect(pipeline.Properties?.Name).toBe("foo-bar-Pipeline-pipeline");
	});

	test("uses the explicit name in reviewer integrations without a cycle", () => {
		const pipelineName = "existing-pipeline-ABC123";
		const template = createTemplate({
			pipelineName,
			onPullRequest: true,
			autoReview: { modelId: "eu.amazon.nova-2-lite-v1:0" },
			stages: [
				{
					name: "Build",
					actions: [{ type: "manualApproval", name: "Approve" }],
				},
			],
		});
		const pipelineEntry = Object.entries(resources(template)).find(
			([, resource]) => resource.Type === "AWS::CodePipeline::Pipeline",
		);
		if (pipelineEntry === undefined)
			throw new Error("Pipeline resource not found");
		const [pipelineLogicalId, pipeline] = pipelineEntry;
		const pipelineReference = { Ref: pipelineLogicalId };
		const router = resourcesByType(template, "AWS::Lambda::Function").find(
			(resource) => {
				const environment = resource.Properties?.Environment as
					| { Variables?: Record<string, unknown> }
					| undefined;
				return environment?.Variables?.PIPELINE_NAME !== undefined;
			},
		);
		const executionRule = resourcesByType(template, "AWS::Events::Rule").find(
			(resource) => {
				const pattern = resource.Properties?.EventPattern as
					| { source?: string[] }
					| undefined;
				return pattern?.source?.includes("aws.codepipeline") === true;
			},
		);
		const eventPattern = executionRule?.Properties?.EventPattern as {
			detail: { pipeline: unknown[] };
		};

		expect(
			(
				router?.Properties?.Environment as {
					Variables: Record<string, unknown>;
				}
			).Variables.PIPELINE_NAME,
		).toEqual(pipelineReference);
		expect(eventPattern.detail.pipeline).toEqual([pipelineReference]);
		expect(JSON.stringify(pipeline.Properties?.Stages)).toContain(pipelineName);
	});

	test("rejects an invalid explicit pipeline name", () => {
		expect(() =>
			createTemplate({ pipelineName: "invalid pipeline name" }),
		).toThrow();
	});
});
