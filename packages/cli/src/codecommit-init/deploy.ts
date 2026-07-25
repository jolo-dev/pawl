import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CodeCommitDeployDeps {
	readonly exec: (
		command: string,
		args: string[],
		cwd: string,
		env: Record<string, string>,
	) => Promise<void>;
	readonly checkCredentials: (profile: string, region: string) => Promise<void>;
	readonly checkBedrockAccess: (
		profile: string,
		region: string,
	) => Promise<boolean>;
	readonly getProfileRegion: (profile: string) => Promise<string | undefined>;
}

async function runCommand(
	command: string,
	args: string[],
	cwd: string,
	env: Record<string, string>,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			shell: false,
			stdio: "inherit",
			env: { ...process.env, ...env },
		});
		child.once("error", reject);
		child.once("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(
				new Error(`${command} ${args.join(" ")} exited with code ${code}`),
			);
		});
	});
}

export const defaultDeployDeps: CodeCommitDeployDeps = {
	exec: runCommand,
	checkCredentials: async () => {},
	checkBedrockAccess: async () => true,
	getProfileRegion: async () => undefined,
};

/**
 * Install dependencies in the generated project directory.
 */
export async function installCodeCommitProject(
	projectDir: string,
	deps: Pick<CodeCommitDeployDeps, "exec"> = { exec: runCommand },
): Promise<void> {
	await deps.exec("bun", ["install"], projectDir, {});
}

/**
 * Deploy the generated CodeCommit project using CDK.
 *
 * Validates credentials, optionally checks Bedrock access for auto-review,
 * and runs `cdk deploy --all --require-approval never --outputs-file <temp>`.
 * The outputs file is created outside the source tree and removed in `finally`.
 */
export async function deployCodeCommitProject(
	projectDir: string,
	profile: string,
	region: string,
	options: {
		readonly autoReviewer?: boolean;
		readonly deps?: Partial<CodeCommitDeployDeps>;
	},
): Promise<Record<string, string>> {
	const deps: CodeCommitDeployDeps = {
		...defaultDeployDeps,
		...options.deps,
	};

	// Validate credentials for the selected profile and region
	await deps.checkCredentials(profile, region);

	// Check Bedrock access only when auto-review is enabled
	if (options.autoReviewer) {
		const hasBedrock = await deps.checkBedrockAccess(profile, region);
		if (!hasBedrock) {
			throw new Error(
				`No Bedrock access for profile "${profile}" in region "${region}"`,
			);
		}
	}

	// Create outputs file outside the source tree
	const tempDir = mkdtempSync(join(tmpdir(), "pawl-deploy-"));
	const outputsFile = join(tempDir, "outputs.json");
	try {
		const env: Record<string, string> = {
			AWS_PROFILE: profile,
			AWS_REGION: region,
			AWS_DEFAULT_REGION: region,
		};
		await deps.exec(
			"bunx",
			[
				"cdk",
				"deploy",
				"--all",
				"--require-approval",
				"never",
				"--outputs-file",
				outputsFile,
			],
			projectDir,
			env,
		);
		const outputs = JSON.parse(readFileSync(outputsFile, "utf8")) as Record<
			string,
			Record<string, string>
		>;
		// Flatten: take the first stack's outputs
		const firstStack = Object.values(outputs)[0];
		if (!firstStack) {
			throw new Error("CDK deploy produced no stack outputs");
		}
		return firstStack;
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

/**
 * Format the retry command for a failed deployment.
 */
export function formatDeployRetryCommand(
	profile: string,
	region: string,
): string {
	return `AWS_PROFILE=${profile} AWS_REGION=${region} bunx cdk deploy --all`;
}
