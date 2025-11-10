import { useApiHandler } from "@pawl/lambda";

export const handler = useApiHandler("api-test-handler", async (event, logger) => {
  logger.info(`event ${JSON.stringify(event)}`);
  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Hello World!" }),
  };
});
