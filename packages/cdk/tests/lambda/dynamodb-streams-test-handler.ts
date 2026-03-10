import { useDynamoDbStreamsHandler } from "@hems-lib/lambda";

const dynamoDbTypes: Record<string, string> = {
	NEW_IMAGE: "insert",
	OLD_IMAGE: "remove",
	NEW_AND_OLD_IMAGES: "update",
};

export const handler = useDynamoDbStreamsHandler(
	"dynamodb-streams-service",
	async (event, logger) => {
		logger.info("Activating the DynamoDB Stream Hander");
		for (const record of event.Records) {
			if (record.dynamodb?.StreamViewType) {
				logger.info(
					`A new record ${dynamoDbTypes[record.dynamodb.StreamViewType]}`,
				);
				logger.info(`${JSON.stringify(record.dynamodb)}`);
			}
		}
	},
);
