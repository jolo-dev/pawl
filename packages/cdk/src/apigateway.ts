import {
	type CfnStage,
	HttpApi,
	type HttpMethod,
	HttpNoneAuthorizer,
	type HttpRouteIntegration,
} from "aws-cdk-lib/aws-apigatewayv2";
import {
	HttpIamAuthorizer,
	HttpJwtAuthorizer,
	HttpLambdaAuthorizer,
	HttpLambdaResponseType,
	HttpUserPoolAuthorizer,
} from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { CfnOutput } from "aws-cdk-lib/core";
import {
	BasicConstruct,
	type BasicConstructProps,
	type PolicyStatement,
} from "./basic-construct";
import type { EventBridge } from "./eventbridge";
import { HttpEventBridgeIntegration } from "./http-eventbridge-integration";
import type { LambdaFunction } from "./lambda-function";
import type { Construct, Stack } from "./stack";
import { resolveScope } from "./stack-function";

type AuthorizerType =
	| HttpIamAuthorizer
	| HttpUserPoolAuthorizer
	| HttpLambdaAuthorizer
	| HttpJwtAuthorizer
	| HttpNoneAuthorizer;

export interface ApiProps extends BasicConstructProps {
	authorizer?: AuthorizerType;
	/**
	 * Define the routes for the API. Can be a function, proxy to another API, or point to an load balancer
	 *
	 * @example
	 * ```js
	 * new Api(stack, "api", {
	 *   routes: {
	 *     "GET  /notes"      : new LambdaFunction(this, "ApiNotes", entry),
	 *     "POST /notes/{id}" : new LambdaFunction(this, "ApiNotesId", entry)
	 *     "POST /notes/{id}" : new LambdaFunction(this, "ApiNotesId", entry)
	 *   }
	 * })
	 * ```
	 */
	routes?: Record<`${HttpMethod} /${string}`, LambdaFunction | EventBridge>;
}

/**
 * An HTTP API Gateway v2 with optional authorization and Lambda or EventBridge routes.
 *
 * The diagram summarizes provisioned resources, not external callers or supplied
 * dependencies. The HTTP API, default stage, and access log group are always created.
 * Routes and integrations are created when routes are configured, including addRoute calls.
 * API authorizers are created when JWT (including Cognito) or Lambda authorization
 * is bound to a route. IAM and no-auth modes do not create an API authorizer resource.
 *
 * Binding may also create Lambda invoke permissions, an EventBridge integration role,
 * or a Cognito app client when clients are not supplied. These supporting resources
 * are summarized here rather than expanded into individual diagram nodes.
 * Supplied Lambda functions, EventBridge buses, user pools, and authorizer functions
 * are not created by this construct. Monitoring is registered with the existing
 * stack monitoring facility; that shared facility is not depicted as an owned resource.
 * Undirected edges show configuration relationships, not request flow.
 *
 * ```mermaid
 * architecture-beta
 *   group mandatory(logos:aws-api-gateway)[HTTP API]
 *   group routing(logos:aws-api-gateway)[When routes are configured]
 *   group authorization(logos:aws-iam)[Optional authorizer]
 *   service logs(logos:aws-cloudwatch)[Access log group] in mandatory
 *   service api(logos:aws-api-gateway)[HTTP API and stage] in mandatory
 *   service routes(logos:aws-api-gateway)[Routes and integrations] in routing
 *   service authorizer(logos:aws-api-gateway)[API authorizer] in authorization
 *   api:L --> R:logs
 *   api:R -- L:routes
 *   authorizer{group}:B -- T:api
 *   align row logs api routes
 *   align column authorizer api
 * ```
 */
export class ApiGateway extends BasicConstruct {
	readonly httpApi: HttpApi;

	/**
	 * Creates an HTTP API with a default stage, access logs, and optional routes.
	 * Authorization is optional; individual routes can override the default authorizer.
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
	constructor(scope: Stack, id: string, props: ApiProps);
	constructor(id: string, props: ApiProps);
	constructor(
		scopeOrId: Stack | string,
		idOrProps: string | ApiProps,
		maybeProps?: ApiProps,
	) {
		const scope = typeof scopeOrId === "string" ? resolveScope() : scopeOrId;
		const id = typeof scopeOrId === "string" ? scopeOrId : idOrProps;
		if (typeof id !== "string") {
			throw new Error("Invalid ApiGateway constructor arguments");
		}
		const props =
			typeof scopeOrId === "string" ? (idOrProps as ApiProps) : maybeProps;
		if (!props) throw new Error("Invalid ApiGateway constructor arguments");

		super(scope, id);

		this.httpApi = new HttpApi(this, "ApiGateway", {
			apiName: `${this.prefix}${id}-apigateway`,
			defaultAuthorizer: props.authorizer,
		});

		// Little hack to add logs: https://github.com/aws/aws-cdk/issues/11100#issuecomment-782213423
		const logs = new LogGroup(this, `${id}-logs`, {
			logGroupName: `/aws/pawl/${this.prefix}/${id}/logs`,
		});
		const stage = this.httpApi.defaultStage?.node.defaultChild as CfnStage;
		stage.accessLogSettings = {
			destinationArn: logs.logGroupArn,
			format: JSON.stringify({
				requestId: "$context.requestId",
				ip: "$context.identity.sourceIp",
				caller: "$context.identity.caller",
				user: "$context.identity.user",
				requestTime: "$context.requestTime",
				httpMethod: "$context.httpMethod",
				resourcePath: "$context.resourcePath",
				status: "$context.status",
				protocol: "$context.protocol",
				responseLength: "$context.responseLength",
			}),
		};

		if (props.routes) {
			for (const [routeKey, target] of Object.entries(props.routes)) {
				this.route(
					routeKey as `${HttpMethod} /${string}`,
					target,
					props.authorizer,
				);
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
	 * @param {LambdaFunction} target - The `target` parameter is a Lambda function that will be executed
	 * when the specified route is accessed.
	 */
	addRoute(
		routeKey: `${HttpMethod} /${string}`,
		target: LambdaFunction | EventBridge,
		authorizer?: AuthorizerType,
	): void {
		this.route(routeKey, target, authorizer);
	}

	/**
	 * The function `route` adds routes to an HTTP API based on the specified method and path.
	 * @param routeKey - The `routeKey` parameter is a string that represents the HTTP method and path
	 * for a specific route. It is formatted as ` /`, where `` is the
	 * HTTP method (e.g., GET, POST) and `` is the path for the route
	 * @param {LambdaFunction | EventBridge} target - The `target` parameter is an object that contains information about
	 * the Lambda function to be integrated with the route. It typically includes the Lambda function
	 * itself and an optional authorizer for authentication and authorization purposes.
	 */
	private route(
		routeKey: `${HttpMethod} /${string}`,
		target: LambdaFunction | EventBridge,
		authorizer?: AuthorizerType,
	): void {
		const [method, path] = routeKey.split(" ");

		let integration: HttpRouteIntegration;

		if ("lambda" in target) {
			// LambdaFunction target
			integration = new HttpLambdaIntegration(
				`${method}${path}Integration`,
				target.lambda,
			);
		} else {
			// EventBridge target
			integration = new HttpEventBridgeIntegration(
				`${method}${path}Integration`,
				{
					eventBus: target.eventBus,
				},
			);
		}

		this.httpApi.addRoutes({
			path,
			methods: [method as HttpMethod],
			integration,
			authorizer,
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

	protected applyPermissionPolicy(
		_construct: Construct,
		_policyStatement: PolicyStatement,
	): void {
		throw new Error("Method not implemented.");
	}
}

export {
	HttpIamAuthorizer,
	HttpJwtAuthorizer,
	HttpLambdaAuthorizer,
	HttpLambdaResponseType,
	HttpNoneAuthorizer,
	HttpUserPoolAuthorizer,
};
