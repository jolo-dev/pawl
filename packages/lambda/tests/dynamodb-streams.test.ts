import { Logger } from "@aws-lambda-powertools/logger";
import { describe, expect, it, vi } from "vitest";
import { useDynamoDbStreamsHandler } from "../src/dynamodb-streams-handler";

vi.mock("@aws-lambda-powertools/logger", () => ({
	Logger: vi.fn().mockImplementation(() => ({
		info: vi.fn(),
	})),
}));

describe("dynamodb-streams", () => {
	const event = require("./dynamodb-streams-event.json");
	const context = require("./context.json");

	it("should check the validity of handler", async () => {
		const spy = vi.fn();

		const handler = useDynamoDbStreamsHandler("dynamodbstreamsTest", spy);
		const _logger = new Logger();
		await handler(event, context, () => {});
		// expect(spy).toBeCalledWith({ ...event, ...logger });
		expect(spy).toBeCalledTimes(1);
	});
});
