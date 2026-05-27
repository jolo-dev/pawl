import { useDynamoDbStreamsHandler } from "@pawl/lambda";

export const handler = useDynamoDbStreamsHandler(
	"sendWelcomeMessageHandler",
	async (event, logger) => {
		logger.info(event.Records[0]?.eventID ?? "no-event-id");
	},
);
