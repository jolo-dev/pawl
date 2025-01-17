import type { Logger } from "@aws-lambda-powertools/logger";
import type { SNSEvent, SNSHandler } from "aws-lambda";
import { handlerFactory } from "./base/handler-factory";
import type { HandlerWithHooks } from "./base/hooks";

/**
 * The function `useSnsHandler` returns a handler function for processing SNS events with the specified
 * service name and request handling function.
 * @param {string} serviceName - The `serviceName` parameter is a string that represents the name of
 * the SNS service that you are working with.
 * @param handleRequest - The `handleRequest` parameter is a function that takes two arguments:
 * @returns A function named `useSnsHandler` is being returned. This function takes two parameters:
 * `serviceName` of type string and `handleRequest` which is a function that takes `event` of type
 * `SNSEvent` and `logger` of type `Logger` as arguments and returns a `Promise<void>`. The
 * `useSnsHandler` function returns a `HandlerWithHooks<SNS
 */
export function useSnsHandler(
  serviceName: string,
  handleRequest: (event: SNSEvent, logger: Logger) => Promise<void>,
): HandlerWithHooks<SNSHandler, SNSEvent> {
  return handlerFactory<SNSEvent>(serviceName, handleRequest);
}
