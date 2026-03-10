import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Logger } from "@aws-lambda-powertools/logger";
import { useSqsHandler } from "../src/sqs-handler";

mock.module("@aws-lambda-powertools/logger", () => ({
	Logger: mock(() => ({
		info: mock(() => {}),
	})),
}));

describe("sqs-handler", () => {
	const event = require("./sqs-event.json");
	const context = require("./context.json");

	let _mockLogger: Logger;

	beforeEach(() => {
		_mockLogger = new Logger({ serviceName: "foo" });
	});

	it("should call the handler with sqs event", async () => {
		const spy = mock(() => {});
		const handler = useSqsHandler("foo", spy);

		await handler(event, context, () => {});

		expect(spy).toHaveBeenCalledTimes(1);
	});
});
