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
	const pipeline = new CodePipeline(stack, "Pipeline", {
		onPullRequest: true,
		autoReviewer: { modelId: "eu.anthropic.claude-sonnet-4-6" },
		...(phase === undefined
			? {}
			: { reviewCoordinationDeploymentPhase: phase }),
	}).source({
		origin: "codecommit",
		repository,
		repositoryName: "review-repository",
	});
	if (options?.omitStages !== true) {
		pipeline.stage({
			name: "Build",
			actions: [{ type: "approval", name: "Approve" }],
		});
	}
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
	const router = Object.values(
		template.findResources("AWS::Lambda::Function"),
	).find((resource) => JSON.stringify(resource).includes("Router-lambda"));
	const routerEnvironment =
		(router?.Properties.Environment?.Variables as
			| Record<string, unknown>
			| undefined) ?? {};
	const eventRules = Object.values(template.findResources("AWS::Events::Rule"));
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
		routerEnvironment,
		hasPipelineExecutionRule: eventRules.some(
			(resource) =>
				JSON.stringify(resource.Properties.EventPattern)?.includes(
					"CodePipeline Pipeline Execution State Change",
				) ?? false,
		),
		sourceTriggerDisabled: JSON.stringify(pipeline.Stages[0]).includes(
			'"PollForSourceChanges":false',
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
	expect(summary.variables).toEqual(PIPELINE_VARIABLES);
	expect(summary.hasAiReview).toBeFalse();
	expect(summary.hasBridge).toBeFalse();
	expect(summary.hasReconciler).toBeFalse();
	expect(summary.routerEnvironment).toMatchObject({
		PIPELINE_SOURCE_ACTION_NAME: "Source",
	});
	expect(summary.routerEnvironment.PIPELINE_NAME).toBeDefined();
	expect(summary.routerEnvironment.RECONCILER_FUNCTION_NAME).toBeUndefined();
	expect(summary.hasPipelineExecutionRule).toBeTrue();
	expect(summary.sourceTriggerDisabled).toBeTrue();
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
		expect(
			() =>
				new CodePipeline(stack, "Pipeline", {
					onPullRequest: true,
					autoReviewer: { modelId: "eu.anthropic.claude-sonnet-4-6" },
					reviewCoordinationDeploymentPhase:
						"preparing" as ReviewCoordinationDeploymentPhase,
				}),
		).toThrow();
	});

	test("requires an explicit fluent user stage at synthesis", () => {
		expect(() => createTemplate("active", { omitStages: true })).toThrow(
			/at least one user stage/i,
		);
	});

	test.each([
		{
			onPullRequest: false,
			autoReviewer: { modelId: "eu.anthropic.claude-sonnet-4-6" },
		},
		{ onPullRequest: true, autoReviewer: undefined },
	])("rejects phase unless PR-gated auto-review is configured", (configuration) => {
		const stack = new Stack(createTestApp(), "InvalidPhaseStack");
		expect(
			() =>
				new CodePipeline(stack, "Pipeline", {
					onPullRequest: configuration.onPullRequest,
					autoReviewer: configuration.autoReviewer,
					reviewCoordinationDeploymentPhase: "prepareGsi1",
				}),
		).toThrow(/requires PR-gated auto-review/);
	});
});
