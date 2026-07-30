import { confirm, isCancel, select, text } from "@clack/prompts";
import { getModels } from "@earendil-works/pi-ai";
import {
	CodeCommitBranchNameSchema,
	CodeCommitRepositoryNameSchema,
	SystemDefinedCrossRegionInferenceProfileIdSchema,
} from "@pawl/cdk";
import type { ValidatedCodeCommitInitCoreConfig } from "./config";

export interface CodeCommitInitPromptDeps {
	readonly promptRepositoryName: () => Promise<string>;
	readonly promptSyncExisting: () => Promise<boolean>;
	readonly promptSyncPath: () => Promise<string>;
	readonly promptDirectory: (isSync: boolean) => Promise<string | undefined>;
	readonly promptBranch: () => Promise<string>;
	readonly promptTeam: () => Promise<string>;
	readonly promptStage: () => Promise<"dev" | "qa" | "prod">;
	readonly promptAutoReviewer: () => Promise<boolean>;
	readonly promptModelId: () => Promise<string>;
	readonly promptConfirm: (summary: string) => Promise<boolean>;
	readonly promptInstall: () => Promise<boolean>;
	readonly promptDeploy: () => Promise<boolean>;
	readonly promptAwsProfile: (profiles: string[]) => Promise<string>;
	readonly promptRegion: (defaultRegion?: string) => Promise<string>;
	readonly listProfiles: () => Promise<string[]>;
	readonly getProfileRegion: (profile: string) => Promise<string | undefined>;
}

function handleCancel<T>(value: T | symbol): T {
	if (isCancel(value)) {
		throw new CodeCommitInitPromptCancelled();
	}
	return value;
}

export class CodeCommitInitPromptCancelled extends Error {
	constructor() {
		super("CodeCommit init prompts cancelled");
		this.name = "CodeCommitInitPromptCancelled";
	}
}

export const defaultPromptDeps: CodeCommitInitPromptDeps = {
	promptRepositoryName,
	promptSyncExisting,
	promptSyncPath,
	promptDirectory,
	promptBranch,
	promptTeam,
	promptStage,
	promptAutoReviewer,
	promptModelId,
	promptConfirm,
	promptInstall,
	promptDeploy,
	promptAwsProfile,
	promptRegion,
	listProfiles: listAwsProfiles,
	getProfileRegion: getProfileRegionDefault,
};

export async function promptRepositoryName(): Promise<string> {
	const value = await text({
		message: "CodeCommit repository name",
		validate: (v) => {
			const result = CodeCommitRepositoryNameSchema.safeParse(v.trim());
			return result.success ? undefined : result.error.issues[0]?.message;
		},
	});
	return handleCancel(value).trim();
}

export async function promptSyncExisting(): Promise<boolean> {
	const value = await select<boolean>({
		message: "Seed from an existing directory?",
		options: [
			{ value: true, label: "Yes, use an existing source path" },
			{ value: false, label: "No, create a new project" },
		],
	});
	return handleCancel(value);
}

export async function promptSyncPath(): Promise<string> {
	const value = await text({
		message: "Source directory path (use . for current directory)",
		validate: (v) =>
			v.trim().length > 0 ? undefined : "Source path is required",
	});
	return handleCancel(value).trim();
}

export async function promptDirectory(
	isSync: boolean,
): Promise<string | undefined> {
	const message = isSync
		? "Infrastructure directory name (default: infra)"
		: "Output directory (default: ./<repository-name>)";
	const value = await text({
		message,
		placeholder: isSync ? "infra" : "",
		validate: (v) => {
			const trimmed = v.trim();
			if (trimmed.length === 0) return undefined;
			if (trimmed.includes("/") || trimmed.includes("\\"))
				return "Must be a single directory name";
			return undefined;
		},
	});
	const result = handleCancel(value).trim();
	return result.length === 0 ? undefined : result;
}

export async function promptBranch(): Promise<string> {
	const value = await text({
		message: "Initial branch name",
		initialValue: "main",
		validate: (v) => {
			const result = CodeCommitBranchNameSchema.safeParse(v.trim());
			return result.success ? undefined : result.error.issues[0]?.message;
		},
	});
	return handleCancel(value).trim();
}

export async function promptTeam(): Promise<string> {
	const value = await text({
		message: "Team name",
		validate: (v) =>
			v.trim().length > 0 ? undefined : "Team name is required",
	});
	return handleCancel(value).trim();
}

export async function promptStage(): Promise<"dev" | "qa" | "prod"> {
	const value = await select<"dev" | "qa" | "prod">({
		message: "Which stage?",
		options: [
			{ value: "dev", label: "dev" },
			{ value: "qa", label: "qa" },
			{ value: "prod", label: "prod" },
		],
	});
	return handleCancel(value);
}

export async function promptAutoReviewer(): Promise<boolean> {
	const value = await confirm({
		message: "Enable the durable auto-reviewer?",
	});
	return handleCancel(value);
}

export async function promptModelId(): Promise<string> {
	const allModels = getModels("amazon-bedrock");
	const inferenceProfileModels = allModels.filter(
		(m) =>
			SystemDefinedCrossRegionInferenceProfileIdSchema.safeParse(m.id).success,
	);

	if (inferenceProfileModels.length === 0) {
		const value = await text({
			message:
				"Bedrock cross-region inference profile ID (e.g. eu.amazon.nova-2-lite-v1:0)",
			validate: (v) => {
				const result =
					SystemDefinedCrossRegionInferenceProfileIdSchema.safeParse(v.trim());
				return result.success ? undefined : result.error.issues[0]?.message;
			},
		});
		return handleCancel(value).trim();
	}

	const grouped = new Map<string, typeof inferenceProfileModels>();
	for (const m of inferenceProfileModels) {
		const baseId = m.id.replace(/^(apac|us|eu|global)\./, "");
		const existing = grouped.get(baseId) ?? [];
		existing.push(m);
		grouped.set(baseId, existing);
	}

	const value = await select<string>({
		message: "Select Bedrock cross-region inference profile",
		options: [...grouped.entries()].map(([_baseId, variants]) => ({
			value: variants[0]?.id,
			label: `${variants[0]?.name} (${variants.map((v) => v.id).join(", ")})`,
		})),
	});
	return handleCancel(value);
}

export async function promptConfirm(summary: string): Promise<boolean> {
	const value = await confirm({
		message: summary,
	});
	return handleCancel(value);
}

export async function promptInstall(): Promise<boolean> {
	const value = await confirm({
		message: "Install dependencies now?",
	});
	return handleCancel(value);
}

export async function promptDeploy(): Promise<boolean> {
	const value = await confirm({
		message: "Deploy now?",
	});
	return handleCancel(value);
}

export async function promptAwsProfile(profiles: string[]): Promise<string> {
	const value = await select<string>({
		message: "Which AWS profile?",
		options: profiles.map((p) => ({ value: p, label: p })),
	});
	return handleCancel(value);
}

export async function promptRegion(defaultRegion?: string): Promise<string> {
	const value = await text({
		message: "AWS region",
		initialValue: defaultRegion ?? "us-east-1",
		validate: (v) => (v.trim().length > 0 ? undefined : "Region is required"),
	});
	return handleCancel(value).trim();
}

async function listAwsProfiles(): Promise<string[]> {
	const { parseKnownFiles } = await import("@smithy/shared-ini-file-loader");
	const profiles = await parseKnownFiles({});
	return Object.keys(profiles);
}

async function getProfileRegionDefault(
	profile: string,
): Promise<string | undefined> {
	const { parseKnownFiles } = await import("@smithy/shared-ini-file-loader");
	const profiles = await parseKnownFiles({});
	return profiles[profile]?.region;
}

/**
 * Resolve TTY prompts for core project choices in the specified order.
 *
 * Returns a partial flags object suitable for `validateCodeCommitInitCoreConfig`.
 */
export async function resolveCorePrompts(
	deps: CodeCommitInitPromptDeps,
): Promise<{
	repositoryName: string;
	syncPath?: string;
	noSync?: true;
	directory?: string;
	branchName: string;
	team: string;
	stage: "dev" | "qa" | "prod";
	autoReviewer: boolean;
	modelId?: string;
}> {
	const repositoryName = await deps.promptRepositoryName();
	const useExisting = await deps.promptSyncExisting();
	let syncPath: string | undefined;
	let noSync: true | undefined;
	if (useExisting) {
		syncPath = await deps.promptSyncPath();
	} else {
		noSync = true;
	}
	const directory = await deps.promptDirectory(useExisting);
	const branchName = await deps.promptBranch();
	const team = await deps.promptTeam();
	const stage = await deps.promptStage();
	const autoReviewer = await deps.promptAutoReviewer();
	let modelId: string | undefined;
	if (autoReviewer) {
		modelId = await deps.promptModelId();
	}
	return {
		repositoryName,
		...(syncPath === undefined ? {} : { syncPath }),
		...(noSync === undefined ? {} : { noSync }),
		...(directory === undefined ? {} : { directory }),
		branchName,
		team,
		stage,
		...(autoReviewer
			? { autoReviewer: true as const }
			: { noAutoReviewer: true as const }),
		...(modelId === undefined ? {} : { modelId }),
	};
}

/**
 * Resolve post-confirmation prompts for install, deploy, profile, and region.
 *
 * Honors supplied flags; prompts only for missing values.
 */
export async function resolvePostConfirmPrompts(
	deps: CodeCommitInitPromptDeps,
	core: ValidatedCodeCommitInitCoreConfig,
): Promise<{
	install: boolean;
	deploy: boolean;
	awsProfile?: string;
	region?: string;
}> {
	const install = core.install ?? (await deps.promptInstall());
	if (!install) {
		return { install: false, deploy: false };
	}
	const deploy = core.deploy ?? (await deps.promptDeploy());
	if (!deploy) {
		return { install, deploy: false };
	}
	const awsProfile =
		core.awsProfile ?? (await deps.promptAwsProfile(await deps.listProfiles()));
	const region =
		core.region ??
		(await deps.promptRegion(await deps.getProfileRegion(awsProfile)));
	return { install, deploy, awsProfile, region };
}
