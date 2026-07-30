import { describe, expect, test } from "bun:test";
import { Template } from "aws-cdk-lib/assertions";
import { Repository } from "aws-cdk-lib/aws-codecommit";
import {
	CodePipeline,
	type CodePipelineNaming,
	type CodePipelineProps,
} from "../src/codepipeline";
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

function prGatedAutoReviewProps(): Partial<CodePipelineProps> {
	return {
		onPullRequest: true,
		autoReview: { modelId: "eu.amazon.nova-2-lite-v1:0" },
		stages: [
			{
				name: "Build",
				actions: [{ type: "manualApproval", name: "Approve" }],
			},
		],
	};
}

function findPipeline(template: ReturnType<typeof createTemplate>) {
	const entry = Object.entries(resources(template)).find(
		([, resource]) => resource.Type === "AWS::CodePipeline::Pipeline",
	);
	if (entry === undefined) throw new Error("Pipeline resource not found");
	return entry;
}

function findAiReviewUserParameters(pipeline: Resource): string {
	const stages = pipeline.Properties?.Stages as Array<{
		Actions: Array<{
			Name: string;
			Configuration?: { UserParameters?: string };
		}>;
	}>;
	for (const stage of stages) {
		const action = stage.Actions.find(({ Name }) => Name === "AIReview");
		if (action?.Configuration?.UserParameters !== undefined) {
			return action.Configuration.UserParameters;
		}
	}
	throw new Error("AIReview UserParameters not found");
}

function parseAiReviewUserParameters(
	pipeline: Resource,
): Record<string, unknown> {
	const parsed: unknown = JSON.parse(findAiReviewUserParameters(pipeline));
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("AIReview UserParameters must be a JSON object");
	}
	return parsed as Record<string, unknown>;
}

function containsRef(value: unknown, logicalId: string): boolean {
	if (Array.isArray(value)) {
		return value.some((item) => containsRef(item, logicalId));
	}
	if (value === null || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	if (record.Ref === logicalId) return true;
	return Object.values(record).some((item) => containsRef(item, logicalId));
}

describe("CodePipeline physical name", () => {
	test("keeps Pawl explicit naming and coordination by default", () => {
		const template = createTemplate(prGatedAutoReviewProps());
		const [, pipeline] = findPipeline(template);

		expect(pipeline.Properties?.Name).toBe("foo-bar-Pipeline-pipeline");
		expect(parseAiReviewUserParameters(pipeline).pipelineName).toBe(
			"foo-bar-Pipeline-pipeline",
		);
	});

	test("uses a validated explicit name for the resource and coordination", () => {
		const pipelineName = "existing-pipeline-ABC123";
		const template = createTemplate({
			...prGatedAutoReviewProps(),
			pipelineNaming: { mode: "explicit", name: pipelineName },
		});
		const [, pipeline] = findPipeline(template);

		expect(pipeline.Properties?.Name).toBe(pipelineName);
		expect(parseAiReviewUserParameters(pipeline).pipelineName).toBe(
			pipelineName,
		);
	});

	test("CloudFormation naming omits Name and uses only concrete bridge coordination", () => {
		const coordinationName = "existing-pipeline-ABC123";
		const template = createTemplate({
			...prGatedAutoReviewProps(),
			pipelineNaming: { mode: "cloudFormation", coordinationName },
		});
		const [pipelineLogicalId, pipeline] = findPipeline(template);
		const userParameters = findAiReviewUserParameters(pipeline);

		expect(pipeline.Properties).not.toHaveProperty("Name");
		expect(containsRef(pipeline.Properties, pipelineLogicalId)).toBe(false);
		expect(parseAiReviewUserParameters(pipeline).pipelineName).toBe(
			coordinationName,
		);
		expect(userParameters).not.toContain(pipelineLogicalId);
	});

	test("CloudFormation naming still uses pipeline tokens outside the resource", () => {
		const template = createTemplate({
			...prGatedAutoReviewProps(),
			pipelineNaming: {
				mode: "cloudFormation",
				coordinationName: "existing-pipeline-ABC123",
			},
		});
		const [pipelineLogicalId] = findPipeline(template);
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
	});

	test("rejects invalid explicit and coordination names", () => {
		expect(() =>
			createTemplate({
				pipelineNaming: { mode: "explicit", name: "invalid pipeline name" },
			}),
		).toThrow();
		expect(() =>
			createTemplate({
				pipelineNaming: {
					mode: "cloudFormation",
					coordinationName: "invalid pipeline name",
				},
			}),
		).toThrow();
	});

	test("rejects invalid or incomplete naming configurations", () => {
		expect(() =>
			createTemplate({
				pipelineNaming: { mode: "automatic" } as unknown as CodePipelineNaming,
			}),
		).toThrow();
		expect(() =>
			createTemplate({
				pipelineNaming: { mode: "explicit" } as unknown as CodePipelineNaming,
			}),
		).toThrow();
	});

	test("requires CloudFormation coordination name for PR-gated auto-review", () => {
		expect(() =>
			createTemplate({
				...prGatedAutoReviewProps(),
				pipelineNaming: { mode: "cloudFormation" },
			}),
		).toThrow(
			"CloudFormation pipeline naming requires coordinationName for PR-gated auto-review",
		);
	});

	test("allows CloudFormation naming without coordination when no bridge is needed", () => {
		const template = createTemplate({
			pipelineNaming: { mode: "cloudFormation" },
		});
		const [, pipeline] = findPipeline(template);

		expect(pipeline.Properties).not.toHaveProperty("Name");
	});
});
