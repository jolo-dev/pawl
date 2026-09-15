import type { ProjectSettingsStore } from "../settings";
import {
	type PreflightDeps,
	type PreflightOutcome,
	type PreflightPrompter,
	runPreflight,
} from "./preflight";
import { validateSavedSelection } from "./preflight-validation";

export interface StartupOptions {
	readonly store: ProjectSettingsStore;
	readonly deps: PreflightDeps;
	readonly prompter: PreflightPrompter;
}

export async function runStartup({
	store,
	deps,
	prompter,
}: StartupOptions): Promise<PreflightOutcome> {
	const cancelled: PreflightOutcome = {
		ok: false,
		cancelled: true,
		reason: "Cancelled.",
	};
	const recover = async (reason: string) => {
		prompter.notice(reason);
		return (
			(await prompter.select({
				id: "settings-recovery",
				message: "Change startup settings?",
				options: [
					{ value: "change", label: "Change settings" },
					{ value: "cancel", label: "Cancel" },
				],
			})) === "change"
		);
	};

	const loaded = await store.load();
	// Failed edits must not replace the trusted defaults from the saved file.
	const defaults = loaded.kind === "saved" ? loaded.settings : undefined;
	let continueSaved = false;
	if (defaults) {
		prompter.notice(
			`Saved startup settings\nProfile: ${defaults.profile}\nRegion: ${defaults.region}\nModel: ${defaults.modelName}\nModel ID: ${defaults.modelId}`,
		);
		const choice = await prompter.select({
			id: "saved-settings",
			message: "Use these startup settings?",
			options: [
				{ value: "continue", label: "Continue" },
				{ value: "change", label: "Change settings" },
			],
			initialValue: "continue",
		});
		if (choice !== "continue" && choice !== "change") return cancelled;
		continueSaved = choice === "continue";
	} else if (loaded.kind === "unusable" && !(await recover(loaded.reason))) {
		return cancelled;
	}

	while (true) {
		const outcome =
			continueSaved && defaults
				? await validateSavedSelection(deps, prompter, defaults)
				: await runPreflight(deps, prompter, defaults ? { defaults } : {});
		if (outcome.ok) {
			try {
				await store.save(outcome.result);
			} catch (error: unknown) {
				const reason = error instanceof Error ? error.message : String(error);
				prompter.notice(
					`Could not save .pawl/settings.json: ${reason}. Continuing with these settings for this session.`,
				);
			}
			return outcome;
		}
		if (outcome.cancelled) return outcome;
		if (!(await recover(outcome.reason))) return cancelled;
		continueSaved = false;
	}
}
