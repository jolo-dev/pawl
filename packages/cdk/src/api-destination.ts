import {
	ApiDestination as ApiDestinationEvent,
	type ApiDestinationProps as ApiDestinationEventProps,
	type Authorization,
	Connection,
	type ConnectionProps,
	HttpMethod,
} from "aws-cdk-lib/aws-events";
import type { Construct } from "constructs";

/**
 * @interface
 */
export type ApiDestinationProps = Required<
	Omit<
		ApiDestinationEventProps,
		"connection" | "httpMethod" | "rateLimitPerSecond"
	>
> & {
	authorization: Authorization;
	httpMethod?: "GET" | "POST" | "PUT";
	rateLimitPerSecond?: number;
} & Omit<ConnectionProps, "authorization" | "description" | "connectionName">;

/**
 *  https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_events.ApiDestination.html
 */
export class ApiDestination extends ApiDestinationEvent {
	/**
	 * The constructor function creates an ApiDestination with a Connection for your EventBridge.
	 * @param {Construct} scope - The `scope` parameter in the constructor refers to the AWS
	 * CloudFormation construct to which the ApiDestination is being added.
	 * @param {string} id - The `id` parameter in the constructor function is a string that represents
	 * the unique identifier for the API destination being created. It is used to identify and reference
	 * the specific instance of the API destination within the scope of the AWS CDK application.
	 * @param {ApiDestinationProps} props - The `props` object in the constructor contains the following
	 * properties:
	 */
	constructor(scope: Construct, id: string, props: ApiDestinationProps) {
		// ApiDestination Always needs a Connection
		const connection = new Connection(scope, "ApiConnection", {
			authorization: props.authorization,
			connectionName: `${props.apiDestinationName}-eventbridge-connection`,
			bodyParameters: props.bodyParameters,
			headerParameters: props.headerParameters,
			queryStringParameters: props.queryStringParameters,
		});

		super(scope, id, {
			connection,
			endpoint: props.endpoint,
			description: props.description,
			apiDestinationName: props.apiDestinationName,
			httpMethod: props.httpMethod
				? HttpMethod[props.httpMethod]
				: HttpMethod.POST,
			rateLimitPerSecond: props.rateLimitPerSecond,
		});
	}
}

export { Authorization } from "aws-cdk-lib/aws-events";
