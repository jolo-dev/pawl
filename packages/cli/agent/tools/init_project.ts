import { defineTool } from "eve/tools";
import { z } from "zod";
import {
	installScaffoldDependencies,
	runPawlInit,
	writeScaffoldProject,
} from "../../src/scaffold";
import {
	scaffoldPackageManagerSchema,
	scaffoldTestModeSchema,
} from "../../src/scaffold/types";

const stageSchema = z.enum(["dev", "qa", "prod"]);

/**
 * A tool call cannot answer a prompt: stdin belongs to the eve server. Fail
 * loudly rather than blocking the turn if a required value reaches a prompt.
 */
function refusePrompt(field: string): () => never {
	return () => {
		throw new Error(
			`init_project is non-interactive: pass "${field}" as tool input.`,
		);
	};
}

export default defineTool({
	description:
		"Scaffold a new pawl project (CDK app, infra directory, config files) in a new directory. Collect every required value from the user before calling; this tool never prompts.",
	inputSchema: z.object({
		projectName: z.string().min(1).describe("Name of the new project."),
		packageManager: scaffoldPackageManagerSchema.describe(
			"Package manager for the generated project.",
		),
		awsProfile: z.string().min(1).describe("AWS profile written into cdk.json."),
		testMode: scaffoldTestModeSchema.describe(
			"Whether the project uses LocalStack for integration tests.",
		),
		team: z.string().min(1).describe("Owning team tag."),
		stage: stageSchema.describe("Deployment stage tag."),
		tags: z
			.record(z.string(), z.string())
			.optional()
			.describe("Additional tags to apply."),
		localstackSecretPath: z
			.string()
			.optional()
			.describe("Required when testMode is localstack."),
		install: z
			.boolean()
			.optional()
			.describe("Install dependencies after writing the files."),
	}),
	async execute(input) {
		const cwd = process.cwd();
		const installNow = input.install ?? false;
		const config = await runPawlInit({
			cwd,
			overrides: {
				projectName: input.projectName,
				packageManager: input.packageManager,
				awsProfile: input.awsProfile,
				testMode: input.testMode,
				team: input.team,
				stage: input.stage,
				tags: input.tags,
				localstackSecretPath: input.localstackSecretPath,
			},
			deps: {
				listProfiles: refusePrompt("awsProfile"),
				promptProjectName: refusePrompt("projectName"),
				promptPackageManager: refusePrompt("packageManager"),
				promptAwsProfile: refusePrompt("awsProfile"),
				promptTestMode: refusePrompt("testMode"),
				promptTeam: refusePrompt("team"),
				promptStage: refusePrompt("stage"),
				promptExtraTags: refusePrompt("tags"),
				promptLocalstackSecretPath: refusePrompt("localstackSecretPath"),
				promptInstallNow: async () => installNow,
			},
		});
		const written = await writeScaffoldProject(config);
		if (config.installNow) {
			await installScaffoldDependencies(config);
		}
		return { projectDir: config.projectDir, files: written.length };
	},
});
