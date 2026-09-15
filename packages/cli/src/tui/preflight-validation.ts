import type { BedrockModelGroup } from "../bedrock-models";
import type {
	PreflightDeps,
	PreflightOutcome,
	PreflightPrompter,
	PreflightSuccess,
} from "./preflight";

type Failure = Extract<PreflightOutcome, { ok: false }>;
type Checked<T> = { readonly ok: true; readonly value: T } | Failure;

function failed(reason: string): Failure {
	return { ok: false, reason, cancelled: false };
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function loadProfiles(
	deps: PreflightDeps,
	prompter: PreflightPrompter,
): Promise<Checked<readonly string[]>> {
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
	return { ok: true, value: profiles };
}

export async function loadAuthenticatedModels(
	deps: PreflightDeps,
	prompter: PreflightPrompter,
	profile: string,
	region: string,
): Promise<Checked<readonly BedrockModelGroup[]>> {
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
		if (isSso && !(await deps.isSsoTokenValid(profile))) {
			prompter.status("SSO token expired, opening a browser to log in");
			// Keep login URLs readable after the status line is replaced.
			await deps.ssoLogin(profile, (message) => prompter.notice(message));
		}
	} catch (error: unknown) {
		return failed(`SSO login failed: ${describeError(error)}`);
	}

	try {
		// A valid SSO token alone does not establish usable role credentials.
		await deps.checkCredentials(profile, region);
	} catch (error: unknown) {
		return failed(
			`Credentials are not valid for profile "${profile}": ${describeError(error)}`,
		);
	}

	prompter.status(`Loading Bedrock models in ${region}`);
	let groups: BedrockModelGroup[];
	try {
		groups = await deps.listModelGroups(profile, region);
	} catch (error: unknown) {
		return failed(`Could not list Bedrock models: ${describeError(error)}`);
	}
	if (groups.length === 0) {
		return failed(`No text models are available in ${region}.`);
	}
	return { ok: true, value: groups };
}

export async function validateModelSelection(
	deps: PreflightDeps,
	prompter: PreflightPrompter,
	profile: string,
	region: string,
	modelId: string,
	groups: readonly BedrockModelGroup[],
): Promise<PreflightOutcome> {
	const group = groups.find((item) => item.scopes.includes(modelId));
	if (!group) {
		return failed(
			`Model scope "${modelId}" is not available in ${region}. Choose another model or scope.`,
		);
	}

	prompter.status("Checking Bedrock access");
	let hasAccess: boolean;
	try {
		hasAccess = await deps.checkBedrockAccess(profile, region);
	} catch (error: unknown) {
		return failed(`Could not check Bedrock access: ${describeError(error)}`);
	}
	if (!hasAccess) {
		return failed(`No Bedrock access for profile "${profile}" in ${region}.`);
	}

	return {
		ok: true,
		result: { profile, region, modelId, modelName: group.name },
	};
}

export async function validateSavedSelection(
	deps: PreflightDeps,
	prompter: PreflightPrompter,
	selection: PreflightSuccess,
): Promise<PreflightOutcome> {
	const profiles = await loadProfiles(deps, prompter);
	if (!profiles.ok) return profiles;
	const { profile, region, modelId } = selection;
	if (!profiles.value.includes(profile)) {
		return failed(
			`AWS profile "${profile}" is not available. Choose an existing profile.`,
		);
	}
	const groups = await loadAuthenticatedModels(deps, prompter, profile, region);
	if (!groups.ok) return groups;
	return validateModelSelection(
		deps,
		prompter,
		profile,
		region,
		modelId,
		groups.value,
	);
}
