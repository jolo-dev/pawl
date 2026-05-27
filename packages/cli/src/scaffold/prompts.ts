import { select, text } from "@clack/prompts";
import type { ScaffoldPackageManager, ScaffoldTestMode } from "./types";

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
