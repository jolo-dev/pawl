import { describe, expect, it, mock } from "bun:test";
import { Logger } from "@aws-lambda-powertools/logger";
import type { DynamoDBBatchResponse } from "aws-lambda";
import { useDynamoDbStreamsHandler } from "../src/dynamodb-streams-handler";

mock.module("@aws-lambda-powertools/logger", () => ({
	Logger: mock(() => ({
		info: mock(() => {}),
	})),
}));

describe("dynamodb-streams", () => {
	const event = require("./dynamodb-streams-event.json");
	const context = require("./context.json");

	it("should check the validity of handler", async () => {
		const spy = mock(async () => undefined);

		const handler = useDynamoDbStreamsHandler("dynamodbstreamsTest", spy);
		const _logger = new Logger();
		await handler(event, context, () => {});
		// expect(spy).toBeCalledWith({ ...event, ...logger });
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("accepts an async callback that returns void or a batch response", async () => {
		let returnBatchResponse = false;
		const spy = mock(
			async (): Promise<void | DynamoDBBatchResponse> => {
				if (returnBatchResponse) {
					return { batchItemFailures: [] };
				}
			},
		);
		const handler = useDynamoDbStreamsHandler("dynamodbstreamsTest", spy);

		expect(await handler(event, context, () => {})).toBeUndefined();

		returnBatchResponse = true;
		expect(await handler(event, context, () => {})).toEqual({
			batchItemFailures: [],
		});
		expect(spy).toHaveBeenCalledTimes(2);
	});
});
