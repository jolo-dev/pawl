import { useApiHandler } from "@hems-lib/lambda";

export const handler = useApiHandler("api-test-handler", async (event, logger) => {
  logger.info(`event ${JSON.stringify(event)}`);
  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Hello World!" }),
  };
});
