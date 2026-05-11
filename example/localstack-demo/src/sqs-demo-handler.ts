import { useSqsHandler } from "@pawl/lambda";

export const handler = useSqsHandler("demo-queue", async (event, logger) => {
	logger.info(event.Records[0].body);
});
