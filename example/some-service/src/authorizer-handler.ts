import { useAuthorizerHandler } from "@pawl/lambda";
// For demo purposes a simple true otherwise check in the DB for authentication
export const handler = useAuthorizerHandler<"simple">("authorize-test", async (event, logger) => {
  if (event.headers?.authorization === "secret") {
    logger.info("authorized");
    return {
      isAuthorized: true,
    };
  }
  logger.info("not authorized");
  return {
    isAuthorized: false,
  };
});
