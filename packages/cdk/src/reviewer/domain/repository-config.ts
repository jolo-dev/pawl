import { z } from "zod";

export const REPOSITORY_CONFIG_LIMITS = {
  maxChecks: 20,
  maxCheckTimeoutSeconds: 3_600,
  maxDebounceSeconds: 60,
  maxTimeoutDays: 90,
  maxChangedFiles: 500,
  maxDiffBytes: 10_000_000,
  maxModelTokens: 2_000_000,
} as const;

const checkSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  command: z.string().trim().min(1).max(2_000),
  timeoutSeconds: z
    .number()
    .int()
    .min(1)
    .max(REPOSITORY_CONFIG_LIMITS.maxCheckTimeoutSeconds)
    .default(600),
});

const reviewConfigSchema = z.strictObject({
  timeoutDays: z.number().int().min(1).max(REPOSITORY_CONFIG_LIMITS.maxTimeoutDays).default(30),
  modelId: z.string().trim().min(1).max(512).default("configured-default"),
  maxChangedFiles: z
    .number()
    .int()
    .min(1)
    .max(REPOSITORY_CONFIG_LIMITS.maxChangedFiles)
    .default(100),
  maxDiffBytes: z
    .number()
    .int()
    .min(1)
    .max(REPOSITORY_CONFIG_LIMITS.maxDiffBytes)
    .default(1_000_000),
  maxModelTokens: z
    .number()
    .int()
    .min(1_000)
    .max(REPOSITORY_CONFIG_LIMITS.maxModelTokens)
    .default(100_000),
  debounceSeconds: z
    .number()
    .int()
    .min(0)
    .max(REPOSITORY_CONFIG_LIMITS.maxDebounceSeconds)
    .default(5),
});

export const repositoryConfigSchema = z.strictObject({
  version: z.literal(1),
  checks: z.array(checkSchema).max(REPOSITORY_CONFIG_LIMITS.maxChecks).default([]),
  install: z.strictObject({ command: z.string().trim().min(1).max(2_000) }).optional(),
  review: reviewConfigSchema.prefault({}),
});

export type RepositoryConfig = z.infer<typeof repositoryConfigSchema>;
export type RepositoryCheckConfig = z.infer<typeof checkSchema>;
