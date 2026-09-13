import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
	DescribeTableCommand,
	DynamoDBClient,
	ListTablesCommand,
	ListTagsOfResourceCommand,
} from "@aws-sdk/client-dynamodb";
import { createDynamoDbScanner } from "../src/infra/scan/dynamodb";

function mockSend(client: { readonly prototype: unknown }) {
	return spyOn(
		client.prototype as { send(command: unknown): Promise<unknown> },
		"send",
	);
}

function dispatch(handlers: {
	onList?: (start: string | undefined) => unknown;
	onDescribe?: (name: string | undefined) => unknown;
	onTag?: (arn: string | undefined) => unknown;
}) {
	return async (command: unknown): Promise<unknown> => {
		if (command instanceof ListTablesCommand) {
			return handlers.onList?.(command.input?.ExclusiveStartTableName);
		}
		if (command instanceof DescribeTableCommand) {
			return handlers.onDescribe?.(command.input?.TableName);
		}
		if (command instanceof ListTagsOfResourceCommand) {
			return handlers.onTag?.(command.input?.ResourceArn);
		}
		throw new Error("unexpected command");
	};
}

describe("dynamodb scanner", () => {
	let client: DynamoDBClient;
	let send: ReturnType<typeof mockSend>;

	afterEach(() => send?.mockRestore());

	it("reports a table with its arn and pawl tags", async () => {
		client = new DynamoDBClient({ region: "eu-central-1" });
		send = mockSend(DynamoDBClient);
		send.mockImplementation(
			dispatch({
				onList: () => ({
					TableNames: ["platform-dev-orders-table"],
					$metadata: {},
				}),
				onDescribe: (name) => ({
					Table: {
						TableName: name,
						TableArn: "arn:aws:dynamodb:table/orders",
					},
					$metadata: {},
				}),
				onTag: () => ({
					Tags: [{ Key: "team", Value: "platform" }],
					$metadata: {},
				}),
			}),
		);

		const resources = await createDynamoDbScanner(client).scan();

		expect(resources).toEqual([
			{
				service: "dynamodb",
				resourceKind: "AWS::DynamoDB::Table",
				physicalName: "platform-dev-orders-table",
				arn: "arn:aws:dynamodb:table/orders",
				tags: { team: "platform" },
			},
		]);
	});

	it("paginates through ListTables", async () => {
		client = new DynamoDBClient({ region: "eu-central-1" });
		send = mockSend(DynamoDBClient);
		send.mockImplementation(
			dispatch({
				onList: (start) =>
					start === undefined
						? {
								TableNames: ["t-a"],
								LastEvaluatedTableName: "t-a",
								$metadata: {},
							}
						: { TableNames: ["t-b"], $metadata: {} },
				onDescribe: (name) => ({ Table: { TableName: name }, $metadata: {} }),
				onTag: () => ({ Tags: [], $metadata: {} }),
			}),
		);

		const resources = await createDynamoDbScanner(client).scan();

		expect(resources.map((r) => r.physicalName)).toEqual(["t-a", "t-b"]);
	});

	it("keeps a table when its describe or tag read fails", async () => {
		client = new DynamoDBClient({ region: "eu-central-1" });
		send = mockSend(DynamoDBClient);
		send.mockImplementation(
			dispatch({
				onList: () => ({ TableNames: ["t-a"], $metadata: {} }),
				onDescribe: () => {
					throw new Error("AccessDeniedException");
				},
			}),
		);

		const resources = await createDynamoDbScanner(client).scan();

		// The name is still the identity; a missing arn only weakens the claim.
		expect(resources).toEqual([
			{
				service: "dynamodb",
				resourceKind: "AWS::DynamoDB::Table",
				physicalName: "t-a",
				arn: undefined,
				tags: {},
			},
		]);
	});
});
