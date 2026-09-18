import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	Agent,
	type AgentEvent,
	type AgentTool,
} from "@earendil-works/pi-agent-core";
import type { Tool } from "@earendil-works/pi-ai";
import {
	type AuthorizerFactory,
	createPawlRuntimeConversation,
	type RuntimeAgentStreamFn,
	type RuntimeRunContext,
} from "../src/pi-runtime/agent";
import type {
	PawlConversation,
	PawlConversationEvent,
} from "../src/pi-runtime/conversation";
import { createMutationCoordinator } from "../src/pi-runtime/mutation";
import {
	createRuntimePolicy,
	type PolicyDependencies,
} from "../src/pi-runtime/policy";
import {
	createSessionStore,
	type SessionMetadata,
} from "../src/pi-runtime/session-store";
import {
	createPawlSpecialistDispatcher,
	DELEGATE_TOOL_NAME,
	delegateSchema,
	FINISH_RESULT_TOOL_NAME,
	generatorResultSchema,
	infraAuditorResultSchema,
	loadSpecialistInstructions,
	type PawlSpecialistDispatcher,
	plannerResultSchema,
	SPECIALIST_ROLES,
	type SpecialistRunContext,
	wellArchitectedResultSchema,
} from "../src/pi-runtime/specialists";
import {
	FIXTURE_MODEL,
	type FixtureStreamFactory,
	scriptedStreamFn,
	textStream,
	toolCallStream,
} from "./fixtures/pi-runtime-stream";

/**
 * Task 12 tests: bounded root-to-specialist orchestration.
 *
 * Both the parent and every specialist child are real installed Pi `Agent`
 * loops; only the provider streams are deterministic fixtures. The tests
 * prove: explicit prompt/data inputs, the four role configurations with the
 * preserved result shapes, child-only `finish_result` structured returns,
 * shared account/model/budgets through one shared policy, the two-child
 * concurrency limit, no nested delegation, child policy restrictions,
 * root-cancellation propagation, parent-dispose settlement and the
 * pending-mutation bypass guard.
 */

const identity = {
	accountId: "123456789012",
	region: "eu-central-1",
	principalArn: "arn:aws:iam::123456789012:user/proof",
};

const metadata = (sessionId: string, projectPath: string): SessionMetadata => ({
	sessionId,
	projectPath,
	identity,
	model: { id: "eu.amazon.nova-2-lite-v1:0", name: "Nova 2 Lite" },
});

const fixtureInstructions = (role: string): string =>
	`You are the fixture ${role} specialist for pawl. Return your structured result.`;

const PLANNER_RESULT = {
	summary: "Serverless API with DynamoDB",
	services: [
		{ name: "ApiGateway", justification: "HTTP entrypoint" },
		{ name: "DynamoDB", justification: "Single-table storage" },
	],
	network: "No VPC required",
	security: "Least-privilege IAM, KMS encryption",
	observability: "Structured JSON logs, X-Ray tracing, alarms",
	diagram: "graph TD\n  A[Client] --> B[ApiGateway]",
	deployment: "Single CDK stack via @pawl/cdk",
	filePlan: [{ path: "infra/stack.ts", purpose: "Main stack" }],
};

const GENERATOR_RESULT = {
	files: [
		{
			path: "infra/stack.ts",
			content: "export class Stack {}\n",
		},
	],
	notes: "Follows the approved plan exactly.",
};

// ---- Event collector (same shape as the Task 10 tests) ------------------- //

interface Collector {
	readonly events: PawlConversationEvent[];
	terminals(): PawlConversationEvent[];
	waitFor(
		predicate: (event: PawlConversationEvent) => boolean,
	): Promise<PawlConversationEvent>;
}

function collectEvents(conversation: PawlConversation): Collector {
	const events: PawlConversationEvent[] = [];
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
		}
	})();
	return {
		events,
		terminals: () => events.filter((event) => event.type === "run_terminal"),
		waitFor: async (predicate) => {
			const cursor = events.length;
			return new Promise<PawlConversationEvent>((resolve) => {
				waiters.push({
					predicate: (event) =>
						events.indexOf(event) >= cursor && predicate(event),
					resolve,
				});
			});
		},
	};
}

const waitForCondition = async (condition: () => boolean): Promise<void> => {
	for (let index = 0; index < 200 && !condition(); index += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	if (!condition()) {
		throw new Error("Condition was not met before the wait budget ran out");
	}
};

// ---- Conversation harness ------------------------------------------------- //

const cleanupDirs: string[] = [];
const activeConversations: PawlConversation[] = [];
const activeDispatchers: PawlSpecialistDispatcher[] = [];
const policies: ReturnType<typeof createRuntimePolicy>[] = [];

afterEach(async () => {
	for (const conversation of activeConversations.splice(0)) {
		await conversation.dispose().catch(() => {});
	}
	for (const dispatcher of activeDispatchers.splice(0)) {
		await dispatcher.dispose().catch(() => {});
	}
	for (const policy of policies.splice(0)) {
		policy.dispose();
	}
	for (const dir of cleanupDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

async function tracked(dir: string): Promise<string> {
	cleanupDirs.push(dir);
	return dir;
}

interface HarnessOptions {
	script: readonly FixtureStreamFactory[];
	roles?: readonly string[];
	limits?: { modelCalls?: number; toolExecutions?: number };
	policyDependencies?: Partial<PolicyDependencies>;
	loadInstructions?: (role: string) => Promise<string>;
}

interface Harness {
	conversation: PawlConversation;
	projectDir: string;
	requests: ReturnType<typeof scriptedStreamFn>["requests"];
	collected: Collector;
	mutations: ReturnType<typeof createMutationCoordinator>;
	dispatcher: PawlSpecialistDispatcher;
}

async function makeHarness(options: HarnessOptions): Promise<Harness> {
	const projectDir = await tracked(
		await mkdtemp(join(tmpdir(), "pawl-specialist-proof-")),
	);
	const store = await createSessionStore(metadata("s1", projectDir), {});
	const scripted = scriptedStreamFn(options.script);
	const mutations = createMutationCoordinator();
	/** The authorizer captures the live run context for the dispatcher. */
	const runHolder: { current: RuntimeRunContext | undefined } = {
		current: undefined,
	};
	const capturingAuthorizer: AuthorizerFactory = (run) => {
		runHolder.current = run;
		return async () => ({ granted: true });
	};
	const dispatcher = createPawlSpecialistDispatcher({
		model: FIXTURE_MODEL,
		streamFn: scripted.streamFn as RuntimeAgentStreamFn,
		mutations,
		resolveRun: () => runHolder.current,
		...(options.loadInstructions
			? { loadInstructions: options.loadInstructions }
			: {}),
	});
	activeDispatchers.push(dispatcher);
	const conversation = createPawlRuntimeConversation({
		id: "specialist_proof",
		systemPrompt: "Pawl proof system prompt",
		model: FIXTURE_MODEL,
		tools: dispatcher.tools as readonly AgentTool<
			Tool["parameters"],
			unknown
		>[],
		streamFn: scripted.streamFn as RuntimeAgentStreamFn,
		store,
		mutations,
		createAuthorizer: capturingAuthorizer,
		...(options.limits ? { policyLimits: options.limits } : {}),
		...(options.policyDependencies
			? { policyDependencies: options.policyDependencies }
			: {}),
	});
	activeConversations.push(conversation);
	const collected = collectEvents(conversation);
	return {
		conversation,
		projectDir,
		requests: scripted.requests,
		collected,
		mutations,
		dispatcher,
	};
}

const delegateCall = (
	id: string,
	input: Record<string, unknown>,
): {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
} => ({
	type: "toolCall",
	id,
	name: DELEGATE_TOOL_NAME,
	arguments: input,
});

const finishCall = (
	id: string,
	result: unknown,
): {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
} => ({
	type: "toolCall",
	id,
	name: FINISH_RESULT_TOOL_NAME,
	arguments: { result },
});

const toolResultEvents = (
	collected: Collector,
	toolCallId: string,
): PawlConversationEvent[] =>
	collected.events.filter(
		(event) => event.type === "tool_result" && event.toolCallId === toolCallId,
	);

type TerminalEvent = Extract<PawlConversationEvent, { type: "run_terminal" }>;
type ToolResultEvent = Extract<PawlConversationEvent, { type: "tool_result" }>;

const asTerminal = (event: PawlConversationEvent): TerminalEvent => {
	if (event.type !== "run_terminal") {
		throw new Error(`Expected a terminal event, received ${event.type}`);
	}
	return event;
};

const asToolResult = (event: PawlConversationEvent): ToolResultEvent => {
	if (event.type !== "tool_result") {
		throw new Error(`Expected a tool_result event, received ${event.type}`);
	}
	return event;
};

const requireAt = <T>(items: readonly T[], index: number): T => {
	const item = items[index];
	if (item === undefined) {
		throw new Error(`Missing item at index ${index}`);
	}
	return item;
};

// ---- Tests ---------------------------------------------------------------- //

describe("specialist role configurations", () => {
	test("delegate input requires an explicit role, prompt and optional data", () => {
		expect(
			delegateSchema.safeParse({
				role: "planner",
				prompt: "Plan the service.",
				data: "SCAN DATA",
			}).success,
		).toBe(true);
		expect(
			delegateSchema.safeParse({ role: "researcher", prompt: "x" }).success,
		).toBe(false);
		expect(
			delegateSchema.safeParse({ role: "planner", prompt: "" }).success,
		).toBe(false);
		expect(delegateSchema.safeParse({ role: "planner" }).success).toBe(false);
		expect([...SPECIALIST_ROLES]).toEqual([
			"planner",
			"generator",
			"well-architected",
			"infra-auditor",
		]);
	});

	test("owned result schemas preserve the authored planner, WAF and auditor shapes and add the generator file set", () => {
		expect(plannerResultSchema.safeParse(PLANNER_RESULT).success).toBe(true);
		expect(
			plannerResultSchema.safeParse({ ...PLANNER_RESULT, extra: 1 }).success,
		).toBe(false);
		expect(
			wellArchitectedResultSchema.safeParse({
				pillars: [
					{
						pillar: "Security",
						currentState: "IAM is ad hoc",
						risks: ["No least privilege"],
						recommendations: [
							{ text: "Use @pawl/cdk constructs", priority: "high" },
						],
					},
				],
			}).success,
		).toBe(true);
		expect(
			infraAuditorResultSchema.safeParse({
				findings: [
					{
						construct: "ApiGateway",
						resourceKind: "REST API",
						resourceNames: ["prod-api"],
						declaredInProject: true,
						rationale: "Drop-in replacement",
						effort: "low",
						risk: "low",
					},
				],
				coverageWarning: "s3 was not scanned",
			}).success,
		).toBe(true);
		const parsed = generatorResultSchema.parse(GENERATOR_RESULT);
		expect(parsed.files).toHaveLength(1);
		expect(generatorResultSchema.safeParse({ files: [] }).success).toBe(true);
		expect(generatorResultSchema.safeParse({ files: "many" }).success).toBe(
			false,
		);
	});
});

describe("root-to-child dispatch", () => {
	test("planner delegation runs a real child agent and returns only the validated structured result", async () => {
		const harness = await makeHarness({
			script: [
				() =>
					toolCallStream([
						delegateCall("d1", {
							role: "planner",
							prompt: "Plan the service.",
							data: "SCAN DATA",
						}),
					]),
				() => toolCallStream([finishCall("f1", PLANNER_RESULT)]),
				() => textStream("Plan received."),
			],
			loadInstructions: async (role) => fixtureInstructions(role),
		});
		await harness.conversation.send("start planning");
		const terminal = await harness.collected.waitFor(
			(event) => event.type === "run_terminal",
		);
		expect(asTerminal(terminal).outcome).toBe("completed");

		// The child was a real Agent dispatch through the shared model/streamFn.
		expect(harness.requests).toHaveLength(3);
		const childRequest = requireAt(harness.requests, 1);
		expect(childRequest.model.id).toBe(FIXTURE_MODEL.id);
		// The authored instructions are the base; the runtime appends the fixed
		// finish_result contract.
		expect(
			(childRequest.context.systemPrompt ?? "").startsWith(
				fixtureInstructions("planner"),
			),
		).toBe(true);
		expect(childRequest.context.systemPrompt).toContain(
			FINISH_RESULT_TOOL_NAME,
		);
		const childPrompt = JSON.stringify(childRequest.context.messages[0]);
		expect(childPrompt).toContain("Plan the service.");
		expect(childPrompt).toContain("SCAN DATA");

		// The delegation tool result is exactly the validated structured result.
		const results = toolResultEvents(harness.collected, "d1");
		expect(results).toHaveLength(1);
		const resultEvent = asToolResult(requireAt(results, 0));
		expect(resultEvent.status).toBe("completed");
		const text = resultEvent.text ?? "";
		const parsed = JSON.parse(text) as {
			role: string;
			result: typeof PLANNER_RESULT;
		};
		expect(parsed.role).toBe("planner");
		expect(parsed.result).toEqual(PLANNER_RESULT);
		expect(plannerResultSchema.safeParse(parsed.result).success).toBe(true);
	});

	test("generator delegation returns a proposed file set and writes nothing", async () => {
		const projectDir = await tracked(
			await mkdtemp(join(tmpdir(), "pawl-specialist-write-")),
		);
		await writeFile(join(projectDir, "canary.txt"), "untouched");
		const harness = await makeHarness({
			script: [
				() =>
					toolCallStream([
						delegateCall("d1", {
							role: "generator",
							prompt: "Write the approved plan.",
						}),
					]),
				() => toolCallStream([finishCall("f1", GENERATOR_RESULT)]),
				() => textStream("Proposal received."),
			],
			loadInstructions: async (role) => fixtureInstructions(role),
		});
		await harness.conversation.send("generate");
		const terminal = await harness.collected.waitFor(
			(event) => event.type === "run_terminal",
		);
		expect(asTerminal(terminal).outcome).toBe("completed");

		const results = toolResultEvents(harness.collected, "d1");
		expect(results).toHaveLength(1);
		const text = asToolResult(requireAt(results, 0)).text ?? "";
		const parsed = JSON.parse(text) as { role: string; result: unknown };
		expect(parsed.role).toBe("generator");
		expect(parsed.result).toEqual(GENERATOR_RESULT);

		// Nothing was written: the dispatcher has no writer and no shell, and
		// the project directory only contains the pre-existing canary file.
		expect(harness.dispatcher.tools.map((tool) => tool.name)).toEqual([
			DELEGATE_TOOL_NAME,
		]);
		const entries = await readdir(projectDir);
		expect(entries).toEqual(["canary.txt"]);
	});

	test("JSON-shaped text without finish_result is a visible failure, not a result", async () => {
		const harness = await makeHarness({
			script: [
				() =>
					toolCallStream([
						delegateCall("d1", { role: "planner", prompt: "Plan it." }),
					]),
				() => textStream('{"summary": "looks like a plan"}'),
				() => textStream("Noted the failure."),
			],
			loadInstructions: async (role) => fixtureInstructions(role),
		});
		await harness.conversation.send("plan");
		const terminal = await harness.collected.waitFor(
			(event) => event.type === "run_terminal",
		);
		expect(asTerminal(terminal).outcome).toBe("completed");
		const results = toolResultEvents(harness.collected, "d1");
		expect(results).toHaveLength(1);
		const text = asToolResult(requireAt(results, 0)).text ?? "";
		expect(asToolResult(requireAt(results, 0)).status).toBe("error");
		expect(text).toContain(FINISH_RESULT_TOOL_NAME);
		expect(text).not.toContain("looks like a plan");
	});

	test("an invalid finish_result payload is a visible failure", async () => {
		const harness = await makeHarness({
			script: [
				() =>
					toolCallStream([
						delegateCall("d1", { role: "planner", prompt: "Plan it." }),
					]),
				// summary must be a string: this payload can never validate.
				() =>
					toolCallStream([
						finishCall("f1", { ...PLANNER_RESULT, summary: 42 }),
					]),
				() => textStream("Giving up."),
				() => textStream("Noted the failure."),
			],
			loadInstructions: async (role) => fixtureInstructions(role),
		});
		await harness.conversation.send("plan");
		const terminal = await harness.collected.waitFor(
			(event) => event.type === "run_terminal",
		);
		expect(asTerminal(terminal).outcome).toBe("completed");
		const results = toolResultEvents(harness.collected, "d1");
		const text = asToolResult(requireAt(results, 0)).text ?? "";
		expect(asToolResult(requireAt(results, 0)).status).toBe("error");
		expect(text).toContain("invalid");
	});

	test("specialist children cannot delegate or use restricted tools", async () => {
		const harness = await makeHarness({
			script: [
				() =>
					toolCallStream([
						delegateCall("d1", { role: "planner", prompt: "Plan it." }),
					]),
				// The child attempts nested delegation, then asks a question.
				() =>
					toolCallStream([
						{
							type: "toolCall" as const,
							id: "nested",
							name: DELEGATE_TOOL_NAME,
							arguments: { role: "generator", prompt: "nested" },
						},
					]),
				() => textStream("Giving up."),
				() => textStream("Noted the failure."),
			],
			loadInstructions: async (role) => fixtureInstructions(role),
		});
		await harness.conversation.send("plan");
		const terminal = await harness.collected.waitFor(
			(event) => event.type === "run_terminal",
		);
		expect(asTerminal(terminal).outcome).toBe("completed");
		const results = toolResultEvents(harness.collected, "d1");
		const text = asToolResult(requireAt(results, 0)).text ?? "";
		expect(asToolResult(requireAt(results, 0)).status).toBe("error");
		expect(text).toContain(DELEGATE_TOOL_NAME);
		// The nested attempt never reached another agent: root turn + blocked
		// child turn + child wrap-up + root wrap-up.
		expect(harness.requests).toHaveLength(4);
	});
});

describe("bounded concurrency and shared budgets", () => {
	test("the two-child limit refuses a third concurrent delegation", async () => {
		const scripted = scriptedStreamFn([
			() =>
				toolCallStream([
					delegateCall("d1", { role: "planner", prompt: "one" }),
					delegateCall("d2", { role: "planner", prompt: "two" }),
					delegateCall("d3", { role: "planner", prompt: "three" }),
				]),
			() => toolCallStream([finishCall("f1", PLANNER_RESULT)]),
			() => toolCallStream([finishCall("f2", PLANNER_RESULT)]),
			() => textStream("All children settled."),
		]);
		const policy = createRuntimePolicy();
		policies.push(policy);
		const parentAbort = new AbortController();
		const run: SpecialistRunContext = { policy, signal: parentAbort.signal };
		const mutations = createMutationCoordinator();
		const dispatcher = createPawlSpecialistDispatcher({
			model: FIXTURE_MODEL,
			streamFn: scripted.streamFn as RuntimeAgentStreamFn,
			mutations,
			resolveRun: () => run,
			loadInstructions: async (role) => fixtureInstructions(role),
		});
		activeDispatchers.push(dispatcher);
		const parent = new Agent({
			initialState: {
				systemPrompt: "root",
				model: FIXTURE_MODEL,
				tools: [...dispatcher.tools],
				thinkingLevel: "off",
			},
			streamFn: scripted.streamFn,
			toolExecution: "parallel",
		});
		const events: AgentEvent[] = [];
		parent.subscribe((event) => {
			events.push(event);
		});
		await parent.prompt("fan out");
		await parent.waitForIdle();

		const delegateEnds = events.filter(
			(event) =>
				event.type === "tool_execution_end" &&
				event.toolName === DELEGATE_TOOL_NAME,
		) as Extract<AgentEvent, { type: "tool_execution_end" }>[];
		expect(delegateEnds).toHaveLength(3);
		const errors = delegateEnds.filter((event) => event.isError);
		const completed = delegateEnds.filter((event) => !event.isError);
		expect(errors).toHaveLength(1);
		expect(JSON.stringify(errors[0]?.result)).toContain("concurrent");
		expect(completed).toHaveLength(2);
		for (const event of completed) {
			const parsed = JSON.parse(
				(event.result.content[0] as { text: string }).text,
			) as { result: unknown };
			expect(parsed.result).toEqual(PLANNER_RESULT);
		}
		expect(dispatcher.activeChildren).toBe(0);
	});

	test("a shared model-call budget prevents further model requests in every agent", async () => {
		const harness = await makeHarness({
			script: [
				() =>
					toolCallStream([
						delegateCall("d1", { role: "planner", prompt: "Plan it." }),
					]),
				() =>
					toolCallStream([
						finishCall("f1", { ...PLANNER_RESULT, summary: 42 }),
					]),
				() => textStream("Never dispatched."),
			],
			limits: { modelCalls: 2 },
			loadInstructions: async (role) => fixtureInstructions(role),
		});
		await harness.conversation.send("plan");
		const terminal = await harness.collected.waitFor(
			(event) => event.type === "run_terminal",
		);
		expect(asTerminal(terminal).outcome).toBe("failed");
		expect(terminal.type === "run_terminal" && terminal.code).toBe(
			"model_call_budget",
		);
		// Root request + one child request; the child's next request was refused
		// before dispatch, and the root never got a follow-up request either.
		expect(harness.requests).toHaveLength(2);
		const results = toolResultEvents(harness.collected, "d1");
		const text = asToolResult(requireAt(results, 0)).text ?? "";
		expect(asToolResult(requireAt(results, 0)).status).toBe("error");
		expect(text).toContain("Model call budget");
	});

	test("a shared tool-execution budget prevents child tool execution", async () => {
		const harness = await makeHarness({
			script: [
				() =>
					toolCallStream([
						delegateCall("d1", { role: "planner", prompt: "Plan it." }),
					]),
				() => toolCallStream([finishCall("f1", PLANNER_RESULT)]),
				() => textStream("Never reached."),
			],
			limits: { toolExecutions: 1 },
			loadInstructions: async (role) => fixtureInstructions(role),
		});
		await harness.conversation.send("plan");
		const terminal = await harness.collected.waitFor(
			(event) => event.type === "run_terminal",
		);
		expect(asTerminal(terminal).outcome).toBe("failed");
		expect(terminal.type === "run_terminal" && terminal.code).toBe(
			"tool_execution_budget",
		);
		const results = toolResultEvents(harness.collected, "d1");
		const text = asToolResult(requireAt(results, 0)).text ?? "";
		expect(asToolResult(requireAt(results, 0)).status).toBe("error");
		expect(text).toContain("budget");
	});
});

describe("cancellation and settlement", () => {
	test("root cancellation settles the child and aborts its provider stream", async () => {
		const harness = await makeHarness({
			script: [
				() =>
					toolCallStream([
						delegateCall("d1", { role: "planner", prompt: "Plan it." }),
					]),
				() => textStream("child thinking forever"),
			],
			loadInstructions: async (role) => fixtureInstructions(role),
		});
		await harness.conversation.send("plan");
		await waitForCondition(() => harness.requests.length === 2);
		await harness.conversation.cancel();
		const terminal = await harness.collected.waitFor(
			(event) => event.type === "run_terminal",
		);
		expect(asTerminal(terminal).outcome).toBe("cancelled");
		expect(terminal.type === "run_terminal" && terminal.code).toBe(
			"run_cancelled",
		);
		expect(harness.dispatcher.activeChildren).toBe(0);
	});

	test("disposing the parent settles all children", async () => {
		const harness = await makeHarness({
			script: [
				() =>
					toolCallStream([
						delegateCall("d1", { role: "planner", prompt: "Plan it." }),
					]),
				() => textStream("child thinking forever"),
			],
			loadInstructions: async (role) => fixtureInstructions(role),
		});
		await harness.conversation.send("plan");
		await waitForCondition(() => harness.requests.length === 2);
		await harness.conversation.dispose();
		expect(harness.dispatcher.activeChildren).toBe(0);
	});

	test("finish_result cannot bypass pending mutations", async () => {
		const harness = await makeHarness({
			script: [
				() =>
					toolCallStream([
						delegateCall("d1", { role: "planner", prompt: "Plan it." }),
					]),
				() => toolCallStream([finishCall("f1", PLANNER_RESULT)]),
				() => textStream("Giving up."),
				() => textStream("Noted."),
			],
			loadInstructions: async (role) => fixtureInstructions(role),
		});
		let releaseHold: (() => void) | undefined;
		const hold = harness.mutations.run(
			() =>
				new Promise<void>((resolve) => {
					releaseHold = resolve;
				}),
			{ owner: "external-side-effect" },
		);
		try {
			await harness.conversation.send("plan");
			const terminal = await harness.collected.waitFor(
				(event) => event.type === "run_terminal",
			);
			expect(asTerminal(terminal).outcome).toBe("completed");
			const results = toolResultEvents(harness.collected, "d1");
			const text = asToolResult(requireAt(results, 0)).text ?? "";
			expect(asToolResult(requireAt(results, 0)).status).toBe("error");
			expect(text).toContain("mutation");
		} finally {
			releaseHold?.();
			await hold.catch(() => {});
		}
	});
});

describe("role instruction data", () => {
	test("role instructions are read as markdown data from the authored role files", async () => {
		for (const role of SPECIALIST_ROLES) {
			const instructions = await loadSpecialistInstructions(role);
			expect(instructions.length).toBeGreaterThan(0);
			expect(instructions.toLowerCase()).toContain("pawl");
		}
	});

	test("the default wiring feeds the authored planner markdown to the real child agent", async () => {
		const harness = await makeHarness({
			script: [
				() =>
					toolCallStream([
						delegateCall("d1", { role: "planner", prompt: "Plan it." }),
					]),
				() => toolCallStream([finishCall("f1", PLANNER_RESULT)]),
				() => textStream("Plan received."),
			],
		});
		await harness.conversation.send("plan");
		await harness.collected.waitFor((event) => event.type === "run_terminal");
		const expected = await loadSpecialistInstructions("planner");
		expect(
			(requireAt(harness.requests, 1).context.systemPrompt ?? "").startsWith(
				expected,
			),
		).toBe(true);
		expect(expected).toContain("planning specialist");
	});
});
