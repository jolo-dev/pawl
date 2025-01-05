import type { Logger } from "@aws-lambda-powertools/logger";
import type { SQSEvent, SQSHandler } from "aws-lambda";
import { handlerFactory } from "./base/handler-factory";
import type { HandlerWithHooks } from "./base/hooks";

export function useSqsHandler(
  serviceName: string,
  handleRequest: (event: SQSEvent, logger: Logger) => Promise<void>,
): HandlerWithHooks<SQSHandler, SQSEvent> {
  return handlerFactory<SQSEvent>(serviceName, handleRequest);
}
