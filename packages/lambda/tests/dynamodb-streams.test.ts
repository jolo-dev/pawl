import { describe, expect, it, mock } from "bun:test";
import { Logger } from "@aws-lambda-powertools/logger";
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
		const spy = mock(() => {});

		const handler = useDynamoDbStreamsHandler("dynamodbstreamsTest", spy);
		const _logger = new Logger();
		await handler(event, context, () => {});
		// expect(spy).toBeCalledWith({ ...event, ...logger });
		expect(spy).toHaveBeenCalledTimes(1);
	});
});
