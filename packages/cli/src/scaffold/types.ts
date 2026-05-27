import { ZodError, z } from "zod";

export const scaffoldPackageManagerSchema = z.enum(["bun", "pnpm", "npm"]);
export const scaffoldTestModeSchema = z.enum(["localstack", "none"]);

export const scaffoldConfigInputSchema = z.object({
	projectName: z.string().trim().min(1, "Project name is required"),
	packageManager: scaffoldPackageManagerSchema,
	awsProfile: z.string().trim().min(1, "AWS profile is required"),
	testMode: scaffoldTestModeSchema,
});

export type ScaffoldPackageManager = z.infer<
	typeof scaffoldPackageManagerSchema
>;
export type ScaffoldTestMode = z.infer<typeof scaffoldTestModeSchema>;
export type ScaffoldConfigInput = z.input<typeof scaffoldConfigInputSchema>;
export type ScaffoldConfig = z.infer<typeof scaffoldConfigInputSchema>;
export type ScaffoldProjectConfig = ScaffoldConfig & { cwd: string };

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
