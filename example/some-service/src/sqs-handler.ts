import { useSqsHandler } from "@pawl/lambda";

export const handler = useSqsHandler("sqsTest", async (event, logger) => {
	logger.info(event.Records[0].messageId);
});
