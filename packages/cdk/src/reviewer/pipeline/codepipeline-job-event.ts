import { z } from "zod";

const nonEmptyIdSchema = z.string().trim().min(1).max(512);
const revisionSchema = z.string().trim().min(7).max(512);
const userParametersStringSchema = z.string().trim().min(2).max(16_384);
const generationSchema = z.union([
	z.number().int().nonnegative(),
	z
		.string()
		.trim()
		.regex(/^(0|[1-9]\d*)$/)
		.transform((value) => Number(value)),
]);

export const sanitizedActionUserParametersSchema = z
	.strictObject({
		pipelineExecutionId: nonEmptyIdSchema,
		pipelineName: nonEmptyIdSchema,
		stageName: nonEmptyIdSchema,
		actionName: nonEmptyIdSchema,
		provider: nonEmptyIdSchema,
		repository: nonEmptyIdSchema,
		requestId: nonEmptyIdSchema,
		generation: generationSchema,
		sourceRevision: revisionSchema,
		destinationRevision: revisionSchema,
	})
	.readonly();

export type SanitizedActionUserParameters = z.infer<
	typeof sanitizedActionUserParametersSchema
>;

export const sanitizedActionUserParametersJsonSchema =
	userParametersStringSchema
		.transform((value, context): unknown => {
			try {
				return JSON.parse(value) as unknown;
			} catch {
				context.addIssue({
					code: "custom",
					message: "UserParameters must be valid JSON",
				});
				return z.NEVER;
			}
		})
		.pipe(sanitizedActionUserParametersSchema);

export const codePipelineJobEnvelopeSchema = z
	.object({
		id: nonEmptyIdSchema,
		data: z
			.object({
				actionConfiguration: z
					.object({
						configuration: z
							.object({
								UserParameters: userParametersStringSchema,
							})
							.passthrough(),
					})
					.passthrough(),
			})
			.passthrough(),
	})
	.passthrough()
	.transform((job) => ({
		jobId: job.id,
		userParameters: job.data.actionConfiguration.configuration.UserParameters,
	}))
	.readonly();

export const codePipelineJobEventSchema = z
	.object({
		"CodePipeline.job": codePipelineJobEnvelopeSchema,
	})
	.passthrough()
	.transform((event) => event["CodePipeline.job"])
	.readonly();

export type CodePipelineJobEnvelope = z.infer<
	typeof codePipelineJobEnvelopeSchema
>;
export type CodePipelineJobEvent = z.infer<typeof codePipelineJobEventSchema>;

export const parseSanitizedActionUserParameters = (
	input: unknown,
): SanitizedActionUserParameters =>
	sanitizedActionUserParametersJsonSchema.parse(input);
