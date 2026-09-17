import { APIGatewayClient } from "@aws-sdk/client-api-gateway";
import { ApiGatewayV2Client } from "@aws-sdk/client-apigatewayv2";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import type {
	HttpHandlerOptions,
	HttpRequest,
	HttpResponse,
} from "@smithy/core/protocols";
import {
	createApiGatewayScanner,
	createApiGatewayV1Scanner,
} from "../infra/scan/apigateway";
import { createDynamoDbScanner } from "../infra/scan/dynamodb";
import { createEventBridgeScanner } from "../infra/scan/eventbridge";
import { createLambdaScanner } from "../infra/scan/lambda";
import { createS3Scanner } from "../infra/scan/s3";
import { createSqsScanner } from "../infra/scan/sqs";
import type { ScannerFactory } from "../infra/scan/types";
import {
	createCheckedSdkExecutor,
	type SdkExecutionContext,
} from "./checked-sdk";

/** Offline transport injection; never an alternate credential/endpoint source. */
export interface ProofScanRequestHandler {
	handle(
		request: HttpRequest,
		options?: HttpHandlerOptions,
	): Promise<{ response: HttpResponse }>;
}

export function createCheckedLambdaClient(
	context: SdkExecutionContext,
	requestHandler?: ProofScanRequestHandler,
	operationSignal?: AbortSignal,
): Pick<LambdaClient, "send"> {
	const execute = createCheckedSdkExecutor(
		context,
		(config) =>
			new LambdaClient({
				...config,
				...(requestHandler ? { requestHandler } : {}),
			}),
		(client, guard) => {
			client.middlewareStack.add(
				(next) => async (args) => {
					await guard();
					return next(args);
				},
				{ step: "deserialize", priority: "low", name: "pawlCheckedTransport" },
			);
		},
		operationSignal,
	);
	const send: LambdaClient["send"] = (
		command,
		optionsOrCallback?,
		callback?,
	) => {
		const options =
			typeof optionsOrCallback === "function" ? undefined : optionsOrCallback;
		const result = execute(
			(client, signal) =>
				client.send(command, { ...options, abortSignal: signal }),
			options?.abortSignal,
		);
		const cb =
			typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
		if (typeof cb === "function")
			void result.then(
				(output) => cb(null, output),
				(error: unknown) => cb(error),
			);
		return result;
	};
	return { send };
}

export function createCheckedApiGatewayClient(
	context: SdkExecutionContext,
	requestHandler?: ProofScanRequestHandler,
	operationSignal?: AbortSignal,
): Pick<ApiGatewayV2Client, "send"> {
	const execute = createCheckedSdkExecutor(
		context,
		(config) =>
			new ApiGatewayV2Client({
				...config,
				...(requestHandler ? { requestHandler } : {}),
			}),
		(client, guard) => {
			client.middlewareStack.add(
				(next) => async (args) => {
					await guard();
					return next(args);
				},
				{ step: "deserialize", priority: "low", name: "pawlCheckedTransport" },
			);
		},
		operationSignal,
	);
	const send: ApiGatewayV2Client["send"] = (
		command,
		optionsOrCallback?,
		callback?,
	) => {
		const options =
			typeof optionsOrCallback === "function" ? undefined : optionsOrCallback;
		const result = execute(
			(client, signal) =>
				client.send(command, { ...options, abortSignal: signal }),
			options?.abortSignal,
		);
		const cb =
			typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
		if (typeof cb === "function")
			void result.then(
				(output) => cb(null, output),
				(error: unknown) => cb(error),
			);
		return result;
	};
	return { send };
}

export function createCheckedApiGatewayV1Client(
	context: SdkExecutionContext,
	requestHandler?: ProofScanRequestHandler,
	operationSignal?: AbortSignal,
): Pick<APIGatewayClient, "send"> {
	const execute = createCheckedSdkExecutor(
		context,
		(config) =>
			new APIGatewayClient({
				...config,
				...(requestHandler ? { requestHandler } : {}),
			}),
		(client, guard) => {
			client.middlewareStack.add(
				(next) => async (args) => {
					await guard();
					return next(args);
				},
				{ step: "deserialize", priority: "low", name: "pawlCheckedTransport" },
			);
		},
		operationSignal,
	);
	const send: APIGatewayClient["send"] = (
		command,
		optionsOrCallback?,
		callback?,
	) => {
		const options =
			typeof optionsOrCallback === "function" ? undefined : optionsOrCallback;
		const result = execute(
			(client, signal) =>
				client.send(command, { ...options, abortSignal: signal }),
			options?.abortSignal,
		);
		const cb =
			typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
		if (typeof cb === "function")
			void result.then(
				(output) => cb(null, output),
				(error: unknown) => cb(error),
			);
		return result;
	};
	return { send };
}

export function createCheckedDynamoDbClient(
	context: SdkExecutionContext,
	requestHandler?: ProofScanRequestHandler,
	operationSignal?: AbortSignal,
): Pick<DynamoDBClient, "send"> {
	const execute = createCheckedSdkExecutor(
		context,
		(config) =>
			new DynamoDBClient({
				...config,
				...(requestHandler ? { requestHandler } : {}),
			}),
		(client, guard) => {
			client.middlewareStack.add(
				(next) => async (args) => {
					await guard();
					return next(args);
				},
				{ step: "deserialize", priority: "low", name: "pawlCheckedTransport" },
			);
		},
		operationSignal,
	);
	const send: DynamoDBClient["send"] = (
		command,
		optionsOrCallback?,
		callback?,
	) => {
		const options =
			typeof optionsOrCallback === "function" ? undefined : optionsOrCallback;
		const result = execute(
			(client, signal) =>
				client.send(command, { ...options, abortSignal: signal }),
			options?.abortSignal,
		);
		const cb =
			typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
		if (typeof cb === "function")
			void result.then(
				(output) => cb(null, output),
				(error: unknown) => cb(error),
			);
		return result;
	};
	return { send };
}

export function createCheckedSqsClient(
	context: SdkExecutionContext,
	requestHandler?: ProofScanRequestHandler,
	operationSignal?: AbortSignal,
): Pick<SQSClient, "send"> {
	const execute = createCheckedSdkExecutor(
		context,
		(config) =>
			new SQSClient({
				...config,
				...(requestHandler ? { requestHandler } : {}),
			}),
		(client, guard) => {
			client.middlewareStack.add(
				(next) => async (args) => {
					await guard();
					return next(args);
				},
				{ step: "deserialize", priority: "low", name: "pawlCheckedTransport" },
			);
		},
		operationSignal,
	);
	const send: SQSClient["send"] = (command, optionsOrCallback?, callback?) => {
		const options =
			typeof optionsOrCallback === "function" ? undefined : optionsOrCallback;
		const result = execute(
			(client, signal) =>
				client.send(command, { ...options, abortSignal: signal }),
			options?.abortSignal,
		);
		const cb =
			typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
		if (typeof cb === "function")
			void result.then(
				(output) => cb(null, output),
				(error: unknown) => cb(error),
			);
		return result;
	};
	return { send };
}

export function createCheckedS3Client(
	context: SdkExecutionContext,
	requestHandler?: ProofScanRequestHandler,
	operationSignal?: AbortSignal,
): Pick<S3Client, "send"> {
	const execute = createCheckedSdkExecutor(
		context,
		(config) =>
			new S3Client({
				...config,
				...(requestHandler ? { requestHandler } : {}),
			}),
		(client, guard) => {
			client.middlewareStack.add(
				(next) => async (args) => {
					await guard();
					return next(args);
				},
				{ step: "deserialize", priority: "low", name: "pawlCheckedTransport" },
			);
		},
		operationSignal,
	);
	const send: S3Client["send"] = (command, optionsOrCallback?, callback?) => {
		const options =
			typeof optionsOrCallback === "function" ? undefined : optionsOrCallback;
		const result = execute(
			(client, signal) =>
				client.send(command, { ...options, abortSignal: signal }),
			options?.abortSignal,
		);
		const cb =
			typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
		if (typeof cb === "function")
			void result.then(
				(output) => cb(null, output),
				(error: unknown) => cb(error),
			);
		return result;
	};
	return { send };
}

export function createCheckedEventBridgeClient(
	context: SdkExecutionContext,
	requestHandler?: ProofScanRequestHandler,
	operationSignal?: AbortSignal,
): Pick<EventBridgeClient, "send"> {
	const execute = createCheckedSdkExecutor(
		context,
		(config) =>
			new EventBridgeClient({
				...config,
				...(requestHandler ? { requestHandler } : {}),
			}),
		(client, guard) => {
			client.middlewareStack.add(
				(next) => async (args) => {
					await guard();
					return next(args);
				},
				{ step: "deserialize", priority: "low", name: "pawlCheckedTransport" },
			);
		},
		operationSignal,
	);
	const send: EventBridgeClient["send"] = (
		command,
		optionsOrCallback?,
		callback?,
	) => {
		const options =
			typeof optionsOrCallback === "function" ? undefined : optionsOrCallback;
		const result = execute(
			(client, signal) =>
				client.send(command, { ...options, abortSignal: signal }),
			options?.abortSignal,
		);
		const cb =
			typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
		if (typeof cb === "function")
			void result.then(
				(output) => cb(null, output),
				(error: unknown) => cb(error),
			);
		return result;
	};
	return { send };
}

/** Service-local send types avoid mixing the installed SDKs' different Smithy versions.
 * Pagination, resource interpretation and production factories remain unchanged. */
export function createCheckedScannerFactories(
	context: SdkExecutionContext,
	signal: AbortSignal,
	requestHandler?: ProofScanRequestHandler,
): readonly ScannerFactory[] {
	return [
		() =>
			createLambdaScanner(
				createCheckedLambdaClient(context, requestHandler, signal),
			),
		() =>
			createApiGatewayScanner(
				createCheckedApiGatewayClient(context, requestHandler, signal),
				context.region,
			),
		() =>
			createApiGatewayV1Scanner(
				createCheckedApiGatewayV1Client(context, requestHandler, signal),
				context.region,
			),
		() =>
			createDynamoDbScanner(
				createCheckedDynamoDbClient(context, requestHandler, signal),
			),
		() =>
			createSqsScanner(createCheckedSqsClient(context, requestHandler, signal)),
		() =>
			createS3Scanner(createCheckedS3Client(context, requestHandler, signal)),
		() =>
			createEventBridgeScanner(
				createCheckedEventBridgeClient(context, requestHandler, signal),
			),
	];
}
