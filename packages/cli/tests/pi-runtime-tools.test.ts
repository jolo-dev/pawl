import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { Tool } from "@earendil-works/pi-ai";
import {
	createPawlRuntimeConversation,
	type PolicyLimits,
	type RuntimeAgentStreamFn,
} from "../src/pi-runtime/agent";
import { ApprovalBroker } from "../src/pi-runtime/approval";
import type {
	PawlConversation,
	PawlConversationEvent,
} from "../src/pi-runtime/conversation";
import {
	type ArtifactExec,
	type DeployTarget,
	prepareArtifact,
} from "../src/pi-runtime/deploy-artifact";
import type {
	ControlledExecRequest,
	ControlledExecResult,
} from "../src/pi-runtime/host-exec";
import { createMutationCoordinator } from "../src/pi-runtime/mutation";
import {
	createRuntimePolicy,
	type PolicyDependencies,
} from "../src/pi-runtime/policy";
import {
	parseSessionLog,
	type SessionRecord,
	toolIntentDigest,
} from "../src/pi-runtime/session-record";
import {
	createSessionStore,
	type SessionMetadata,
	type SessionStore,
} from "../src/pi-runtime/session-store";
import {
	createPawlToolset,
	type PawlDeploymentDependency,
	type PawlGenerateDependency,
	type PawlScanDependency,
	type PawlToolset,
} from "../src/pi-runtime/tools";
import {
	FIXTURE_MODEL,
	type FixtureStreamFactory,
	scriptedStreamFn,
	textStream,
	toolCallStream,
} from "./fixtures/pi-runtime-stream";

/**
 * Task 11 tests: the representative Pawl tools (ask_question, scan_resources,
 * approval-gated generate, deploy_preview/deploy_infra) run through the real
 * Pi Agent and the real Task 6/9 policy machinery. Only the domain seams are
 * offline fakes (scan dependency, proof writer, artifact synthesis, preview and
 * deploy executors); every approval flows through the run-scoped ApprovalBroker
 * and is answered through the conversation like the UI would. Refusals are
 * asserted with fixture filesystem/executor evidence, not prompt counts.
 */

const identity = {
	accountId: "123456789012",
	region: "eu-central-1",
	principalArn: "arn:aws:iam::123456789012:user/proof",
};

const TARGET: DeployTarget = {
	accountId: identity.accountId,
	region: identity.region,
};

const sessionModel = { id: "eu.amazon.nova-2-lite-v1:0", name: "Nova 2 Lite" };

const metadata = (sessionId: string, projectPath: string): SessionMetadata => ({
	sessionId,
	projectPath,
	identity,
	model: sessionModel,
});

// ---- collector (same contract as the agent tests) ----------------------- //

interface Collector {
	readonly events: PawlConversationEvent[];
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
		waitFor: async (predicate) => {
			// Waits only for FUTURE events: an already-observed event must never
			// satisfy a later wait.
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

const flush = async (): Promise<void> => {
	for (let index = 0; index < 10; index += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
};

const toolCall = (id: string, input: unknown, name: string) => ({
	type: "toolCall" as const,
	id,
	name,
	arguments: input as Record<string, unknown>,
});

// ---- fixture assembly + executors (Task 9 patterns) --------------------- //

const directories: string[] = [];
const scratch = () => {
	const path = mkdtempSync(join(tmpdir(), "pawl-tools-proof-"));
	directories.push(path);
	return path;
};

interface Harness {
	conversation: PawlConversation;
	projectDir: string;
	store: SessionStore;
	mutations: ReturnType<typeof createMutationCoordinator>;
	toolset: PawlToolset;
	collected: Collector;
	generate: ReturnType<typeof fakeGenerate>;
	exec: FakeDeployExec;
	deployment: ReturnType<typeof deploymentWith>;
}

const activeHarnesses: Harness[] = [];

afterEach(async () => {
	for (const harness of activeHarnesses.splice(0)) {
		await harness.conversation.dispose().catch(() => {});
	}
	for (const path of directories.splice(0)) {
		rmSync(path, { recursive: true, force: true });
	}
});

function writeProjectAssembly(
	assemblyDir: string,
	stacks: readonly string[] = ["PawlStack"],
) {
	const artifacts: Record<string, unknown> = {};
	for (const stack of stacks) {
		artifacts[stack] = {
			type: "aws:cloudformation:stack",
			environment: `aws://${TARGET.accountId}/${TARGET.region}`,
			properties: {
				templateFile: `${stack}.template.json`,
				stackName: stack,
			},
		};
	}
	artifacts[`${stacks[0]}.assets`] = {
		type: "cdk:asset-manifest",
		properties: { file: "assets.json" },
	};
	artifacts.tree = { type: "cdk:tree", properties: { file: "tree.json" } };
	writeFileSync(
		join(assemblyDir, "manifest.json"),
		JSON.stringify({ version: "39.0.0", artifacts }),
	);
	for (const stack of stacks) {
		writeFileSync(
			join(assemblyDir, `${stack}.template.json`),
			JSON.stringify({ Resources: {} }),
		);
	}
	writeFileSync(join(assemblyDir, "tree.json"), "{}");
	mkdirSync(dirname(join(assemblyDir, "assets/handler.js")), {
		recursive: true,
	});
	writeFileSync(
		join(assemblyDir, "assets/handler.js"),
		"materialized handler bytes",
	);
	writeFileSync(
		join(assemblyDir, "assets.json"),
		JSON.stringify({
			version: "assets-1.0",
			files: {
				asset1: {
					source: { path: "assets/handler.js" },
					destinations: {
						current: {
							bucketName: `cdk-hnb659fds-assets-${TARGET.accountId}-${TARGET.region}`,
							objectKey: "handler.zip",
						},
					},
				},
			},
		}),
	);
}

const fakeResult = (
	request: ControlledExecRequest,
	overrides: Partial<ControlledExecResult> = {},
): ControlledExecResult => ({
	command: request.command,
	args: [...(request.args ?? [])],
	exitCode: 0,
	stdout: "",
	stderr: "",
	stdoutTruncated: false,
	stderrTruncated: false,
	...overrides,
});

/** Recomputes the frozen digests of the assembly the executor was pointed at. */
const observedAssemblyDigests = (request: ControlledExecRequest) => {
	const args = request.args ?? [];
	const appIndex = args.indexOf("--app");
	if (appIndex < 0) throw new Error("executor was not pointed at an assembly");
	const assemblyDir = args[appIndex + 1];
	if (assemblyDir === undefined) throw new Error("--app without a value");
	const files: { path: string; sha256: string }[] = [];
	const visit = (dir: string) => {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			const stat = lstatSync(full);
			if (stat.isSymbolicLink()) throw new Error("unexpected symlink");
			if (stat.isDirectory()) {
				visit(full);
				continue;
			}
			files.push({
				path: relative(assemblyDir, full).split(sep).join("/"),
				sha256: createHash("sha256").update(readFileSync(full)).digest("hex"),
			});
		}
	};
	visit(assemblyDir);
	files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	return files;
};

interface FakeDeployExec {
	readonly exec: ArtifactExec;
	readonly diffCalls: ControlledExecRequest[];
	readonly deployCalls: ControlledExecRequest[];
	readonly observed: { path: string; sha256: string }[][];
}

const makeDeployExec = (
	options: {
		diffStdout?: string;
		diffOverrides?: Partial<ControlledExecResult>;
		deployOverrides?: Partial<ControlledExecResult>;
	} = {},
): FakeDeployExec => {
	const diffCalls: ControlledExecRequest[] = [];
	const deployCalls: ControlledExecRequest[] = [];
	const observed: { path: string; sha256: string }[][] = [];
	return {
		diffCalls,
		deployCalls,
		observed,
		exec: {
			run: async (request) => {
				const args = request.args ?? [];
				if (args[1] === "diff") {
					diffCalls.push(request);
					return fakeResult(request, {
						stdout: "Stack PawlStack\n[+] AWS::SQS::Queue Orders OrdersABC\n",
						...options.diffOverrides,
					});
				}
				if (args[1] === "deploy") {
					deployCalls.push(request);
					observed.push(observedAssemblyDigests(request));
					return fakeResult(request, {
						stdout: "PawlStack: creating changeset... done",
						...options.deployOverrides,
					});
				}
				throw new Error(`unexpected executor command: ${args.join(" ")}`);
			},
		},
	};
};

// ---- fake domain seams --------------------------------------------------- //

interface ScanCall {
	services?: readonly string[];
	maxEntries?: number;
	signal?: AbortSignal;
}

const fakeScan = (
	outcome: Record<string, unknown>,
): PawlScanDependency & { readonly calls: ScanCall[] } => {
	const calls: ScanCall[] = [];
	return {
		calls,
		scan: async (request) => {
			calls.push(request);
			return outcome as unknown as Awaited<
				ReturnType<PawlScanDependency["scan"]>
			>;
		},
	};
};

const scanOutcome = (overrides: Record<string, unknown> = {}) => ({
	report: {
		accountId: TARGET.accountId,
		region: TARGET.region,
		synthesizedCount: 1,
		deployedCount: 2,
		drift: { matched: 1, notDeployed: 0, unmanaged: 1, foreign: 0 },
		coverage: {
			total: 7,
			scanned: 7,
			denied: 0,
			error: 0,
			unsupported: 0,
			complete: true,
			gaps: [],
		},
		entries: [
			{
				status: "unmanaged",
				name: "someone-elses-table",
				resourceKind: "AWS::DynamoDB::Table",
				basis: "physicalName",
				reason: "no synthesized counterpart",
			},
		],
		truncated: 0,
	},
	suggestions: [],
	suggestionSummary: [],
	suggestionsTruncated: 0,
	stacks: ["PawlStack"],
	notScanned: ["cloudfront", "cognito"],
	...overrides,
});

const fakeGenerate = (
	projectDir: string,
): PawlGenerateDependency & {
	readonly writes: Array<{
		files: readonly { path: string; content: string }[];
		signal?: AbortSignal;
	}>;
	setIdentity: (target: DeployTarget) => void;
} => {
	const writes: Array<{
		files: readonly { path: string; content: string }[];
		signal?: AbortSignal;
	}> = [];
	let current: DeployTarget = { ...TARGET };
	return {
		writes,
		setIdentity: (target) => {
			current = target;
		},
		approvedPlanDigest: async () => "sha256:fixture-approved-plan-digest",
		currentIdentity: () => current,
		write: async (files, options) => {
			writes.push({ files, signal: options.signal });
			for (const file of files) {
				const full = join(projectDir, file.path);
				mkdirSync(dirname(full), { recursive: true });
				writeFileSync(full, file.content);
			}
		},
	};
};

const deploymentWith = (
	projectDir: string,
	exec: ArtifactExec,
): PawlDeploymentDependency & {
	setIdentity: (target: DeployTarget) => void;
} => {
	let current: DeployTarget = { ...TARGET };
	return {
		setIdentity: (target) => {
			current = target;
		},
		currentIdentity: () => current,
		exec,
		prepare: async ({ stacks, signal }) => {
			signal?.throwIfAborted();
			return prepareArtifact({
				projectDir,
				target: TARGET,
				...(stacks === undefined ? {} : { stacks }),
				synthesize: async (assemblyDir) => {
					writeProjectAssembly(
						assemblyDir,
						stacks === undefined ? ["PawlStack"] : stacks,
					);
				},
			});
		},
	};
};

// ---- harness ------------------------------------------------------------- //

interface HarnessOptions {
	script?: readonly FixtureStreamFactory[];
	generate?: boolean;
	deployment?: boolean;
	projectDir?: string;
	approvalTimeoutMs?: number;
	limits?: PolicyLimits;
	policyDependencies?: Partial<PolicyDependencies>;
	initialMessages?: readonly AgentMessage[];
	sessionId?: string;
	scan?: PawlScanDependency;
	exec?: FakeDeployExec;
}

async function makeHarness(options: HarnessOptions = {}): Promise<Harness> {
	const projectDir =
		options.projectDir ??
		(await mkdtemp(join(tmpdir(), "pawl-tools-project-")));
	directories.push(projectDir);
	const store = await createSessionStore(
		metadata(options.sessionId ?? "s1", projectDir),
		{},
	);
	const mutations = createMutationCoordinator();
	const scan = options.scan ?? fakeScan(scanOutcome());
	const generate = fakeGenerate(projectDir);
	const exec = options.exec ?? makeDeployExec();
	const deployment = deploymentWith(projectDir, exec.exec);
	const toolset = createPawlToolset({
		projectDir,
		mutations,
		scan,
		...(options.generate === false ? {} : { generate }),
		...(options.deployment === false ? {} : { deployment }),
	});
	const scripted = scriptedStreamFn(
		options.script ?? [() => textStream("fixture reply")],
	);
	const conversation = createPawlRuntimeConversation({
		id: "conv_tools_proof",
		systemPrompt: "Pawl tools proof system prompt",
		model: FIXTURE_MODEL,
		tools: [...toolset.tools],
		streamFn: scripted.streamFn as RuntimeAgentStreamFn,
		store,
		mutations,
		createAuthorizer: toolset.createAuthorizer,
		...(options.initialMessages
			? { initialMessages: [...options.initialMessages] }
			: {}),
		...(options.limits ? { policyLimits: options.limits } : {}),
		...(options.policyDependencies
			? { policyDependencies: options.policyDependencies }
			: {}),
		...(options.approvalTimeoutMs === undefined
			? {}
			: { approvalTimeoutMs: options.approvalTimeoutMs }),
	});
	const collected = collectEvents(conversation);
	const harness: Harness = {
		conversation,
		projectDir,
		store,
		mutations,
		toolset,
		collected,
		generate,
		exec,
		deployment,
	};
	activeHarnesses.push(harness);
	return harness;
}

const toolOf = (
	toolset: PawlToolset,
	name: string,
): AgentTool<Tool["parameters"], unknown> => {
	const tool = toolset.tools.find((entry) => entry.name === name);
	if (!tool) throw new Error(`tool ${name} is not registered`);
	return tool;
};

const answerOption = async (
	conversation: PawlConversation,
	requestId: string,
	value: string,
): Promise<void> => {
	await conversation.answer({
		requestId,
		choice: { kind: "option", value },
	});
};

const answerText = async (
	conversation: PawlConversation,
	requestId: string,
	text: string,
): Promise<void> => {
	await conversation.answer({
		requestId,
		choice: { kind: "text", value: text },
	});
};

async function recordsOf(
	store: SessionStore,
): Promise<readonly SessionRecord[]> {
	return parseSessionLog(await readFile(store.path, "utf8")).records;
}

const waitTerminal = async (collector: Collector) => {
	const terminal = await collector.waitFor(
		(event) => event.type === "run_terminal",
	);
	if (terminal.type !== "run_terminal") throw new Error("not a terminal");
	return terminal;
};

const waitInputRequest = async (collector: Collector) => {
	const requested = await collector.waitFor(
		(event) => event.type === "input_requested",
	);
	if (requested.type !== "input_requested")
		throw new Error("not an input request");
	return requested.request;
};

const waitToolResult = async (collector: Collector) => {
	const result = await collector.waitFor(
		(event) => event.type === "tool_result",
	);
	if (result.type !== "tool_result") throw new Error("not a tool result");
	return result;
};

const waitDeployResult = async (collector: Collector) => {
	const result = await collector.waitFor(
		(event) =>
			event.type === "tool_result" && event.toolName === "deploy_infra",
	);
	if (result.type !== "tool_result") throw new Error("not a tool result");
	return result;
};

// ---- ask_question -------------------------------------------------------- //

describe("ask_question", () => {
	test("surfaces a freeform question and returns the exact answer text", async () => {
		const harness = await makeHarness({
			script: [
				() =>
					toolCallStream([
						toolCall(
							"call_1",
							{ question: "Which region should I scan?" },
							"ask_question",
						),
					]),
				() => textStream("done"),
			],
		});
		await harness.conversation.send("ask me");
		const request = await waitInputRequest(harness.collected);
		expect(request.prompt).toBe("Which region should I scan?");
		// Freeform: no approve/deny options, so answering can never imply a grant.
		expect(request.options).toEqual([]);
		await answerText(
			harness.conversation,
			request.requestId,
			"eu-central-1 please",
		);
		const result = await waitToolResult(harness.collected);
		expect(result.status).toBe("completed");
		expect(result.text).toBe("eu-central-1 please");
		const terminal = await waitTerminal(harness.collected);
		expect(terminal.outcome).toBe("completed");
	});

	test("an option answer to a freeform question is rejected and never grants", async () => {
		const harness = await makeHarness({
			script: [
				() =>
					toolCallStream([
						toolCall("call_1", { question: "Continue?" }, "ask_question"),
					]),
				() => textStream("after answer"),
			],
		});
		await harness.conversation.send("ask");
		const request = await waitInputRequest(harness.collected);
		// An approve-style option answer must be a visible rejection, not a grant.
		await expect(
			answerOption(harness.conversation, request.requestId, "approve"),
		).rejects.toThrow(/freeform/i);
		await answerText(harness.conversation, request.requestId, "yes");
		const result = await waitToolResult(harness.collected);
		expect(result.text).toBe("yes");
		const terminal = await waitTerminal(harness.collected);
		expect(terminal.outcome).toBe("completed");
	});

	test("an unanswered question expires with an error result", async () => {
		const harness = await makeHarness({
			approvalTimeoutMs: 25,
			script: [
				() =>
					toolCallStream([
						toolCall("call_1", { question: "Still there?" }, "ask_question"),
					]),
				() => textStream("moving on"),
			],
		});
		await harness.conversation.send("ask");
		const result = await waitToolResult(harness.collected);
		expect(result.status).toBe("error");
		expect(result.text ?? "").toMatch(/expired/i);
		const terminal = await waitTerminal(harness.collected);
		expect(terminal.outcome).toBe("completed");
	});

	test("cancelling the run settles a pending question", async () => {
		const harness = await makeHarness({
			script: [
				() =>
					toolCallStream([
						toolCall("call_1", { question: "Wait…" }, "ask_question"),
					]),
				() => textStream("never"),
			],
		});
		const { runId } = await harness.conversation.send("ask");
		await waitInputRequest(harness.collected);
		await harness.conversation.cancel(runId);
		const terminal = await waitTerminal(harness.collected);
		expect(terminal.outcome).toBe("cancelled");
	});
});

// ---- scan_resources ------------------------------------------------------ //

describe("scan_resources", () => {
	test("passes explicit input through the injected scan seam and preserves coverage limits", async () => {
		const scan = fakeScan(scanOutcome());
		const harness = await makeHarness({
			scan,
			script: [
				() =>
					toolCallStream([
						toolCall(
							"call_1",
							{ services: ["lambda"], maxEntries: 5 },
							"scan_resources",
						),
					]),
				() => textStream("scan done"),
			],
		});
		await harness.conversation.send("scan");
		const result = await waitToolResult(harness.collected);
		expect(result.status).toBe("completed");
		// The current scan shape (Task 2 schema bridge) reaches the seam unchanged.
		const call = scan.calls[0];
		expect(call?.services).toEqual(["lambda"]);
		expect(call?.maxEntries).toBe(5);
		expect(call?.signal).toBeInstanceOf(AbortSignal);
		// Coverage/drift limitations are preserved, never silently dropped.
		const parsed = JSON.parse(result.text ?? "{}") as Record<string, unknown>;
		expect(parsed.notScanned).toEqual(["cloudfront", "cognito"]);
		expect(parsed.stacks).toEqual(["PawlStack"]);
		expect(parsed.report).toBeTruthy();
	});

	test("oversized scan output is bounded by the runtime truncation marker", async () => {
		const scan = fakeScan(
			scanOutcome({
				suggestions: Array.from({ length: 900 }, (_, index) => ({
					construct: "Sqs",
					reason: `unmanaged queue ${index} with a long explanation`.repeat(4),
				})),
			}),
		);
		const harness = await makeHarness({
			scan,
			script: [
				() => toolCallStream([toolCall("call_1", {}, "scan_resources")]),
				() => textStream("scan done"),
			],
		});
		await harness.conversation.send("scan big");
		const result = await waitToolResult(harness.collected);
		expect(result.status).toBe("completed");
		expect(scan.calls).toHaveLength(1);
		expect(result.text ?? "").toContain("[pawl: truncated");
	});
});

// ---- generate ------------------------------------------------------------ //

const GENERATE_FILES = [
	{ path: "src/generated/queue.ts", content: "export const queue = true;\n" },
	{ path: "src/generated/table.ts", content: "export const table = true;\n" },
];

const generateScript = (
	files: unknown = GENERATE_FILES,
): FixtureStreamFactory[] => [
	() => toolCallStream([toolCall("call_1", { files }, "generate")]),
	() => textStream("generated"),
];

describe("generate", () => {
	test("writes exactly the approved file set after an explicit approve", async () => {
		const harness = await makeHarness({ script: generateScript() });
		await harness.conversation.send("generate the queue");
		const request = await waitInputRequest(harness.collected);
		expect(request.options.map((option) => option.id)).toEqual([
			"approve",
			"deny",
		]);
		await answerOption(harness.conversation, request.requestId, "approve");
		const result = await waitToolResult(harness.collected);
		expect(result.status).toBe("completed");
		// Filesystem evidence: exactly the approved files, exact contents.
		expect(
			readFileSync(join(harness.projectDir, "src/generated/queue.ts"), "utf8"),
		).toBe("export const queue = true;\n");
		expect(
			readFileSync(join(harness.projectDir, "src/generated/table.ts"), "utf8"),
		).toBe("export const table = true;\n");
		// Durable intent evidence: synced with the canonical-argument digest.
		const records = await recordsOf(harness.store);
		const intent = records.find(
			(record) =>
				record.kind === "tool_intent" && record.toolName === "generate",
		);
		expect(intent?.kind === "tool_intent" && intent.digest).toBe(
			toolIntentDigest({ files: GENERATE_FILES }),
		);
	});

	test("a denied generation never writes", async () => {
		const harness = await makeHarness({ script: generateScript() });
		await harness.conversation.send("generate");
		const request = await waitInputRequest(harness.collected);
		await answerOption(harness.conversation, request.requestId, "deny");
		const result = await waitToolResult(harness.collected);
		expect(result.status).toBe("error");
		expect(result.text ?? "").toMatch(/not approved|denied/i);
		expect(existsSync(join(harness.projectDir, "src/generated/queue.ts"))).toBe(
			false,
		);
		expect(harness.generate.writes).toEqual([]);
	});

	test("an expired generation approval never writes", async () => {
		const harness = await makeHarness({
			approvalTimeoutMs: 25,
			script: generateScript(),
		});
		await harness.conversation.send("generate");
		const result = await waitToolResult(harness.collected);
		expect(result.status).toBe("error");
		expect(existsSync(join(harness.projectDir, "src/generated/queue.ts"))).toBe(
			false,
		);
		expect(harness.generate.writes).toEqual([]);
	});

	test("cancelling while the approval is pending never writes", async () => {
		const harness = await makeHarness({ script: generateScript() });
		const { runId } = await harness.conversation.send("generate");
		await waitInputRequest(harness.collected);
		await harness.conversation.cancel(runId);
		const terminal = await waitTerminal(harness.collected);
		expect(terminal.outcome).toBe("cancelled");
		expect(existsSync(join(harness.projectDir, "src/generated/queue.ts"))).toBe(
			false,
		);
		expect(harness.generate.writes).toEqual([]);
	});

	test("an identity change between approval and the write boundary refuses", async () => {
		const harness = await makeHarness({ script: generateScript() });
		await harness.conversation.send("generate");
		const request = await waitInputRequest(harness.collected);
		// The checked account changes while the human answers.
		harness.generate.setIdentity({
			accountId: "999999999999",
			region: TARGET.region,
		});
		await answerOption(harness.conversation, request.requestId, "approve");
		const result = await waitToolResult(harness.collected);
		expect(result.status).toBe("error");
		expect(result.text ?? "").toMatch(/identity/i);
		expect(existsSync(join(harness.projectDir, "src/generated/queue.ts"))).toBe(
			false,
		);
		expect(harness.generate.writes).toEqual([]);
	});

	test("an invalid write set is refused before any approval is surfaced", async () => {
		const harness = await makeHarness({
			script: generateScript([{ path: "../outside.txt", content: "no" }]),
		});
		await harness.conversation.send("generate");
		const result = await waitToolResult(harness.collected);
		expect(result.status).toBe("error");
		expect(result.text ?? "").toMatch(/escape|path/i);
		// No approval question was ever surfaced for an invalid set.
		expect(
			harness.collected.events.filter(
				(event) => event.type === "input_requested",
			),
		).toEqual([]);
		expect(harness.generate.writes).toEqual([]);
	});

	test("a direct call outside the active runtime can never write", async () => {
		const harness = await makeHarness({ script: generateScript() });
		// No run has ever been created: the write boundary is unreachable.
		await expect(
			toolOf(harness.toolset, "generate").execute(
				"call_direct",
				{ files: GENERATE_FILES },
				undefined,
				undefined,
			),
		).rejects.toThrow(/outside the runtime/i);
		// With a settled run (parent context aborted) the request fails closed too.
		await harness.conversation.send("generate");
		await waitInputRequest(harness.collected);
		await harness.conversation.cancel();
		await waitTerminal(harness.collected);
		await expect(
			toolOf(harness.toolset, "generate").execute(
				"call_direct2",
				{ files: GENERATE_FILES },
				undefined,
				undefined,
			),
		).rejects.toThrow(/not approved|no active run/i);
		expect(existsSync(join(harness.projectDir, "src/generated/queue.ts"))).toBe(
			false,
		);
		expect(harness.generate.writes).toEqual([]);
	});

	test("the preflight authorizer never issues a grant for the gated tools", async () => {
		const toolset = createPawlToolset({
			projectDir: scratch(),
			mutations: createMutationCoordinator(),
			scan: fakeScan(scanOutcome()),
			generate: fakeGenerate(scratch()),
			deployment: deploymentWith(scratch(), makeDeployExec().exec),
		});
		const authorizer = toolset.createAuthorizer({
			runId: "run_probe",
			broker: new ApprovalBroker({}),
			policy: createRuntimePolicy(),
			signal: new AbortController().signal,
		});
		for (const name of ["generate", "deploy_infra", "deploy_preview"]) {
			const decision = await authorizer({
				runId: "run_probe",
				toolCallId: "call_probe",
				toolName: name,
				input: {},
				signal: new AbortController().signal,
			});
			expect(decision.granted).toBe(true);
			// Permission to proceed to execute — never an approval grant.
			expect(decision.granted && decision.grant).toBeUndefined();
			expect(decision.granted && decision.binding).toBeUndefined();
		}
		const unknown = await authorizer({
			runId: "run_probe",
			toolCallId: "call_probe",
			toolName: "deploy_production",
			input: {},
			signal: new AbortController().signal,
		});
		expect(unknown.granted).toBe(false);
	});

	test("a held mutation permit serializes the write without deadlock", async () => {
		const harness = await makeHarness({ script: generateScript() });
		let release!: () => void;
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		const holder = harness.mutations.run(async () => {
			await barrier;
		});
		await harness.conversation.send("generate");
		const request = await waitInputRequest(harness.collected);
		await answerOption(harness.conversation, request.requestId, "approve");
		await flush();
		// The write waits for the session-wide permit; queued, never deadlocked.
		expect(harness.mutations.queued).toBe(1);
		expect(harness.generate.writes).toEqual([]);
		release();
		await holder;
		const terminal = await waitTerminal(harness.collected);
		expect(terminal.outcome).toBe("completed");
		expect(existsSync(join(harness.projectDir, "src/generated/queue.ts"))).toBe(
			true,
		);
	});

	test("restored context never replays a generate tool call", async () => {
		const priorDir = await mkdtemp(join(tmpdir(), "pawl-tools-prior-"));
		directories.push(priorDir);
		const prior = await createSessionStore(metadata("s0", priorDir), {});
		await prior.recordMessage({
			role: "user",
			content: "generate earlier",
			timestamp: 1000,
		});
		await prior.recordMessage({
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "call_old",
					name: "generate",
					arguments: { files: GENERATE_FILES },
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
			toolName: "generate",
			content: [{ type: "text", text: "Wrote 2 file(s)" }],
			isError: false,
			timestamp: 3000,
		});
		await prior.close();
		const parsed = parseSessionLog(await readFile(prior.path, "utf8"));
		const harness = await makeHarness({
			initialMessages: parsed.records
				.filter((record) => record.kind === "message")
				.map((record) => (record as { message: AgentMessage }).message),
			script: [() => textStream("fresh reply")],
		});
		await flush();
		expect(harness.generate.writes).toEqual([]);
		await harness.conversation.send("new prompt");
		const terminal = await waitTerminal(harness.collected);
		expect(terminal.outcome).toBe("completed");
		// Restore runs nothing: only the fresh text reply happened.
		expect(harness.generate.writes).toEqual([]);
	});
});

// ---- deploy_preview / deploy_infra --------------------------------------- //

const previewScript = (): FixtureStreamFactory[] => [
	() => toolCallStream([toolCall("call_1", {}, "deploy_preview")]),
	() => textStream("preview shown"),
];

const ARTIFACT_ID_PATTERN = /artifact (artifact-\d+-[0-9a-f]+)/;

const deployScript = (
	artifactId: { value?: string },
	callId = "call_2",
): FixtureStreamFactory[] => [
	() =>
		toolCallStream([
			toolCall(
				callId,
				{ artifactId: artifactId.value ?? "artifact-missing" },
				"deploy_infra",
			),
		]),
	() => textStream("deployed"),
];

describe("deploy_preview and deploy_infra", () => {
	test("an approved deploy runs only against the frozen previewed assembly", async () => {
		const artifactId: { value?: string } = {};
		const harness = await makeHarness({
			script: [...previewScript(), ...deployScript(artifactId)],
		});
		await harness.conversation.send("preview");
		const previewResult = await waitToolResult(harness.collected);
		expect(previewResult.status).toBe("completed");
		const previewText = previewResult.text ?? "";
		expect(previewText).toContain("sha256:");
		expect(previewText).toContain("AWS::SQS::Queue");
		expect(previewText).toMatch(/complete: yes/);
		artifactId.value = ARTIFACT_ID_PATTERN.exec(previewText)?.[1];
		expect(artifactId.value).toBeTruthy();

		// Second run: deploy the previewed artifact after an explicit approve.
		await harness.conversation.send("deploy it");
		const request = await waitInputRequest(harness.collected);
		expect(request.prompt).toMatch(/deploy_infra/);
		await answerOption(harness.conversation, request.requestId, "approve");
		const deployResult = await waitDeployResult(harness.collected);
		expect(deployResult.status).toBe("completed");
		expect(deployResult.text ?? "").toMatch(/exit code 0/);
		const terminal = await waitTerminal(harness.collected);
		expect(terminal.outcome).toBe("completed");

		// Executor evidence: read-only diff, then deploy against the SAME frozen
		// assembly under .pawl/artifacts — never a fresh synthesis or cdk.out.
		expect(harness.exec.diffCalls).toHaveLength(1);
		const diffArgs = harness.exec.diffCalls[0]?.args ?? [];
		expect(diffArgs.slice(0, 6)).toEqual([
			"cdk",
			"diff",
			"--app",
			expect.any(String),
			"--change-set",
			"false",
		]);
		const assemblyDir = diffArgs[3] as string;
		expect(diffArgs[3]).toBeDefined();
		expect(assemblyDir).toContain(join(".pawl", "artifacts"));
		expect(harness.exec.deployCalls).toHaveLength(1);
		expect(harness.exec.deployCalls[0]?.args?.slice(0, 6)).toEqual([
			"cdk",
			"deploy",
			"--app",
			assemblyDir,
			"--require-approval",
			"never",
		]);
		expect(harness.exec.deployCalls[0]?.args ?? []).toContain("PawlStack");
		// The deployed bytes are exactly the frozen material, observed unchanged
		// at deploy time inside the same assembly the preview pointed at.
		expect(harness.exec.observed[0]).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "manifest.json" }),
				expect.objectContaining({ path: "PawlStack.template.json" }),
				expect.objectContaining({ path: "assets/handler.js" }),
			]),
		);
	});

	test("a deploy without a prepared preview refuses and never executes", async () => {
		const harness = await makeHarness({
			script: deployScript({ value: "artifact-never-prepared" }, "call_1"),
		});
		await harness.conversation.send("deploy");
		const result = await waitDeployResult(harness.collected);
		expect(result.status).toBe("error");
		expect(result.text ?? "").toMatch(/deploy_preview/i);
		expect(harness.exec.deployCalls).toHaveLength(0);
		expect(
			harness.collected.events.filter(
				(event) => event.type === "input_requested",
			),
		).toEqual([]);
	});

	test("an incomplete (truncated) preview never deploys", async () => {
		const truncated = makeDeployExec({
			diffOverrides: { stdoutTruncated: true },
		});
		const artifactId: { value?: string } = {};
		const harness = await makeHarness({
			exec: truncated,
			script: [...previewScript(), ...deployScript(artifactId)],
		});
		await harness.conversation.send("preview");
		const previewResult = await waitToolResult(harness.collected);
		expect(previewResult.text ?? "").toMatch(/complete: no/);
		artifactId.value = ARTIFACT_ID_PATTERN.exec(previewResult.text ?? "")?.[1];
		expect(artifactId.value).toBeTruthy();
		await harness.conversation.send("deploy it");
		const result = await waitDeployResult(harness.collected);
		expect(result.status).toBe("error");
		expect(result.text ?? "").toMatch(/truncated/i);
		// Refusal happens before any approval is surfaced.
		expect(
			harness.collected.events.filter(
				(event) => event.type === "input_requested",
			).length,
		).toBe(0);
		expect(truncated.deployCalls).toHaveLength(0);
	});

	test("a denied deployment never executes the deploy command", async () => {
		const artifactId: { value?: string } = {};
		const harness = await makeHarness({
			script: [...previewScript(), ...deployScript(artifactId)],
		});
		await harness.conversation.send("preview");
		const previewResult = await waitToolResult(harness.collected);
		artifactId.value = ARTIFACT_ID_PATTERN.exec(previewResult.text ?? "")?.[1];
		await harness.conversation.send("deploy it");
		const request = await waitInputRequest(harness.collected);
		await answerOption(harness.conversation, request.requestId, "deny");
		const result = await waitDeployResult(harness.collected);
		expect(result.status).toBe("error");
		expect(harness.exec.diffCalls).toHaveLength(1);
		expect(harness.exec.deployCalls).toHaveLength(0);
	});

	test("an identity change after the preview refuses the deployment", async () => {
		const artifactId: { value?: string } = {};
		const harness = await makeHarness({
			script: [...previewScript(), ...deployScript(artifactId)],
		});
		await harness.conversation.send("preview");
		const previewResult = await waitToolResult(harness.collected);
		artifactId.value = ARTIFACT_ID_PATTERN.exec(previewResult.text ?? "")?.[1];
		// The checked account changes before the human approves.
		harness.deployment.setIdentity({
			accountId: "999999999999",
			region: TARGET.region,
		});
		await harness.conversation.send("deploy it");
		const request = await waitInputRequest(harness.collected);
		await answerOption(harness.conversation, request.requestId, "approve");
		const result = await waitDeployResult(harness.collected);
		expect(result.status).toBe("error");
		expect(result.text ?? "").toMatch(/identity|account/i);
		expect(harness.exec.deployCalls).toHaveLength(0);
	});

	test("a restart leaves no prepared preview to deploy", async () => {
		const artifactId: { value?: string } = {};
		const first = await makeHarness({ script: previewScript() });
		await first.conversation.send("preview");
		const previewResult = await waitToolResult(first.collected);
		artifactId.value = ARTIFACT_ID_PATTERN.exec(previewResult.text ?? "")?.[1];
		await first.conversation.dispose();

		// A restart is a new conversation with a fresh toolset: the preview
		// registry is empty and approvals are never persisted.
		const fresh = await makeHarness({
			projectDir: first.projectDir,
			sessionId: "s2",
			script: deployScript({ value: artifactId.value }, "call_1"),
		});
		await fresh.conversation.send("deploy the old artifact");
		const result = await waitDeployResult(fresh.collected);
		expect(result.status).toBe("error");
		expect(result.text ?? "").toMatch(/deploy_preview|restart/i);
		expect(fresh.exec.deployCalls).toHaveLength(0);
	});

	test("unknown tool names and missing deployment capability fail closed", async () => {
		const harness = await makeHarness({
			deployment: false,
			script: [
				() => toolCallStream([toolCall("call_1", {}, "deploy_production")]),
				() => toolCallStream([toolCall("call_2", {}, "deploy_infra")]),
				() => textStream("refused"),
			],
		});
		await harness.conversation.send("deploy please");
		await waitTerminal(harness.collected);
		const results = harness.collected.events.filter(
			(event) => event.type === "tool_result",
		);
		expect(results).toHaveLength(2);
		for (const result of results) {
			if (result.type !== "tool_result") return;
			expect(result.status).toBe("error");
			expect(result.text ?? "").toMatch(/not found/i);
		}
		// No production deployment capability exists anywhere in the factory.
		expect(
			harness.toolset.tools.some((tool) => tool.name === "deploy_infra"),
		).toBe(false);
	});

	test("invalid raw arguments fail closed before any side effect", async () => {
		const harness = await makeHarness({
			script: [
				() => toolCallStream([toolCall("call_1", {}, "ask_question")]),
				() =>
					toolCallStream([toolCall("call_2", { files: "nope" }, "generate")]),
				() => textStream("refused"),
			],
		});
		await harness.conversation.send("do things");
		await waitTerminal(harness.collected);
		const results = harness.collected.events.filter(
			(event) => event.type === "tool_result",
		);
		expect(results).toHaveLength(2);
		for (const result of results) {
			if (result.type !== "tool_result") return;
			expect(result.status).toBe("error");
		}
		expect(
			harness.collected.events.filter(
				(event) => event.type === "input_requested",
			),
		).toEqual([]);
		expect(harness.generate.writes).toEqual([]);
	});
});
