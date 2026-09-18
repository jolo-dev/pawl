import {
	Agent,
	type AgentMessage,
	type AgentTool,
	type AgentToolResult,
} from "@earendil-works/pi-agent-core";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
	type Tool,
} from "@earendil-works/pi-ai";
import {
	type ApprovalBinding,
	ApprovalBroker,
	type ApprovalGrant,
} from "./approval";
import {
	type PawlAnswer,
	type PawlConversation,
	type PawlConversationEvent,
	QUEUED_PROMPT_LIMIT,
} from "./conversation";
import type { MutationCoordinator } from "./mutation";
import {
	CONTEXT_LIMIT_CODE,
	createRuntimePolicy,
	type PolicyDependencies,
	PolicyExhaustedError,
	type PolicyRejection,
	type RuntimePolicy,
	truncateToolResult,
} from "./policy";
import { toolIntentDigest } from "./session-record";
import type { SessionStore } from "./session-store";

/**
 * The real Pi-backed implementation of the Pawl conversation boundary.
 *
 * The installed Pi `Agent` (constructed with explicit model, messages, tools
 * and system prompt) runs the loop; this module owns everything around it:
 *
 * - A single awaited subscriber projects Pi events into the Pawl-owned event
 *   union and checkpoints persisted state. Completed assistant messages are
 *   recorded before Pi's preflight barrier lets a tool run; tool results are
 *   recorded when their message ends. A checkpoint failure becomes shared
 *   fatal state and aborts the run — Pi does not propagate listener errors,
 *   so the runtime must not rely on that.
 * - The StreamFn wrapper performs context admission and the shared budget
 *   reservation BEFORE dispatching to the Task 4 stream function (including
 *   the first and restored requests), forwards only an abort signal (the Task
 *   4 wrapper rejects every other option), enforces the per-request timeout
 *   capped by the remaining run budget, and never throws: refusals are encoded
 *   as provider error streams, per Pi's StreamFn contract.
 * - Authorization is executable policy: the preflight hook calls the injected
 *   authorizer (the Task 6 approval broker decides; questions never grant),
 *   and the executor wrapper rechecks the run state, re-reserves the tool
 *   budget immediately before execution, consumes the one-use grant at the
 *   write boundary, syncs the durable tool intent BEFORE any side effect and
 *   bounds model-facing result text with the Task 6 truncation rule.
 * - Tools declared `replay: "never"` (non-recoverable effects) hold the
 *   session-wide mutation permit during execution, acquired after the
 *   authorization decision. Delegation-style tools must not be `replay:
 *   "never"` so a parent never holds the permit across a child delegation.
 * - `send` while idle starts a fresh root-prompt budget (a new Task 6 policy
 *   per accepted prompt); queued prompts are processed serially after
 *   settlement and get their own budgets. Automatic inner calls and approval
 *   answers never create budgets. Exactly one terminal event is emitted per
 *   run after awaited cleanup, durable checkpoints and grant revocation; an
 *   unexpected run rejection still produces that one owned terminal event.
 * - Restored history is passed to the Agent as initial messages; nothing runs
 *   until a new prompt is sent. A context admission failure explains how to
 *   start a new conversation instead of trimming history.
 */

export class PawlRuntimeAgentError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "PawlRuntimeAgentError";
		this.code = code;
	}
}

/** Shared Task 6 budget limits applied to every root and specialist prompt. */
export interface PolicyLimits {
	readonly modelCalls?: number;
	readonly toolExecutions?: number;
	readonly runDeadlineMs?: number;
}

/**
 * The stream function the runtime hands model requests to. It has the same
 * call shape as the Task 4 Bedrock stream function: model, LLM context and an
 * optional abort signal — the runtime forwards only the signal.
 */
export type RuntimeAgentStreamFn = (
	model: Model<Api>,
	context: Context,
	options?: { signal?: AbortSignal | undefined },
) => AssistantMessageEventStream;

export interface ToolAuthorizationRequest {
	readonly runId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	/** Schema-validated (canonical) tool input. */
	readonly input: unknown;
	readonly signal: AbortSignal;
}

export type ToolAuthorization =
	| { readonly granted: false; readonly reason: string }
	| {
			readonly granted: true;
			readonly grant?: ApprovalGrant;
			readonly binding?: ApprovalBinding;
	  };

export type ToolAuthorizer = (
	request: ToolAuthorizationRequest,
) => Promise<ToolAuthorization>;

/** Per-run authorization context handed to the authorizer factory. */
export interface RuntimeRunContext {
	readonly runId: string;
	readonly broker: ApprovalBroker;
	readonly policy: RuntimePolicy;
	/** The run's abort signal; aborted on cancellation, disposal or exhaustion. */
	readonly signal: AbortSignal;
}

export type AuthorizerFactory = (run: RuntimeRunContext) => ToolAuthorizer;

export interface PawlRuntimeAgentOptions {
	readonly id?: string;
	readonly systemPrompt: string;
	readonly model: Model<Api>;
	readonly tools?: readonly AgentTool<Tool["parameters"], unknown>[];
	readonly streamFn: RuntimeAgentStreamFn;
	readonly store: SessionStore;
	/** The session-wide coordinator shared with specialists (Task 12). */
	readonly mutations: MutationCoordinator;
	readonly createAuthorizer: AuthorizerFactory;
	/** Restored model context; nothing runs until the next explicit prompt. */
	readonly initialMessages?: readonly AgentMessage[];
	readonly policyLimits?: PolicyLimits;
	readonly policyDependencies?: Partial<PolicyDependencies>;
	readonly approvalTimeoutMs?: number;
}

interface ActiveRun {
	readonly runId: string;
	readonly policy: RuntimePolicy;
	readonly broker: ApprovalBroker;
	readonly authorizer: ToolAuthorizer;
	/** Cancels this run: settles pending approvals and revokes its grants. */
	readonly abort: AbortController;
	readonly authorizations: Map<
		string,
		{ grant?: ApprovalGrant; binding?: ApprovalBinding }
	>;
	readonly finished: Promise<void>;
	readonly finish: () => void;
	fatal: { code: string; message: string } | undefined;
	exhaustion: PolicyRejection | undefined;
	requestTimedOut: boolean;
	requestTimerClear: (() => void) | undefined;
	lastAssistant: AssistantMessage | undefined;
	settled: boolean;
}

type TerminalEvent = Extract<PawlConversationEvent, { type: "run_terminal" }>;

const CONTEXT_GUIDANCE =
	" History is never trimmed; start a new conversation to continue.";

function failureAssistantMessage(
	model: Model<Api>,
	message: string,
	stopReason: "error" | "aborted",
): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		errorMessage: message,
		timestamp: Date.now(),
	};
}

/** A refusal encoded as a provider error stream; the StreamFn never throws. */
function refusedStream(
	model: Model<Api>,
	message: string,
	reason: "error" | "aborted",
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	stream.push({
		type: "error",
		reason,
		error: failureAssistantMessage(model, message, reason),
	});
	stream.end();
	return stream;
}

function textOfContent(content: unknown): string | undefined {
	if (typeof content !== "object" || content === null) return undefined;
	const items = (content as { content?: unknown }).content;
	if (!Array.isArray(items)) return undefined;
	const parts: string[] = [];
	for (const item of items) {
		if (
			typeof item === "object" &&
			item !== null &&
			(item as { type?: unknown }).type === "text"
		) {
			parts.push(String((item as { text?: unknown }).text ?? ""));
		}
	}
	return parts.join("");
}

/** Bounds model-facing tool result text with the Task 6 truncation rule. */
function boundedResult<T>(result: AgentToolResult<T>): AgentToolResult<T> {
	return {
		...result,
		content: result.content.map((item) =>
			item.type === "text"
				? { type: "text" as const, text: truncateToolResult(item.text).text }
				: item,
		),
	};
}

function classifyRun(run: ActiveRun): TerminalEvent {
	const terminal = (
		outcome: TerminalEvent["outcome"],
		code?: string,
		message?: string,
	): TerminalEvent => ({
		type: "run_terminal",
		runId: run.runId,
		outcome,
		...(code === undefined ? {} : { code }),
		...(message === undefined ? {} : { message }),
	});
	if (run.fatal) {
		return terminal("failed", run.fatal.code, run.fatal.message);
	}
	if (run.requestTimedOut) {
		return terminal(
			"failed",
			"model_request_timeout",
			"The model request exceeded its budget and was cancelled before completion",
		);
	}
	if (run.exhaustion) {
		return terminal(
			"failed",
			run.exhaustion.code,
			run.exhaustion.code === CONTEXT_LIMIT_CODE
				? `${run.exhaustion.message}${CONTEXT_GUIDANCE}`
				: run.exhaustion.message,
		);
	}
	const stop = run.lastAssistant?.stopReason;
	if (stop === "aborted") {
		return terminal("cancelled", "run_cancelled", "The run was cancelled");
	}
	if (stop === "error") {
		return terminal(
			"failed",
			"provider_error",
			run.lastAssistant?.errorMessage ?? "The provider stream failed",
		);
	}
	return terminal("completed");
}

export function createPawlRuntimeConversation(
	options: PawlRuntimeAgentOptions,
): PawlConversation {
	const id = options.id ?? "pawl-pi-conversation";
	const store = options.store;
	const now = options.policyDependencies?.now ?? Date.now;
	const scheduleTimeout: PolicyDependencies["scheduleTimeout"] =
		options.policyDependencies?.scheduleTimeout ??
		((handler, ms) => {
			const timer = setTimeout(handler, ms);
			return () => clearTimeout(timer);
		});

	let disposed = false;
	/** Set when the single consumer subscribed; send refuses before that. */
	let subscribed = false;
	let runCounter = 0;
	let currentRun: ActiveRun | undefined;
	const queued: Array<{ runId: string; text: string }> = [];

	// ---- Owned event queue (single consumer, subscribed before first send) ----

	let iteratorDone = false;
	let waiter:
		| ((result: IteratorResult<PawlConversationEvent>) => void)
		| undefined;
	const pendingEvents: PawlConversationEvent[] = [];
	const emit = (event: PawlConversationEvent): void => {
		if (iteratorDone) return;
		const wake = waiter;
		if (wake) {
			waiter = undefined;
			wake({ value: event, done: false });
			return;
		}
		pendingEvents.push(event);
	};

	const endIterator = (): void => {
		iteratorDone = true;
		const wake = waiter;
		waiter = undefined;
		wake?.({ done: true } as IteratorResult<PawlConversationEvent>);
	};

	// ---- Run creation and settlement ----

	const createRun = (runId: string): ActiveRun => {
		const abort = new AbortController();
		let runRef: ActiveRun | undefined;
		const policy = createRuntimePolicy({
			...(options.policyLimits ?? {}),
			dependencies: { now, scheduleTimeout },
			onExhausted: (rejection) => {
				if (runRef && !runRef.exhaustion) runRef.exhaustion = rejection;
				// Shared cancellation settles pending approvals and provider streams.
				abort.abort(new PolicyExhaustedError(rejection));
			},
		});
		const broker = new ApprovalBroker({
			signal: abort.signal,
			onRequest: (question) => {
				if (!runRef) return;
				emit({
					type: "input_requested",
					runId: runRef.runId,
					request: {
						requestId: question.requestId,
						prompt: question.prompt,
						options: [...question.options],
					},
				});
			},
			now,
			scheduleTimeout,
			...(options.approvalTimeoutMs === undefined
				? {}
				: { timeoutMs: options.approvalTimeoutMs }),
		});
		const authorizer = options.createAuthorizer({
			runId,
			broker,
			policy,
			signal: abort.signal,
		});
		let resolveFinished: () => void = () => {};
		const finished = new Promise<void>((resolve) => {
			resolveFinished = resolve;
		});
		const run: ActiveRun = {
			runId,
			policy,
			broker,
			authorizer,
			abort,
			authorizations: new Map(),
			finished,
			finish: resolveFinished,
			fatal: undefined,
			exhaustion: undefined,
			requestTimedOut: false,
			requestTimerClear: undefined,
			lastAssistant: undefined,
			settled: false,
		};
		runRef = run;
		return run;
	};

	const settleRun = async (run: ActiveRun): Promise<void> => {
		if (run.settled) return;
		run.settled = true;
		run.requestTimerClear?.();
		run.requestTimerClear = undefined;
		if (currentRun === run) currentRun = undefined;
		// Settle pending approvals and revoke un-consumed grants with the run,
		// after awaited cleanup and durable checkpoints.
		run.abort.abort(
			new PawlRuntimeAgentError("run_settled", "The run settled"),
		);
		run.policy.dispose();
		emit(classifyRun(run));
		if (disposed) {
			run.finish();
			return;
		}
		const next = queued.shift();
		if (next) startRun(next.runId, next.text);
		run.finish();
	};

	const startRun = (runId: string, text: string): void => {
		void (async () => {
			let run: ActiveRun | undefined;
			try {
				run = createRun(runId);
				currentRun = run;
				await agent.prompt(text);
				await agent.waitForIdle();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (run) {
					run.fatal ??= { code: "unexpected_failure", message };
				} else {
					emit({
						type: "run_terminal",
						runId,
						outcome: "failed",
						code: "unexpected_failure",
						message,
					});
					return;
				}
			} finally {
				if (run) await settleRun(run);
			}
		})();
	};

	// ---- Guarded stream function (budget + admission before dispatch) ----

	const guardedStreamFn = (
		model: Model<Api>,
		context: Context,
		callerOptions?: SimpleStreamOptions,
	): AssistantMessageEventStream => {
		const run = currentRun;
		if (!run || run.settled) {
			return refusedStream(
				model,
				"No active run owns this model request; it was not dispatched",
				"error",
			);
		}
		if (run.fatal) {
			return refusedStream(model, run.fatal.message, "error");
		}
		const cancelled = run.abort.signal.aborted || run.policy.signal.aborted;
		if (cancelled) {
			return refusedStream(
				model,
				"The run is no longer active; the model request was not dispatched",
				run.exhaustion || run.requestTimedOut ? "error" : "aborted",
			);
		}
		// Context admission and the shared model-call budget are checked here,
		// before every dispatch, including the first and restored requests. The
		// policy strictly validates admission inputs, so only the fields it owns
		// are passed (a full Model object carries unrelated provider metadata).
		const decision = run.policy.checkBeforeModel({
			model: { contextWindow: model.contextWindow, maxTokens: model.maxTokens },
			context,
		});
		if (!decision.allowed) {
			// onExhausted already recorded the rejection for the terminal outcome.
			return refusedStream(model, decision.message, "error");
		}
		const signals: AbortSignal[] = [run.abort.signal, run.policy.signal];
		if (callerOptions?.signal) signals.push(callerOptions.signal);
		let requestTimerClear: (() => void) | undefined;
		const timeoutMs = run.policy.modelRequestTimeoutMs();
		if (timeoutMs > 0) {
			const requestDeadline = new AbortController();
			signals.push(requestDeadline.signal);
			requestTimerClear = scheduleTimeout(() => {
				run.requestTimedOut = true;
				requestDeadline.abort(
					new PawlRuntimeAgentError(
						"model_request_timeout",
						"The model request exceeded its budget",
					),
				);
			}, timeoutMs);
			run.requestTimerClear?.();
			run.requestTimerClear = requestTimerClear;
		}
		// The run and policy signals are always present, so this always combines.
		const signal = AbortSignal.any(signals);
		let inner: AssistantMessageEventStream;
		try {
			inner = options.streamFn(model, context, { signal });
		} catch (error) {
			requestTimerClear?.();
			return refusedStream(
				model,
				error instanceof Error ? error.message : String(error),
				"error",
			);
		}
		// Forward the provider stream and clear this request's timer when it
		// completes, so a stale timer can never misclassify a finished request.
		const outer = createAssistantMessageEventStream();
		void (async () => {
			try {
				for await (const event of inner) {
					outer.push(event);
				}
				outer.end();
			} catch (error) {
				outer.push({
					type: "error",
					reason: "error",
					error: failureAssistantMessage(
						model,
						error instanceof Error ? error.message : String(error),
						"error",
					),
				});
				outer.end();
			} finally {
				requestTimerClear?.();
				if (run.requestTimerClear === requestTimerClear) {
					run.requestTimerClear = undefined;
				}
			}
		})();
		return outer;
	};

	// ---- Guarded tools (authorization preflight, intent before side effect) ----

	const guardTool = (
		tool: AgentTool<Tool["parameters"], unknown>,
	): AgentTool<Tool["parameters"], unknown> => ({
		...tool,
		execute: async (toolCallId, params, signal, onUpdate) => {
			const run = currentRun;
			if (!run || run.settled) {
				throw new PawlRuntimeAgentError(
					"no_active_run",
					"No active run owns this tool execution; refusing to execute",
				);
			}
			if (run.fatal) {
				throw new PawlRuntimeAgentError(
					"run_failed",
					`The run already failed (${run.fatal.code}); no further tool execution`,
				);
			}
			// Shared budget: atomic reservation immediately before execution.
			const decision = run.policy.checkBeforeTool(tool.name);
			if (!decision.allowed) {
				throw new PolicyExhaustedError({
					code: decision.code,
					message: decision.message,
				});
			}
			if (run.abort.signal.aborted) {
				throw new PawlRuntimeAgentError(
					"run_cancelled",
					"The run was cancelled; tool execution refused",
				);
			}
			// Fail-closed recheck: preflight must have authorized this exact call.
			const authorization = run.authorizations.get(toolCallId);
			run.authorizations.delete(toolCallId);
			if (!authorization) {
				throw new PawlRuntimeAgentError(
					"unauthorized",
					`${tool.name} has no recorded preflight authorization; refusing to execute`,
				);
			}
			if (authorization.grant && authorization.binding) {
				// One-use consumption at the actual executor/write boundary.
				const consumption = authorization.grant.consume(authorization.binding);
				if (!consumption.ok) {
					throw new PawlRuntimeAgentError(
						"grant_unusable",
						`The approval grant could not be consumed at the executor boundary: ${consumption.message}`,
					);
				}
			}
			// Durable intent must be synced before any side effect; a failed
			// intent record refuses execution fail-closed (no automatic retry).
			await store.recordToolIntent({
				toolCallId,
				toolName: tool.name,
				digest: toolIntentDigest(params),
			});
			// Non-recoverable effects hold the session-wide mutation permit,
			// acquired after the authorization decision.
			const execute = (): Promise<AgentToolResult<unknown>> =>
				tool.execute(toolCallId, params, signal, onUpdate);
			const result =
				tool.replay === "never"
					? await options.mutations.run(execute, {
							owner: tool.name,
							signal: run.abort.signal,
						})
					: await execute();
			return boundedResult(result);
		},
	});

	const wrappedTools = (options.tools ?? []).map(guardTool);

	const agent = new Agent({
		initialState: {
			systemPrompt: options.systemPrompt,
			model: options.model,
			tools: wrappedTools,
			thinkingLevel: "off",
			...(options.initialMessages
				? { messages: [...options.initialMessages] }
				: {}),
		},
		streamFn: guardedStreamFn,
		toolExecution: "sequential",
		beforeToolCall: async ({ toolCall, args }) => {
			const run = currentRun;
			if (!run || run.settled) {
				return { block: true, reason: "No active run owns this tool call" };
			}
			if (run.fatal) {
				return {
					block: true,
					reason: `The run already failed (${run.fatal.code}); no further tool execution`,
				};
			}
			if (run.policy.signal.aborted) {
				return {
					block: true,
					reason: "The run's execution budget is exhausted or cancelled",
				};
			}
			try {
				const authorization = await run.authorizer({
					runId: run.runId,
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					input: args,
					signal: run.abort.signal,
				});
				if (!authorization.granted) {
					return {
						block: true,
						reason: `${toolCall.name} was not authorized: ${authorization.reason}`,
					};
				}
				run.authorizations.set(toolCall.id, authorization);
				return undefined;
			} catch (error) {
				// The preflight hook must not throw: convert to a blocked result
				// and share cancellation so the run cannot continue.
				const message = error instanceof Error ? error.message : String(error);
				run.fatal ??= { code: "unexpected_failure", message };
				agent.abort();
				run.abort.abort(
					new PawlRuntimeAgentError("unexpected_failure", message),
				);
				return { block: true, reason: message };
			}
		},
	});
	agent.sessionId = store.sessionId;

	// ---- The single awaited subscriber (checkpoint/project boundary) ----

	agent.subscribe(async (event) => {
		const run = currentRun;
		if (!run || run.settled) return; // late or unknown-run events are dropped
		try {
			switch (event.type) {
				case "agent_start":
					emit({ type: "run_started", runId: run.runId });
					break;
				case "message_update": {
					const streamEvent = event.assistantMessageEvent;
					if (streamEvent.type === "text_delta") {
						emit({
							type: "text_delta",
							runId: run.runId,
							delta: streamEvent.delta,
						});
					} else if (streamEvent.type === "thinking_delta") {
						emit({
							type: "reasoning_delta",
							runId: run.runId,
							delta: streamEvent.delta,
						});
					}
					break;
				}
				case "message_end": {
					const message = event.message;
					if (message.role === "assistant") {
						run.lastAssistant = message;
						// Pi treats this awaited listener as a barrier before tool
						// preflight: the completed assistant message is durable first.
						await store.recordMessage(message);
						emit({ type: "message_end", runId: run.runId });
					} else if (message.role === "toolResult") {
						await store.recordMessage(message);
					}
					// user messages are recorded by send().
					break;
				}
				case "tool_execution_start":
					emit({
						type: "tool_started",
						runId: run.runId,
						toolCallId: event.toolCallId,
						toolName: event.toolName,
					});
					break;
				case "tool_execution_update": {
					const text = textOfContent(event.partialResult);
					if (text) {
						emit({
							type: "tool_update",
							runId: run.runId,
							toolCallId: event.toolCallId,
							text,
						});
					}
					break;
				}
				case "tool_execution_end": {
					const text = textOfContent(event.result);
					emit({
						type: "tool_result",
						runId: run.runId,
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						status: event.isError ? "error" : "completed",
						...(text ? { text } : {}),
					});
					break;
				}
				default:
					// turn_start/turn_end/agent_end are inner lifecycle, never UI events.
					break;
			}
		} catch (error) {
			// Checkpoint/persistence failure: shared fatal state + abort. Pi does
			// not propagate listener errors, so the runtime must not rely on it.
			const message = error instanceof Error ? error.message : String(error);
			if (!run.fatal) {
				run.fatal = { code: "checkpoint_failed", message };
			}
			agent.abort();
			run.abort.abort(new PawlRuntimeAgentError("checkpoint_failed", message));
			try {
				// The outcome is unknown/interrupted; never retried automatically.
				await store.recordInterrupted({
					reason: "checkpoint_failed",
					text: "",
				});
			} catch {
				// The store is likely poisoned; the terminal outcome records it.
			}
		}
	});

	// ---- Public conversation ----

	const send = async (text: string): Promise<{ runId: string }> => {
		if (disposed) {
			throw new PawlRuntimeAgentError("disposed", "The conversation is closed");
		}
		if (!subscribed) {
			throw new PawlRuntimeAgentError(
				"not_subscribed",
				"Subscribe via events() before the first send so no event is lost",
			);
		}
		if (text.trim().length === 0) {
			throw new PawlRuntimeAgentError(
				"empty_input",
				"An empty prompt is not a conversation input",
			);
		}
		// send accepts and persists the input; it never awaits model completion.
		if (currentRun && !currentRun.settled) {
			if (queued.length >= QUEUED_PROMPT_LIMIT) {
				throw new PawlRuntimeAgentError(
					"queue_full",
					`The in-memory prompt queue is full (${QUEUED_PROMPT_LIMIT} queued); wait for the active run to settle`,
				);
			}
			const runId = `run_${++runCounter}`;
			await store.recordMessage({
				role: "user",
				content: text,
				timestamp: Date.now(),
			});
			queued.push({ runId, text });
			emit({ type: "user_message", runId, text, queued: true });
			return { runId };
		}
		const runId = `run_${++runCounter}`;
		await store.recordMessage({
			role: "user",
			content: text,
			timestamp: Date.now(),
		});
		emit({ type: "user_message", runId, text, queued: false });
		startRun(runId, text);
		return { runId };
	};

	const answer = async (answer: PawlAnswer): Promise<void> => {
		if (disposed) {
			throw new PawlRuntimeAgentError("disposed", "The conversation is closed");
		}
		const run = currentRun;
		if (!run) {
			throw new PawlRuntimeAgentError(
				"no_pending_request",
				"There is no active run waiting for an answer",
			);
		}
		// One-use answer for a live pending request; stale/unknown answers reject.
		await run.broker.answer(answer);
		emit({
			type: "input_resolved",
			runId: run.runId,
			requestId: answer.requestId,
		});
	};

	const cancel = async (runId?: string): Promise<void> => {
		if (disposed) {
			throw new PawlRuntimeAgentError("disposed", "The conversation is closed");
		}
		const cancelRun = (target: ActiveRun): void => {
			target.abort.abort(
				new PawlRuntimeAgentError("run_cancelled", "The run was cancelled"),
			);
		};
		if (runId !== undefined) {
			const queuedIndex = queued.findIndex((entry) => entry.runId === runId);
			if (queuedIndex >= 0) {
				queued.splice(queuedIndex, 1);
				emit({ type: "prompt_discarded", runId });
				return;
			}
			if (currentRun && currentRun.runId === runId) cancelRun(currentRun);
			// An unknown run id has nothing to cancel.
			return;
		}
		// Cancel everything active: queued prompts are discarded on cancel.
		for (const entry of queued.splice(0)) {
			emit({ type: "prompt_discarded", runId: entry.runId });
		}
		if (currentRun && !currentRun.settled) cancelRun(currentRun);
	};

	const events = (): AsyncIterable<PawlConversationEvent> => {
		if (subscribed) {
			throw new PawlRuntimeAgentError(
				"already_subscribed",
				"A single event consumer must subscribe via events(); a second subscription is not supported",
			);
		}
		subscribed = true;
		async function* pump(): AsyncGenerator<PawlConversationEvent> {
			while (true) {
				const next = pendingEvents.shift();
				if (next) {
					yield next;
					continue;
				}
				if (iteratorDone) return;
				const result = await new Promise<IteratorResult<PawlConversationEvent>>(
					(resolve) => {
						waiter = resolve;
					},
				);
				if (result.done) return;
				yield result.value;
			}
		}
		return pump();
	};

	const dispose = async (): Promise<void> => {
		if (disposed) return;
		disposed = true;
		queued.length = 0;
		endIterator(); // late events after disposal are not delivered
		const run = currentRun;
		if (run && !run.settled) {
			run.abort.abort(
				new PawlRuntimeAgentError("disposed", "The conversation was disposed"),
			);
			await run.finished;
		}
		await store.close();
	};

	return {
		id,
		send,
		answer,
		cancel,
		events,
		dispose,
	};
}
