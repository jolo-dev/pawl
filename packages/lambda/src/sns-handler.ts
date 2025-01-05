import type { Logger } from "@aws-lambda-powertools/logger";
import type { SNSEvent, SNSHandler } from "aws-lambda";
import { handlerFactory } from "./base/handler-factory";
import type { HandlerWithHooks } from "./base/hooks";

export function useSnsHandler(
  serviceName: string,
  handleRequest: (event: SNSEvent, logger: Logger) => Promise<void>,
): HandlerWithHooks<SNSHandler, SNSEvent> {
  return handlerFactory<SNSEvent>(serviceName, handleRequest);
}
