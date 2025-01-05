import { HttpApi, HttpMethod, HttpNoneAuthorizer } from "aws-cdk-lib/aws-apigatewayv2";
import {
  HttpIamAuthorizer,
  HttpJwtAuthorizer,
  HttpLambdaAuthorizer,
  HttpLambdaResponseType,
  HttpUserPoolAuthorizer,
} from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { CfnOutput } from "aws-cdk-lib/core";
import { BasicConstruct } from "./basic-construct";
import type { LambdaFunction } from "./lambda-function";
import type { Stack } from "./stack";

export interface ApiProps {
  authorizer: HttpIamAuthorizer | HttpUserPoolAuthorizer | HttpLambdaAuthorizer | HttpJwtAuthorizer;
  /**
   * Define the routes for the API. Can be a function, proxy to another API, or point to an load balancer
   *
   * @example
   *
   * ```js
   * new Api(stack, "api", {
   *   routes: {
   *     "GET  /notes"      : new LambdaFunction(this, "ApiNotes", entry),
   *     "POST /notes/{id}" : new LambdaFunction(this, "ApiNotesId", entry)
   *   }
   * })
   * ```
   */
  routes?: Record<`${HttpMethod} /${string}`, LambdaFunction>;
}

/**
 * This construct is an HTTP API Gateway v2. It has to use an authorizer and can trigger a list
 * of AWS Lambdas. The authorizer can be LambdaAuthorizer, IamAuthorizer, CognitoUserPoolAuthorizer, and HttpJwtAuthorizer
 * 
 * ```mermaid 
  architecture-beta
    group authorizer(logos:aws-cognito)[Authorizer]
    service api(logos:aws-api-gateway)[HTTP API Gateway v2]
    service lambda(logos:aws-lambda)[Lambda]
    service cognito(logos:aws-cognito)[AWS Cognito] in authorizer
    service iam(logos:aws-iam)[IAM] in authorizer
    service jwt(logos:jwt)[JWT] in authorizer
    service lambdaAuth(logos:aws-lambda)[Lambda] in authorizer
    auth{group}:L --> R:api
    api:B --> T:lambda
 * ```
 *
 */
export class ApiGateway extends BasicConstruct {
  private httpApi: HttpApi;

  /**
   * The constructor function initializes an HTTP API with specified routes. Every API GW has an Authorizer(@see {@link foo}).
   * It is possible to give each route an individual Authorizer.
   *
   * @param {Stack} scope - The `scope` parameter in the constructor represents the stack where the
   * resources will be created. It is typically an instance of the `Stack` class in an AWS
   * CloudFormation template.
   * @param {string} id - The `id` parameter in the constructor represents the unique identifier or
   * name for the API being created. It is used to differentiate this specific instance of the API from
   * others and is often used in naming resources associated with this API.
   * @param {ApiProps} props - The `props` parameter in the constructor function likely contains
   * configuration options and settings for the API being created. It seems to include an `authorizer`
   * property for setting a default authorizer for the API, and a `routes` property which is an object
   * containing route definitions for the API.
   */
  constructor(scope: Stack, id: string, props: ApiProps) {
    super(scope, id);

    this.httpApi = new HttpApi(this, "ApiGateway", {
      apiName: `${id}-apigateway`,
      defaultAuthorizer: props.authorizer,
    });
    if (props.routes) {
      for (const [routeKey, func] of Object.entries(props.routes)) {
        this.route(routeKey as `${HttpMethod} /${string}`, func);
      }
    }

    if (this.httpApi.url) {
      new CfnOutput(this, `${id}Url`, {
        value: this.httpApi.url,
        exportName: `${id}Url`,
      });
    }

    this.createAlarm(this.stack);
  }

  /**
   * The `addRoute` function in TypeScript adds a route with a specified key and Lambda function to a
   * class.
   * @param routeKey - The `routeKey` parameter is a string that represents a combination of an HTTP
   * method (such as GET, POST, PUT, DELETE, etc.) and a route path (such as `/users`, `/products`,
   * etc.). It is used to define a specific route for handling incoming requests in a web
   * @param {LambdaFunction} func - The `func` parameter is a Lambda function that will be executed
   * when the specified route is accessed.
   */
  addRoute(routeKey: `${HttpMethod} /${string}`, func: LambdaFunction) {
    this.route(routeKey, func);
  }

  /**
   * The function `route` adds routes to an HTTP API based on the specified method and path.
   * @param routeKey - The `routeKey` parameter is a string that represents the HTTP method and path
   * for a specific route. It is formatted as ` /`, where `` is the
   * HTTP method (e.g., GET, POST) and `` is the path for the route
   * @param {LambdaFunction} func - The `func` parameter is an object that contains information about
   * the Lambda function to be integrated with the route. It typically includes the Lambda function
   * itself and an optional authorizer for authentication and authorization purposes.
   */
  private route(routeKey: `${HttpMethod} /${string}`, func: LambdaFunction) {
    const [method, path] = routeKey.split(" ");

    this.httpApi.addRoutes({
      path,
      methods: [HttpMethod[method as keyof typeof HttpMethod]],
      integration: new HttpLambdaIntegration(`${method}${path}Integration`, func.lambda),
      authorizer:
        func.authorizer === false ? new HttpNoneAuthorizer() : this.httpApi.defaultAuthorizer,
    });
  }

  /**
   * The function `createAlarm` monitors an HTTP API Gateway using a given stack.
   * @param {Stack} stack - The `stack` parameter is a Stack object that is being passed into the
   * `createAlarm` function.
   */
  createAlarm(stack: Stack): void {
    stack.monitoring.monitorApiGatewayV2HttpApi({
      api: this.httpApi,
    });
  }
}

export {
  HttpIamAuthorizer,
  HttpUserPoolAuthorizer,
  HttpLambdaAuthorizer,
  HttpLambdaResponseType,
  HttpJwtAuthorizer,
};
