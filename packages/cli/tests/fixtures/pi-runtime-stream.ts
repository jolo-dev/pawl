import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type ToolCall,
	type Usage,
} from "@earendil-works/pi-ai";

/**
 * Deterministic public `AssistantMessageEventStream` fixtures for the Task 10
 * Pi Agent integration tests.
 *
 * Every fixture is offline: no network, no personal Pi state, no timing
 * sleeps. Streams that can stay open (barriers, aborts) are resolved through
 * explicit handles or the caller's abort signal, never through timers. The
 * shapes follow the installed pi-ai 0.85.1 event protocol: `start` first,
 * partials growing through `*_delta`, termination with `done` or `error`.
 */

export const FIXTURE_MODEL: Model<"bedrock-converse-stream"> = {
	id: "fixture.model-v1:0",
	name: "Fixture Model",
	api: "bedrock-converse-stream",
	provider: "amazon-bedrock",
	baseUrl: "",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 4096,
};

function fixtureUsage(): Usage {
	return {
		input: 11,
		output: 7,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 18,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function assistantMessage(
	overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "bedrock-converse-stream",
		provider: "amazon-bedrock",
		model: FIXTURE_MODEL.id,
		usage: fixtureUsage(),
		stopReason: "pending",
		timestamp: 5_000,
		...overrides,
	};
}

function textPartial(text: string): AssistantMessage {
	return assistantMessage({ content: [{ type: "text", text }] });
}

/** One dispatched model request as observed by the fixture stream function. */
export interface FixtureRequest {
	readonly model: Model<Api>;
	readonly context: Context;
	readonly signal: AbortSignal | undefined;
}

/**
 * A fixture stream factory with the same call shape the runtime gives the
 * Task 4 Bedrock stream function: model, LLM context and an optional abort
 * signal (the runtime wrapper forwards only the signal).
 */
export type FixtureStreamFactory = (
	request: FixtureRequest,
) => AssistantMessageEventStream;

/** The stream function shape the runtime accepts (`Agent`-compatible). */
export type FixtureStreamFn = (
	model: Model<Api>,
	context: Context,
	options?: { signal?: AbortSignal | undefined },
) => AssistantMessageEventStream;

function abortPromise(signal: AbortSignal | undefined): Promise<void> {
	if (!signal) return new Promise(() => {});
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		signal.addEventListener("abort", () => resolve(), { once: true });
	});
}

function pushAborted(stream: AssistantMessageEventStream): void {
	stream.push({
		type: "error",
		reason: "aborted",
		error: assistantMessage({
			stopReason: "aborted",
			errorMessage: "Fixture stream aborted",
		}),
	});
	stream.end();
}

/** Plain streamed reply. Chunks must concatenate to `text`. */
export function textStream(
	text: string,
	chunks?: readonly string[],
): AssistantMessageEventStream {
	const parts = chunks ?? [text];
	if (parts.join("") !== text) {
		throw new Error("Fixture chunks must concatenate to the full text");
	}
	const stream = createAssistantMessageEventStream();
	stream.push({ type: "start", partial: assistantMessage() });
	let accumulated = "";
	for (const part of parts) {
		accumulated += part;
		stream.push({
			type: "text_delta",
			contentIndex: 0,
			delta: part,
			partial: textPartial(accumulated),
		});
	}
	stream.push({
		type: "text_end",
		contentIndex: 0,
		content: text,
		partial: textPartial(text),
	});
	stream.push({
		type: "done",
		reason: "stop",
		message: assistantMessage({
			content: [{ type: "text", text }],
			stopReason: "stop",
		}),
	});
	stream.end();
	return stream;
}

/** Reasoning block first, then the visible reply (medium-reasoning shape). */
export function reasoningTextStream(
	thinking: string,
	text: string,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	stream.push({ type: "start", partial: assistantMessage() });
	stream.push({
		type: "thinking_start",
		contentIndex: 0,
		partial: assistantMessage({
			content: [{ type: "thinking", thinking: "" }],
		}),
	});
	stream.push({
		type: "thinking_delta",
		contentIndex: 0,
		delta: thinking,
		partial: assistantMessage({
			content: [{ type: "thinking", thinking }],
		}),
	});
	stream.push({
		type: "thinking_end",
		contentIndex: 0,
		content: thinking,
		partial: assistantMessage({
			content: [{ type: "thinking", thinking }],
		}),
	});
	stream.push({
		type: "text_start",
		contentIndex: 1,
		partial: assistantMessage({
			content: [
				{ type: "thinking", thinking },
				{ type: "text", text: "" },
			],
		}),
	});
	stream.push({
		type: "text_delta",
		contentIndex: 1,
		delta: text,
		partial: assistantMessage({
			content: [
				{ type: "thinking", thinking },
				{ type: "text", text },
			],
		}),
	});
	stream.push({
		type: "done",
		reason: "stop",
		message: assistantMessage({
			content: [
				{ type: "thinking", thinking },
				{ type: "text", text },
			],
			stopReason: "stop",
		}),
	});
	stream.end();
	return stream;
}

/** One or more tool calls in a single assistant message (toolUse stop). */
export function toolCallStream(
	calls: readonly ToolCall[],
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	stream.push({ type: "start", partial: assistantMessage() });
	const content: AssistantMessage["content"] = [];
	calls.forEach((call, contentIndex) => {
		content.push({ ...call, arguments: {} });
		stream.push({
			type: "toolcall_start",
			contentIndex,
			partial: assistantMessage({ content: [...content] }),
		});
		const argsJson = JSON.stringify(call.arguments);
		content[contentIndex] = { ...call };
		stream.push({
			type: "toolcall_delta",
			contentIndex,
			delta: argsJson,
			partial: assistantMessage({ content: [...content] }),
		});
		stream.push({
			type: "toolcall_end",
			contentIndex,
			toolCall: call,
			partial: assistantMessage({ content: [...content] }),
		});
	});
	stream.push({
		type: "done",
		reason: "toolUse",
		message: assistantMessage({ content, stopReason: "toolUse" }),
	});
	stream.end();
	return stream;
}

/** Provider failure: protocol start, then a terminal error event. */
export function providerErrorStream(
	message: string,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	stream.push({ type: "start", partial: assistantMessage() });
	stream.push({
		type: "error",
		reason: "error",
		error: assistantMessage({
			stopReason: "error",
			errorMessage: message,
		}),
	});
	stream.end();
	return stream;
}

/**
 * Protocol violations: a text delta before `start` and an unknown event type
 * are dropped by the installed loop; the run must still complete normally.
 */
export function malformedStream(text: string): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	stream.push({
		type: "text_delta",
		contentIndex: 0,
		delta: "ORPHAN",
		partial: assistantMessage(),
	} as AssistantMessageEvent);
	stream.push({
		type: "unknown_vendor_event",
	} as unknown as AssistantMessageEvent);
	stream.push({ type: "start", partial: assistantMessage() });
	stream.push({
		type: "text_delta",
		contentIndex: 0,
		delta: text,
		partial: textPartial(text),
	});
	stream.push({
		type: "text_end",
		contentIndex: 0,
		content: text,
		partial: textPartial(text),
	});
	stream.push({
		type: "done",
		reason: "stop",
		message: assistantMessage({
			content: [{ type: "text", text }],
			stopReason: "stop",
		}),
	});
	stream.end();
	return stream;
}

/**
 * A reply whose completion is deferred until `release()` — or the run's abort
 * signal, so a cancelled run always settles. The returned promise resolves
 * when the barrier was passed, giving tests a deterministic wait point.
 */
export function barrierTextStream(text: string): {
	factory: FixtureStreamFactory;
	release(): void;
	passed: Promise<void>;
} {
	let passRelease: () => void;
	const gate = new Promise<void>((resolve) => {
		passRelease = resolve;
	});
	let signalPass: (() => void) | undefined;
	const passed = new Promise<void>((resolve) => {
		signalPass = resolve;
	});
	const factory: FixtureStreamFactory = ({ signal }) => {
		const stream = createAssistantMessageEventStream();
		void (async () => {
			stream.push({ type: "start", partial: assistantMessage() });
			stream.push({
				type: "text_delta",
				contentIndex: 0,
				delta: text,
				partial: textPartial(text),
			});
			const abort = abortPromise(signal);
			abort.then(
				() => {
					signalPass?.();
				},
				() => {},
			);
			const winner = await Promise.race([
				gate.then(() => "release" as const),
				abort.then(() => "abort" as const),
			]);
			if (winner === "abort") {
				pushAborted(stream);
				return;
			}
			stream.push({
				type: "text_end",
				contentIndex: 0,
				content: text,
				partial: textPartial(text),
			});
			stream.push({
				type: "done",
				reason: "stop",
				message: assistantMessage({
					content: [{ type: "text", text }],
					stopReason: "stop",
				}),
			});
			stream.end();
		})();
		return stream;
	};
	return {
		factory,
		release: () => passRelease(),
		passed,
	};
}

/**
 * A stream that emits its text only after the caller's abort signal fires,
 * then terminates as aborted. Proves cancellation settles a waiting provider
 * stream without timing sleeps.
 */
export function abortedStreamFactory(text: string): FixtureStreamFactory {
	return ({ signal }) => {
		const stream = createAssistantMessageEventStream();
		void (async () => {
			stream.push({ type: "start", partial: assistantMessage() });
			stream.push({
				type: "text_delta",
				contentIndex: 0,
				delta: text,
				partial: textPartial(text),
			});
			await abortPromise(signal);
			if (signal?.aborted) {
				pushAborted(stream);
				return;
			}
			// No signal was supplied: fail closed instead of hanging forever.
			stream.push({
				type: "error",
				reason: "error",
				error: assistantMessage({
					stopReason: "error",
					errorMessage: "Fixture stream requires an abort signal",
				}),
			});
			stream.end();
		})();
		return stream;
	};
}

/**
 * A scripted stream function: each model request consumes the next factory;
 * an unexpected extra request fails closed as a provider error instead of
 * blocking the loop. Every dispatch is recorded for assertions.
 */
export function scriptedStreamFn(script: readonly FixtureStreamFactory[]): {
	streamFn: FixtureStreamFn;
	requests: FixtureRequest[];
} {
	const requests: FixtureRequest[] = [];
	let index = 0;
	const streamFn: FixtureStreamFn = (model, context, options) => {
		const request: FixtureRequest = {
			model,
			context,
			signal: options?.signal,
		};
		requests.push(request);
		const factory = script[index];
		index += 1;
		if (!factory) {
			return providerErrorStream(
				`Unexpected model request ${index}; the fixture script is exhausted`,
			);
		}
		return factory(request);
	};
	return { streamFn, requests };
}
