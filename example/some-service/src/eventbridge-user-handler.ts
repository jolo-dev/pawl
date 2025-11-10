import { useEventbridgeHandler } from "@pawl/lambda";
import z from "zod";

const userSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  address: z.object({
    street: z.string(),
    number: z.number(),
    postcode: z.number().min(10000).max(99999),
  }),
  username: z.string().optional(),
});

type User = z.infer<typeof userSchema>;

export const handler = useEventbridgeHandler<"user", User, { result: string }>(
  "user-service",
  async (event, logger) => {
    const user = userSchema.safeParse(event.detail);
    if (!user.success) {
      logger.error("User not correctly typed", user.error.flatten());
      throw new Error("User not correctly typed");
    }

    return {
      result: `User with ID: ${user.data.id} will be processed`,
    };
  },
);
