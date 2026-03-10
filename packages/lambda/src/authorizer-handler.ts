import type { Logger } from "@aws-lambda-powertools/logger";
import type {
	APIGatewayIAMAuthorizerResult,
	APIGatewayRequestAuthorizerEventV2,
	APIGatewayRequestIAMAuthorizerHandlerV2,
	APIGatewayRequestSimpleAuthorizerHandlerV2,
	APIGatewaySimpleAuthorizerResult,
} from "aws-lambda";
import { handlerFactory } from "./base/handler-factory";
import type { HandlerWithHooks } from "./base/hooks";

export const authorizer = {
	SIMPLE: "simple" as const,
	IAM: "iam" as const,
};

/**
 * @interface
 */
type Authorizer = (typeof authorizer)[keyof typeof authorizer];

/**
 * The function `useAuthorizerHandler` is a TypeScript function that returns a handler with hooks for
 * authorizing API Gateway requests based on the specified authorizer type.
 * @param {string} serviceName - The `serviceName` parameter is a string that represents the name of
 * the service for which the authorizer handler is being created.
 * @param handleRequest - The `handleRequest` parameter is a function that takes two arguments:
 * @returns The `useAuthorizerHandler` function returns a handler function with hooks for handling API
 * Gateway request authorizer events. The specific type of handler returned depends on the type of
 * authorizer specified (either SIMPLE or IAM). The handler function will call the `handleRequest`
 * function with the event and logger parameters and return a promise with the appropriate authorizer
 * result based on the authorizer type.
 */
export function useAuthorizerHandler<T extends Authorizer>(
	serviceName: string,
	handleRequest: (
		event: APIGatewayRequestAuthorizerEventV2,
		logger: Logger,
	) => Promise<
		T extends typeof authorizer.SIMPLE
			? APIGatewaySimpleAuthorizerResult
			: APIGatewayIAMAuthorizerResult
	>,
): HandlerWithHooks<
	T extends typeof authorizer.SIMPLE
		? APIGatewayRequestSimpleAuthorizerHandlerV2
		: APIGatewayRequestIAMAuthorizerHandlerV2,
	APIGatewayRequestAuthorizerEventV2,
	T extends typeof authorizer.SIMPLE
		? APIGatewaySimpleAuthorizerResult
		: APIGatewayIAMAuthorizerResult
> {
	// @ts-expect-error
	return handlerFactory<
		APIGatewayRequestAuthorizerEventV2,
		T extends typeof authorizer.SIMPLE
			? APIGatewaySimpleAuthorizerResult
			: APIGatewayIAMAuthorizerResult
	>(serviceName, handleRequest);
}
