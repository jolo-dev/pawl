import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
	GetQueueAttributesCommand,
	ListQueuesCommand,
	ListQueueTagsCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import { createSqsScanner } from "../src/infra/scan/sqs";

function mockSend(client: { readonly prototype: unknown }) {
	return spyOn(
		client.prototype as { send(command: unknown): Promise<unknown> },
		"send",
	);
}

function dispatch(handlers: {
	onList?: (token: string | undefined) => unknown;
	onAttributes?: (url: string | undefined) => unknown;
	onTags?: (url: string | undefined) => unknown;
}) {
	return async (command: unknown): Promise<unknown> => {
		if (command instanceof ListQueuesCommand) {
			return handlers.onList?.(command.input?.NextToken);
		}
		if (command instanceof GetQueueAttributesCommand) {
			return handlers.onAttributes?.(command.input?.QueueUrl);
		}
		if (command instanceof ListQueueTagsCommand) {
			return handlers.onTags?.(command.input?.QueueUrl);
		}
		throw new Error("unexpected command");
	};
}

describe("sqs scanner", () => {
	let client: SQSClient;
	let send: ReturnType<typeof mockSend>;

	afterEach(() => send?.mockRestore());

	it("derives the queue name from the url and reports its arn", async () => {
		client = new SQSClient({ region: "eu-central-1" });
		send = mockSend(SQSClient);
		send.mockImplementation(
			dispatch({
				onList: () => ({
					QueueUrls: [
						"https://sqs.eu-central-1.amazonaws.com/123456789012/platform-dev-orders-sqs",
					],
					$metadata: {},
				}),
				onAttributes: () => ({
					Attributes: { QueueArn: "arn:aws:sqs:eu-central-1:1:orders" },
					$metadata: {},
				}),
				onTags: () => ({ Tags: { team: "platform" }, $metadata: {} }),
			}),
		);

		const resources = await createSqsScanner(client).scan();

		expect(resources).toEqual([
			{
				service: "sqs",
				resourceKind: "AWS::SQS::Queue",
				physicalName: "platform-dev-orders-sqs",
				arn: "arn:aws:sqs:eu-central-1:1:orders",
				tags: { team: "platform" },
			},
		]);
	});

	it("paginates through ListQueues", async () => {
		client = new SQSClient({ region: "eu-central-1" });
		send = mockSend(SQSClient);
		send.mockImplementation(
			dispatch({
				onList: (token) =>
					token === undefined
						? {
								QueueUrls: ["https://sqs/q-a"],
								NextToken: "next",
								$metadata: {},
							}
						: { QueueUrls: ["https://sqs/q-b"], $metadata: {} },
				onAttributes: () => ({ Attributes: {}, $metadata: {} }),
				onTags: () => ({ Tags: {}, $metadata: {} }),
			}),
		);

		const resources = await createSqsScanner(client).scan();

		expect(resources.map((r) => r.physicalName)).toEqual(["q-a", "q-b"]);
	});

	it("keeps a queue when its attribute or tag read fails", async () => {
		client = new SQSClient({ region: "eu-central-1" });
		send = mockSend(SQSClient);
		send.mockImplementation(
			dispatch({
				onList: () => ({ QueueUrls: ["https://sqs/q-a"], $metadata: {} }),
				onAttributes: () => {
					throw new Error("AccessDeniedException");
				},
			}),
		);

		const resources = await createSqsScanner(client).scan();

		expect(resources).toEqual([
			{
				service: "sqs",
				resourceKind: "AWS::SQS::Queue",
				physicalName: "q-a",
				arn: undefined,
				tags: {},
			},
		]);
	});
});
