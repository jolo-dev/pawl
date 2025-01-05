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

type Authorizer = (typeof authorizer)[keyof typeof authorizer];

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
  // @ts-ignore
  return handlerFactory<
    APIGatewayRequestAuthorizerEventV2,
    T extends typeof authorizer.SIMPLE
      ? APIGatewaySimpleAuthorizerResult
      : APIGatewayIAMAuthorizerResult
  >(serviceName, handleRequest);
}
