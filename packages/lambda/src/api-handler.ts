import type { Logger } from "@aws-lambda-powertools/logger";
import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyHandlerV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { handlerFactory } from "./base/handler-factory";
import type { HandlerWithHooks } from "./base/hooks";

// Make `body` and `statusCode` required
export interface ApiResponse extends APIGatewayProxyStructuredResultV2 {
	statusCode: number;
	body: string;
	headers?: Record<string, string>;
}

/**
 * The function `useApiHandler` returns a handler with hooks for processing API Gateway proxy events in
 * TypeScript.
 * @param {string} serviceName - The `serviceName` parameter is a string that represents the name of
 * the service or API being handled by the `useApiHandler` function.
 * @param handleRequest - The `handleRequest` parameter is a function that takes two arguments:
 * @returns The `useApiHandler` function is returning a `HandlerWithHooks` that is specific to handling
 * API Gateway proxy events in AWS Lambda. The handler is created using the `handlerFactory` function
 * with the provided `serviceName` and `handleRequest` function for processing the API request.
 */
export function useApiHandler(
	serviceName: string,
	handleRequest: (
		event: APIGatewayProxyEventV2,
		logger: Logger,
	) => Promise<ApiResponse>,
): HandlerWithHooks<
	APIGatewayProxyHandlerV2,
	APIGatewayProxyEventV2,
	ApiResponse
> {
	return handlerFactory<APIGatewayProxyEventV2, ApiResponse>(
		serviceName,
		handleRequest,
	);
}
