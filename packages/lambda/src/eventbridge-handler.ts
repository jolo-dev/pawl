import type { Logger } from "@aws-lambda-powertools/logger";
import type { EventBridgeEvent } from "aws-lambda";
import { handlerFactory } from "./base/handler-factory";

export function useEventbridgeHandler<TDetailType extends string, TDetail, TResult>(
  serviceName: string,
  handleRequest: (
    event: EventBridgeEvent<TDetailType, TDetail>,
    logger: Logger,
  ) => Promise<TResult>,
) {
  return handlerFactory<EventBridgeEvent<TDetailType, TDetail>, TResult>(
    serviceName,
    handleRequest,
  );
}
