import { useSqsHandler } from "@hems-lib/lambda";

export const handler = useSqsHandler("sqsTest", async (event, logger) => {
  logger.info(event.Records[0].messageId);
});
