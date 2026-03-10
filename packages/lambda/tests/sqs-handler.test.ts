import { Logger } from "@aws-lambda-powertools/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSqsHandler } from "../src/sqs-handler";

vi.mock("@aws-lambda-powertools/logger", () => ({
	Logger: vi.fn().mockImplementation(() => ({
		info: vi.fn(),
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
		const spy = vi.fn();
		const handler = useSqsHandler("foo", spy);

		await handler(event, context, () => {});

		expect(spy).toBeCalledTimes(1);
	});
});
