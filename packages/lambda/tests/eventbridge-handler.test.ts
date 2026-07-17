import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import { Logger } from "@aws-lambda-powertools/logger";
import type { EventBridgeEvent } from "aws-lambda";
import { handlerFactory } from "../src/base/handler-factory";
import { useEventbridgeHandler } from "../src/eventbridge-handler";

const infoMock = mock(() => {});
let infoSpy: { mockRestore: () => void };

type TDetailType = "test";
type TDetail = {
	foo: string;
	comment: {
		text: string;
	};
};
type TResult = {
	result: string;
};

type EventbridgeOptions = NonNullable<
	Parameters<typeof useEventbridgeHandler>[2]
>;
// @ts-expect-error Only supported logging modes may be selected.
const invalidLoggingOptions: EventbridgeOptions = { logging: "verbose" };
void invalidLoggingOptions;

const sentinel = "NEVER_LOG_EVENTBRIDGE_DETAIL";
const event: EventBridgeEvent<TDetailType, TDetail> = {
	"detail-type": "test",
	account: "1234",
	detail: {
		foo: "bar",
		comment: {
			text: sentinel,
		},
	},
	id: "event-id",
	region: "us-east-1",
	resources: ["foo", "bar"],
	source: "test.source",
	time: "test",
	version: "1234",
};

const successResult = { result: "bar" };

describe("eventbridge-handler", () => {
	beforeAll(() => {
		infoSpy = spyOn(Logger.prototype, "info").mockImplementation(infoMock);
	});

	afterAll(() => {
		infoSpy.mockRestore();
	});

	it("keeps full-event input logging when options are omitted", async () => {
		const handler = useEventbridgeHandler<TDetailType, TDetail, TResult>(
			"foo",
			async () => successResult,
		);
		const previousCallCount = infoMock.mock.calls.length;

		expect(await handler(event)).toEqual(successResult);
		expect(infoMock.mock.calls).toHaveLength(previousCallCount + 1);
		const inputLogCall = infoMock.mock.calls.at(-1);
		expect(inputLogCall).toEqual(["Processing request", { event }]);
		expect(JSON.stringify(inputLogCall)).toContain(sentinel);
	});

	it("logs the complete event when full logging is explicit", async () => {
		const handler = useEventbridgeHandler<TDetailType, TDetail, TResult>(
			"foo",
			async () => successResult,
			{ logging: "full" },
		);
		const previousCallCount = infoMock.mock.calls.length;

		expect(await handler(event)).toEqual(successResult);
		expect(infoMock.mock.calls).toHaveLength(previousCallCount + 1);
		const inputLogCall = infoMock.mock.calls.at(-1);
		expect(inputLogCall).toEqual(["Processing request", { event }]);
		expect(JSON.stringify(inputLogCall)).toContain(sentinel);
	});

	it("logs exactly the EventBridge envelope metadata without detail", async () => {
		const handler = useEventbridgeHandler<TDetailType, TDetail, TResult>(
			"foo",
			async () => successResult,
			{ logging: "metadata" },
		);
		const previousCallCount = infoMock.mock.calls.length;

		expect(await handler(event)).toEqual(successResult);
		expect(infoMock.mock.calls).toHaveLength(previousCallCount + 1);
		const inputLogCall = infoMock.mock.calls.at(-1);
		expect(inputLogCall).toEqual([
			"Processing request",
			{
				event: {
					id: event.id,
					source: event.source,
					"detail-type": event["detail-type"],
				},
			},
		]);
		expect(JSON.stringify(inputLogCall)).not.toContain(sentinel);
		expect(JSON.stringify(inputLogCall)).not.toContain("comment");
	});

	it("does not emit the built-in input log when logging is none", async () => {
		const handler = useEventbridgeHandler<TDetailType, TDetail, TResult>(
			"foo",
			async () => successResult,
			{ logging: "none" },
		);
		const previousCallCount = infoMock.mock.calls.length;

		expect(await handler(event)).toEqual(successResult);
		expect(infoMock.mock.calls).toHaveLength(previousCallCount);
	});

	for (const logging of ["full", "metadata", "none"] as const) {
		it(`passes the unchanged event and preserves success hook ordering in ${logging} mode`, async () => {
			const calls: string[] = [];
			const handleRequest = mock(
				async (receivedEvent: EventBridgeEvent<TDetailType, TDetail>) => {
					calls.push("handle");
					expect(receivedEvent).toBe(event);
					return { result: "handled" };
				},
			);
			const handler = useEventbridgeHandler<TDetailType, TDetail, TResult>(
				"foo",
				handleRequest,
				{ logging },
			);
			handler.addBeforeHook((receivedEvent) => {
				calls.push("before");
				expect(receivedEvent).toBe(event);
				return receivedEvent;
			});
			handler.addAfterHook((result) => {
				calls.push("after");
				return { result: `${result.result}-after` };
			});

			expect(await handler(event)).toEqual({ result: "handled-after" });
			expect(handleRequest).toHaveBeenCalledTimes(1);
			expect(calls).toEqual(["before", "handle", "after"]);
		});

		it(`passes the unchanged event and preserves error behavior in ${logging} mode`, async () => {
			const calls: string[] = [];
			const failure = new Error("expected failure");
			const handler = useEventbridgeHandler<TDetailType, TDetail, TResult>(
				"foo",
				async (receivedEvent) => {
					calls.push("handle");
					expect(receivedEvent).toBe(event);
					throw failure;
				},
				{ logging },
			);
			handler.addBeforeHook((receivedEvent) => {
				calls.push("before");
				return receivedEvent;
			});
			handler.addErrorHook((error) => {
				calls.push("error");
				expect(error).toBe(failure);
				return { result: "recovered" };
			});

			expect(await handler(event)).toEqual({ result: "recovered" });
			expect(calls).toEqual(["before", "handle", "error"]);
		});
	}

	it("fails clearly when generic metadata logging has no projector", () => {
		expect(() =>
			handlerFactory<EventBridgeEvent<TDetailType, TDetail>, TResult>(
				"foo",
				async () => successResult,
				{ logging: "metadata" },
			),
		).toThrow("metadata");
	});
});
