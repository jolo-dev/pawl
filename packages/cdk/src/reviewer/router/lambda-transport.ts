import {
	GetDurableExecutionCommand,
	InvokeCommand,
	LambdaClient,
	ListDurableExecutionsByFunctionCommand,
	SendDurableExecutionCallbackSuccessCommand,
} from "@aws-sdk/client-lambda";

export type LambdaCommand =
	| {
			readonly kind: "invoke";
			readonly input: {
				readonly FunctionName: string;
				readonly InvocationType: "Event";
				readonly DurableExecutionName: string;
				readonly Payload: Uint8Array;
				readonly Qualifier?: string;
			};
	  }
	| {
			readonly kind: "list";
			readonly input: {
				readonly FunctionName: string;
				readonly DurableExecutionName: string;
				readonly Qualifier?: string;
			};
	  }
	| {
			readonly kind: "status";
			readonly input: {
				readonly DurableExecutionArn: string;
				readonly IncludeExecutionData: false;
			};
	  }
	| {
			readonly kind: "callback";
			readonly input: {
				readonly CallbackId: string;
				readonly Result: Uint8Array;
			};
	  };

export interface LambdaTransport {
	send(command: LambdaCommand): Promise<unknown>;
}

export class AwsLambdaTransport implements LambdaTransport {
	readonly #client: LambdaClient;
	constructor() {
		this.#client = new LambdaClient({});
	}
	send(command: LambdaCommand): Promise<unknown> {
		switch (command.kind) {
			case "invoke":
				return this.#client.send(new InvokeCommand(command.input));
			case "list":
				return this.#client.send(
					new ListDurableExecutionsByFunctionCommand(command.input),
				);
			case "status":
				return this.#client.send(new GetDurableExecutionCommand(command.input));
			case "callback":
				return this.#client.send(
					new SendDurableExecutionCallbackSuccessCommand(command.input),
				);
		}
	}
}
