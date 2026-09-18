#!/usr/bin/env bun
/**
 * Explicit proof runner for the embedded local Pi runtime (Stage 1, Task 14).
 *
 * CLI contract (parsing is fully separated from execution, so importing this
 * module or testing `parseProofArgs` never logs in, resolves AWS credentials
 * or calls a provider):
 *
 * - `--project-dir <dir>` is always required and must select an EMPTY,
 *   explicitly created temporary directory (for example `mktemp -d`) for a
 *   new session — the proof never writes into a working project. With
 *   `--resume-session <id>` the directory must instead already contain that
 *   proof session under `.pawl/sessions/`.
 * - Offline mode is the default (`--offline` makes it explicit) and is
 *   mutually exclusive with `--live`. Offline mode never resolves AWS
 *   credentials; AWS selection flags are refused there.
 * - `--tui` runs the proof through the native OpenTUI terminal shell
 *   (`createPawlApp` + the Task 13 `createTuiView` sink).
 * - `--resume-session <id>` loads persisted history without an automatic
 *   opening prompt; nothing runs until a new prompt is submitted.
 * - Live mode additionally requires the environment gate `PAWL_PI_PROOF_LIVE=1`
 *   AND the explicit `--confirm-live-bedrock` flag, plus `--profile`,
 *   `--region`, `--model-id` and `--second-model-id` (two DIFFERENT models:
 *   each live model proves its own reasoning behavior in its own session, so
 *   reasoning/signatures are never replayed into a different model).
 *
 * Offline mode drives the real Task 10 conversation over the Task 13
 * deterministic fixture streams and a harmless read/fake-approval toolset.
 * Live mode reuses the production Clack credential/model validation first,
 * then Task 3's checked execution context and Task 4's controlled Bedrock
 * stream function. No deploy or artifact-upload capability is registered in
 * either mode. Evidence is redacted: no credential values, no raw signing
 * headers, no full transcripts — only identity metadata, model ids,
 * request-shape counts and pass/fail checks.
 *
 * Session files are private (`0600`) and preserved after the run so an
 * explicit second invocation (`--resume-session`) can load them; cleanup is
 * manual: delete the temporary project directory when finished.
 */

import { existsSync, rmSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
	AgentMessage,
	AgentTool,
	AgentToolResult,
} from "@earendil-works/pi-agent-core";
import type { Tool, ToolCall } from "@earendil-works/pi-ai";
import { createCliRenderer } from "@opentui/core";
import { z } from "zod";
import {
	type AuthorizerFactory,
	createPawlRuntimeConversation,
	type RuntimeAgentStreamFn,
	type RuntimeRunContext,
} from "../src/pi-runtime/agent";
import type { ApprovalBinding } from "../src/pi-runtime/approval";
import {
	createBedrockModelStream,
	resolveApprovedBedrockModel,
} from "../src/pi-runtime/bedrock";
import type {
	PawlConversation,
	PawlConversationEvent,
} from "../src/pi-runtime/conversation";
import { createExecutionContext } from "../src/pi-runtime/execution-context";
import { createMutationCoordinator } from "../src/pi-runtime/mutation";
import {
	createSessionDriver,
	type PawlSessionDriver,
} from "../src/pi-runtime/session-driver";
import {
	type RecoveredHistoryEntry,
	recoverSessionContext,
	type SessionMessage,
} from "../src/pi-runtime/session-record";
import {
	createSessionStore,
	openSessionStore,
	readSessionLog,
	type SessionMetadata,
	type SessionStore,
} from "../src/pi-runtime/session-store";
import { definePawlTool } from "../src/pi-runtime/tool-schema";
import { createTuiView, type RestoredLine } from "../src/pi-runtime/tui-view";
import { createPawlApp } from "../src/tui/app";
import type { PreflightPrompter } from "../src/tui/preflight";
import { defaultPreflightDeps } from "../src/tui/preflight-deps";
import {
	loadAuthenticatedModels,
	validateModelSelection,
} from "../src/tui/preflight-validation";
import { THEME } from "../src/tui/theme";
import {
	FIXTURE_MODEL,
	scriptedStreamFn,
	textStream,
	toolCallStream,
} from "../tests/fixtures/pi-runtime-stream";

// ---- CLI parsing (pure; no side effects, no AWS, no filesystem) ---------- //

export type ProofMode = "offline" | "live";

export interface ProofConfig {
	readonly mode: ProofMode;
	readonly projectDir: string;
	readonly tui: boolean;
	readonly resumeSessionId?: string;
	readonly profile?: string;
	readonly region?: string;
	readonly modelId?: string;
	readonly secondModelId?: string;
}

export type ParsedProofArgs =
	| { readonly ok: true; readonly config: ProofConfig }
	| { readonly ok: false; readonly error: string };

const VALUE_FLAGS = [
	"--project-dir",
	"--resume-session",
	"--profile",
	"--region",
	"--model-id",
	"--second-model-id",
] as const;

const BOOLEAN_FLAGS = [
	"--offline",
	"--live",
	"--tui",
	"--confirm-live-bedrock",
] as const;

const LIVE_ONLY_FLAGS = [
	"--profile",
	"--region",
	"--model-id",
	"--second-model-id",
] as const;

const REQUIRED_LIVE_FLAGS = [
	"--profile",
	"--region",
	"--model-id",
	"--second-model-id",
] as const;

const REGION_PATTERN = /^[a-z]{2}(?:-[a-z0-9]+)+-\d$/;

const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function parseProofArgs(
	argv: readonly string[],
	env: Record<string, string | undefined> = process.env,
): ParsedProofArgs {
	const values = new Map<string, string>();
	const booleans = new Set<string>();
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === undefined) break;
		if ((VALUE_FLAGS as readonly string[]).includes(arg)) {
			const value = argv[index + 1];
			if (value === undefined || value.startsWith("--")) {
				return { ok: false, error: `${arg} requires a value` };
			}
			if (values.has(arg)) {
				return { ok: false, error: `${arg} was given twice` };
			}
			values.set(arg, value);
			index += 1;
			continue;
		}
		if ((BOOLEAN_FLAGS as readonly string[]).includes(arg)) {
			if (booleans.has(arg)) {
				return { ok: false, error: `${arg} was given twice` };
			}
			booleans.add(arg);
			continue;
		}
		return { ok: false, error: `Unknown argument "${arg}"` };
	}

	const projectDir = values.get("--project-dir");
	if (projectDir === undefined) {
		return {
			ok: false,
			error:
				"--project-dir is required: select an empty temporary directory created for this proof (for example mktemp -d), never a working project",
		};
	}

	const live = booleans.has("--live");
	const offline = booleans.has("--offline");
	if (live && offline) {
		return {
			ok: false,
			error:
				"--offline and --live are mutually exclusive; pick exactly one mode (omitting both selects offline)",
		};
	}
	const confirmLive = booleans.has("--confirm-live-bedrock");
	const selectedLiveOnly = LIVE_ONLY_FLAGS.filter((flag) => values.has(flag));
	if (!live) {
		if (confirmLive) {
			return {
				ok: false,
				error:
					"--confirm-live-bedrock is only valid together with --live; offline mode never calls Bedrock",
			};
		}
		if (selectedLiveOnly.length > 0) {
			return {
				ok: false,
				error: `${selectedLiveOnly.join(", ")} select AWS material and are only valid with --live; offline mode never resolves AWS credentials`,
			};
		}
	} else {
		if (env.PAWL_PI_PROOF_LIVE !== "1") {
			return {
				ok: false,
				error:
					"Live Bedrock proof calls require PAWL_PI_PROOF_LIVE=1 in the environment as an explicit gate; set it only when you intend to make paid model calls",
			};
		}
		if (!confirmLive) {
			return {
				ok: false,
				error:
					"Live Bedrock proof calls additionally require the explicit --confirm-live-bedrock flag on the command line",
			};
		}
		const missing = REQUIRED_LIVE_FLAGS.filter((flag) => !values.has(flag));
		if (missing.length > 0) {
			return {
				ok: false,
				error: `Live mode requires ${missing.join(", ")}`,
			};
		}
		const region = values.get("--region");
		if (region !== undefined && !REGION_PATTERN.test(region)) {
			return {
				ok: false,
				error: `--region "${region}" is not a valid AWS region code (for example eu-central-1)`,
			};
		}
		if (values.get("--model-id") === values.get("--second-model-id")) {
			return {
				ok: false,
				error:
					"--second-model-id must select a different model than --model-id; each live model proves its own reasoning behavior in its own session",
			};
		}
	}

	const resumeSessionId = values.get("--resume-session");
	if (
		resumeSessionId !== undefined &&
		!SESSION_ID_PATTERN.test(resumeSessionId)
	) {
		return {
			ok: false,
			error: `--resume-session "${resumeSessionId}" must be a plain session id (letters, digits, dot, dash, underscore)`,
		};
	}

	return {
		ok: true,
		config: {
			mode: live ? "live" : "offline",
			projectDir,
			tui: booleans.has("--tui"),
			...(resumeSessionId === undefined ? {} : { resumeSessionId }),
			...(live
				? {
						profile: values.get("--profile") ?? "",
						region: values.get("--region") ?? "",
						modelId: values.get("--model-id") ?? "",
						secondModelId: values.get("--second-model-id") ?? "",
					}
				: {}),
		},
	};
}

// ---- Typed refusals -------------------------------------------------------- //

export class ProofRefusedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProofRefusedError";
	}
}

class ProofToolError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "ProofToolError";
		this.code = code;
	}
}

// ---- Proof toolset: harmless read + fake approval only --------------------- //

export const PROOF_TOOL_NAMES = {
	echo: "proof_echo",
	askQuestion: "ask_question",
	fakeWrite: "proof_fake_write",
} as const;

const PROOF_PLAN_DIGEST = "pawl-pi-proof-plan";

const PROOF_SYSTEM_PROMPT =
	"You are the pawl local runtime proof agent. Answer briefly. " +
	"Use tools only when the proof prompt asks for them. " +
	"The proof_fake_write tool never writes anything; it only exercises the human approval flow.";

interface ProofIdentity {
	readonly accountId: string;
	readonly region: string;
}

interface ProofToolset {
	readonly tools: readonly AgentTool<Tool["parameters"], unknown>[];
	readonly createAuthorizer: AuthorizerFactory;
}

function textResult(text: string): AgentToolResult<Record<string, never>> {
	return { content: [{ type: "text", text }], details: {} };
}

/**
 * The proof toolset: one read-only echo, one freeform question and one
 * fake-approval tool that writes NOTHING. Deploy/artifact tooling is never
 * registered in the proof runner. Authorization follows the reviewed Task 11
 * pattern: preflight grants only registered names (never a grant), and the
 * approval decision for the fake write happens inside execution through the
 * run-scoped broker, with the one-use grant consumed at the boundary.
 */
function createProofToolset(
	projectDir: string,
	identity: ProofIdentity,
	mutations: ReturnType<typeof createMutationCoordinator>,
): ProofToolset {
	/** The run context captured by the per-run authorizer factory (Task 11 pattern). */
	let activeRun: RuntimeRunContext | undefined;

	const requireRun = (): RuntimeRunContext => {
		if (!activeRun) {
			throw new ProofToolError(
				"no_active_run",
				"Proof tools execute only inside an active approved run",
			);
		}
		return activeRun;
	};

	const echoTool = definePawlTool({
		name: PROOF_TOOL_NAMES.echo,
		label: "Proof echo (read-only)",
		description:
			"Read-only proof fixture: echoes its input back. Performs no write and no AWS call.",
		executionMode: "sequential",
		replay: "safe",
		schema: z.strictObject({ input: z.string().min(1) }),
		execute: async (_toolCallId, input) =>
			textResult(
				`proof_echo: ${input.input} (read-only proof fixture, no AWS call)`,
			),
	});

	const askQuestionTool = definePawlTool({
		name: PROOF_TOOL_NAMES.askQuestion,
		label: "Ask the proof user",
		description:
			"Ask the human a freeform question and wait for their typed answer.",
		executionMode: "sequential",
		replay: "safe",
		schema: z.strictObject({ question: z.string().min(1) }),
		execute: async (_toolCallId, input) => {
			const run = requireRun();
			const outcome = await run.broker.ask(input.question);
			if (!outcome.answered) {
				throw new ProofToolError(outcome.reason, outcome.message);
			}
			return textResult(outcome.text);
		},
	});

	const fakeWriteTool = definePawlTool({
		name: PROOF_TOOL_NAMES.fakeWrite,
		label: "Fake approved write",
		description:
			"Proof-only approval exercise: requests an explicit human approval bound to the exact arguments, then performs NO write of any kind.",
		executionMode: "sequential",
		replay: "safe",
		schema: z.strictObject({ target: z.string().min(1) }),
		execute: async (toolCallId, input, signal) => {
			const run = requireRun();
			const binding = (): ApprovalBinding => ({
				runId: run.runId,
				toolCallId,
				toolName: PROOF_TOOL_NAMES.fakeWrite,
				input,
				planDigest: PROOF_PLAN_DIGEST,
				projectDir,
				identity: { accountId: identity.accountId, region: identity.region },
				previewComplete: true,
			});
			const outcome = await run.broker.request(binding());
			if (!outcome.granted) {
				throw new ProofToolError(
					"proof_write_not_approved",
					`The fake proof write was not approved: ${outcome.message}`,
				);
			}
			await mutations.run(
				async (lease) => {
					lease.signal.throwIfAborted();
					const consumption = outcome.grant.consume(binding());
					if (!consumption.ok) {
						throw new ProofToolError(
							"grant_unusable",
							`The proof approval could not be consumed at the boundary: ${consumption.message}`,
						);
					}
				},
				{
					owner: PROOF_TOOL_NAMES.fakeWrite,
					...(signal === undefined ? {} : { signal }),
				},
			);
			return textResult(
				`FAKE WRITE approved for "${input.target}" — proof only; nothing was written anywhere.`,
			);
		},
	});

	const registeredTools = [echoTool, askQuestionTool, fakeWriteTool];
	const allowedNames = new Set(registeredTools.map((tool) => tool.name));

	return {
		tools: registeredTools,
		createAuthorizer: (run) => {
			activeRun = run;
			return async (request) => {
				if (!allowedNames.has(request.toolName)) {
					return {
						granted: false,
						reason: `${request.toolName} is not a registered proof tool`,
					};
				}
				return { granted: true };
			};
		},
	};
}

// ---- Evidence (redacted by construction: no credentials, no transcripts) --- //

export interface ProofCheck {
	readonly name: string;
	readonly passed: boolean;
	readonly detail?: string;
}

export interface ProofSessionEvidence {
	readonly sessionId: string;
	readonly modelId: string;
	readonly path: string;
	readonly resumed: boolean;
	readonly userMessages: number;
	readonly assistantReplies: number;
	readonly toolExecutions: number;
	readonly modelRequests: number;
	readonly reasoningObserved: boolean;
	readonly terminalOutcomes: readonly string[];
	readonly checks: readonly ProofCheck[];
}

export interface ProofEvidence {
	readonly mode: ProofMode;
	readonly projectDir: string;
	readonly sessions: readonly ProofSessionEvidence[];
	/** Live only; offline never establishes an AWS identity. */
	readonly identity:
		| {
				readonly accountId: string;
				readonly region: string;
				readonly principalArn: string;
		  }
		| undefined;
}

// ---- Session plumbing ------------------------------------------------------- //

interface SessionTallies {
	userMessages: number;
	assistantReplies: number;
	toolExecutions: number;
	reasoningObserved: boolean;
	outcomes: string[];
}

interface SessionPlan {
	readonly sessionId: string;
	readonly modelId: string;
	readonly store: SessionStore;
	readonly conversation: PawlConversation;
	readonly driver: PawlSessionDriver;
	/** Teed event copy for redacted tallies; the driver keeps the single owned subscription. */
	readonly tapEvents: () => AsyncIterable<PawlConversationEvent>;
	readonly tallies: SessionTallies;
	readonly requestCounter: { count: number };
	readonly resumed: boolean;
	readonly recoveredHistory: readonly RecoveredHistoryEntry[];
	readonly tailDiscarded: boolean;
	readonly openingPrompt: string | undefined;
	readonly secondPrompt: string | undefined;
}

const OFFLINE_IDENTITY: ProofIdentity & {
	readonly principalArn: string;
} = {
	accountId: "000000000000",
	region: "offline-fixture",
	principalArn: "arn:aws:iam::000000000000:user/pawl-pi-proof-fixture",
};

const OFFLINE_MODEL_META = {
	id: FIXTURE_MODEL.id,
	name: FIXTURE_MODEL.name,
};

const OFFLINE_OPENING_PROMPT =
	'Proof round trip: call the proof_echo tool once with input "proof-round-trip", then summarize its result.';

const OFFLINE_RESUMED_REPLY =
	"The proof resumed: persisted history was loaded and this reply was produced only after your new prompt.";

function countModelRequests(
	inner: RuntimeAgentStreamFn,
	counter: { count: number },
): RuntimeAgentStreamFn {
	return (model, context, options) => {
		counter.count += 1;
		return inner(model, context, options);
	};
}

/**
 * The conversation allows exactly ONE event consumer (the Task 5 session
 * driver subscribes immediately). The proof runner still needs the raw events
 * for redacted tallies, so the driver's stream is teed: the driver receives a
 * proxy conversation whose events() also copies every event into an unbounded
 * queue consumed by the tap (the same pattern as scripts/verify-live-session.ts).
 */
function teeConversation(conversation: PawlConversation): {
	forDriver: PawlConversation;
	tapEvents: () => AsyncIterable<PawlConversationEvent>;
} {
	const buffered: PawlConversationEvent[] = [];
	let waiter:
		| ((result: IteratorResult<PawlConversationEvent>) => void)
		| undefined;
	let finished = false;
	const push = (event: PawlConversationEvent): void => {
		const wake = waiter;
		if (wake) {
			waiter = undefined;
			wake({ value: event, done: false });
			return;
		}
		buffered.push(event);
	};
	const forDriver: PawlConversation = {
		...conversation,
		events: () =>
			(async function* () {
				for await (const event of conversation.events()) {
					push(event);
					yield event;
				}
				finished = true;
				const wake = waiter;
				waiter = undefined;
				wake?.({ done: true } as IteratorResult<PawlConversationEvent>);
			})(),
	};
	const tapEvents = (): AsyncIterable<PawlConversationEvent> =>
		(async function* () {
			while (true) {
				const next = buffered.shift();
				if (next !== undefined) {
					yield next;
					continue;
				}
				if (finished) return;
				const result = await new Promise<IteratorResult<PawlConversationEvent>>(
					(resolveWait) => {
						waiter = resolveWait;
					},
				);
				if (result.done) return;
				yield result.value;
			}
		})();
	return { forDriver, tapEvents };
}

/**
 * Consumes the teed event copy and tallies redacted counts. `waitTerminal()`
 * resolves on the next run_terminal event.
 */
function pumpConversationEvents(
	events: AsyncIterable<PawlConversationEvent>,
	tallies: SessionTallies,
): { waitTerminal(): Promise<void>; done(): Promise<void> } {
	const terminalWaiters: Array<() => void> = [];
	const done = (async () => {
		for await (const event of events) {
			tallyEvent(event, tallies);
			if (event.type === "run_terminal") {
				const wake = terminalWaiters.shift();
				wake?.();
			}
		}
	})();
	return {
		waitTerminal: () =>
			new Promise<void>((resolveWait) => {
				terminalWaiters.push(resolveWait);
			}),
		done: () => done,
	};
}

function tallyEvent(
	event: PawlConversationEvent,
	tallies: SessionTallies,
): void {
	switch (event.type) {
		case "user_message":
			tallies.userMessages += 1;
			break;
		case "message_end":
			tallies.assistantReplies += 1;
			break;
		case "tool_result":
			tallies.toolExecutions += 1;
			break;
		case "reasoning_delta":
			tallies.reasoningObserved = true;
			break;
		case "run_terminal":
			tallies.outcomes.push(event.outcome);
			break;
		default:
			break;
	}
}

function fixtureToolCall(
	id: string,
	name: string,
	arguments_: Record<string, unknown>,
): ToolCall {
	return { type: "toolCall", id, name, arguments: arguments_ };
}

/** Offline script: echo round trip, then (on the next typed prompt) question → fake approval → done. */
function offlineScript(): ReturnType<typeof scriptedStreamFn> {
	return scriptedStreamFn([
		() =>
			toolCallStream([
				fixtureToolCall("call_proof_echo", PROOF_TOOL_NAMES.echo, {
					input: "proof-round-trip",
				}),
			]),
		() =>
			textStream(
				"The proof echo returned: proof-round-trip. Offline fixture round trip complete.",
			),
		() =>
			toolCallStream([
				fixtureToolCall("call_proof_ask", PROOF_TOOL_NAMES.askQuestion, {
					question: "Which stage should the proof exercise next?",
				}),
			]),
		() =>
			toolCallStream([
				fixtureToolCall("call_proof_write", PROOF_TOOL_NAMES.fakeWrite, {
					target: "demo",
				}),
			]),
		() => textStream("Offline proof sequence finished."),
	]);
}

async function recoveredSessionState(store: SessionStore): Promise<{
	initialMessages: readonly AgentMessage[];
	history: readonly RecoveredHistoryEntry[];
	tailDiscarded: boolean;
}> {
	const log = await readSessionLog(store.path);
	const recovered = recoverSessionContext(log.records);
	return {
		initialMessages: recovered.modelContext as unknown as AgentMessage[],
		history: recovered.history,
		tailDiscarded: log.tailDiscarded,
	};
}

function buildConversation(options: {
	id: string;
	model: Parameters<typeof createPawlRuntimeConversation>[0]["model"];
	streamFn: RuntimeAgentStreamFn;
	store: SessionStore;
	projectDir: string;
	identity: ProofIdentity;
	initialMessages: readonly AgentMessage[];
}): {
	conversation: PawlConversation;
	driver: PawlSessionDriver;
	tapEvents: () => AsyncIterable<PawlConversationEvent>;
	requestCounter: { count: number };
} {
	const mutations = createMutationCoordinator();
	const toolset = createProofToolset(
		options.projectDir,
		options.identity,
		mutations,
	);
	const requestCounter = { count: 0 };
	const conversation = createPawlRuntimeConversation({
		id: options.id,
		systemPrompt: PROOF_SYSTEM_PROMPT,
		model: options.model,
		tools: toolset.tools,
		streamFn: countModelRequests(options.streamFn, requestCounter),
		store: options.store,
		mutations,
		createAuthorizer: toolset.createAuthorizer,
		...(options.initialMessages.length === 0
			? {}
			: { initialMessages: [...options.initialMessages] }),
	});
	const tee = teeConversation(conversation);
	const driver = createSessionDriver(tee.forDriver);
	return { conversation, driver, tapEvents: tee.tapEvents, requestCounter };
}

async function prepareOfflineSession(
	config: ProofConfig,
	resolvedProjectDir: string,
	startedAt: number,
): Promise<SessionPlan> {
	const sessionId = config.resumeSessionId ?? `proof_offline_${startedAt}`;
	const metadata: SessionMetadata = {
		sessionId,
		projectPath: resolvedProjectDir,
		identity: OFFLINE_IDENTITY,
		model: OFFLINE_MODEL_META,
	};
	const store = config.resumeSessionId
		? await openSessionStore(metadata)
		: await createSessionStore(metadata);
	try {
		const recovered = config.resumeSessionId
			? await recoveredSessionState(store)
			: {
					initialMessages: [] as readonly AgentMessage[],
					history: [] as readonly RecoveredHistoryEntry[],
					tailDiscarded: false,
				};
		const scripted = config.resumeSessionId
			? scriptedStreamFn([() => textStream(OFFLINE_RESUMED_REPLY)])
			: offlineScript();
		const { conversation, driver, requestCounter, tapEvents } =
			buildConversation({
				id: `pawl-proof-offline-${sessionId}`,
				model: FIXTURE_MODEL,
				streamFn: scripted.streamFn as unknown as RuntimeAgentStreamFn,
				store,
				projectDir: resolvedProjectDir,
				identity: OFFLINE_IDENTITY,
				initialMessages: recovered.initialMessages,
			});
		return {
			sessionId,
			modelId: OFFLINE_MODEL_META.id,
			store,
			conversation,
			driver,
			tapEvents,
			tallies: {
				userMessages: 0,
				assistantReplies: 0,
				toolExecutions: 0,
				reasoningObserved: false,
				outcomes: [],
			},
			requestCounter,
			resumed: config.resumeSessionId !== undefined,
			recoveredHistory: recovered.history,
			tailDiscarded: recovered.tailDiscarded,
			openingPrompt: config.resumeSessionId
				? undefined
				: OFFLINE_OPENING_PROMPT,
			secondPrompt: undefined,
		};
	} catch (error) {
		await store.close().catch(() => {});
		throw error;
	}
}

async function runHeadlessSession(plan: SessionPlan): Promise<void> {
	const pump = pumpConversationEvents(plan.tapEvents(), plan.tallies);
	if (plan.openingPrompt !== undefined) {
		await plan.conversation.send(plan.openingPrompt);
		await pump.waitTerminal();
		if (plan.secondPrompt !== undefined) {
			await plan.conversation.send(plan.secondPrompt);
			await pump.waitTerminal();
		}
	}
	await plan.conversation.dispose();
	await pump.done();
}

async function runTuiSession(plan: SessionPlan): Promise<void> {
	const renderer = await createCliRenderer({
		exitOnCtrlC: false,
		backgroundColor: THEME.background,
	});
	try {
		const app = createPawlApp({
			renderer,
			onSubmit: (text) => {
				void plan.driver.submit(text);
			},
		});
		const view = createTuiView({ app });
		renderer.root.add(app.root);
		app.focusInput();
		if (plan.resumed) {
			view.restore(restoredLines(plan.recoveredHistory));
		}
		const pump = pumpConversationEvents(plan.tapEvents(), plan.tallies);
		// Ctrl+C cancels an active run; when idle it closes the proof terminal.
		renderer.keyInput.on("keypress", (event) => {
			if (!(event.ctrl && event.name === "c")) return;
			if (plan.driver.state.busy) {
				void plan.driver.cancel();
				return;
			}
			closeProof();
		});
		let resolveClosed: () => void = () => {};
		const closed = new Promise<void>((resolveClose) => {
			resolveClosed = resolveClose;
		});
		const closeProof = (): void => {
			resolveClosed();
		};
		if (plan.openingPrompt !== undefined) {
			void plan.driver.submit(plan.openingPrompt);
		}
		await closed;
		await plan.driver.dispose();
		await pump.done();
	} finally {
		renderer.destroy();
	}
}

function messageText(content: SessionMessage["content"]): string {
	if (typeof content === "string") return content;
	return content
		.filter(
			(block): block is { type: "text"; text: string } => block.type === "text",
		)
		.map((block) => block.text)
		.join("");
}

function restoredLines(
	history: readonly RecoveredHistoryEntry[],
): readonly RestoredLine[] {
	const lines: RestoredLine[] = [];
	for (const entry of history) {
		if (entry.kind === "interrupted") {
			lines.push({ role: "alert", text: `[interrupted: ${entry.reason}]` });
			continue;
		}
		const message = entry.message;
		if (message.role === "user") {
			lines.push({ role: "user", text: messageText(message.content) });
			continue;
		}
		const text = messageText(message.content);
		if (text.length === 0) continue;
		lines.push({
			role: message.role === "assistant" ? "assistant" : "tool",
			text,
		});
	}
	return lines;
}

function sessionEvidence(
	plan: SessionPlan,
	checks: readonly ProofCheck[],
): ProofSessionEvidence {
	return {
		sessionId: plan.sessionId,
		modelId: plan.modelId,
		path: plan.store.path,
		resumed: plan.resumed,
		userMessages: plan.tallies.userMessages,
		assistantReplies: plan.tallies.assistantReplies,
		toolExecutions: plan.tallies.toolExecutions,
		modelRequests: plan.requestCounter.count,
		reasoningObserved: plan.tallies.reasoningObserved,
		terminalOutcomes: [...plan.tallies.outcomes],
		checks,
	};
}

// ---- Project validation ------------------------------------------------------ //

async function assertProofProject(config: ProofConfig): Promise<string> {
	const resolved = resolve(config.projectDir);
	const info = await stat(resolved).catch(() => undefined);
	if (info?.isDirectory() !== true) {
		throw new ProofRefusedError(
			`--project-dir "${config.projectDir}" must select an existing directory for the proof project`,
		);
	}
	if (config.resumeSessionId !== undefined) {
		if (!SESSION_ID_PATTERN.test(config.resumeSessionId)) {
			throw new ProofRefusedError(
				`--resume-session "${config.resumeSessionId}" must be a plain session id`,
			);
		}
		const sessionPath = join(
			resolved,
			".pawl",
			"sessions",
			`${config.resumeSessionId}.jsonl`,
		);
		if (!existsSync(sessionPath)) {
			throw new ProofRefusedError(
				`Session "${config.resumeSessionId}" does not exist under ${resolved}/.pawl/sessions; nothing was loaded and no provider or credential was touched`,
			);
		}
		return resolved;
	}
	const entries = await readdir(resolved);
	if (entries.length > 0) {
		throw new ProofRefusedError(
			`The proof writes only into an empty, explicitly selected temporary project; ${resolved} already has ${entries.length} entr${entries.length === 1 ? "y" : "ies"}. Create a temporary directory (for example mktemp -d) and pass it as --project-dir; never select a working project.`,
		);
	}
	return resolved;
}

// ---- Offline mode ------------------------------------------------------------- //

async function runOfflineProof(config: ProofConfig): Promise<ProofEvidence> {
	const startedAt = Date.now();
	const resolvedProjectDir = await assertProofProject(config);
	const plan = await prepareOfflineSession(
		config,
		resolvedProjectDir,
		startedAt,
	);
	try {
		if (config.tui) {
			// Best-effort lock cleanup when the terminal process dies abruptly;
			// the normal Ctrl+C path disposes the store and releases the lock.
			const lockPath = `${plan.store.path}.lock`;
			process.on("exit", () => {
				try {
					rmSync(lockPath, { force: true });
				} catch {
					// Best effort only; the conservative lock policy documents manual cleanup.
				}
			});
			await runTuiSession(plan);
		} else {
			await runHeadlessSession(plan);
		}
	} finally {
		await plan.store.close().catch(() => {});
	}
	const session = sessionEvidence(
		plan,
		plan.resumed
			? [
					{
						name: "history_recovered",
						passed: plan.recoveredHistory.length > 0,
						detail: `${plan.recoveredHistory.length} recovered entries${plan.tailDiscarded ? "; an uncommitted tail was discarded conservatively" : ""}`,
					},
					{
						name: "no_automatic_opening_prompt",
						passed:
							plan.requestCounter.count === 0 &&
							plan.tallies.userMessages === 0 &&
							plan.tallies.outcomes.length === 0,
						detail: "a resumed session runs nothing until a new prompt",
					},
					{
						name: "offline_no_aws_credentials",
						passed: true,
						detail: "offline mode never constructs an execution context",
					},
				]
			: [
					{
						name: "offline_no_aws_credentials",
						passed: true,
						detail: "offline mode never constructs an execution context",
					},
					{
						name: "session_file_persisted",
						passed: existsSync(plan.store.path),
						detail: plan.store.path,
					},
					{
						name: "fixture_tool_round_trip",
						passed: plan.tallies.toolExecutions === 1,
						detail: `${plan.tallies.toolExecutions} tool result(s)`,
					},
					{
						name: "opening_run_completed",
						passed:
							plan.tallies.outcomes.length === 1 &&
							plan.tallies.outcomes[0] === "completed",
						detail: `terminal outcomes: ${plan.tallies.outcomes.join(", ") || "none"}`,
					},
				],
	);
	return {
		mode: "offline",
		projectDir: resolvedProjectDir,
		sessions: [session],
		identity: undefined,
	};
}

// ---- Live mode (env-gated; never exercised by tests) --------------------------- //

const LIVE_OPENING_PROMPT =
	"Live proof: reply with exactly PROOF-OK and nothing else. Do not call any tools.";

const LIVE_TOOL_PROMPT =
	'Live proof tool round trip: call the proof_echo tool once with input "live-round-trip", then summarize its result.';

/** Non-interactive stand-in for the Clack prompter: statuses only, no prompts. */
const statusPrompter: PreflightPrompter = {
	select: async () => null,
	text: async () => null,
	status: (message) => {
		console.log(`· ${message}`);
	},
	notice: (message) => {
		console.log(`· ${message}`);
	},
};

async function validateLiveSelections(config: ProofConfig): Promise<void> {
	if (
		config.profile === undefined ||
		config.region === undefined ||
		config.modelId === undefined ||
		config.secondModelId === undefined
	) {
		throw new ProofRefusedError(
			"Live mode requires --profile, --region, --model-id and --second-model-id",
		);
	}
	const deps = defaultPreflightDeps();
	// The production Clack credential/model validation runs BEFORE any
	// renderer is created (values come from arguments, not prompts).
	const groups = await loadAuthenticatedModels(
		deps,
		statusPrompter,
		config.profile,
		config.region,
	);
	if (!groups.ok) {
		throw new ProofRefusedError(groups.reason);
	}
	for (const modelId of [config.modelId, config.secondModelId]) {
		const validated = await validateModelSelection(
			deps,
			statusPrompter,
			config.profile,
			config.region,
			modelId,
			groups.value,
		);
		if (!validated.ok) {
			throw new ProofRefusedError(validated.reason);
		}
	}
}

async function prepareLiveSession(
	config: ProofConfig,
	resolvedProjectDir: string,
	context: Awaited<ReturnType<typeof createExecutionContext>>,
	modelId: string,
	index: number,
	startedAt: number,
): Promise<SessionPlan> {
	const model = resolveApprovedBedrockModel(modelId, context.region);
	const sessionId = config.resumeSessionId
		? config.resumeSessionId
		: `proof_live_${index}_${startedAt}`;
	const identity = {
		accountId: context.identity.accountId,
		region: context.region,
		principalArn: context.identity.principalArn,
	};
	const metadata: SessionMetadata = {
		sessionId,
		projectPath: resolvedProjectDir,
		identity,
		model: { id: model.id, name: model.name },
	};
	const store = config.resumeSessionId
		? await openSessionStore(metadata)
		: await createSessionStore(metadata);
	try {
		const recovered = config.resumeSessionId
			? await recoveredSessionState(store)
			: {
					initialMessages: [] as readonly AgentMessage[],
					history: [] as readonly RecoveredHistoryEntry[],
					tailDiscarded: false,
				};
		const bedrockStream = createBedrockModelStream(context, {
			reasoning: "medium",
		}) as unknown as RuntimeAgentStreamFn;
		const { conversation, driver, requestCounter, tapEvents } =
			buildConversation({
				id: `pawl-proof-live-${sessionId}`,
				model,
				streamFn: bedrockStream,
				store,
				projectDir: resolvedProjectDir,
				identity: { accountId: identity.accountId, region: identity.region },
				initialMessages: recovered.initialMessages,
			});
		return {
			sessionId,
			modelId: model.id,
			store,
			conversation,
			driver,
			tapEvents,
			tallies: {
				userMessages: 0,
				assistantReplies: 0,
				toolExecutions: 0,
				reasoningObserved: false,
				outcomes: [],
			},
			requestCounter,
			resumed: config.resumeSessionId !== undefined,
			recoveredHistory: recovered.history,
			tailDiscarded: recovered.tailDiscarded,
			openingPrompt: config.resumeSessionId ? undefined : LIVE_OPENING_PROMPT,
			secondPrompt: config.resumeSessionId ? undefined : LIVE_TOOL_PROMPT,
		};
	} catch (error) {
		await store.close().catch(() => {});
		throw error;
	}
}

async function runLiveProof(config: ProofConfig): Promise<ProofEvidence> {
	const startedAt = Date.now();
	const resolvedProjectDir = await assertProofProject(config);
	await validateLiveSelections(config);
	const context = await createExecutionContext({
		projectDir: resolvedProjectDir,
		profile: config.profile ?? "",
		region: config.region ?? "",
	});
	const identity = {
		accountId: context.identity.accountId,
		region: context.region,
		principalArn: context.identity.principalArn,
	};
	// A live resume invocation proves exactly one session (the resumed one);
	// a fresh live invocation proves both selected models, each in its own
	// session so reasoning/signatures are never replayed across models.
	const modelIds = config.resumeSessionId
		? [config.modelId ?? ""]
		: [config.modelId ?? "", config.secondModelId ?? ""];
	const sessions: ProofSessionEvidence[] = [];
	for (const [index, modelId] of modelIds.entries()) {
		const plan = await prepareLiveSession(
			config,
			resolvedProjectDir,
			context,
			modelId,
			index + 1,
			startedAt,
		);
		try {
			if (config.tui) {
				const lockPath = `${plan.store.path}.lock`;
				process.on("exit", () => {
					try {
						rmSync(lockPath, { force: true });
					} catch {
						// Best effort only.
					}
				});
				await runTuiSession(plan);
			} else {
				await runHeadlessSession(plan);
			}
		} finally {
			await plan.store.close().catch(() => {});
		}
		sessions.push(
			sessionEvidence(
				plan,
				plan.resumed
					? [
							{
								name: "history_recovered",
								passed: plan.recoveredHistory.length > 0,
								detail: `${plan.recoveredHistory.length} recovered entries`,
							},
							{
								name: "no_automatic_opening_prompt",
								passed:
									plan.requestCounter.count === 0 &&
									plan.tallies.userMessages === 0 &&
									plan.tallies.outcomes.length === 0,
								detail:
									"history was loaded without invoking the provider or any tool",
							},
						]
					: [
							{
								name: "identity_checked",
								passed: true,
								detail: `account ${redactAccount(identity.accountId)} via STS with checked credentials`,
							},
							{
								name: "opening_run_completed",
								passed:
									plan.tallies.outcomes.length >= 1 &&
									plan.tallies.outcomes[0] === "completed",
								detail: `terminal outcomes: ${plan.tallies.outcomes.join(", ") || "none"}`,
							},
							{
								name: "tool_round_trip_completed",
								passed: plan.tallies.toolExecutions >= 1,
								detail: `${plan.tallies.toolExecutions} tool result(s)`,
							},
							{
								name: "session_file_persisted",
								passed: existsSync(plan.store.path),
								detail: plan.store.path,
							},
							{
								name: "reasoning_stream_observed",
								passed: plan.tallies.reasoningObserved,
								detail: plan.tallies.reasoningObserved
									? "reasoning deltas streamed from the selected model"
									: "the selected model streamed no reasoning deltas in this run",
							},
						],
			),
		);
	}
	return {
		mode: "live",
		projectDir: resolvedProjectDir,
		sessions,
		identity,
	};
}

// ---- Entry points --------------------------------------------------------------- //

export async function runProof(config: ProofConfig): Promise<ProofEvidence> {
	// Defense in depth: even a directly constructed live config is refused
	// before anything (filesystem validation included) happens.
	if (config.mode === "live" && process.env.PAWL_PI_PROOF_LIVE !== "1") {
		throw new ProofRefusedError(
			"Live Bedrock proof calls require PAWL_PI_PROOF_LIVE=1 in the environment and --confirm-live-bedrock on the command line; refusing to touch AWS",
		);
	}
	if (config.mode === "offline") {
		return runOfflineProof(config);
	}
	return runLiveProof(config);
}

function redactAccount(accountId: string): string {
	return accountId.length >= 8
		? `${accountId.slice(0, 4)}…${accountId.slice(-4)}`
		: "…";
}

export function printEvidence(evidence: ProofEvidence): void {
	console.log(`pawl pi proof — mode: ${evidence.mode}`);
	console.log(`project: ${evidence.projectDir}`);
	if (evidence.identity) {
		console.log(
			`identity: account ${redactAccount(evidence.identity.accountId)}, region ${evidence.identity.region}, principal ${evidence.identity.principalArn}`,
		);
	} else {
		console.log(
			"identity: not established (offline mode resolves no AWS credentials)",
		);
	}
	for (const session of evidence.sessions) {
		console.log(
			`session ${session.sessionId} (model ${session.modelId}${session.resumed ? ", resumed" : ""})`,
		);
		console.log(
			`  user messages ${session.userMessages}, assistant messages ${session.assistantReplies}, tool executions ${session.toolExecutions}, model requests ${session.modelRequests}, reasoning streamed ${session.reasoningObserved ? "yes" : "no"}`,
		);
		console.log(
			`  terminal outcomes: ${session.terminalOutcomes.join(", ") || "none"}`,
		);
		console.log(`  session file (private, kept for resume): ${session.path}`);
		for (const check of session.checks) {
			console.log(
				`  [${check.passed ? "pass" : "FAIL"}] ${check.name}${check.detail ? ` — ${check.detail}` : ""}`,
			);
		}
	}
	console.log(
		"cleanup: delete the temporary project directory when the proof evidence is no longer needed.",
	);
}

async function main(): Promise<void> {
	const parsed = parseProofArgs(process.argv.slice(2));
	if (!parsed.ok) {
		console.error(`pawl-pi-proof: ${parsed.error}`);
		process.exit(2);
	}
	try {
		const evidence = await runProof(parsed.config);
		printEvidence(evidence);
		const failed = evidence.sessions.some((session) =>
			session.checks.some((check) => !check.passed),
		);
		if (failed) process.exit(1);
	} catch (error) {
		console.error(
			`pawl-pi-proof: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(1);
	}
}

if (import.meta.main) {
	void main();
}
