import { z } from "zod";
import { requestKeySchema } from "./review-request";

const eventBase = {
  id: z.string().trim().min(1).max(512),
  request: requestKeySchema,
  occurredAt: z.iso.datetime({ offset: true }),
};

export const reviewEventSchema = z
  .discriminatedUnion("type", [
    z.strictObject({ ...eventBase, type: z.literal("request-opened") }),
    z.strictObject({
      ...eventBase,
      type: z.literal("revision-updated"),
      revision: z.string().trim().min(7).max(512),
    }),
    z.strictObject({
      ...eventBase,
      type: z.literal("human-comment"),
      commentId: z.string().trim().min(1).max(512),
      inReplyTo: z.string().trim().min(1).max(512).optional(),
    }),
    z.strictObject({ ...eventBase, type: z.literal("request-merged") }),
    z.strictObject({ ...eventBase, type: z.literal("request-closed") }),
  ])
  .readonly();

export type ReviewEvent = z.infer<typeof reviewEventSchema>;
export type EventWatermark = string;
