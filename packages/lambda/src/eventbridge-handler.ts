import type { Logger } from "@aws-lambda-powertools/logger";
import type { EventBridgeEvent } from "aws-lambda";
import {
	type HandlerLoggingMode,
	handlerFactory,
} from "./base/handler-factory";

export interface EventbridgeHandlerOptions {
	logging?: HandlerLoggingMode;
}

/**
 * The function `useEventbridgeHandler` is a TypeScript function that creates a handler for processing
 * EventBridge events with a specified detail type and detail data.
 * @param {string} serviceName - The `serviceName` parameter is a string that represents the name of
 * the service or component that will be handling the EventBridge events.
 * @param handleRequest - The `handleRequest` parameter is a function that takes two arguments:
 * @returns The `useEventbridgeHandler` function is returning a handler function that takes an event
 * and a logger as parameters, and returns a Promise of a result. This handler function is created
 * using the `handlerFactory` function, which is passed the `serviceName` and `handleRequest` function
 * provided to the `useEventbridgeHandler` function.
 */
export function useEventbridgeHandler<
	TDetailType extends string,
	TDetail,
	TResult,
>(
	serviceName: string,
	handleRequest: (
		event: EventBridgeEvent<TDetailType, TDetail>,
		logger: Logger,
	) => Promise<TResult>,
	options?: EventbridgeHandlerOptions,
) {
	return handlerFactory<EventBridgeEvent<TDetailType, TDetail>, TResult>(
		serviceName,
		handleRequest,
		{
			logging: options?.logging,
			metadataProjector: (event) => ({
				id: event.id,
				source: event.source,
				"detail-type": event["detail-type"],
			}),
		},
	);
}
