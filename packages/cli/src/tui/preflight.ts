/**
 * The AWS pre-flight, as control flow rather than as prompts.
 *
 * This was previously written inline against `@clack/prompts`, which made it
 * testable only by driving a terminal. The decisions — which profile, whether
 * SSO needs a login, which region, which model — are the part worth testing, so
 * they live here and the caller supplies both the prompts and the AWS calls.
 *
 * Everything that touches AWS is injected; `src/aws-credentials.ts` and
 * `src/bedrock-models.ts` keep their own tests and are unchanged.
 *
 * Failure is returned, not thrown, because the client has to render the reason:
 * a pre-flight that fails silently would leave a user staring at a prompt that
 * cannot advance.
 */

import type { BedrockModelGroup } from "../bedrock-models";
import {
	loadAuthenticatedModels,
	loadProfiles,
	validateModelSelection,
} from "./preflight-validation";

/** Returned by `select` when the user asks to go back one step. */
export const BACK = Symbol("back");

export type SelectResult = string | typeof BACK | null;

export interface SelectOption {
	readonly value: string;
	readonly label: string;
}

export interface PreflightPrompter {
	/** The chosen value, {@link BACK}, or null when cancelled. */
	select(input: {
		readonly id: string;
		readonly message: string;
		readonly options: readonly SelectOption[];
		readonly initialValue?: string | undefined;
		readonly allowBack?: boolean;
	}): Promise<SelectResult>;
	/** The entered text, or null when cancelled. */
	text(input: {
		readonly id: string;
		readonly message: string;
		readonly initialValue?: string | undefined;
		readonly validate?: ((value: string) => string | undefined) | undefined;
	}): Promise<string | null>;
	/** Reports work with no input, so a slow AWS call is not a frozen screen. */
	status(message: string): void;
	/**
	 * A line the user may need to re-read, such as an SSO login URL. It goes into
	 * the transcript rather than the status line, because a status line is
	 * replaced and a URL that scrolls away cannot be followed.
	 */
	notice(message: string): void;
}

export interface PreflightDeps {
	readonly listProfiles: () => Promise<string[]>;
	readonly profileRegion: (profile: string) => Promise<string | undefined>;
	readonly isSso: (profile: string) => Promise<boolean>;
	readonly isSsoTokenValid: (profile: string) => Promise<boolean>;
	readonly checkCredentials: (
		profile: string,
		region?: string,
	) => Promise<void>;
	readonly ssoLogin: (
		profile: string,
		report: (message: string) => void,
	) => Promise<void>;
	readonly listModelGroups: (
		profile: string,
		region: string,
	) => Promise<BedrockModelGroup[]>;
	readonly checkBedrockAccess: (
		profile: string,
		region: string,
	) => Promise<boolean>;
}

export interface PreflightSuccess {
	readonly profile: string;
	readonly region: string;
	readonly modelId: string;
	readonly modelName: string;
}

export type PreflightOutcome =
	| { readonly ok: true; readonly result: PreflightSuccess }
	| {
			readonly ok: false;
			readonly reason: string;
			/** True when the user chose to stop rather than the pre-flight failing. */
			readonly cancelled: boolean;
	  };

const DEFAULT_REGION = "us-east-1";

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Walk profile -> region -> credentials -> model -> access, returning the
 * configuration the runtime needs or the reason it could not be resolved.
 */
export async function runPreflight(
	deps: PreflightDeps,
	prompter: PreflightPrompter,
	{ defaults }: { defaults?: PreflightSuccess } = {},
): Promise<PreflightOutcome> {
	const cancelled = (reason = "Cancelled."): PreflightOutcome => ({
		ok: false,
		reason,
		cancelled: true,
	});
	const failed = (reason: string): PreflightOutcome => ({
		ok: false,
		reason,
		cancelled: false,
	});

	const loadedProfiles = await loadProfiles(deps, prompter);
	if (!loadedProfiles.ok) return loadedProfiles;
	const profiles = loadedProfiles.value;

	const profileChoice = await prompter.select({
		id: "profile",
		message: "Select an AWS profile",
		options: profiles.map((profile) => ({ value: profile, label: profile })),
		initialValue:
			defaults && profiles.includes(defaults.profile)
				? defaults.profile
				: undefined,
	});
	if (profileChoice === null || profileChoice === BACK) return cancelled();
	const profile = profileChoice;

	if (!profiles.includes(profile)) {
		return failed(
			`AWS profile "${profile}" is not available. Choose an existing profile.`,
		);
	}

	let suggestedRegion: string;
	try {
		suggestedRegion = (await deps.profileRegion(profile)) ?? DEFAULT_REGION;
	} catch (error: unknown) {
		return failed(
			`Could not read the region for profile "${profile}": ${describeError(error)}`,
		);
	}
	const region = await prompter.text({
		id: "region",
		message: "AWS region",
		initialValue:
			profile === defaults?.profile ? defaults.region : suggestedRegion,
		validate: (value) =>
			value.trim().length > 0 ? undefined : "Region is required",
	});
	if (region === null) return cancelled();
	const chosenRegion = region.trim();

	const loadedGroups = await loadAuthenticatedModels(
		deps,
		prompter,
		profile,
		chosenRegion,
	);
	if (!loadedGroups.ok) return loadedGroups;
	const groups = loadedGroups.value;
	const defaultGroup = defaults
		? groups.find((item) => item.scopes.includes(defaults.modelId))
		: undefined;

	const providers = [...new Set(groups.map((group) => group.provider))].sort();
	let selectedModelId: string | null = null;
	let step: "provider" | "model" | "scope" = "provider";
	let provider = "";
	let group: BedrockModelGroup | undefined;

	while (selectedModelId === null) {
		if (step === "provider") {
			const choice = await prompter.select({
				id: "provider",
				message: "Select provider",
				initialValue:
					defaultGroup && providers.includes(defaultGroup.provider)
						? defaultGroup.provider
						: undefined,
				options: providers.map((value) => ({
					value,
					label: value.charAt(0).toUpperCase() + value.slice(1),
				})),
			});
			if (choice === null) return cancelled();
			if (choice === BACK) continue;
			provider = choice;
			step = "model";
			continue;
		}

		if (step === "model") {
			const candidates = groups.filter((item) => item.provider === provider);
			const choice = await prompter.select({
				id: "model",
				message: "Select model",
				initialValue: candidates.find(
					(item) => item.baseId === defaultGroup?.baseId,
				)?.baseId,
				allowBack: true,
				options: candidates.map((item) => ({
					value: item.baseId,
					label: item.name,
				})),
			});
			if (choice === null) return cancelled();
			if (choice === BACK) {
				step = "provider";
				continue;
			}
			group = candidates.find((item) => item.baseId === choice);
			if (!group) {
				step = "provider";
				continue;
			}
			step = "scope";
			continue;
		}

		const scopes = group?.scopes ?? [];
		if (scopes.length === 0) {
			step = "model";
			continue;
		}
		if (scopes.length === 1) {
			selectedModelId = scopes[0] ?? "";
			break;
		}
		const choice = await prompter.select({
			id: "scope",
			message: "Select inference profile scope",
			initialValue:
				defaults && scopes.includes(defaults.modelId)
					? defaults.modelId
					: undefined,
			allowBack: true,
			options: scopes.map((scope) => ({ value: scope, label: scope })),
		});
		if (choice === null) return cancelled();
		if (choice === BACK) {
			step = "model";
			continue;
		}
		if (!scopes.includes(choice)) {
			return failed(
				`Model scope "${choice}" is not available for the selected model. Choose an offered scope.`,
			);
		}
		selectedModelId = choice;
	}

	return validateModelSelection(
		deps,
		prompter,
		profile,
		chosenRegion,
		selectedModelId,
		groups,
	);
}
