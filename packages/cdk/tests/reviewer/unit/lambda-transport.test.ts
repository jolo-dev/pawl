import { expect, mock, test } from "bun:test";
import type { LambdaCommand } from "../../../src/reviewer/router/lambda-transport";

const sent: unknown[] = [];

class TestCommand {
	constructor(readonly input: unknown) {}
}
class InvokeCommand extends TestCommand {}
class ListDurableExecutionsByFunctionCommand extends TestCommand {}
class GetDurableExecutionCommand extends TestCommand {}
class SendDurableExecutionCallbackSuccessCommand extends TestCommand {}

mock.module("@aws-sdk/client-lambda", () => ({
	LambdaClient: class {
		send(command: unknown): Promise<unknown> {
			sent.push(command);
			return Promise.resolve({ accepted: true });
		}
	},
	InvokeCommand,
	ListDurableExecutionsByFunctionCommand,
	GetDurableExecutionCommand,
	SendDurableExecutionCallbackSuccessCommand,
}));

const { AwsLambdaTransport } = await import(
	"../../../src/reviewer/router/lambda-transport"
);

test("maps every transport command to its AWS SDK command without changing input", async () => {
	sent.length = 0;
	const payload = new Uint8Array([1, 2, 3]);
	const result = new Uint8Array([4, 5, 6]);
	const commands = [
		{
			kind: "invoke",
			input: {
				FunctionName: "reviewer",
				InvocationType: "Event",
				DurableExecutionName: "execution",
				Payload: payload,
				Qualifier: "live",
			},
		},
		{
			kind: "list",
			input: {
				FunctionName: "reviewer",
				DurableExecutionName: "execution",
			},
		},
		{
			kind: "status",
			input: {
				DurableExecutionArn: "arn:execution",
				IncludeExecutionData: false,
			},
		},
		{
			kind: "callback",
			input: {
				CallbackId: "callback",
				Result: result,
			},
		},
	] satisfies LambdaCommand[];

	const transport = new AwsLambdaTransport();
	await Promise.all(commands.map((command) => transport.send(command)));

	expect(sent).toEqual([
		new InvokeCommand(commands[0].input),
		new ListDurableExecutionsByFunctionCommand(commands[1].input),
		new GetDurableExecutionCommand(commands[2].input),
		new SendDurableExecutionCallbackSuccessCommand(commands[3].input),
	]);
});
