import { describe, expect, it, mock } from "bun:test";
import type { DynamoDBBatchResponse } from "aws-lambda";
import { useDynamoDbStreamsHandler } from "../src/dynamodb-streams-handler";

describe("dynamodb-streams", () => {
	const event = require("./dynamodb-streams-event.json");
	const context = require("./context.json");

	it("should check the validity of handler", async () => {
		const spy = mock(async () => undefined);

		const handler = useDynamoDbStreamsHandler("dynamodbstreamsTest", spy);
		await handler(event, context, () => {});
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("accepts an async callback that returns void or a batch response", async () => {
		let returnBatchResponse = false;
		const spy = mock(async (): Promise<undefined | DynamoDBBatchResponse> => {
			if (returnBatchResponse) {
				return { batchItemFailures: [] };
			}
		});
		const handler = useDynamoDbStreamsHandler("dynamodbstreamsTest", spy);

		expect(await handler(event, context, () => {})).toBeUndefined();

		returnBatchResponse = true;
		expect(await handler(event, context, () => {})).toEqual({
			batchItemFailures: [],
		});
		expect(spy).toHaveBeenCalledTimes(2);
	});
});
