import type { Logger } from "@aws-lambda-powertools/logger";
import type {
	DynamoDBBatchResponse,
	DynamoDBStreamEvent,
	DynamoDBStreamHandler,
} from "aws-lambda";
import { handlerFactory } from "./base/handler-factory";
import type { HandlerWithHooks } from "./base/hooks";

/**
 * The function `useDynamoDbStreamsHandler` creates a handler for processing DynamoDB stream events
 * with a specified service name and request handling function.
 * @param {string} serviceName - The `serviceName` parameter is a string that represents the name of
 * the service or function that will be handling the DynamoDB stream events.
 * @param handleRequest - The `handleRequest` parameter is a function that takes two arguments:
 * @returns The `useDynamoDbStreamsHandler` function is returning a handler function with hooks for
 * processing DynamoDB stream events. It takes in a `serviceName` as a string and a `handleRequest`
 * function that handles the DynamoDB stream event and logger. The `handleRequest` function returns a
 * promise that resolves to `void` or `DynamoDBBatchResponse`.
 */
export function useDynamoDbStreamsHandler(
	serviceName: string,
	handleRequest: (
		event: DynamoDBStreamEvent,
		logger: Logger,
	) => Promise<void> | Promise<DynamoDBBatchResponse>,
): HandlerWithHooks<
	DynamoDBStreamHandler,
	DynamoDBStreamEvent,
	DynamoDBBatchResponse
> {
	//@ts-expect-error
	return handlerFactory<DynamoDBStreamEvent, DynamoDBBatchResponse>(
		serviceName,
		handleRequest,
	);
}
