import { BasicTags } from "@pawl/cdk";
import { ZodError, z } from "zod";

export const scaffoldPackageManagerSchema = z.enum(["bun", "pnpm", "npm"]);
export const scaffoldTestModeSchema = z.enum(["localstack", "none"]);

export const scaffoldConfigInputSchema = z
	.object({
		projectName: z.string().trim().min(1, "Project name is required"),
		packageManager: scaffoldPackageManagerSchema,
		awsProfile: z.string().trim().min(1, "AWS profile is required"),
		testMode: scaffoldTestModeSchema,
		team: z.string().trim().min(1, "Team name is required"),
		stage: BasicTags.shape.stage,
		tags: z.record(z.string(), z.string()).optional().default({}),
		localstackSecretPath: z
			.string()
			.trim()
			.min(1, "LocalStack secret path is required")
			.optional(),
	})
	.superRefine((data, ctx) => {
		if (data.testMode === "localstack" && !data.localstackSecretPath) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"LocalStack secret path is required when test mode is localstack",
				path: ["localstackSecretPath"],
			});
		}
	});

export type ScaffoldPackageManager = z.infer<
	typeof scaffoldPackageManagerSchema
>;
export type ScaffoldTestMode = z.infer<typeof scaffoldTestModeSchema>;
export type ScaffoldStage = z.infer<typeof BasicTags.shape.stage>;
export type ScaffoldConfigInput = z.input<typeof scaffoldConfigInputSchema>;
export type ScaffoldConfig = z.infer<typeof scaffoldConfigInputSchema>;
export type ScaffoldProjectConfig = ScaffoldConfig & {
	cwd: string;
	projectDir: string;
};
export type ScaffoldInitResult = ScaffoldProjectConfig & {
	installNow: boolean;
};
export type ScaffoldInitOverrides = Partial<ScaffoldConfig>;

export function validateScaffoldConfig(
	input: ScaffoldConfigInput,
): ScaffoldConfig {
	try {
		return scaffoldConfigInputSchema.parse(input);
	} catch (error: unknown) {
		if (error instanceof ZodError) {
			const details = error.issues
				.map((issue) => {
					const field = issue.path.join(".") || "config";
					const label = field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
					return `${label}: ${issue.message}`;
				})
				.join("; ");
			throw new Error(`Invalid scaffold config: ${details}`);
		}
		throw error;
	}
}
