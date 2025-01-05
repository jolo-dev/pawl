import type { Logger } from "@aws-lambda-powertools/logger";
import type { DynamoDBBatchResponse, DynamoDBStreamEvent, DynamoDBStreamHandler } from "aws-lambda";
import { handlerFactory } from "./base/handler-factory";
import type { HandlerWithHooks } from "./base/hooks";

export function useDynamoDbStreamsHandler(
  serviceName: string,
  handleRequest: (
    event: DynamoDBStreamEvent,
    logger: Logger,
  ) => Promise<void> | Promise<DynamoDBBatchResponse>,
): HandlerWithHooks<DynamoDBStreamHandler, DynamoDBStreamEvent, DynamoDBBatchResponse> {
  //@ts-ignore
  return handlerFactory<DynamoDBStreamEvent, DynamoDBBatchResponse>(serviceName, handleRequest);
}
