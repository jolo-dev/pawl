import { z } from "zod";

const nonEmptyIdSchema = z.string().trim().min(1).max(512);
const revisionSchema = z.string().trim().min(7).max(512);
const occurredAtSchema = z.iso.datetime({ offset: true });

export const requestKeySchema = z
  .strictObject({
    provider: nonEmptyIdSchema,
    repository: nonEmptyIdSchema,
    requestId: nonEmptyIdSchema,
  })
  .readonly();

export type RequestKey = z.infer<typeof requestKeySchema>;
export type RequestRef = RequestKey;

export const revisionRangeSchema = z
  .strictObject({
    sourceRevision: revisionSchema,
    destinationRevision: revisionSchema,
  })
  .readonly();

export type RevisionRange = z.infer<typeof revisionRangeSchema>;

export const reviewRequestSchema = z
  .strictObject({
    key: requestKeySchema,
    title: z.string().max(1_000),
    status: z.enum(["open", "merged", "closed"]),
    sourceBranch: nonEmptyIdSchema,
    destinationBranch: nonEmptyIdSchema,
    sourceRevision: revisionSchema,
    destinationRevision: revisionSchema,
  })
  .readonly();

export type ReviewRequest = z.infer<typeof reviewRequestSchema>;

export const reviewCycleSnapshotSchema = z
  .strictObject({
    request: requestKeySchema,
    generation: z.number().int().nonnegative(),
    cycle: z.number().int().positive(),
    sourceRevision: revisionSchema,
    destinationRevision: revisionSchema,
    configVersion: z.number().int().positive(),
    eventWatermark: nonEmptyIdSchema,
    startedAt: occurredAtSchema,
  })
  .readonly();

export type ReviewCycleSnapshot = z.infer<typeof reviewCycleSnapshotSchema>;
