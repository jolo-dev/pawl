import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { Tool } from "@earendil-works/pi-ai";
import {
	type AssistantMessage,
	type AssistantMessageEventStream,
	createAssistantMessageEventStream,
	type ToolCall,
} from "@earendil-works/pi-ai";
import { TextRenderable } from "@opentui/core";
import {
	createTestRenderer,
	type TestRendererSetup,
} from "@opentui/core/testing";
import { z } from "zod";
import {
	type AuthorizerFactory,
	createPawlRuntimeConversation,
	type RuntimeAgentStreamFn,
} from "../src/pi-runtime/agent";
import type { ApprovalBinding } from "../src/pi-runtime/approval";
import type { PawlConversation } from "../src/pi-runtime/conversation";
import { createMutationCoordinator } from "../src/pi-runtime/mutation";
import type { PawlConversationState } from "../src/pi-runtime/reducer";
import {
	createSessionDriver,
	type PawlSessionDriver,
} from "../src/pi-runtime/session-driver";
import {
	parseSessionLog,
	recoverSessionContext,
} from "../src/pi-runtime/session-record";
import {
	createSessionStore,
	type SessionMetadata,
	type SessionStore,
} from "../src/pi-runtime/session-store";
import { definePawlTool } from "../src/pi-runtime/tool-schema";
import {
	createTuiView,
	type PawlTuiView,
	type RestoredLine,
} from "../src/pi-runtime/tui-view";
import { createPawlApp, type PawlApp } from "../src/tui/app";
import {
	abortedStreamFactory,
	barrierTextStream,
	FIXTURE_MODEL,
	type FixtureRequest,
	type FixtureStreamFactory,
	scriptedStreamFn,
	textStream,
	toolCallStream,
} from "./fixtures/pi-runtime-stream";

/**
 * One assistant message that reasons first and then calls a tool: the same
 * installed pi-ai event protocol the Task 10 fixtures use, composed locally so
 * a single model iteration can carry both a reasoning block and a tool call.
 */
function reasoningToolCallStream(
	thinking: string,
	call: ToolCall,
): AssistantMessageEventStream {
	const base: AssistantMessage = {
		role: "assistant",
		content: [],
		api: "bedrock-converse-stream",
		provider: "amazon-bedrock",
		model: FIXTURE_MODEL.id,
		usage: {
			input: 11,
			output: 7,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 18,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "pending",
		timestamp: 5_000,
	};
	const stream = createAssistantMessageEventStream();
	stream.push({ type: "start", partial: base });
	stream.push({
		type: "thinking_start",
		contentIndex: 0,
		partial: { ...base, content: [{ type: "thinking", thinking: "" }] },
	});
	stream.push({
		type: "thinking_delta",
		contentIndex: 0,
		delta: thinking,
		partial: {
			...base,
			content: [{ type: "thinking", thinking }],
		},
	});
	stream.push({
		type: "thinking_end",
		contentIndex: 0,
		content: thinking,
		partial: {
			...base,
			content: [{ type: "thinking", thinking }],
		},
	});
	stream.push({
		type: "toolcall_start",
		contentIndex: 1,
		partial: {
			...base,
			content: [
				{ type: "thinking", thinking },
				{ ...call, arguments: {} },
			],
		},
	});
	stream.push({
		type: "toolcall_delta",
		contentIndex: 1,
		delta: JSON.stringify(call.arguments),
		partial: {
			...base,
			content: [{ type: "thinking", thinking }, { ...call }],
		},
	});
	stream.push({
		type: "toolcall_end",
		contentIndex: 1,
		toolCall: call,
		partial: {
			...base,
			content: [{ type: "thinking", thinking }, { ...call }],
		},
	});
	stream.push({
		type: "done",
		reason: "toolUse",
		message: {
			...base,
			content: [{ type: "thinking", thinking }, { ...call }],
			stopReason: "toolUse",
		},
	});
	stream.end();
	return stream;
}

/**
 * Task 13: the full proof chain through the NATIVE OpenTUI test renderer —
 * real installed Pi Agent with deterministic fake provider streams → the
 * Task 10 conversation → the Task 5 session driver/reducer → the new narrow
 * tui-view sink adapter → the existing clean-baseline `createPawlApp`.
 * Keyboard input is injected through the test renderer's mock input. Owned
 * state is never cast to an Eve type and never fed to the renderer directly:
 * the view is driven only by reduced conversation state.
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
type Executions = Array<{ toolCallId: string; input: unknown }>;

function toolCall(id: string, input: Record<string, unknown>, name = "echo") {
	return { type: "toolCall" as const, id, name, arguments: input };
}

function echoTool(timeline: Timeline, executions: Executions) {
	return definePawlTool({
		name: "echo",
		label: "Echo",
		description: "Echoes its text input back to the model",
		executionMode: "sequential",
		replay: "safe",
		schema: z.strictObject({ text: z.string() }),
		execute: async (toolCallId, input) => {
			timeline.push(`execute:${toolCallId}`);
			executions.push({ toolCallId, input });
			return {
				content: [{ type: "text", text: `echo:${input.text}` }],
				details: {},
			};
		},
	});
}

function mutatorTool(timeline: Timeline, executions: Executions) {
	return definePawlTool({
		name: "mutator",
		label: "Mutator",
		description: "Performs the fake mutation once approved",
		executionMode: "sequential",
		replay: "never",
		schema: z.strictObject({ target: z.string() }),
		execute: async (toolCallId, input) => {
			timeline.push(`execute:${toolCallId}`);
			executions.push({ toolCallId, input });
			return {
				content: [{ type: "text", text: `mutated:${input.target}` }],
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

function questionAuthorizer(
	answers: string[],
	timeline: Timeline,
): AuthorizerFactory {
	return (run) => async (request) => {
		timeline.push(`authorize:${request.toolName}`);
		const outcome = await run.broker.ask("What name should the resource have?");
		if (outcome.answered) {
			answers.push(outcome.text);
			return { granted: true };
		}
		return { granted: false, reason: outcome.message };
	};
}

interface BusyEntry {
	readonly busy: boolean;
	/** Settled run count observed in the driver state when busy was emitted. */
	readonly settledRuns: number;
}

interface Harness {
	readonly setup: TestRendererSetup;
	readonly app: PawlApp;
	readonly view: PawlTuiView;
	readonly driver: PawlSessionDriver;
	readonly conversation: PawlConversation;
	readonly requests: FixtureRequest[];
	readonly executions: Executions;
	readonly timeline: Timeline;
	readonly busyLog: BusyEntry[];
	readonly projectDir: string;
	readonly store: SessionStore;
	destroyed: boolean;
}

interface MountOptions {
	readonly script?: readonly FixtureStreamFactory[];
	/** Builds the tools once the harness-owned recording arrays exist. */
	readonly toolsFor?: (
		timeline: Timeline,
		executions: Executions,
	) => readonly AgentTool<Tool["parameters"], unknown>[];
	readonly authorizer?: AuthorizerFactory;
	/** Builds the authorizer once the fixture project directory is known. */
	readonly authorizerFor?: (
		projectDir: string,
		timeline: Timeline,
	) => AuthorizerFactory;
	readonly initialMessages?: readonly AgentMessage[];
	/** History recovered from a prior session, rendered before any live event. */
	readonly restoredLines?: readonly RestoredLine[];
	readonly height?: number;
}

const cleanupDirs: string[] = [];
let active: Harness | undefined;

async function mount(options: MountOptions = {}): Promise<Harness> {
	const projectDir = await mkdtemp(join(tmpdir(), "pawl-tui-proof-"));
	cleanupDirs.push(projectDir);
	const store = await createSessionStore(metadata("tui1", projectDir), {});
	const timeline: Timeline = [];
	const executions: Executions = [];
	const authorizer =
		options.authorizerFor?.(projectDir, timeline) ??
		options.authorizer ??
		allowAuthorizer(timeline);
	const scripted = scriptedStreamFn(
		options.script ?? [() => textStream("fixture reply")],
	);
	const conversation = createPawlRuntimeConversation({
		id: "tui_proof",
		systemPrompt: "Pawl TUI proof system prompt",
		model: FIXTURE_MODEL,
		tools: [
			...(options.toolsFor?.(timeline, executions) ?? [
				echoTool(timeline, executions),
			]),
		],
		streamFn: scripted.streamFn as RuntimeAgentStreamFn,
		store,
		mutations: createMutationCoordinator(),
		createAuthorizer: authorizer,
		...(options.initialMessages
			? { initialMessages: [...options.initialMessages] }
			: {}),
	});

	const setup = await createTestRenderer({
		width: 80,
		height: options.height ?? 26,
	});
	const busyLog: BusyEntry[] = [];
	const driverRef: { current?: PawlSessionDriver } = {};
	const app = createPawlApp({
		renderer: setup.renderer,
		onSubmit: (text) => {
			void driverRef.current?.submit(text);
		},
	});
	const view = createTuiView({
		app,
		onBusy: (busy) => {
			busyLog.push({
				busy,
				settledRuns: driverRef.current?.state.settledRunIds.length ?? 0,
			});
		},
	});
	const driver = createSessionDriver(conversation, {
		onState: (state) => view.apply(state),
	});
	driverRef.current = driver;
	if (options.restoredLines) {
		view.restore(options.restoredLines);
	}
	setup.renderer.root.add(app.root);
	app.focusInput();
	await setup.renderOnce();

	const harness: Harness = {
		setup,
		app,
		view,
		driver,
		conversation,
		requests: scripted.requests,
		executions,
		timeline,
		busyLog,
		projectDir,
		store,
		destroyed: false,
	};
	const originalDestroy = setup.renderer.destroy.bind(setup.renderer);
	setup.renderer.destroy = () => {
		harness.destroyed = true;
		originalDestroy();
	};
	active = harness;
	return harness;
}

afterEach(async () => {
	const current = active;
	active = undefined;
	if (current) {
		try {
			await current.driver.dispose();
		} catch {
			// Dispose is best-effort here; individual tests assert their own teardown.
		}
		if (!current.destroyed) current.setup.renderer.destroy();
		current.destroyed = true;
	}
	for (const dir of cleanupDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

function frame(h: Harness): string {
	return h.setup.captureCharFrame();
}

type TextContent = { chunks?: readonly { text?: unknown }[] } | undefined;

function textRenderableText(child: TextRenderable): string {
	const content = (child as unknown as { content?: TextContent }).content;
	return (content?.chunks ?? [])
		.map((chunk) => (typeof chunk.text === "string" ? chunk.text : ""))
		.join("");
}

function transcriptLines(h: Harness): string[] {
	return h.app.transcript
		.getChildren()
		.filter((child): child is TextRenderable => child instanceof TextRenderable)
		.map(textRenderableText);
}

function countLine(h: Harness, text: string): number {
	return transcriptLines(h).filter((line) => line.includes(text)).length;
}

async function until(
	h: Harness,
	what: string,
	predicate: (state: PawlConversationState) => boolean,
): Promise<void> {
	for (let attempt = 0; attempt < 2_000; attempt += 1) {
		if (predicate(h.driver.state)) return;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	throw new Error(`condition not met: ${what}`);
}

async function typePrompt(h: Harness, text: string): Promise<void> {
	await h.setup.mockInput.typeText(text);
	await h.setup.mockInput.pressEnter();
}

const flush = async (): Promise<void> => {
	for (let index = 0; index < 10; index += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
};

describe("pi conversation through the native opentui renderer", () => {
	test("renders two consecutive prompts and a multi-iteration tool turn", async () => {
		const h = await mount({
			script: [
				() => toolCallStream([toolCall("call_1", { text: "one" })]),
				() => textStream("first reply"),
				() => textStream("second reply"),
			],
		});

		await typePrompt(h, "first question");
		await until(
			h,
			"first run active",
			(state) => state.activeRunIds.length > 0,
		);
		await h.setup.renderOnce();
		expect(frame(h)).toContain("Working");

		await until(h, "first run settled", (state) => !state.busy);
		await typePrompt(h, "second question");
		await until(
			h,
			"second run settled",
			(state) => state.settledRunIds.length === 2 && !state.busy,
		);
		await h.setup.renderOnce();

		// Both user prompts are echoed exactly once; the tool turn and both
		// replies render in the transcript.
		expect(countLine(h, "› first question")).toBe(1);
		expect(countLine(h, "› second question")).toBe(1);
		expect(countLine(h, "⚙ echo …")).toBe(1);
		expect(countLine(h, "⚙ echo done")).toBe(1);
		expect(countLine(h, "first reply")).toBe(1);
		expect(countLine(h, "second reply")).toBe(1);
		expect(h.requests).toHaveLength(3);
		expect(h.executions).toHaveLength(1);
		expect(h.driver.state.failure).toBeNull();
		expect(h.busyLog.at(-1)?.busy).toBe(false);
	});

	test("streams text and reasoning without going idle between inner turns", async () => {
		const barrier = barrierTextStream("after the tool");
		const h = await mount({
			script: [
				() =>
					reasoningToolCallStream(
						"weighing the options",
						toolCall("call_r", { text: "r" }),
					),
				barrier.factory,
			],
		});

		await typePrompt(h, "think and act");
		// The SECOND model request being dispatched proves the loop crossed the
		// reasoning and tool iterations without settling: the barrier still holds
		// the follow-up stream open while the run stays owned-busy.
		await until(
			h,
			"second model request dispatched",
			() => h.requests.length === 2,
		);
		expect(h.driver.state.busy).toBe(true);
		expect(h.driver.state.status).toBe("Working");
		await h.setup.renderOnce();
		expect(frame(h)).toContain("Working");

		barrier.release();
		await until(h, "run settled", (state) => state.settledRunIds.length === 1);
		await h.setup.renderOnce();

		expect(countLine(h, "∴ weighing the options")).toBe(1);
		expect(countLine(h, "⚙ echo done")).toBe(1);
		expect(countLine(h, "after the tool")).toBe(1);
		// Busy was raised once for the run and only cleared after settlement:
		// no premature idle between inner turns.
		expect(h.busyLog.map((entry) => entry.busy)).toEqual([true, false]);
		const busyIndex = h.busyLog.findIndex((entry) => entry.busy);
		for (const entry of h.busyLog.slice(busyIndex + 1)) {
			if (!entry.busy) {
				expect(entry.settledRuns).toBeGreaterThanOrEqual(1);
			}
		}
	});

	test("a freeform question is answered while the agent is waiting", async () => {
		const answers: string[] = [];
		const h = await mount({
			toolsFor: (mountTimeline, mountExecutions) => [
				echoTool(mountTimeline, mountExecutions),
			],
			authorizerFor: (_projectDir, mountTimeline) =>
				questionAuthorizer(answers, mountTimeline),
			script: [
				() => toolCallStream([toolCall("call_q", { text: "q" })]),
				() =>
					textStream(
						`named: ${answers[0] === undefined ? "unanswered" : answers[0]}`,
					),
			],
		});

		await typePrompt(h, "name it");
		await until(
			h,
			"freeform question pending",
			(state) => state.pendingRequests.length === 1,
		);
		// The agent is waiting, not idle, and nothing executed yet.
		expect(h.driver.state.busy).toBe(true);
		expect(h.driver.state.status).toBe("Waiting for you");
		await h.setup.renderOnce();
		expect(frame(h)).toContain("Waiting for you");
		expect(frame(h)).toContain("What name should the resource have?");
		expect(h.executions).toHaveLength(0);

		await typePrompt(h, "my-resource-name");
		await until(h, "run settled", (state) => state.settledRunIds.length === 1);
		await h.setup.renderOnce();

		// The answer went to the question (never echoed as a new user prompt)
		// and the tool executed exactly once with the reply reflecting it.
		expect(answers).toEqual(["my-resource-name"]);
		expect(countLine(h, "› my-resource-name")).toBe(0);
		expect(h.executions).toHaveLength(1);
		expect(countLine(h, "named: my-resource-name")).toBe(1);
	});

	test("approval gates the mutation; numbered and id answers each execute once", async () => {
		const h = await mount({
			toolsFor: (mountTimeline, mountExecutions) => [
				mutatorTool(mountTimeline, mountExecutions),
			],
			authorizerFor: approvalAuthorizer,
			script: [
				() =>
					toolCallStream([
						toolCall("call_m1", { target: "bucket-a" }, "mutator"),
					]),
				() => textStream("created bucket-a"),
				() =>
					toolCallStream([
						toolCall("call_m2", { target: "bucket-b" }, "mutator"),
					]),
				() => textStream("created bucket-b"),
			],
		});

		await typePrompt(h, "make bucket-a");
		await until(
			h,
			"approval pending",
			(state) => state.pendingRequests.length === 1,
		);
		// The mutation has NOT run while the approval is pending.
		expect(h.executions).toHaveLength(0);
		expect(h.driver.state.busy).toBe(true);
		await h.setup.renderOnce();
		expect(frame(h)).toContain("Allow mutator");
		expect(frame(h)).toContain("1) Approve");
		expect(frame(h)).toContain("2) Deny");

		// A numbered answer approves; exactly one execution happens.
		await typePrompt(h, "1");
		await until(h, "first run settled", (state) => !state.busy);
		expect(h.executions.map((entry) => entry.toolCallId)).toEqual(["call_m1"]);

		await typePrompt(h, "make bucket-b");
		await until(
			h,
			"second approval pending",
			(state) => state.pendingRequests.length === 1,
		);
		// An option-id answer approves too; again exactly one execution.
		await typePrompt(h, "approve");
		await until(
			h,
			"second run settled",
			(state) => state.settledRunIds.length === 2 && !state.busy,
		);
		expect(h.executions.map((entry) => entry.toolCallId)).toEqual([
			"call_m1",
			"call_m2",
		]);
		await h.setup.renderOnce();
		expect(countLine(h, "created bucket-a")).toBe(1);
		expect(countLine(h, "created bucket-b")).toBe(1);
	});

	test("unresolved text and denial never execute the mutation", async () => {
		const h = await mount({
			toolsFor: (mountTimeline, mountExecutions) => [
				mutatorTool(mountTimeline, mountExecutions),
			],
			authorizerFor: approvalAuthorizer,
			script: [
				() =>
					toolCallStream([toolCall("call_d", { target: "nope" }, "mutator")]),
				() => textStream("after denial"),
			],
		});

		await typePrompt(h, "mutate nope");
		await until(
			h,
			"approval pending",
			(state) => state.pendingRequests.length === 1,
		);
		// Unresolved text while an approval is pending is a visible rejection.
		await typePrompt(h, "maybe");
		await until(
			h,
			"unresolved notice rendered",
			(state) =>
				state.pendingRequests.length === 1 &&
				state.lines.some((line) => line.text.includes("Not a valid answer")),
		);
		expect(h.executions).toHaveLength(0);

		await typePrompt(h, "2");
		await until(h, "denial run settled", (state) => !state.busy);
		expect(h.executions).toHaveLength(0);
		await h.setup.renderOnce();
		expect(countLine(h, "! mutator failed")).toBe(1);
		expect(countLine(h, "after denial")).toBe(1);
		expect(h.driver.state.failure).toBeNull();
	});

	test("cancelling settles the run and late stream events change nothing", async () => {
		const h = await mount({
			script: [abortedStreamFactory("never finishes")],
		});

		await typePrompt(h, "keep going");
		await until(h, "run active", (state) => state.activeRunIds.length > 0);
		await h.driver.cancel();
		await until(
			h,
			"cancelled and settled",
			(state) => state.settledRunIds.length === 1 && !state.busy,
		);
		await h.setup.renderOnce();
		expect(h.requests).toHaveLength(1);
		expect(h.executions).toHaveLength(0);
		// A cancellation is not a failure.
		expect(h.driver.state.failure).toBeNull();
		expect(frame(h)).not.toContain("Working");

		const before = transcriptLines(h);
		await flush();
		await h.setup.renderOnce();
		// Late provider events after settlement are dropped: no new lines and
		// no second terminal for the run.
		expect(transcriptLines(h)).toEqual(before);
		expect(h.driver.state.settledRunIds).toHaveLength(1);
	});

	test("restored scrollback shows the interruption, replays nothing and needs new input", async () => {
		const priorDir = await mkdtemp(join(tmpdir(), "pawl-tui-prior-"));
		cleanupDirs.push(priorDir);
		const prior = await createSessionStore(metadata("tui0", priorDir), {});
		await prior.recordMessage({
			role: "user",
			content: "earlier question",
			timestamp: 1000,
		});
		await prior.recordMessage({
			role: "assistant",
			content: [toolCall("call_old", { text: "old" })],
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
		await prior.recordInterrupted({
			reason: "stream_interrupted",
			text: "stopped mid-turn",
		});
		await prior.close();
		const parsed = parseSessionLog(await readFile(prior.path, "utf8"));
		const recovered = recoverSessionContext(parsed.records);

		// Display history (including the interrupted marker) is mapped to
		// restored transcript lines; the model context feeds the new Agent.
		const restoredLines: RestoredLine[] = [];
		for (const entry of recovered.history) {
			if (entry.kind === "interrupted") {
				restoredLines.push({
					role: "alert",
					text: `interrupted (${entry.reason}): ${entry.text}`,
				});
				continue;
			}
			const message = entry.message;
			if (message.role === "user") {
				restoredLines.push({
					role: "user",
					text: typeof message.content === "string" ? message.content : "",
				});
			} else if (message.role === "toolResult") {
				restoredLines.push({ role: "tool", text: "echo done" });
			} else {
				const text = message.content
					.filter((block) => block.type === "text")
					.map((block) => block.text)
					.join("");
				if (text.length > 0) {
					restoredLines.push({ role: "assistant", text });
				} else {
					restoredLines.push({ role: "tool", text: "echo …" });
				}
			}
		}

		const h = await mount({
			initialMessages: recovered.modelContext as unknown as AgentMessage[],
			restoredLines,
			script: [() => textStream("fresh reply")],
		});
		await h.setup.renderOnce();

		// Restored scrollback: prior turns plus the interrupted marker.
		expect(countLine(h, "› earlier question")).toBe(1);
		expect(
			transcriptLines(h).some(
				(line) =>
					line.startsWith("! ") &&
					line.includes("interrupted (stream_interrupted)"),
			),
		).toBe(true);
		// Nothing replayed and the run did not start by itself.
		expect(h.requests).toHaveLength(0);
		expect(h.executions).toHaveLength(0);
		expect(h.driver.state.busy).toBe(false);
		expect(frame(h)).not.toContain("Working");

		// A new prompt is required and then works normally.
		await typePrompt(h, "continue");
		await until(
			h,
			"fresh run settled",
			(state) => state.settledRunIds.length === 1,
		);
		await h.setup.renderOnce();
		expect(h.requests).toHaveLength(1);
		expect(h.executions).toHaveLength(0);
		expect(countLine(h, "› continue")).toBe(1);
		expect(countLine(h, "fresh reply")).toBe(1);
	});

	test("the fixed editor stays usable while the transcript scrolls", async () => {
		const filler: RestoredLine[] = Array.from({ length: 24 }, (_, index) => ({
			role: "user" as const,
			text: `history line ${index + 1}`,
		}));
		const h = await mount({
			height: 14,
			restoredLines: filler,
			script: [() => textStream("fresh reply")],
		});

		await typePrompt(h, "after restore");
		await until(h, "run settled", (state) => state.settledRunIds.length === 1);
		await h.setup.renderOnce();

		// The transcript content overflows the fixed viewport, the editor was
		// cleared on submit and stays usable, and the prompt echoed exactly once.
		expect(h.app.transcript.scrollHeight).toBeGreaterThan(
			h.app.transcript.height,
		);
		expect(h.app.input.value).toBe("");
		expect(countLine(h, "› after restore")).toBe(1);
		expect(countLine(h, "fresh reply")).toBe(1);
		expect(countLine(h, "› history line 7")).toBe(1);
	});

	test("teardown settles state, disposes the conversation and destroys the renderer", async () => {
		const h = await mount();
		await typePrompt(h, "hello");
		await until(
			h,
			"run settled",
			(state) => state.settledRunIds.length === 1 && !state.busy,
		);

		await h.driver.dispose();
		expect(h.driver.state.busy).toBe(false);
		expect(h.driver.state.activeRunIds).toHaveLength(0);
		expect(h.driver.state.pendingRequests).toHaveLength(0);
		expect(h.driver.state.queuedPrompts).toHaveLength(0);

		// Post-dispose input is refused visibly instead of silently dropped.
		await h.driver.submit("after close");
		await h.setup.renderOnce();
		expect(
			transcriptLines(h).some((line) =>
				line.includes("The conversation is closed."),
			),
		).toBe(true);

		await h.setup.renderer.destroy();
		expect(h.destroyed).toBe(true);
	});
});
