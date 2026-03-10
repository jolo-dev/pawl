import { useApiHandler } from "../../../lambda";

export const handler = useApiHandler("test-service", async (event, logger) => {
	logger.info("This handler gots triggered by an API GW event:");
	logger.info(JSON.stringify(event));
	return {
		statusCode: 200,
		body: JSON.stringify({ message: "Hello, World!" }),
	};
});
