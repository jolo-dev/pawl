import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
	GetRestApisCommand,
	GetTagsCommand as GetRestApiTagsCommand,
	APIGatewayClient as RestApiClient,
} from "@aws-sdk/client-api-gateway";
import {
	ApiGatewayV2Client,
	GetApisCommand,
	GetTagsCommand,
} from "@aws-sdk/client-apigatewayv2";
import {
	createApiGatewayScanner,
	createApiGatewayV1Scanner,
} from "../src/infra/scan/apigateway";

const REGION = "eu-central-1";

function mockSend(client: { readonly prototype: unknown }) {
	return spyOn(
		client.prototype as { send(command: unknown): Promise<unknown> },
		"send",
	);
}

describe("apigateway (v2) scanner", () => {
	let client: ApiGatewayV2Client;
	let send: ReturnType<typeof mockSend>;

	afterEach(() => send?.mockRestore());

	it("reports an api with tags read from its arn", async () => {
		client = new ApiGatewayV2Client({ region: REGION });
		send = mockSend(ApiGatewayV2Client);
		send.mockImplementation(async (command: unknown) => {
			if (command instanceof GetApisCommand) {
				return {
					Items: [
						{
							ApiId: "abc123",
							Name: "platform-dev-myapi-apigateway",
							ProtocolType: "HTTP",
						},
					],
					$metadata: {},
				};
			}
			if (command instanceof GetTagsCommand) {
				expect(command.input?.ResourceArn).toBe(
					"arn:aws:apigateway:eu-central-1::/apis/abc123",
				);
				return { Tags: { team: "platform" }, $metadata: {} };
			}
			throw new Error("unexpected command");
		});

		const resources = await createApiGatewayScanner(client, REGION).scan();

		expect(resources).toEqual([
			{
				service: "apigateway",
				resourceKind: "AWS::ApiGatewayV2::Api",
				physicalName: "platform-dev-myapi-apigateway",
				arn: "arn:aws:apigateway:eu-central-1::/apis/abc123",
				tags: { team: "platform" },
			},
		]);
	});

	it("paginates and keeps an api whose tag read fails", async () => {
		client = new ApiGatewayV2Client({ region: REGION });
		send = mockSend(ApiGatewayV2Client);
		send.mockImplementation(async (command: unknown) => {
			if (command instanceof GetApisCommand) {
				return command.input?.NextToken === undefined
					? {
							Items: [{ ApiId: "a1", Name: "api-a" }],
							NextToken: "next",
							$metadata: {},
						}
					: { Items: [{ ApiId: "a2", Name: "api-b" }], $metadata: {} };
			}
			throw new Error("AccessDeniedException");
		});

		const resources = await createApiGatewayScanner(client, REGION).scan();

		expect(resources.map((r) => r.physicalName)).toEqual(["api-a", "api-b"]);
		expect(resources.every((r) => Object.keys(r.tags).length === 0)).toBe(true);
	});

	it("skips an api with no id rather than emitting a blank arn", async () => {
		client = new ApiGatewayV2Client({ region: REGION });
		send = mockSend(ApiGatewayV2Client);
		send.mockImplementation(async () => ({
			Items: [{ Name: "nameless" }],
			$metadata: {},
		}));

		expect(await createApiGatewayScanner(client, REGION).scan()).toEqual([]);
	});
});

describe("apigateway v1 scanner", () => {
	let client: RestApiClient;
	let send: ReturnType<typeof mockSend>;

	afterEach(() => send?.mockRestore());

	it("reports a REST api with tags read from its arn", async () => {
		client = new RestApiClient({ region: REGION });
		send = mockSend(RestApiClient);
		send.mockImplementation(async (command: unknown) => {
			if (command instanceof GetRestApisCommand) {
				return {
					items: [{ id: "r1", name: "platform-dev-myapi-apigateway" }],
					$metadata: {},
				};
			}
			if (command instanceof GetRestApiTagsCommand) {
				expect(command.input?.resourceArn).toBe(
					"arn:aws:apigateway:eu-central-1::/restapis/r1",
				);
				return { tags: { team: "platform" }, $metadata: {} };
			}
			throw new Error("unexpected command");
		});

		const resources = await createApiGatewayV1Scanner(client, REGION).scan();

		// v1 reports `items` in lowercase and tags in lowercase too.
		expect(resources).toEqual([
			{
				service: "apigateway-v1",
				resourceKind: "AWS::ApiGateway::RestApi",
				physicalName: "platform-dev-myapi-apigateway",
				arn: "arn:aws:apigateway:eu-central-1::/restapis/r1",
				tags: { team: "platform" },
			},
		]);
	});
});
