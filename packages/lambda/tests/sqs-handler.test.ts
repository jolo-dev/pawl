import { describe, expect, it, mock } from "bun:test";
import { useSqsHandler } from "../src/sqs-handler";

describe("sqs-handler", () => {
	const event = require("./sqs-event.json");
	const context = require("./context.json");

	it("should call the handler with sqs event", async () => {
		const spy = mock(() => {});
		const handler = useSqsHandler("foo", spy);

		await handler(event, context, () => {});

		expect(spy).toHaveBeenCalledTimes(1);
	});
});
