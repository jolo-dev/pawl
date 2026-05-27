import { useSqsHandler } from "@pawl/lambda";

export const handler = useSqsHandler(
	"messageProcessorHandler",
	async (event, logger) => {
		logger.info(event.Records[0]?.messageId ?? "no-message-id");
	},
);
