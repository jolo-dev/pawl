import { describe, expect, test } from "bun:test";
import { Template } from "aws-cdk-lib/assertions";
import { Repository } from "aws-cdk-lib/aws-codecommit";
import {
	CodePipeline,
	type ReviewCoordinationDeploymentPhase,
	ReviewCoordinationDeploymentPhaseSchema,
} from "../src/codepipeline";
import { Stack } from "../src/stack";
import { createTestApp } from "./utils";

const PIPELINE_VARIABLES = [
	"PAWL_PROVIDER",
	"PAWL_REPOSITORY",
	"PAWL_REQUEST_ID",
	"PAWL_GENERATION",
	"PAWL_SOURCE_REVISION",
	"PAWL_DESTINATION_REVISION",
] as const;

function createTemplate(
	phase?: ReviewCoordinationDeploymentPhase,
	options?: { readonly omitStages?: boolean },
): Template {
	const stack = new Stack(createTestApp(), "CoordinationDeploymentStack");
	const repository = new Repository(stack, "Repository", {
		repositoryName: "review-repository",
	});
	new CodePipeline(stack, "Pipeline", {
		source: {
			type: "codecommit",
			repository,
			repositoryName: "review-repository",
		},
		onPullRequest: true,
		autoReview: { modelId: "eu.anthropic.claude-sonnet-4-6" },
		...(options?.omitStages === true
			? {}
			: {
					stages: [{ name: "Build", actions: [{ type: "manualApproval" }] }],
				}),
		...(phase === undefined
			? {}
			: { reviewCoordinationDeploymentPhase: phase }),
	});
	return Template.fromStack(stack);
}

type PipelineStageActions = {
	readonly Name: string;
	readonly Actions: readonly { readonly Name: string }[];
};

function pipelineProperties(template: Template): {
	readonly Variables?: readonly { readonly Name: string }[];
	readonly Stages: readonly PipelineStageActions[];
} {
	const pipeline = Object.values(
		template.findResources("AWS::CodePipeline::Pipeline"),
	)[0];
	if (pipeline === undefined) throw new Error("Pipeline resource not found");
	return pipeline.Properties as ReturnType<typeof pipelineProperties>;
}

function stateTable(template: Template): {
	readonly logicalId: string;
	readonly indexes: readonly string[];
} {
	const tables = template.findResources("AWS::DynamoDB::GlobalTable");
	const entry = Object.entries(tables)[0];
	if (entry === undefined) throw new Error("State table resource not found");
	const [logicalId, resource] = entry;
	const indexes = (
		resource.Properties as {
			readonly GlobalSecondaryIndexes?: readonly {
				readonly IndexName: string;
			}[];
		}
	).GlobalSecondaryIndexes;
	return {
		logicalId,
		indexes: indexes?.map(({ IndexName }) => IndexName) ?? [],
	};
}

function serializedLambdas(template: Template): readonly string[] {
	return Object.values(template.findResources("AWS::Lambda::Function")).map(
		(resource) => JSON.stringify(resource),
	);
}

function scheduledRuleLogicalIds(template: Template): readonly string[] {
	return Object.entries(template.findResources("AWS::Events::Rule"))
		.filter(([, resource]) =>
			JSON.stringify(resource).includes(
				'"ScheduleExpression":"rate(1 minute)"',
			),
		)
		.map(([logicalId]) => logicalId);
}

function coordinationResourceSummary(template: Template) {
	const pipeline = pipelineProperties(template);
	const lambdas = serializedLambdas(template);
	return {
		indexes: stateTable(template).indexes,
		variables: pipeline.Variables?.map(({ Name }) => Name) ?? [],
		hasAiReview: pipeline.Stages.some((stage) =>
			stage.Actions.some(({ Name }) => Name === "AIReview"),
		),
		bridgeLambdaLogicalIds: Object.entries(
			template.findResources("AWS::Lambda::Function"),
		)
			.filter(([, resource]) =>
				JSON.stringify(resource).includes("Bridge-lambda"),
			)
			.map(([logicalId]) => logicalId),
		reconcilerLambdaLogicalIds: Object.entries(
			template.findResources("AWS::Lambda::Function"),
		)
			.filter(([, resource]) =>
				JSON.stringify(resource).includes("Reconciler-lambda"),
			)
			.map(([logicalId]) => logicalId),
		hasBridge: lambdas.some((resource) => resource.includes("Bridge-lambda")),
		hasReconciler: lambdas.some((resource) =>
			resource.includes("Reconciler-lambda"),
		),
		scheduledRuleLogicalIds: scheduledRuleLogicalIds(template),
		hasCallbackIam: JSON.stringify(
			template.findResources("AWS::IAM::Policy"),
		).includes("codepipeline:PutJobSuccessResult"),
	};
}

function expectPreparationPhase(
	template: Template,
	expectedIndexes: readonly string[],
): void {
	const summary = coordinationResourceSummary(template);
	expect(summary.indexes).toEqual(expectedIndexes);
	expect(summary.variables).toEqual([]);
	expect(summary.hasAiReview).toBeFalse();
	expect(summary.hasBridge).toBeFalse();
	expect(summary.hasReconciler).toBeFalse();
	expect(summary.scheduledRuleLogicalIds).toEqual([]);
	expect(summary.hasCallbackIam).toBeFalse();
}

describe("CodePipeline review coordination deployment phases", () => {
	test("uses a Zod-validated three-phase enum", () => {
		expect(ReviewCoordinationDeploymentPhaseSchema.options).toEqual([
			"prepareGsi1",
			"prepareGsi2",
			"active",
		]);
		expect(
			ReviewCoordinationDeploymentPhaseSchema.safeParse("preparing").success,
		).toBeFalse();
	});

	test("prepareGsi1 provisions only GSI1 without activating coordination", () => {
		expectPreparationPhase(createTemplate("prepareGsi1"), ["GSI1"]);
	});

	test("prepareGsi2 provisions both GSIs without activating coordination", () => {
		expectPreparationPhase(createTemplate("prepareGsi2"), ["GSI1", "GSI2"]);
	});

	test("active provisions and activates complete coordination", () => {
		const summary = coordinationResourceSummary(createTemplate("active"));
		expect(summary.indexes).toEqual(["GSI1", "GSI2"]);
		expect(summary.variables).toEqual(PIPELINE_VARIABLES);
		expect(summary.hasAiReview).toBeTrue();
		expect(summary.hasBridge).toBeTrue();
		expect(summary.hasReconciler).toBeTrue();
		expect(summary.scheduledRuleLogicalIds).toHaveLength(1);
		expect(summary.hasCallbackIam).toBeTrue();
	});

	test("defaults existing PR-gated auto-review consumers to active", () => {
		expect(coordinationResourceSummary(createTemplate())).toEqual(
			coordinationResourceSummary(createTemplate("active")),
		);
	});

	test("preserves state table and final coordination logical IDs", () => {
		const prepareGsi1 = createTemplate("prepareGsi1");
		const prepareGsi2 = createTemplate("prepareGsi2");
		const active = createTemplate("active");
		const defaultActive = createTemplate();

		expect(stateTable(prepareGsi1).logicalId).toBe(
			stateTable(prepareGsi2).logicalId,
		);
		expect(stateTable(prepareGsi2).logicalId).toBe(
			stateTable(active).logicalId,
		);
		const activeSummary = coordinationResourceSummary(active);
		const defaultSummary = coordinationResourceSummary(defaultActive);
		expect(activeSummary.bridgeLambdaLogicalIds).toEqual(
			defaultSummary.bridgeLambdaLogicalIds,
		);
		expect(activeSummary.reconcilerLambdaLogicalIds).toEqual(
			defaultSummary.reconcilerLambdaLogicalIds,
		);
		expect(activeSummary.scheduledRuleLogicalIds).toEqual(
			defaultSummary.scheduledRuleLogicalIds,
		);
	});

	test("rejects an invalid phase through the CodePipeline API", () => {
		const stack = new Stack(createTestApp(), "InvalidEnumPhaseStack");
		const repository = new Repository(stack, "Repository", {
			repositoryName: "review-repository",
		});
		expect(
			() =>
				new CodePipeline(stack, "Pipeline", {
					source: {
						type: "codecommit",
						repository,
						repositoryName: "review-repository",
					},
					onPullRequest: true,
					autoReview: { modelId: "eu.anthropic.claude-sonnet-4-6" },
					reviewCoordinationDeploymentPhase:
						"preparing" as ReviewCoordinationDeploymentPhase,
				}),
		).toThrow();
	});

	describe("default stages with PR-gated auto-review", () => {
		function defaultStageNames(
			phase?: ReviewCoordinationDeploymentPhase,
		): readonly string[] {
			const template = createTemplate(phase, { omitStages: true });
			return pipelineProperties(template).Stages.flatMap((stage) =>
				stage.Actions.map(({ Name }) => Name),
			);
		}

		test("active phase injects AIReview into default Approve stage", () => {
			const names = defaultStageNames("active");
			expect(names).toContain("AIReview");
		});

		test("prepareGsi1 omits AIReview from default stages", () => {
			expect(defaultStageNames("prepareGsi1")).not.toContain("AIReview");
		});

		test("prepareGsi2 omits AIReview from default stages", () => {
			expect(defaultStageNames("prepareGsi2")).not.toContain("AIReview");
		});

		test("default phase (active) injects AIReview into default stages", () => {
			expect(defaultStageNames()).toContain("AIReview");
		});

		test("default stages with active phase creates bridge and reconciler", () => {
			const template = createTemplate("active", { omitStages: true });
			const summary = coordinationResourceSummary(template);
			expect(summary.hasBridge).toBeTrue();
			expect(summary.hasReconciler).toBeTrue();
			expect(summary.variables).toEqual(PIPELINE_VARIABLES);
		});

		test("default stages with prepareGsi1 skips bridge and reconciler", () => {
			const template = createTemplate("prepareGsi1", { omitStages: true });
			const summary = coordinationResourceSummary(template);
			expect(summary.hasBridge).toBeFalse();
			expect(summary.hasReconciler).toBeFalse();
			expect(summary.variables).toEqual([]);
		});
	});

	test.each([
		{
			onPullRequest: false,
			autoReview: { modelId: "eu.anthropic.claude-sonnet-4-6" },
		},
		{ onPullRequest: true, autoReview: undefined },
	])("rejects phase unless PR-gated auto-review is configured", (configuration) => {
		const stack = new Stack(createTestApp(), "InvalidPhaseStack");
		const repository = new Repository(stack, "Repository", {
			repositoryName: "review-repository",
		});
		expect(
			() =>
				new CodePipeline(stack, "Pipeline", {
					source: {
						type: "codecommit",
						repository,
						repositoryName: "review-repository",
					},
					onPullRequest: configuration.onPullRequest,
					autoReview: configuration.autoReview,
					reviewCoordinationDeploymentPhase: "prepareGsi1",
				}),
		).toThrow(/requires PR-gated auto-review/);
	});
});
