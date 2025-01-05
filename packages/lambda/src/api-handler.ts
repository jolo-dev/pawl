import type { Logger } from "@aws-lambda-powertools/logger";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { handlerFactory } from "./base/handler-factory";
import type { HandlerWithHooks } from "./base/hooks";

// Make `body` and `statusCode` required
interface ApiResponse extends APIGatewayProxyStructuredResultV2 {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

export function useApiHandler(
  serviceName: string,
  handleRequest: (event: APIGatewayProxyEventV2, logger: Logger) => Promise<ApiResponse>,
): HandlerWithHooks<APIGatewayProxyHandlerV2, APIGatewayProxyEventV2, ApiResponse> {
  return handlerFactory<APIGatewayProxyEventV2, ApiResponse>(serviceName, handleRequest);
}
