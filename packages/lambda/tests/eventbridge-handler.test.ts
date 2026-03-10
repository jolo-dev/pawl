import { describe, expect, it } from "vitest";
import { useEventbridgeHandler } from "../src/eventbridge-handler";

type TDetailType = "test";
type TDetail = {
	foo: string;
};
type TResult = {
	result: string;
};

describe("eventbridge-handler", () => {
	it("should check the validity of handler", async () => {
		const bar = "bar";
		const handler = useEventbridgeHandler<TDetailType, TDetail, TResult>(
			"foo",
			async () => {
				return {
					result: bar,
				};
			},
		);

		const result = await handler({
			"detail-type": "test",
			account: "1234",
			detail: {
				foo: "bar",
			},
			id: "foo",
			region: "us-east-1",
			resources: ["foo", "bar"],
			source: "test",
			time: "test",
			version: "1234",
		});

		expect(result).toHaveProperty("result", bar);
	});
});
