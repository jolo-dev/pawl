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
	readonly ssoLogin: (profile: string) => Promise<void>;
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
 * Walk profile -> credentials -> region -> model -> access, returning the
 * configuration the runtime needs or the reason it could not be resolved.
 */
export async function runPreflight(
	deps: PreflightDeps,
	prompter: PreflightPrompter,
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

	prompter.status("Loading AWS profiles");
	let profiles: string[];
	try {
		profiles = await deps.listProfiles();
	} catch (error: unknown) {
		return failed(`Could not read AWS profiles: ${describeError(error)}`);
	}
	if (profiles.length === 0) {
		return failed(
			"No AWS profiles found. Run `aws configure sso` or `aws configure` first.",
		);
	}

	const profileChoice = await prompter.select({
		id: "profile",
		message: "Select an AWS profile",
		options: profiles.map((profile) => ({ value: profile, label: profile })),
	});
	if (profileChoice === null || profileChoice === BACK) return cancelled();
	const profile = profileChoice;

	prompter.status("Checking credentials");
	let isSso: boolean;
	try {
		isSso = await deps.isSso(profile);
	} catch (error: unknown) {
		return failed(
			`Could not read the profile's configuration: ${describeError(error)}`,
		);
	}

	try {
		if (isSso) {
			if (!(await deps.isSsoTokenValid(profile))) {
				prompter.status("SSO token expired, opening a browser to log in");
				await deps.ssoLogin(profile);
			}
		} else {
			await deps.checkCredentials(profile);
		}
	} catch (error: unknown) {
		return failed(
			isSso
				? `SSO login failed: ${describeError(error)}`
				: `Credentials are not valid for profile "${profile}": ${describeError(error)}`,
		);
	}

	const suggestedRegion = (await deps.profileRegion(profile)) ?? DEFAULT_REGION;
	const region = await prompter.text({
		id: "region",
		message: "AWS region",
		initialValue: suggestedRegion,
		validate: (value) =>
			value.trim().length > 0 ? undefined : "Region is required",
	});
	if (region === null) return cancelled();
	const chosenRegion = region.trim();

	prompter.status(`Loading Bedrock models in ${chosenRegion}`);
	let groups: BedrockModelGroup[];
	try {
		groups = await deps.listModelGroups(profile, chosenRegion);
	} catch (error: unknown) {
		return failed(`Could not list Bedrock models: ${describeError(error)}`);
	}
	if (groups.length === 0) {
		return failed(`No text models are available in ${chosenRegion}.`);
	}

	const providers = [...new Set(groups.map((group) => group.provider))].sort();
	let selected: { modelId: string; modelName: string } | null = null;
	let step: "provider" | "model" | "scope" = "provider";
	let provider = "";
	let group: BedrockModelGroup | undefined;

	while (selected === null) {
		if (step === "provider") {
			const choice = await prompter.select({
				id: "provider",
				message: "Select provider",
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
			selected = { modelId: scopes[0] ?? "", modelName: group?.name ?? "" };
			break;
		}
		const choice = await prompter.select({
			id: "scope",
			message: "Select inference profile scope",
			allowBack: true,
			options: scopes.map((scope) => ({ value: scope, label: scope })),
		});
		if (choice === null) return cancelled();
		if (choice === BACK) {
			step = "model";
			continue;
		}
		selected = { modelId: choice, modelName: group?.name ?? "" };
	}

	prompter.status("Checking Bedrock access");
	let hasAccess: boolean;
	try {
		hasAccess = await deps.checkBedrockAccess(profile, chosenRegion);
	} catch (error: unknown) {
		return failed(`Could not check Bedrock access: ${describeError(error)}`);
	}
	if (!hasAccess) {
		return failed(
			`No Bedrock access for profile "${profile}" in ${chosenRegion}.`,
		);
	}

	return {
		ok: true,
		result: {
			profile,
			region: chosenRegion,
			modelId: selected.modelId,
			modelName: selected.modelName,
		},
	};
}
