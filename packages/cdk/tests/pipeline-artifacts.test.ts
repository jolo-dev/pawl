import { describe, expect, test } from "bun:test";
import {
	type ArtifactPlanState,
	type ArtifactStagePlan,
	createArtifactPlan,
	planStageBatch,
} from "../src/pipeline/artifacts";
import { PipelineDefinitionError } from "../src/pipeline/errors";

function expectDefinitionError(
	callback: () => unknown,
	code: PipelineDefinitionError["code"],
	path: string,
) {
	try {
		callback();
	} catch (error) {
		expect(error).toBeInstanceOf(PipelineDefinitionError);
		if (!(error instanceof PipelineDefinitionError)) return;
		expect(error.code).toBe(code);
		expect(error.path).toBe(path);
		return;
	}
	throw new Error("Expected PipelineDefinitionError");
}

function stage(
	name: string,
	actions: ArtifactStagePlan["actions"],
): ArtifactStagePlan {
	return { name, actions };
}

describe("artifact frontier planning", () => {
	test("registers the initial source artifact as the sole frontier", () => {
		const state = createArtifactPlan("SourceOutput");

		expect([...state.registered]).toEqual(["SourceOutput"]);
		expect(state.frontier).toEqual(["SourceOutput"]);
	});

	test("validates the initial source artifact name", () => {
		expectDefinitionError(
			() => createArtifactPlan("Source.Output"),
			"ARTIFACT_NAME_CONFLICT",
			"source.output",
		);
	});

	test("resolves sole-frontier required and optional inputs", () => {
		const result = planStageBatch(createArtifactPlan("SourceOutput"), [
			stage("Build", [
				{
					name: "Web",
					input: { mode: "required" },
					outputs: ["WebOutput"],
				},
			]),
			stage("Inspect", [
				{
					name: "Report",
					input: { mode: "optional" },
				},
			]),
		]);

		expect(result.stages[0]?.actions[0]?.inputs).toEqual(["SourceOutput"]);
		expect(result.stages[1]?.actions[0]?.inputs).toEqual(["WebOutput"]);
	});

	test("resolves no inputs for none mode and optional false", () => {
		const result = planStageBatch(createArtifactPlan("SourceOutput"), [
			stage("Checks", [
				{ name: "NoInput", input: { mode: "none" } },
				{
					name: "DisabledInput",
					input: { mode: "optional", explicit: false },
				},
			]),
		]);

		expect(result.stages[0]?.actions.map((action) => action.inputs)).toEqual([
			[],
			[],
		]);
	});

	test("allows explicit input from any previously registered artifact", () => {
		const result = planStageBatch(createArtifactPlan("SourceOutput"), [
			stage("Build", [
				{
					name: "Web",
					input: { mode: "required" },
					outputs: ["WebOutput"],
				},
			]),
			stage("Package", [
				{
					name: "Bundle",
					input: { mode: "required", explicit: ["SourceOutput"] },
					outputs: ["BundleOutput"],
				},
			]),
		]);

		expect(result.stages[1]?.actions[0]?.inputs).toEqual(["SourceOutput"]);
	});

	test("appends registered additional inputs after the inferred primary", () => {
		const state: ArtifactPlanState = {
			registered: new Set(["Primary", "Configuration", "Parameters"]),
			frontier: ["Primary"],
		};
		const result = planStageBatch(state, [
			stage("Deploy", [
				{
					name: "Stack",
					input: { mode: "required" },
					additionalInputs: ["Configuration", "Parameters"],
				},
			]),
		]);

		expect(result.stages[0]?.actions[0]?.inputs).toEqual([
			"Primary",
			"Configuration",
			"Parameters",
		]);
	});

	test("rejects unknown and duplicate additional inputs at their own paths", () => {
		const state: ArtifactPlanState = {
			registered: new Set(["Primary", "Configuration"]),
			frontier: ["Primary"],
		};

		expectDefinitionError(
			() =>
				planStageBatch(state, [
					stage("Deploy", [
						{
							name: "Stack",
							input: { mode: "required" },
							additionalInputs: ["Missing"],
						},
					]),
				]),
			"ARTIFACT_NOT_FOUND",
			"stages[Deploy].actions[Stack].additionalInputs[0]",
		);
		expectDefinitionError(
			() =>
				planStageBatch(state, [
					stage("Deploy", [
						{
							name: "Stack",
							input: { mode: "required" },
							additionalInputs: ["Primary"],
						},
					]),
				]),
			"ARTIFACT_NAME_CONFLICT",
			"stages[Deploy].actions[Stack].additionalInputs[0]",
		);
	});

	test("rejects automatic input with an empty frontier", () => {
		const state: ArtifactPlanState = {
			registered: new Set<string>(),
			frontier: [],
		};

		expectDefinitionError(
			() =>
				planStageBatch(state, [
					stage("Builds", [{ name: "Web", input: { mode: "required" } }]),
				]),
			"ARTIFACT_INPUT_AMBIGUOUS",
			"stages[Builds].actions[Web].input",
		);
	});

	test("rejects automatic input with a multi-artifact frontier", () => {
		const state: ArtifactPlanState = {
			registered: new Set(["WebOutput", "ApiOutput"]),
			frontier: ["WebOutput", "ApiOutput"],
		};

		expectDefinitionError(
			() =>
				planStageBatch(state, [
					stage("Deploy", [{ name: "Release", input: { mode: "optional" } }]),
				]),
			"ARTIFACT_INPUT_AMBIGUOUS",
			"stages[Deploy].actions[Release].input",
		);
	});

	test("rejects duplicate output names globally", () => {
		expectDefinitionError(
			() =>
				planStageBatch(createArtifactPlan("SourceOutput"), [
					stage("Builds", [
						{
							name: "Web",
							input: { mode: "required" },
							outputs: ["SourceOutput"],
						},
					]),
				]),
			"ARTIFACT_NAME_CONFLICT",
			"stages[Builds].actions[Web].outputs[0]",
		);
	});

	test("rejects invalid and repeated output names at their output paths", () => {
		expectDefinitionError(
			() =>
				planStageBatch(createArtifactPlan("SourceOutput"), [
					stage("Builds", [
						{
							name: "Web",
							input: { mode: "required" },
							outputs: ["Web.Output"],
						},
					]),
				]),
			"ARTIFACT_NAME_CONFLICT",
			"stages[Builds].actions[Web].outputs[0]",
		);

		expectDefinitionError(
			() =>
				planStageBatch(createArtifactPlan("SourceOutput"), [
					stage("Builds", [
						{
							name: "Web",
							input: { mode: "required" },
							outputs: ["SharedOutput"],
						},
						{
							name: "Api",
							input: { mode: "required" },
							outputs: ["SharedOutput"],
						},
					]),
				]),
			"ARTIFACT_NAME_CONFLICT",
			"stages[Builds].actions[Api].outputs[0]",
		);
	});

	test("rejects unknown explicit inputs at the action input path", () => {
		expectDefinitionError(
			() =>
				planStageBatch(createArtifactPlan("SourceOutput"), [
					stage("Builds", [
						{
							name: "Web",
							input: {
								mode: "required",
								explicit: ["MissingOutput"],
							},
						},
					]),
				]),
			"ARTIFACT_NOT_FOUND",
			"stages[Builds].actions[Web].input",
		);
	});

	test("plans parallel actions against the same pre-stage frontier", () => {
		const result = planStageBatch(createArtifactPlan("SourceOutput"), [
			stage("Builds", [
				{
					name: "Web",
					input: { mode: "required" },
					outputs: ["WebOutput"],
				},
				{
					name: "Api",
					input: { mode: "required" },
					outputs: ["ApiOutput"],
				},
			]),
		]);

		expect(result.stages[0]?.actions).toEqual([
			{
				name: "Web",
				inputs: ["SourceOutput"],
				outputs: ["WebOutput"],
			},
			{
				name: "Api",
				inputs: ["SourceOutput"],
				outputs: ["ApiOutput"],
			},
		]);
		expect(result.state.frontier).toEqual(["WebOutput", "ApiOutput"]);
	});

	test("preserves the frontier through no-output stages", () => {
		const result = planStageBatch(createArtifactPlan("SourceOutput"), [
			stage("Check", [
				{ name: "Lint", input: { mode: "required" }, outputs: [] },
			]),
		]);

		expect(result.state.frontier).toEqual(["SourceOutput"]);
	});

	test("makes sequential stages see the prior stage frontier", () => {
		const result = planStageBatch(createArtifactPlan("SourceOutput"), [
			stage("Compile", [
				{
					name: "Build",
					input: { mode: "required" },
					outputs: ["BuildOutput"],
				},
			]),
			stage("Deploy", [
				{
					name: "Release",
					input: { mode: "required" },
					outputs: ["ReleaseOutput"],
				},
			]),
		]);

		expect(result.stages[1]?.actions[0]?.inputs).toEqual(["BuildOutput"]);
		expect([...result.state.registered]).toEqual([
			"SourceOutput",
			"BuildOutput",
			"ReleaseOutput",
		]);
		expect(result.state.frontier).toEqual(["ReleaseOutput"]);
	});

	test("does not mutate input state after success", () => {
		const registered = new Set(["SourceOutput"]);
		const frontier = ["SourceOutput"];
		const state: ArtifactPlanState = { registered, frontier };

		planStageBatch(state, [
			stage("Build", [
				{
					name: "Web",
					input: { mode: "required" },
					outputs: ["WebOutput"],
				},
			]),
		]);

		expect([...registered]).toEqual(["SourceOutput"]);
		expect(frontier).toEqual(["SourceOutput"]);
	});

	test("does not mutate input state when complete-batch validation fails", () => {
		const registered = new Set(["SourceOutput"]);
		const frontier = ["SourceOutput"];
		const state: ArtifactPlanState = { registered, frontier };

		expectDefinitionError(
			() =>
				planStageBatch(state, [
					stage("Build", [
						{
							name: "Web",
							input: { mode: "required" },
							outputs: ["WebOutput"],
						},
					]),
					stage("Deploy", [
						{
							name: "Release",
							input: { mode: "required", explicit: ["Missing"] },
						},
					]),
				]),
			"ARTIFACT_NOT_FOUND",
			"stages[Deploy].actions[Release].input",
		);
		expect([...registered]).toEqual(["SourceOutput"]);
		expect(frontier).toEqual(["SourceOutput"]);
	});

	test("rejects an empty stage batch and an empty action list", () => {
		expectDefinitionError(
			() => planStageBatch(createArtifactPlan("SourceOutput"), []),
			"STAGE_EMPTY",
			"stages",
		);
		expectDefinitionError(
			() =>
				planStageBatch(createArtifactPlan("SourceOutput"), [
					stage("Builds", []),
				]),
			"STAGE_EMPTY",
			"stages[Builds].actions",
		);
	});
});
