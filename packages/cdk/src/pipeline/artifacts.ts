import { PipelineDefinitionError } from "./errors";
import { validateArtifactName } from "./naming";

export interface ArtifactPlanState {
	readonly registered: ReadonlySet<string>;
	readonly frontier: readonly string[];
}

export type ArtifactInputPlan =
	| { readonly mode: "none" }
	| { readonly mode: "required"; readonly explicit?: readonly string[] }
	| {
			readonly mode: "optional";
			readonly explicit?: readonly string[] | false;
	  };

export interface ArtifactActionPlan {
	readonly name: string;
	readonly input: ArtifactInputPlan;
	readonly additionalInputs?: readonly string[];
	readonly deduplicateAdditionalInputWithInferredPrimary?: string;
	readonly maxInputs?: number;
	readonly outputs?: readonly string[];
}

export interface ArtifactStagePlan {
	readonly name: string;
	readonly actions: readonly ArtifactActionPlan[];
}

export interface PlannedArtifactAction {
	readonly name: string;
	readonly inputs: readonly string[];
	readonly outputs: readonly string[];
}

export interface PlannedArtifactStage {
	readonly name: string;
	readonly actions: readonly PlannedArtifactAction[];
}

export interface ArtifactStageBatchPlan {
	readonly stages: readonly PlannedArtifactStage[];
	readonly state: ArtifactPlanState;
}

export function createArtifactPlan(sourceOutput: string): ArtifactPlanState {
	const name = validateArtifactName(sourceOutput, "source.output");
	return {
		registered: new Set([name]),
		frontier: [name],
	};
}

function actionPath(stageName: string, actionName: string): string {
	return `stages[${stageName}].actions[${actionName}]`;
}

function resolveInputs(
	input: ArtifactInputPlan,
	frontier: readonly string[],
	registered: ReadonlySet<string>,
	path: string,
): readonly string[] {
	if (input.mode === "none" || input.explicit === false) return [];

	if (input.explicit !== undefined) {
		for (const name of input.explicit) {
			if (!registered.has(name)) {
				throw new PipelineDefinitionError(
					"ARTIFACT_NOT_FOUND",
					`Artifact '${name}' is not registered`,
					path,
				);
			}
		}
		return [...input.explicit];
	}

	if (frontier.length !== 1) {
		throw new PipelineDefinitionError(
			"ARTIFACT_INPUT_AMBIGUOUS",
			"Automatic artifact input requires exactly one frontier artifact",
			path,
		);
	}
	return [...frontier];
}

export function planStageBatch(
	state: ArtifactPlanState,
	stages: readonly ArtifactStagePlan[],
): ArtifactStageBatchPlan {
	if (stages.length === 0) {
		throw new PipelineDefinitionError(
			"STAGE_EMPTY",
			"Artifact planning requires at least one stage",
			"stages",
		);
	}

	const registered = new Set(state.registered);
	let frontier = [...state.frontier];
	const plannedStages: PlannedArtifactStage[] = [];

	for (const stage of stages) {
		if (stage.actions.length === 0) {
			throw new PipelineDefinitionError(
				"STAGE_EMPTY",
				`Stage '${stage.name}' requires at least one action`,
				`stages[${stage.name}].actions`,
			);
		}

		const preStageFrontier = [...frontier];
		const stageOutputs: string[] = [];
		const plannedActions: PlannedArtifactAction[] = [];

		for (const action of stage.actions) {
			const path = actionPath(stage.name, action.name);
			const inputWasInferred =
				action.input.mode !== "none" && action.input.explicit === undefined;
			const inputs = [
				...resolveInputs(
					action.input,
					preStageFrontier,
					registered,
					`${path}.input`,
				),
			];
			for (const [index, additionalInput] of (
				action.additionalInputs ?? []
			).entries()) {
				const additionalInputPath = `${path}.additionalInputs[${index}]`;
				if (!registered.has(additionalInput)) {
					throw new PipelineDefinitionError(
						"ARTIFACT_NOT_FOUND",
						`Artifact '${additionalInput}' is not registered`,
						additionalInputPath,
					);
				}
				if (inputs.includes(additionalInput)) {
					if (
						inputWasInferred &&
						action.deduplicateAdditionalInputWithInferredPrimary ===
							additionalInput
					) {
						continue;
					}
					throw new PipelineDefinitionError(
						"ARTIFACT_NAME_CONFLICT",
						`Artifact '${additionalInput}' is already an input`,
						additionalInputPath,
					);
				}
				inputs.push(additionalInput);
			}
			if (action.maxInputs !== undefined && inputs.length > action.maxInputs) {
				throw new PipelineDefinitionError(
					"PIPELINE_PROP_CONFLICT",
					`Action '${action.name}' supports at most ${action.maxInputs} input artifacts`,
					`${path}.input`,
				);
			}
			const outputs: string[] = [];

			for (const [index, output] of (action.outputs ?? []).entries()) {
				const outputPath = `${path}.outputs[${index}]`;
				const name = validateArtifactName(output, outputPath);
				if (registered.has(name) || stageOutputs.includes(name)) {
					throw new PipelineDefinitionError(
						"ARTIFACT_NAME_CONFLICT",
						`Artifact '${name}' is already registered`,
						outputPath,
					);
				}
				outputs.push(name);
				stageOutputs.push(name);
			}

			plannedActions.push({ name: action.name, inputs, outputs });
		}

		for (const output of stageOutputs) registered.add(output);
		if (stageOutputs.length > 0) frontier = [...stageOutputs];
		plannedStages.push({ name: stage.name, actions: plannedActions });
	}

	return {
		stages: plannedStages,
		state: { registered, frontier },
	};
}
