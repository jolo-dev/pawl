import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
	LambdaClient,
	ListFunctionsCommand,
	ListTagsCommand,
} from "@aws-sdk/client-lambda";
import { createLambdaScanner } from "../src/infra/scan/lambda";

function mockSend(client: { readonly prototype: unknown }) {
	const transport = client.prototype as {
		send(command: unknown): Promise<unknown>;
	};
	return spyOn(transport, "send");
}

const fn = (name: string, arn: string) => ({
	FunctionName: name,
	FunctionArn: arn,
	Runtime: "nodejs24.x",
	MemorySize: 512,
	CodeSize: 1024,
});

/**
 * Dispatch by command type rather than by call order: page reads are sequential
 * but tag reads run concurrently, so a fixed response queue would be flaky.
 */
function dispatch(handlers: {
	onList?: (marker: string | undefined) => unknown;
	onTag?: (resource: string | undefined) => unknown;
}) {
	return async (command: unknown): Promise<unknown> => {
		if (command instanceof ListFunctionsCommand) {
			return handlers.onList?.(command.input?.Marker);
		}
		if (command instanceof ListTagsCommand) {
			return handlers.onTag?.(command.input?.Resource);
		}
		throw new Error(`unexpected command: ${String(command)}`);
	};
}

describe("lambda scanner", () => {
	let client: LambdaClient;
	let send: ReturnType<typeof mockSend>;

	afterEach(() => {
		send?.mockRestore();
	});

	it("reports each function with its arn and pawl tags", async () => {
		client = new LambdaClient({ region: "eu-central-1" });
		send = mockSend(LambdaClient);
		send.mockImplementation(
			dispatch({
				onList: () => ({
					Functions: [
						fn("platform-dev-myapi-lambda", "arn:aws:lambda:fn:myapi"),
					],
					$metadata: {},
				}),
				onTag: () => ({
					Tags: { team: "platform", stage: "dev" },
					$metadata: {},
				}),
			}),
		);

		const resources = await createLambdaScanner(client).scan();

		expect(resources).toEqual([
			{
				service: "lambda",
				resourceKind: "AWS::Lambda::Function",
				physicalName: "platform-dev-myapi-lambda",
				arn: "arn:aws:lambda:fn:myapi",
				tags: { team: "platform", stage: "dev" },
			},
		]);
		const commands = send.mock.calls.map((call) => call[0]);
		expect(commands[0]).toBeInstanceOf(ListFunctionsCommand);
		expect(commands).toContainEqual(expect.any(ListTagsCommand));
	});

	it("paginates until the marker runs out", async () => {
		client = new LambdaClient({ region: "eu-central-1" });
		send = mockSend(LambdaClient);
		send.mockImplementation(
			dispatch({
				onList: (marker) =>
					marker === undefined
						? {
								Functions: [fn("fn-a", "arn:a")],
								NextMarker: "page-2",
								$metadata: {},
							}
						: { Functions: [fn("fn-b", "arn:b")], $metadata: {} },
				onTag: () => ({ Tags: {}, $metadata: {} }),
			}),
		);

		const resources = await createLambdaScanner(client).scan();

		expect(resources.map((r) => r.physicalName)).toEqual(["fn-a", "fn-b"]);
		const listCalls = send.mock.calls
			.map((call) => call[0])
			.filter((command) => command instanceof ListFunctionsCommand);
		expect(listCalls).toHaveLength(2);
		expect(listCalls[1]).toMatchObject({ input: { Marker: "page-2" } });
	});

	it("keeps a function whose tag lookup fails", async () => {
		client = new LambdaClient({ region: "eu-central-1" });
		send = mockSend(LambdaClient);
		send.mockResolvedValueOnce({
			Functions: [fn("platform-dev-myapi-lambda", "arn:aws:lambda:fn:myapi")],
			$metadata: {},
		});
		send.mockRejectedValueOnce(new Error("AccessDeniedException"));

		const resources = await createLambdaScanner(client).scan();

		// Tags are an enhancement, not the identity: losing them must not lose
		// the resource, because pawl pins the name.
		expect(resources).toHaveLength(1);
		expect(resources[0]?.tags).toEqual({});
	});

	it("skips an entry with no name rather than emitting a blank identity", async () => {
		client = new LambdaClient({ region: "eu-central-1" });
		send = mockSend(LambdaClient);
		send.mockResolvedValueOnce({
			Functions: [{ FunctionArn: "arn:aws:lambda:fn:nameless" }],
			$metadata: {},
		});

		expect(await createLambdaScanner(client).scan()).toEqual([]);
	});
});
