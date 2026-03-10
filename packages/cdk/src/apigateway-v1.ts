import {
	type AuthorizationType,
	Cors,
	type IAuthorizer,
	LambdaIntegration,
	LogGroupLogDestination,
	type MethodOptions,
	RestApi,
} from "aws-cdk-lib/aws-apigateway";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { CfnOutput } from "aws-cdk-lib/core";
import {
	BasicConstruct,
	type BasicConstructProps,
	type PolicyStatement,
} from "./basic-construct";
import type { LambdaFunction } from "./lambda-function";
import type { Construct, Stack } from "./stack";

type HttpMethod =
	| "GET"
	| "POST"
	| "PUT"
	| "PATCH"
	| "DELETE"
	| "HEAD"
	| "OPTIONS"
	| "ANY";

export interface ApiV1Props extends BasicConstructProps {
	authorizer?: IAuthorizer;
	authorizationType?: AuthorizationType;
	/**
	 * Define the routes for the API.
	 *
	 * ```js
	 * new ApiGatewayV1(stack, "api", {
	 *   routes: {
	 *     "GET  /notes"      : new LambdaFunction(this, "ApiNotes", entry),
	 *     "POST /notes/{id}" : new LambdaFunction(this, "ApiNotesId", entry),
	 *   }
	 * })
	 * ```
	 */
	routes?: Record<`${HttpMethod} /${string}`, LambdaFunction>;
}

export class ApiGatewayV1 extends BasicConstruct {
	private restApi: RestApi;

	constructor(scope: Stack, id: string, props: ApiV1Props) {
		super(scope, id);

		const logs = new LogGroup(this, `${id}-logs`, {
			logGroupName: `/aws/vendedlogs/${this.prefix}/${id}/logs`,
		});

		this.restApi = new RestApi(this, "ApiGateway", {
			restApiName: `${this.prefix}${id}-apigateway`,
			defaultCorsPreflightOptions: {
				allowOrigins: Cors.ALL_ORIGINS,
				allowMethods: Cors.ALL_METHODS,
			},
			deployOptions: {
				stageName: "prod",
				accessLogDestination: new LogGroupLogDestination(logs),
			},
		});

		if (props.routes) {
			for (const [routeKey, target] of Object.entries(props.routes)) {
				this.route(
					routeKey as `${HttpMethod} /${string}`,
					target,
					props.authorizer,
					props.authorizationType,
				);
			}
		}

		if (this.restApi.url) {
			new CfnOutput(this, `${id}Url`, {
				value: this.restApi.url,
				exportName: `${id}Url`,
			});
		}

		this.createAlarm(this.stack);
	}

	addRoute(
		routeKey: `${HttpMethod} /${string}`,
		target: LambdaFunction,
		authorizer?: IAuthorizer,
		authorizationType?: AuthorizationType,
	): void {
		this.route(routeKey, target, authorizer, authorizationType);
	}

	private route(
		routeKey: `${HttpMethod} /${string}`,
		target: LambdaFunction,
		authorizer?: IAuthorizer,
		authorizationType?: AuthorizationType,
	): void {
		const [method, path] = routeKey.split(" ");
		const pathParts = path.split("/").filter(Boolean);

		let resource = this.restApi.root;
		for (const part of pathParts) {
			resource = resource.getResource(part) ?? resource.addResource(part);
		}

		const methodOptions: MethodOptions = authorizer
			? { authorizer, authorizationType }
			: {};

		resource.addMethod(
			method,
			new LambdaIntegration(target.lambda),
			methodOptions,
		);
	}

	createAlarm(stack: Stack): void {
		stack.monitoring.monitorApiGateway({
			api: this.restApi,
		});
	}

	protected applyPermissionPolicy(
		_construct: Construct,
		_policyStatement: PolicyStatement,
	): void {
		throw new Error("Method not implemented.");
	}
}
