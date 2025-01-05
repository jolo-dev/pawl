import { z } from "zod";

export const BasicTags = z.object({
  team: z.string(),
  stage: z.enum(["dev", "qa", "prod"]),
});

export type BasicTagsProps = z.infer<typeof BasicTags>;
