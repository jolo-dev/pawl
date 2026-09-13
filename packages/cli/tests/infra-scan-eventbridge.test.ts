import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
	EventBridgeClient,
	ListEventBusesCommand,
	ListTagsForResourceCommand,
} from "@aws-sdk/client-eventbridge";
import { createEventBridgeScanner } from "../src/infra/scan/eventbridge";

function mockSend(client: { readonly prototype: unknown }) {
	return spyOn(
		client.prototype as { send(command: unknown): Promise<unknown> },
		"send",
	);
}

describe("eventbridge scanner", () => {
	let client: EventBridgeClient;
	let send: ReturnType<typeof mockSend>;

	afterEach(() => send?.mockRestore());

	it("reports an event bus with its tags", async () => {
		client = new EventBridgeClient({ region: "eu-central-1" });
		send = mockSend(EventBridgeClient);
		send.mockImplementation(async (command: unknown) => {
			if (command instanceof ListEventBusesCommand) {
				return {
					EventBuses: [
						{
							Name: "orders-bus",
							Arn: "arn:aws:events:eu-central-1:1:event-bus/orders-bus",
						},
					],
					$metadata: {},
				};
			}
			if (command instanceof ListTagsForResourceCommand) {
				return { Tags: [{ Key: "team", Value: "platform" }], $metadata: {} };
			}
			throw new Error("unexpected command");
		});

		const resources = await createEventBridgeScanner(client).scan();

		expect(resources).toEqual([
			{
				service: "eventbridge",
				resourceKind: "AWS::Events::EventBus",
				physicalName: "orders-bus",
				arn: "arn:aws:events:eu-central-1:1:event-bus/orders-bus",
				tags: { team: "platform" },
			},
		]);
	});

	it("paginates and keeps a bus whose tag read fails", async () => {
		client = new EventBridgeClient({ region: "eu-central-1" });
		send = mockSend(EventBridgeClient);
		send.mockImplementation(async (command: unknown) => {
			if (command instanceof ListEventBusesCommand) {
				return command.input?.NextToken === undefined
					? {
							EventBuses: [{ Name: "bus-a", Arn: "arn:a" }],
							NextToken: "next",
							$metadata: {},
						}
					: { EventBuses: [{ Name: "bus-b", Arn: "arn:b" }], $metadata: {} };
			}
			throw new Error("AccessDeniedException");
		});

		const resources = await createEventBridgeScanner(client).scan();

		expect(resources.map((r) => r.physicalName)).toEqual(["bus-a", "bus-b"]);
		expect(resources.every((r) => Object.keys(r.tags).length === 0)).toBe(true);
	});

	it("skips an entry with no name", async () => {
		client = new EventBridgeClient({ region: "eu-central-1" });
		send = mockSend(EventBridgeClient);
		send.mockImplementation(async () => ({
			EventBuses: [{ Arn: "arn:only" }],
			$metadata: {},
		}));

		expect(await createEventBridgeScanner(client).scan()).toEqual([]);
	});
});
