import type { Logger } from "@aws-lambda-powertools/logger";
import type { SQSEvent, SQSHandler } from "aws-lambda";
import { handlerFactory } from "./base/handler-factory";
import type { HandlerWithHooks } from "./base/hooks";

/**
 * The useSqsHandler function returns a handler with hooks for processing SQS events in TypeScript.
 * @param {string} serviceName - The `serviceName` parameter is a string that represents the name of
 * the service or function that will be handling the SQS events.
 * @param handleRequest - The `handleRequest` parameter is a function that takes two arguments:
 * @returns A function named `useSqsHandler` is being returned. This function takes two parameters:
 * `serviceName` of type string and `handleRequest` which is a function that takes `event` of type
 * `SQSEvent` and `logger` of type `Logger` as arguments and returns a `Promise<void>`. The
 * `useSqsHandler` function returns a `HandlerWithHooks<SQS
 */
export function useSqsHandler(
  serviceName: string,
  handleRequest: (event: SQSEvent, logger: Logger) => Promise<void>,
): HandlerWithHooks<SQSHandler, SQSEvent> {
  return handlerFactory<SQSEvent>(serviceName, handleRequest);
}
