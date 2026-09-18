import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { Api, Model, Tool } from "@earendil-works/pi-ai";
import { z } from "zod";
import {
	type AuthorizerFactory,
	createPawlRuntimeConversation,
	type PolicyLimits,
	type RuntimeAgentStreamFn,
} from "../src/pi-runtime/agent";
import type { ApprovalBinding } from "../src/pi-runtime/approval";
import type {
	PawlConversation,
	PawlConversationEvent,
} from "../src/pi-runtime/conversation";
import { createMutationCoordinator } from "../src/pi-runtime/mutation";
import type { PolicyDependencies } from "../src/pi-runtime/policy";
import {
	INITIAL_CONVERSATION_STATE,
	reduceConversationEvent,
} from "../src/pi-runtime/reducer";
import {
	parseSessionLog,
	recoverSessionContext,
	type SessionRecord,
	toolIntentDigest,
} from "../src/pi-runtime/session-record";
import {
	createSessionStore,
	type SessionMetadata,
	type SessionStore,
} from "../src/pi-runtime/session-store";
import { definePawlTool } from "../src/pi-runtime/tool-schema";
import {
	abortedStreamFactory,
	barrierTextStream,
	FIXTURE_MODEL,
	type FixtureStreamFactory,
	malformedStream,
	providerErrorStream,
	reasoningTextStream,
	scriptedStreamFn,
	textStream,
	toolCallStream,
} from "./fixtures/pi-runtime-stream";

/**
 * Task 10 integration tests: the real installed Pi `Agent` runs the loop
 * behind the Pawl-owned conversation; only the provider streams (deterministic
 * fixtures) and the injected authorizer are offline stand-ins. Persistence
 * uses the real Task 8 session store against a private fixture project.
 */

const identity = {
	accountId: "123456789012",
	region: "eu-central-1",
	principalArn: "arn:aws:iam::123456789012:user/proof",
};

const sessionModel = { id: "eu.amazon.nova-2-lite-v1:0", name: "Nova 2 Lite" };

const metadata = (sessionId: string, projectPath: string): SessionMetadata => ({
	sessionId,
	projectPath,
	identity,
	model: sessionModel,
});

type Timeline = string[];

interface StoreFailures {
	failMessageAtCall(callNumber: number): void;
	failIntents(): void;
}

function instrumentedStore(
	real: SessionStore,
	timeline: Timeline,
): { store: SessionStore; failures: StoreFailures } {
	let failingMessageCall: number | undefined;
	let messageCalls = 0;
	let failIntents = false;
	const store: SessionStore = {
		sessionId: real.sessionId,
		path: real.path,
		header: real.header,
		get uncertain() {
			return real.uncertain;
		},
		async recordMessage(message) {
			messageCalls += 1;
			const role = (message as { role?: unknown }).role;
			timeline.push(`record:${String(role)}`);
			if (failingMessageCall === messageCalls) {
				throw new Error("injected message-record failure");
			}
			await real.recordMessage(message);
		},
		async recordToolIntent(intent) {
			timeline.push(`intent:${intent.toolName}`);
			if (failIntents) {
				throw new Error("injected intent failure");
			}
			await real.recordToolIntent(intent);
		},
		async recordInterrupted(entry) {
			await real.recordInterrupted(entry);
		},
		async close() {
			await real.close();
		},
	};
	return {
		store,
		failures: {
			failMessageAtCall: (callNumber) => {
				failingMessageCall = callNumber;
			},
			failIntents: () => {
				failIntents = true;
			},
		},
	};
}

function echoTool(
	timeline: Timeline,
	executions: Array<{ toolCallId: string; input: unknown }>,
) {
	return definePawlTool({
		name: "echo",
		label: "Echo",
		description: "Echoes its text input back to the model",
		executionMode: "sequential",
		replay: "safe",
		schema: z.strictObject({ text: z.string() }),
		execute: async (toolCallId, input, _signal, onUpdate) => {
			timeline.push(`execute:${toolCallId}`);
			executions.push({ toolCallId, input });
			onUpdate?.({
				content: [{ type: "text", text: "echo working" }],
				details: {},
			});
			return {
				content: [{ type: "text", text: `echo:${input.text}` }],
				details: {},
			};
		},
	});
}

const allowAuthorizer =
	(timeline: Timeline): AuthorizerFactory =>
	() =>
	async (request) => {
		timeline.push(`authorize:${request.toolName}`);
		return { granted: true };
	};

function approvalAuthorizer(
	projectDir: string,
	timeline: Timeline,
): AuthorizerFactory {
	return (run) => async (request) => {
		timeline.push(`authorize:${request.toolName}`);
		const binding: ApprovalBinding = {
			runId: run.runId,
			toolCallId: request.toolCallId,
			toolName: request.toolName,
			input: request.input,
			planDigest: "fixture-plan-digest",
			projectDir,
			identity: { accountId: identity.accountId, region: identity.region },
			previewComplete: true,
		};
		const outcome = await run.broker.request(binding);
		if (outcome.granted) {
			return { granted: true, grant: outcome.grant, binding };
		}
		return { granted: false, reason: outcome.message };
	};
}

function throwingAuthorizer(): AuthorizerFactory {
	return () => {
		throw new Error("authorizer wiring exploded");
	};
}

interface Collector {
	readonly events: PawlConversationEvent[];
	readonly ended: boolean;
	terminals(): PawlConversationEvent[];
	waitFor(
		predicate: (event: PawlConversationEvent) => boolean,
	): Promise<PawlConversationEvent>;
}

function collectEvents(conversation: PawlConversation): Collector {
	const events: PawlConversationEvent[] = [];
	let ended = false;
	const waiters: Array<{
		predicate: (event: PawlConversationEvent) => boolean;
		resolve: (event: PawlConversationEvent) => void;
	}> = [];
	void (async () => {
		try {
			for await (const event of conversation.events()) {
				events.push(event);
				for (let index = waiters.length - 1; index >= 0; index -= 1) {
					const waiter = waiters[index];
					if (waiter?.predicate(event)) {
						waiters.splice(index, 1);
						waiter.resolve(event);
					}
				}
			}
		} catch {
			// The iterator ends on disposal; collectors never fail tests here.
		} finally {
			ended = true;
		}
	})();
	return {
		events,
		get ended() {
			return ended;
		},
		terminals: () => events.filter((event) => event.type === "run_terminal"),
		waitFor: async (predicate) => {
			// Waits only for FUTURE events: an already-observed event must never
			// satisfy a later wait (that would hide ordering regressions).
			const cursor = events.length;
			return new Promise<PawlConversationEvent>((resolve) => {
				waiters.push({
					predicate: (event) => {
						const sinceCursor = events.indexOf(event) >= cursor;
						return sinceCursor && predicate(event);
					},
					resolve,
				});
			});
		},
	};
}

const flush = async (): Promise<void> => {
	for (let index = 0; index < 10; index += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
};

interface HarnessOptions {
	script?: readonly FixtureStreamFactory[];
	tools?: readonly AgentTool<Tool["parameters"], unknown>[];
	authorizer?: AuthorizerFactory;
	initialMessages?: readonly AgentMessage[];
	limits?: PolicyLimits;
	policyDependencies?: Partial<PolicyDependencies>;
	approvalTimeoutMs?: number;
	model?: Model<Api>;
	projectDir?: string;
	mutations?: ReturnType<typeof createMutationCoordinator>;
	subscribe?: boolean;
}

interface Harness {
	conversation: PawlConversation;
	projectDir: string;
	store: SessionStore;
	requests: ReturnType<typeof scriptedStreamFn>["requests"];
	executions: Array<{ toolCallId: string; input: unknown }>;
	timeline: Timeline;
	mutations: ReturnType<typeof createMutationCoordinator>;
	failures: StoreFailures;
	collected: Collector | null;
}

async function makeHarness(options: HarnessOptions = {}): Promise<Harness> {
	const projectDir =
		options.projectDir ?? (await mkdtemp(join(tmpdir(), "pawl-agent-proof-")));
	const realStore = await createSessionStore(metadata("s1", projectDir), {});
	const timeline: Timeline = [];
	const { store, failures } = instrumentedStore(realStore, timeline);
	const scripted = scriptedStreamFn(
		options.script ?? [() => textStream("fixture reply")],
	);
	const executions: Array<{ toolCallId: string; input: unknown }> = [];
	const mutations = options.mutations ?? createMutationCoordinator();
	const conversation = createPawlRuntimeConversation({
		id: "conv_proof",
		systemPrompt: "Pawl proof system prompt",
		model: options.model ?? FIXTURE_MODEL,
		tools: [...(options.tools ?? [echoTool(timeline, executions)])],
		streamFn: scripted.streamFn as RuntimeAgentStreamFn,
		store,
		mutations,
		createAuthorizer: options.authorizer ?? allowAuthorizer(timeline),
		...(options.initialMessages
			? { initialMessages: [...options.initialMessages] }
			: {}),
		...(options.limits ? { policyLimits: options.limits } : {}),
		...(options.policyDependencies
			? { policyDependencies: options.policyDependencies }
			: {}),
		...(options.approvalTimeoutMs !== undefined
			? { approvalTimeoutMs: options.approvalTimeoutMs }
			: {}),
	});
	const collected =
		options.subscribe === false ? null : collectEvents(conversation);
	return {
		conversation,
		projectDir,
		store: realStore,
		requests: scripted.requests,
		executions,
		timeline,
		mutations,
		failures,
		collected,
	};
}

const cleanupDirs: string[] = [];
const activeHarnesses: Harness[] = [];

afterEach(async () => {
	for (const harness of activeHarnesses.splice(0)) {
		await harness.conversation.dispose().catch(() => {});
	}
	for (const dir of cleanupDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

async function tracked(harness: Harness): Promise<Harness> {
	cleanupDirs.push(harness.projectDir);
	activeHarnesses.push(harness);
	return harness;
}

async function recordsOf(store: SessionStore) {
	return parseSessionLog(await readFile(store.path, "utf8"));
}

function messageRole(record: SessionRecord): string | undefined {
	return record.kind === "message" ? record.message.role : undefined;
}

function lastAssistantStop(log: {
	records: readonly SessionRecord[];
}): string | undefined {
	const assistants = log.records.filter(
		(record) => messageRole(record) === "assistant",
	);
	const last = assistants.at(-1);
	return last?.kind === "message" && last.message.role === "assistant"
		? last.message.stopReason
		: undefined;
}

function toolCall(id: string, input: Record<string, unknown>, name = "echo") {
	return { type: "toolCall" as const, id, name, arguments: input };
}

describe("pi runtime agent conversation", () => {
	test("send requires a subscribed event consumer first", async () => {
		const harness = await tracked(await makeHarness({ subscribe: false }));
		await expect(harness.conversation.send("hello")).rejects.toThrow(
			/subscribe/i,
		);
	});

	test("streams a plain reply, persists history and emits exactly one terminal", async () => {
		const harness = await tracked(
			await makeHarness({
				script: [
					() =>
						textStream("Hello from the fixture", [
							"Hello ",
							"from the fixture",
						]),
				],
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		const { runId } = await harness.conversation.send("hi there");
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		expect(terminal.runId).toBe(runId);
		if (terminal.type !== "run_terminal") return;
		expect(terminal.outcome).toBe("completed");
		expect(terminal.code).toBeUndefined();

		const types = collector.events.map((event) => event.type);
		expect(types[0]).toBe("user_message");
		expect(types).toContain("run_started");
		expect(types).toContain("text_delta");
		expect(types).toContain("message_end");
		expect(collector.terminals()).toHaveLength(1);
		await flush();
		expect(collector.events.at(-1)?.type).toBe("run_terminal");

		const deltas = collector.events
			.filter((event) => event.type === "text_delta")
			.map((event) => (event.type === "text_delta" ? event.delta : ""))
			.join("");
		expect(deltas).toBe("Hello from the fixture");

		const log = await recordsOf(harness.store);
		expect(log.records.map((record) => record.kind)).toEqual([
			"message",
			"message",
		]);
		const roles = log.records.map(messageRole);
		expect(roles).toEqual(["user", "assistant"]);
		expect(lastAssistantStop(log)).toBe("stop");
	});

	test("maps reasoning deltas before text deltas", async () => {
		const harness = await tracked(
			await makeHarness({
				script: [() => reasoningTextStream("quiet thinking", "visible answer")],
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("think");
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		expect(terminal.type === "run_terminal" && terminal.outcome).toBe(
			"completed",
		);
		const kinds = collector.events
			.filter(
				(event) =>
					event.type === "reasoning_delta" || event.type === "text_delta",
			)
			.map((event) => event.type);
		expect(kinds).toEqual(["reasoning_delta", "text_delta"]);
	});

	test("executes a tool batch behind synced intent with persisted results", async () => {
		const harness = await tracked(
			await makeHarness({
				script: [
					() => toolCallStream([toolCall("call_1", { text: "a" })]),
					() => textStream("done"),
				],
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("use the tool");
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		expect(terminal.type === "run_terminal" && terminal.outcome).toBe(
			"completed",
		);
		expect(harness.executions).toEqual([
			{ toolCallId: "call_1", input: { text: "a" } },
		]);

		const toolEvents = collector.events.filter(
			(event) =>
				event.type === "tool_started" ||
				event.type === "tool_update" ||
				event.type === "tool_result",
		);
		expect(toolEvents.map((event) => event.type)).toEqual([
			"tool_started",
			"tool_update",
			"tool_result",
		]);
		const started = toolEvents[0];
		if (started?.type === "tool_started") {
			expect(started.toolCallId).toBe("call_1");
			expect(started.toolName).toBe("echo");
		}
		const result = toolEvents[2];
		if (result?.type === "tool_result") {
			expect(result.status).toBe("completed");
			expect(result.text).toBe("echo:a");
		}

		const order = harness.timeline;
		expect(order.indexOf("record:assistant")).toBeLessThan(
			order.indexOf("authorize:echo"),
		);
		expect(order.indexOf("authorize:echo")).toBeLessThan(
			order.indexOf("intent:echo"),
		);
		expect(order.indexOf("intent:echo")).toBeLessThan(
			order.indexOf("execute:call_1"),
		);

		const log = await recordsOf(harness.store);
		const kinds = log.records.map((record) => record.kind);
		const intentIndex = kinds.indexOf("tool_intent");
		expect(intentIndex).toBeGreaterThanOrEqual(0);
		const intent = log.records[intentIndex];
		if (intent?.kind === "tool_intent") {
			expect(intent.toolCallId).toBe("call_1");
			expect(intent.digest).toBe(toolIntentDigest({ text: "a" }));
		}
		const messageIndices = kinds
			.map((kind, index) => (kind === "message" ? index : -1))
			.filter((index) => index >= 0);
		const toolResultIndex = messageIndices.find((index) => {
			const record = log.records[index];
			return record?.kind === "message" && record.message.role === "toolResult";
		});
		expect(toolResultIndex).toBeDefined();
		// The synced intent record precedes the persisted tool result record.
		expect(intentIndex).toBeLessThan(toolResultIndex ?? -1);
	});

	test("keeps the run busy across Pi inner turns", async () => {
		const barrier = barrierTextStream("second turn reply");
		const harness = await tracked(
			await makeHarness({
				script: [
					() => toolCallStream([toolCall("call_b", { text: "b" })]),
					barrier.factory,
				],
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("run with tools");
		await collector.waitFor((event) => event.type === "tool_result");
		// Between the tool batch and the follow-up model reply the run is still
		// busy: an inner turn never becomes an application terminal event.
		const midRun = collector.events.reduce(
			reduceConversationEvent,
			INITIAL_CONVERSATION_STATE,
		);
		expect(midRun.busy).toBe(true);
		expect(midRun.activeRunIds).toHaveLength(1);
		expect(collector.terminals()).toHaveLength(0);
		barrier.release();
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		expect(terminal.type === "run_terminal" && terminal.outcome).toBe(
			"completed",
		);
		const settled = collector.events.reduce(
			reduceConversationEvent,
			INITIAL_CONVERSATION_STATE,
		);
		expect(settled.busy).toBe(false);
		expect(settled.activeRunIds).toHaveLength(0);
	});

	test("restores history without running anything until a new prompt", async () => {
		const priorDir = await mkdtemp(join(tmpdir(), "pawl-agent-prior-"));
		cleanupDirs.push(priorDir);
		const prior = await createSessionStore(metadata("s0", priorDir), {});
		await prior.recordMessage({
			role: "user",
			content: "earlier question",
			timestamp: 1000,
		});
		await prior.recordMessage({
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "call_old",
					name: "echo",
					arguments: { text: "old" },
				},
			],
			api: "bedrock-converse-stream",
			provider: "amazon-bedrock",
			model: sessionModel.id,
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: 2000,
		});
		await prior.recordMessage({
			role: "toolResult",
			toolCallId: "call_old",
			toolName: "echo",
			content: [{ type: "text", text: "echo:old" }],
			isError: false,
			timestamp: 3000,
		});
		await prior.close();
		const parsed = parseSessionLog(await readFile(prior.path, "utf8"));
		const recovered = recoverSessionContext(parsed.records);

		const harness = await tracked(
			await makeHarness({
				initialMessages: recovered.modelContext as unknown as AgentMessage[],
				script: [() => textStream("fresh reply")],
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await flush();
		expect(harness.requests).toHaveLength(0);
		expect(harness.executions).toHaveLength(0);
		expect(collector.events).toHaveLength(0);

		await harness.conversation.send("new prompt");
		await collector.waitFor((event) => event.type === "run_terminal");
		expect(harness.requests).toHaveLength(1);
		const roles = harness.requests[0]?.context.messages.map(
			(message) => message.role,
		);
		expect(roles).toEqual(["user", "assistant", "toolResult", "user"]);
	});

	test("fails the first request on context admission with new-conversation guidance", async () => {
		const harness = await tracked(
			await makeHarness({
				model: { ...FIXTURE_MODEL, contextWindow: 400, maxTokens: 64 },
				script: [() => textStream("never")],
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("hello");
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		if (terminal.type !== "run_terminal") return;
		expect(terminal.outcome).toBe("failed");
		expect(terminal.code).toBe("context_limit");
		expect(terminal.message ?? "").toMatch(/new conversation/);
		expect(harness.requests).toHaveLength(0);
	});

	test("ignores malformed protocol events and still completes", async () => {
		const harness = await tracked(
			await makeHarness({ script: [() => malformedStream("clean text")] }),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("go");
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		expect(terminal.type === "run_terminal" && terminal.outcome).toBe(
			"completed",
		);
		const text = collector.events
			.filter((event) => event.type === "text_delta")
			.map((event) => (event.type === "text_delta" ? event.delta : ""))
			.join("");
		expect(text).toBe("clean text");
	});

	test("maps provider errors to one failed terminal and persists the failure", async () => {
		const harness = await tracked(
			await makeHarness({
				script: [() => providerErrorStream("provider exploded")],
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("go");
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		if (terminal.type !== "run_terminal") return;
		expect(terminal.outcome).toBe("failed");
		expect(terminal.code).toBe("provider_error");
		expect(terminal.message ?? "").toMatch(/provider exploded/);
		const log = await recordsOf(harness.store);
		expect(lastAssistantStop(log)).toBe("error");
	});

	test("a failed checkpoint subscriber aborts further work with one terminal", async () => {
		const harness = await tracked(
			await makeHarness({
				script: [
					() => toolCallStream([toolCall("call_f", { text: "f" })]),
					() => textStream("never"),
				],
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("go");
		// Record 1 is the user message; record 2 is the assistant checkpoint.
		harness.failures.failMessageAtCall(2);
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		if (terminal.type !== "run_terminal") return;
		expect(terminal.outcome).toBe("failed");
		expect(terminal.code).toBe("checkpoint_failed");
		expect(harness.executions).toHaveLength(0);
		expect(harness.requests).toHaveLength(1);
		expect(collector.terminals()).toHaveLength(1);
	});

	test("a failed result persistence after execution fails the run without retry", async () => {
		const harness = await tracked(
			await makeHarness({
				script: [
					() => toolCallStream([toolCall("call_p", { text: "p" })]),
					() => textStream("after"),
				],
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("go");
		// user=1, assistant=2, toolResult=3: the executed result record fails.
		harness.failures.failMessageAtCall(3);
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		if (terminal.type !== "run_terminal") return;
		expect(terminal.outcome).toBe("failed");
		expect(terminal.code).toBe("checkpoint_failed");
		expect(harness.executions).toHaveLength(1);
	});

	test("a failed intent sync prevents the side effect", async () => {
		const harness = await tracked(
			await makeHarness({
				script: [
					() => toolCallStream([toolCall("call_i", { text: "i" })]),
					() => textStream("after denial"),
				],
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		harness.failures.failIntents();
		await harness.conversation.send("go");
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		expect(terminal.type === "run_terminal" && terminal.outcome).toBe(
			"completed",
		);
		expect(harness.executions).toHaveLength(0);
		const toolResult = collector.events.find(
			(event) => event.type === "tool_result",
		);
		if (toolResult?.type === "tool_result") {
			expect(toolResult.status).toBe("error");
			expect(toolResult.text ?? "").toMatch(/intent/i);
		}
	});

	test("runs queued prompts serially with their own budgets", async () => {
		const barrier = barrierTextStream("first run");
		const harness = await tracked(
			await makeHarness({
				script: [
					barrier.factory,
					() => textStream("second"),
					() => textStream("third"),
				],
				limits: { modelCalls: 1 },
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		const first = await harness.conversation.send("one");
		const second = await harness.conversation.send("two");
		const third = await harness.conversation.send("three");
		await collector.waitFor(
			(event) =>
				event.type === "user_message" &&
				event.queued &&
				event.runId === third.runId,
		);
		const queued = collector.events.filter(
			(event) => event.type === "user_message" && event.queued,
		);
		expect(queued).toHaveLength(2);
		barrier.release();
		for (const run of [first, second, third]) {
			const terminal = await collector.waitFor(
				(event) => event.type === "run_terminal" && event.runId === run.runId,
			);
			expect(terminal.type === "run_terminal" && terminal.outcome).toBe(
				"completed",
			);
		}
		expect(harness.requests).toHaveLength(3);
		expect(collector.terminals()).toHaveLength(3);
	});

	test("rejects sends beyond the queued prompt limit and discards them on cancel", async () => {
		const barrier = barrierTextStream("held");
		const harness = await tracked(
			await makeHarness({ script: [barrier.factory] }),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("active");
		for (let index = 0; index < 8; index += 1) {
			await harness.conversation.send(`queued ${index}`);
		}
		await expect(harness.conversation.send("one too many")).rejects.toThrow(
			/queued/i,
		);
		await harness.conversation.cancel();
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		expect(terminal.type === "run_terminal" && terminal.outcome).toBe(
			"cancelled",
		);
		const discarded = collector.events.filter(
			(event) => event.type === "prompt_discarded",
		);
		expect(discarded).toHaveLength(8);
		expect(harness.requests).toHaveLength(1);
	});

	test("tool execution budget refuses the second executor and stops the run", async () => {
		const harness = await tracked(
			await makeHarness({
				script: [
					() =>
						toolCallStream([
							toolCall("call_1", { text: "one" }),
							toolCall("call_2", { text: "two" }),
						]),
					() => textStream("wrapped up"),
				],
				limits: { toolExecutions: 1 },
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("two tools");
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		// Task 6's cross-kind rule: once any budget is exhausted the run fails;
		// no further model request may start either.
		if (terminal.type !== "run_terminal") return;
		expect(terminal.outcome).toBe("failed");
		expect(terminal.code).toBe("tool_execution_budget");
		expect(harness.executions).toHaveLength(1);
		expect(harness.requests).toHaveLength(1);
		const results = collector.events.filter(
			(event) => event.type === "tool_result",
		);
		expect(results).toHaveLength(2);
		const statuses = results.map(
			(event) => event.type === "tool_result" && event.status,
		);
		expect(statuses).toEqual(["completed", "error"]);
		const second = results[1];
		if (second?.type === "tool_result") {
			expect(second.text ?? "").toMatch(/budget/);
		}
	});

	test("model call budget prevents the follow-up request", async () => {
		const harness = await tracked(
			await makeHarness({
				script: [
					() => toolCallStream([toolCall("call_m", { text: "m" })]),
					() => textStream("never"),
				],
				limits: { modelCalls: 1 },
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("go");
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		if (terminal.type !== "run_terminal") return;
		expect(terminal.outcome).toBe("failed");
		expect(terminal.code).toBe("model_call_budget");
		expect(harness.requests).toHaveLength(1);
		expect(harness.executions).toHaveLength(1);
	});

	test("the run deadline stops a held run before further dispatch", async () => {
		const scheduled: Array<{ ms: number; fire: () => void }> = [];
		const harness = await tracked(
			await makeHarness({
				script: [barrierTextStream("held").factory],
				limits: { runDeadlineMs: 1_000 },
				policyDependencies: {
					now: () => 0,
					scheduleTimeout: (handler, ms) => {
						scheduled.push({ ms, fire: () => handler() });
						return () => {};
					},
				},
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("go");
		expect(scheduled.length).toBeGreaterThan(0);
		scheduled[0]?.fire();
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		if (terminal.type !== "run_terminal") return;
		expect(terminal.outcome).toBe("failed");
		expect(terminal.code).toBe("run_deadline");
		expect(harness.requests).toHaveLength(0);
	});

	test("the model request timeout fails the run without hanging", async () => {
		const barrier = barrierTextStream("held");
		const scheduled: Array<{ ms: number; fire: () => void }> = [];
		const harness = await tracked(
			await makeHarness({
				script: [barrier.factory],
				limits: { runDeadlineMs: 30_000 },
				policyDependencies: {
					now: () => 0,
					scheduleTimeout: (handler, ms) => {
						scheduled.push({ ms, fire: () => handler() });
						return () => {};
					},
				},
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("go");
		await collector.waitFor((event) => event.type === "text_delta");
		// scheduled[0] is the run-deadline timer; the next is the request timer.
		const requestTimeout = scheduled[1];
		expect(requestTimeout).toBeDefined();
		requestTimeout?.fire();
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		if (terminal.type !== "run_terminal") return;
		expect(terminal.outcome).toBe("failed");
		expect(terminal.code).toBe("model_request_timeout");
	});

	test("approval gates execution and an explicit approve runs the tool once", async () => {
		const projectDir = await mkdtemp(join(tmpdir(), "pawl-agent-approve-"));
		cleanupDirs.push(projectDir);
		const timeline: Timeline = [];
		const harness = await tracked(
			await makeHarness({
				projectDir,
				script: [
					() => toolCallStream([toolCall("call_a", { text: "a" })]),
					() => textStream("approved and done"),
				],
				authorizer: approvalAuthorizer(projectDir, timeline),
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("mutate");
		const request = await collector.waitFor(
			(event) => event.type === "input_requested",
		);
		const requestId =
			request.type === "input_requested" ? request.request.requestId : "";
		// Unknown answers reject without resolving the request.
		await expect(
			harness.conversation.answer({
				requestId: "nope",
				choice: { kind: "option", value: "approve" },
			}),
		).rejects.toThrow();
		expect(harness.executions).toHaveLength(0);
		await harness.conversation.answer({
			requestId,
			choice: { kind: "option", value: "approve" },
		});
		const result = await collector.waitFor(
			(event) => event.type === "tool_result",
		);
		expect(result.type === "tool_result" && result.status).toBe("completed");
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		expect(terminal.type === "run_terminal" && terminal.outcome).toBe(
			"completed",
		);
		expect(harness.executions).toHaveLength(1);
		const resolved = collector.events.find(
			(event) => event.type === "input_resolved",
		);
		expect(resolved?.type === "input_resolved" && resolved.requestId).toBe(
			requestId,
		);
	});

	test("denial blocks the side effect", async () => {
		const projectDir = await mkdtemp(join(tmpdir(), "pawl-agent-deny-"));
		cleanupDirs.push(projectDir);
		const timeline: Timeline = [];
		const harness = await tracked(
			await makeHarness({
				projectDir,
				script: [
					() => toolCallStream([toolCall("call_d", { text: "d" })]),
					() => textStream("denied and done"),
				],
				authorizer: approvalAuthorizer(projectDir, timeline),
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("mutate");
		const request = await collector.waitFor(
			(event) => event.type === "input_requested",
		);
		const requestId =
			request.type === "input_requested" ? request.request.requestId : "";
		await harness.conversation.answer({
			requestId,
			choice: { kind: "option", value: "deny" },
		});
		const result = await collector.waitFor(
			(event) => event.type === "tool_result",
		);
		expect(result.type === "tool_result" && result.status).toBe("error");
		expect(harness.executions).toHaveLength(0);
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		expect(terminal.type === "run_terminal" && terminal.outcome).toBe(
			"completed",
		);
	});

	test("approval expiry fails closed without executing", async () => {
		const projectDir = await mkdtemp(join(tmpdir(), "pawl-agent-expiry-"));
		cleanupDirs.push(projectDir);
		const scheduled: Array<{ ms: number; fire: () => void }> = [];
		const timeline: Timeline = [];
		const harness = await tracked(
			await makeHarness({
				projectDir,
				script: [
					() => toolCallStream([toolCall("call_e", { text: "e" })]),
					() => textStream("after expiry"),
				],
				authorizer: approvalAuthorizer(projectDir, timeline),
				approvalTimeoutMs: 50,
				policyDependencies: {
					scheduleTimeout: (handler, ms) => {
						scheduled.push({ ms, fire: () => handler() });
						return () => {};
					},
				},
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("mutate");
		await collector.waitFor((event) => event.type === "input_requested");
		const expiry = scheduled.find((entry) => entry.ms === 50);
		expect(expiry).toBeDefined();
		expiry?.fire();
		const result = await collector.waitFor(
			(event) => event.type === "tool_result",
		);
		expect(result.type === "tool_result" && result.status).toBe("error");
		expect(harness.executions).toHaveLength(0);
	});

	test("cancelling while an approval is pending settles the run cancelled", async () => {
		const projectDir = await mkdtemp(join(tmpdir(), "pawl-agent-cancel-"));
		cleanupDirs.push(projectDir);
		const timeline: Timeline = [];
		const harness = await tracked(
			await makeHarness({
				projectDir,
				script: [
					() => toolCallStream([toolCall("call_c", { text: "c" })]),
					() => textStream("never"),
				],
				authorizer: approvalAuthorizer(projectDir, timeline),
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("mutate");
		await collector.waitFor((event) => event.type === "input_requested");
		await harness.conversation.cancel();
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		if (terminal.type !== "run_terminal") return;
		expect(terminal.outcome).toBe("cancelled");
		expect(terminal.code).toBe("run_cancelled");
		expect(harness.executions).toHaveLength(0);
	});

	test("cancel aborts a held provider stream", async () => {
		const harness = await tracked(
			await makeHarness({
				script: [abortedStreamFactory("partial text")],
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("go");
		await collector.waitFor((event) => event.type === "text_delta");
		await harness.conversation.cancel();
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		if (terminal.type !== "run_terminal") return;
		expect(terminal.outcome).toBe("cancelled");
		expect(collector.terminals()).toHaveLength(1);
	});

	test("dispose settles the active run, closes the session and rejects later sends", async () => {
		const barrier = barrierTextStream("held");
		const harness = await tracked(
			await makeHarness({ script: [barrier.factory] }),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("go");
		await collector.waitFor((event) => event.type === "text_delta");
		await harness.conversation.dispose();
		await expect(harness.conversation.send("after")).rejects.toThrow(
			/closed|disposed/i,
		);
		expect(collector.ended).toBe(true);
		await harness.conversation.dispose(); // idempotent
	});

	test("an unexpected run rejection still emits one owned terminal", async () => {
		const harness = await tracked(
			await makeHarness({ authorizer: throwingAuthorizer() }),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("go");
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		if (terminal.type !== "run_terminal") return;
		expect(terminal.outcome).toBe("failed");
		expect(collector.terminals()).toHaveLength(1);
	});

	test("a failed user-message persistence rejects send without starting a run", async () => {
		const harness = await tracked(await makeHarness({}));
		harness.failures.failMessageAtCall(1);
		await expect(harness.conversation.send("go")).rejects.toThrow(
			/injected message-record failure/,
		);
		await flush();
		expect(harness.requests).toHaveLength(0);
		expect(harness.collected?.events).toHaveLength(0);
	});

	test("stored history stays complete across consecutive runs", async () => {
		const harness = await tracked(
			await makeHarness({
				script: [() => textStream("first"), () => textStream("second")],
			}),
		);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("one");
		await collector.waitFor((event) => event.type === "run_terminal");
		await harness.conversation.send("two");
		await collector.waitFor((event) => event.type === "run_terminal");
		expect(collector.terminals()).toHaveLength(2);
		const log = await recordsOf(harness.store);
		const roles = log.records.map(messageRole);
		expect(roles).toEqual(["user", "assistant", "user", "assistant"]);
	});

	test("the shared mutation coordinator serializes tool mutations", async () => {
		const rig = {
			order: [] as string[],
			started: undefined as undefined | (() => void),
			release: undefined as undefined | (() => void),
		};
		const gate = new Promise<void>((resolve) => {
			rig.release = resolve;
		});
		const started = new Promise<void>((resolve) => {
			rig.started = () => resolve();
		});
		const mutations = createMutationCoordinator();
		const mutatingTool = definePawlTool({
			name: "mutate",
			label: "Mutate",
			description: "Holds the session mutation permit",
			executionMode: "sequential",
			replay: "never",
			schema: z.strictObject({ text: z.string() }),
			execute: async () => {
				rig.order.push("tool:start");
				rig.started?.();
				await gate;
				rig.order.push("tool:done");
				return { content: [{ type: "text", text: "mutated" }], details: {} };
			},
		});
		const harness = await tracked(
			await makeHarness({
				tools: [mutatingTool],
				mutations,
				script: [
					() => toolCallStream([toolCall("call_mu", { text: "m" }, "mutate")]),
					() => textStream("done"),
				],
			}),
		);
		// The conversation must run with the caller-supplied shared coordinator.
		expect(harness.mutations).toBe(mutations);
		const collector = harness.collected;
		if (!collector) throw new Error("collector missing");
		await harness.conversation.send("mutate");
		await started;
		let directResult: string | undefined;
		const direct = mutations
			.run(async () => {
				rig.order.push("direct:permit");
				return "direct";
			})
			.then((value) => {
				directResult = value;
			});
		await flush();
		// The runtime holds the session-wide permit for the non-replayable tool.
		expect(mutations.held).toBe(true);
		expect(mutations.queued).toBe(1);
		expect(rig.order).toEqual(["tool:start"]);
		rig.release?.();
		await direct;
		const terminal = await collector.waitFor(
			(event) => event.type === "run_terminal",
		);
		expect(terminal.type === "run_terminal" && terminal.outcome).toBe(
			"completed",
		);
		expect(rig.order).toEqual(["tool:start", "tool:done", "direct:permit"]);
		expect(directResult).toBe("direct");
	});
});
