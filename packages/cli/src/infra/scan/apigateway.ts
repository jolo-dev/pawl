/**
 * API Gateway scanners.
 *
 * Two scanners, not one, because REST (v1) and HTTP/WebSocket (v2) are separate
 * services with separate permissions and separate clients. A denial on one must
 * not hide the other.
 *
 * Both v2 `ApiGateway` and v1 `ApiGatewayV1` pin `apiName` / `restApiName` to
 * `{prefix}{id}-apigateway`, so the name identifies the construct. v2 also
 * covers WebSocket APIs, which pawl's `Websocket` construct names differently
 * (`-appsync-event-api`).
 */

import {
	GetRestApisCommand,
	GetTagsCommand as GetRestApiTagsCommand,
	APIGatewayClient as RestApiClient,
} from "@aws-sdk/client-api-gateway";
import {
	ApiGatewayV2Client,
	GetApisCommand,
	GetTagsCommand as GetApiTagsCommand,
} from "@aws-sdk/client-apigatewayv2";
import type { DeployedResource } from "../drift";
import { mapWithConcurrency } from "./concurrency";
import type { ResourceScanner, ScannerFactory } from "./types";

const TAG_CONCURRENCY = 10;
const V2_RESOURCE_KIND = "AWS::ApiGatewayV2::Api";
const V1_RESOURCE_KIND = "AWS::ApiGateway::RestApi";

const v2Arn = (region: string, apiId: string): string =>
	`arn:aws:apigateway:${region}::/apis/${apiId}`;
const v1Arn = (region: string, restApiId: string): string =>
	`arn:aws:apigateway:${region}::/restapis/${restApiId}`;

export function createApiGatewayScanner(
	client: Pick<ApiGatewayV2Client, "send">,
	region: string,
): ResourceScanner {
	return {
		service: "apigateway",
		async scan(): Promise<DeployedResource[]> {
			const apis: { ApiId: string; Name?: string }[] = [];
			let token: string | undefined;
			do {
				const page = await client.send(
					new GetApisCommand(token === undefined ? {} : { NextToken: token }),
				);
				for (const item of page.Items ?? []) {
					if (item.ApiId) apis.push({ ApiId: item.ApiId, Name: item.Name });
				}
				token = page.NextToken;
			} while (token);

			return mapWithConcurrency(apis, TAG_CONCURRENCY, async (api) => {
				const arn = v2Arn(region, api.ApiId);
				let tags: Record<string, string | undefined> = {};
				try {
					const response = await client.send(
						new GetApiTagsCommand({ ResourceArn: arn }),
					);
					tags = response.Tags ?? {};
				} catch {
					tags = {};
				}
				return {
					service: "apigateway",
					resourceKind: V2_RESOURCE_KIND,
					physicalName: api.Name ?? api.ApiId,
					arn,
					tags,
				};
			});
		},
	};
}

export function createApiGatewayV1Scanner(
	client: Pick<RestApiClient, "send">,
	region: string,
): ResourceScanner {
	return {
		service: "apigateway-v1",
		async scan(): Promise<DeployedResource[]> {
			const restApis: { id: string; name?: string }[] = [];
			let position: string | undefined;
			do {
				const page = await client.send(
					new GetRestApisCommand(position === undefined ? {} : { position }),
				);
				for (const item of page.items ?? []) {
					if (item.id) restApis.push({ id: item.id, name: item.name });
				}
				position = page.position;
			} while (position);

			return mapWithConcurrency(restApis, TAG_CONCURRENCY, async (api) => {
				const arn = v1Arn(region, api.id);
				let tags: Record<string, string | undefined> = {};
				try {
					const response = await client.send(
						new GetRestApiTagsCommand({ resourceArn: arn }),
					);
					tags = response.tags ?? {};
				} catch {
					tags = {};
				}
				return {
					service: "apigateway-v1",
					resourceKind: V1_RESOURCE_KIND,
					physicalName: api.name ?? api.id,
					arn,
					tags,
				};
			});
		},
	};
}

export const scanApiGateway: ScannerFactory = (context) =>
	createApiGatewayScanner(
		new ApiGatewayV2Client({
			region: context.region,
			credentials: context.credentials,
		}),
		context.region,
	);

export const scanApiGatewayV1: ScannerFactory = (context) =>
	createApiGatewayV1Scanner(
		new RestApiClient({
			region: context.region,
			credentials: context.credentials,
		}),
		context.region,
	);
