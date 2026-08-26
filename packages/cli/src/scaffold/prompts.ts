import { confirm, select, text } from "@clack/prompts";
import type {
	ScaffoldPackageManager,
	ScaffoldStage,
	ScaffoldTestMode,
} from "./types";

export async function promptProjectName(): Promise<string> {
	const name = await text({
		message: "Project name",
		validate: (value) =>
			value.trim().length > 0 ? undefined : "Project name is required",
	});
	return name.trim();
}

export async function promptPackageManager(): Promise<ScaffoldPackageManager> {
	const value = await select<ScaffoldPackageManager>({
		message: "Which package manager?",
		options: [
			{ value: "bun", label: "Bun (recommended)" },
			{ value: "pnpm", label: "pnpm" },
			{ value: "npm", label: "npm (not recommended)" },
		],
	});
	return value;
}

export async function promptAwsProfile(profiles: string[]): Promise<string> {
	const value = await select<string>({
		message: "Which AWS profile?",
		options: profiles.map((profile) => ({ value: profile, label: profile })),
	});
	return value;
}

export async function promptTestMode(): Promise<ScaffoldTestMode> {
	const value = await select<ScaffoldTestMode>({
		message: "Which test mode?",
		options: [
			{ value: "localstack", label: "LocalStack" },
			{ value: "none", label: "none" },
		],
	});
	return value;
}

export async function promptTeam(): Promise<string> {
	const name = await text({
		message: "Team name",
		validate: (value) =>
			value.trim().length > 0 ? undefined : "Team name is required",
	});
	return name.trim();
}

export async function promptStage(): Promise<ScaffoldStage> {
	const value = await select<ScaffoldStage>({
		message: "Which stage?",
		options: [
			{ value: "dev", label: "dev" },
			{ value: "qa", label: "qa" },
			{ value: "prod", label: "prod" },
		],
	});
	return value;
}

export async function promptExtraTags(): Promise<Record<string, string>> {
	const tags: Record<string, string> = {};
	while (await confirm({ message: "Add an additional tag?" })) {
		const key = await text({
			message: "Tag key",
			validate: (value) =>
				value.trim().length > 0 ? undefined : "Tag key is required",
		});
		const value = await text({
			message: `Tag value for "${key}"`,
		});
		tags[key.trim()] = value.trim() || key.trim();
	}
	return tags;
}

export async function promptLocalstackSecretPath(): Promise<string> {
	const path = await text({
		message: "LocalStack API key SSM parameter path",
		placeholder: "/localstack/token",
		validate: (value) =>
			value.trim().length > 0 ? undefined : "SSM parameter path is required",
	});
	return path.trim();
}

export async function promptInstallNow(): Promise<boolean> {
	return confirm({
		message: "Do you want to install it now?",
	});
}
