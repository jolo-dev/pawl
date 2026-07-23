import { z } from "zod";

export const findingCategorySchema = z.enum([
  "correctness",
  "security",
  "reliability",
  "maintainability",
]);

export const findingSeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export const findingSideSchema = z.enum(["before", "after"]);

const lineLocationCandidateSchema = z.strictObject({
  kind: z.literal("line"),
  line: z.number().int().positive(),
  hunkIdentity: z.string().trim().min(1).max(512),
});

const hunkLocationCandidateSchema = z.strictObject({
  kind: z.literal("hunk"),
  hunkIdentity: z.string().trim().min(1).max(512),
});

export const findingLocationCandidateSchema = z.discriminatedUnion("kind", [
  lineLocationCandidateSchema,
  hunkLocationCandidateSchema,
]);

const findingFields = {
  kind: z.literal("finding"),
  category: findingCategorySchema,
  severity: findingSeveritySchema,
  confidence: z.number().min(0).max(1),
  path: z.string().trim().min(1).max(1_024),
  side: findingSideSchema,
  issueIdentity: z.string().trim().min(1).max(512),
  evidence: z.string().trim().min(1).max(4_000),
  impact: z.string().trim().min(1).max(2_000),
  recommendation: z.string().trim().min(1).max(2_000),
  suggestion: z.string().max(8_000).optional(),
};

export const findingCandidateSchema = z.strictObject({
  ...findingFields,
  location: findingLocationCandidateSchema,
});

export const acceptedFindingSchema = findingCandidateSchema.brand<"PolicyAcceptedFinding">();

export const findingFingerprintSchema = z.string().regex(/^review-finding:v1:[a-f0-9]{64}$/);

export const dismissalCandidateSchema = z.strictObject({
  kind: z.literal("dismissal"),
  findingFingerprint: findingFingerprintSchema,
  linkedProviderCommentId: z.string().trim().min(1).max(512),
  eligibleHumanCommentId: z.string().trim().min(1).max(512),
  rationale: z.string().trim().min(1).max(2_000),
});

export const modelReviewCandidateSchema = z.discriminatedUnion("kind", [
  findingCandidateSchema,
  dismissalCandidateSchema,
]);

export const modelReviewOutputSchema = z.strictObject({
  candidates: z.array(modelReviewCandidateSchema).max(100),
});

export type FindingCategory = z.infer<typeof findingCategorySchema>;
export type FindingSeverity = z.infer<typeof findingSeveritySchema>;
export type FindingSide = z.infer<typeof findingSideSchema>;
export type FindingCandidate = z.infer<typeof findingCandidateSchema>;
export type AcceptedFinding = z.infer<typeof acceptedFindingSchema>;
export type Finding = AcceptedFinding;
export type DismissalCandidate = z.infer<typeof dismissalCandidateSchema>;
export type FindingFingerprint = z.infer<typeof findingFingerprintSchema>;
export type ModelReviewOutput = z.infer<typeof modelReviewOutputSchema>;
