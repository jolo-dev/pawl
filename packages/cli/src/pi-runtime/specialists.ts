import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	Agent,
	type AgentTool,
	type AgentToolResult,
} from "@earendil-works/pi-agent-core";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
	type Tool,
	type ToolResultMessage,
} from "@earendil-works/pi-ai";
import { z } from "zod";
import type { RuntimeAgentStreamFn } from "./agent";
import type { MutationCoordinator } from "./mutation";
import { MAX_CONCURRENT_SPECIALISTS, type RuntimePolicy } from "./policy";
import { definePawlTool } from "./tool-schema";

/**
 * Bounded root-to-specialist orchestration (Task 12).
 *
 * The four authored specialist roles (planner, generator, well-architected,
 * infra-auditor) are created explicitly as Pi `Agent` children of the root
 * run. Every child shares the session's account-bound model and stream
 * function and the parent run's ONE policy object, so model-call, tool and
 * deadline budgets are shared counters across root and specialists — never
 * independent child budgets. Children share the session-wide mutation
 * coordinator; the parent never holds the permit across a delegation (the
 * delegate tool is `replay: "safe"` and never acquires it), so a delegating
 * parent cannot deadlock against a child.
 *
 * Explicit boundaries, not prompt instructions:
 * - Role instructions are READ AS DATA from the authored
 *   `agent/subagents/<role>/instructions.md` markdown. Nothing here imports
 *   Eve `defineAgent` modules and nothing discovers personal or project
 *   extensions; the role set is fixed in this file.
 * - A child's ONLY tool is `finish_result`, generated from the role's Zod
 *   result schema. The planner, well-architected and infra-auditor schemas
 *   preserve the authored Eve output shapes; the generator gets an explicit
 *   proposed-file-set schema and no writer, shell or delegation capability —
 *   the root keeps writing through the approval-gated `generate` path.
 * - A valid return exists only when the child called `finish_result` and the
 *   Zod schema validated the payload. Text that merely resembles JSON is a
 *   visible failure (`specialist_no_result`), as is an invalid payload
 *   (`specialist_invalid_result`). One delegation is one bounded attempt;
 *   there is no automatic repair loop — the shared policy bounds everything.
 * - `finish_result` refuses to settle a child while the shared mutation
 *   coordinator holds or queues work, so a child can never bypass unexecuted
 *   side-effect work by declaring completion.
 * - Root cancellation and disposal propagate: aborting the parent run's
 *   signal aborts every child agent and its provider stream, settles the
 *   delegation as a visible tool error, and clears any child queued inputs.
 *   No background jobs, receipts or pollers exist; child work cannot outlive
 *   the parent run.
 * - At most `MAX_CONCURRENT_SPECIALISTS` children run at once; the refusal is
 *   a visible tool error. Children have no delegation tool, so there is no
 *   nested delegation.
 */

export class PawlSpecialistError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "PawlSpecialistError";
		this.code = code;
	}
}

// ---- Roles and preserved result schemas ----------------------------------- //

export const SPECIALIST_ROLES = [
	"planner",
	"generator",
	"well-architected",
	"infra-auditor",
] as const;

export type SpecialistRole = (typeof SPECIALIST_ROLES)[number];

/** Preserved shape of the authored planner subagent output. */
export const plannerResultSchema = z.strictObject({
	summary: z.string(),
	services: z.array(
		z.strictObject({ name: z.string(), justification: z.string() }),
	),
	network: z.string(),
	security: z.string(),
	observability: z.string(),
	diagram: z.string(),
	deployment: z.string(),
	filePlan: z.array(z.strictObject({ path: z.string(), purpose: z.string() })),
});

/**
 * The generator's explicit proposed-file-set result. It is a PROPOSAL only:
 * the child has no writer, shell or approval path, and the root keeps writing
 * through the approval-gated `generate` tool.
 */
export const generatorResultSchema = z.strictObject({
	files: z.array(
		z.strictObject({ path: z.string().min(1), content: z.string() }),
	),
	notes: z.string().optional(),
});

/** Preserved shape of the authored well-architected subagent output. */
export const wellArchitectedResultSchema = z.strictObject({
	pillars: z.array(
		z.strictObject({
			pillar: z.string(),
			currentState: z.string(),
			risks: z.array(z.string()),
			recommendations: z.array(
				z.strictObject({
					text: z.string(),
					priority: z.enum(["high", "medium", "low"]),
				}),
			),
		}),
	),
});

/** Preserved shape of the authored infra-auditor subagent output. */
export const infraAuditorResultSchema = z.strictObject({
	findings: z.array(
		z.strictObject({
			construct: z.string(),
			resourceKind: z.string(),
			resourceNames: z.array(z.string()),
			declaredInProject: z.boolean(),
			rationale: z.string(),
			effort: z.enum(["low", "medium", "high"]),
			risk: z.enum(["low", "medium", "high"]),
			caveat: z.string().optional(),
		}),
	),
	coverageWarning: z.string().optional(),
	driftNote: z.string().optional(),
});

/**
 * A role's result schema is the exact Zod object its `finish_result` tool
 * validates against; `captured` is the validated, typed result.
 */
interface SpecialistRoleConfig {
	readonly resultSchema: z.ZodObject<z.core.$ZodShape, z.core.$ZodObjectConfig>;
	readonly summary: string;
}

const SPECIALIST_ROLE_CONFIG: Record<SpecialistRole, SpecialistRoleConfig> = {
	planner: {
		resultSchema: plannerResultSchema,
		summary: "structured infrastructure plan",
	},
	generator: {
		resultSchema: generatorResultSchema,
		summary:
			"proposed file set (a proposal only; the root writes via the approval-gated generate path)",
	},
	"well-architected": {
		resultSchema: wellArchitectedResultSchema,
		summary: "six-pillar review",
	},
	"infra-auditor": {
		resultSchema: infraAuditorResultSchema,
		summary: "ranked adoption findings",
	},
};

// ---- Tool name registry (single spelling per concept) --------------------- //

export const DELEGATE_TOOL_NAME = "delegate";
export const FINISH_RESULT_TOOL_NAME = "finish_result";

export const delegateSchema = z.strictObject({
	role: z.enum(SPECIALIST_ROLES),
	prompt: z.string().min(1),
	data: z.string().optional(),
});

// ---- Instruction data (authored markdown, read; never imported) ----------- //

const ROLE_INSTRUCTION_DIRS: Record<SpecialistRole, string> = {
	planner: "planner",
	generator: "generator",
	"well-architected": "well-architected",
	"infra-auditor": "infra-auditor",
};

/**
 * Reads one role's authored instruction markdown as data from the package's
 * fixed `agent/subagents/<role>/instructions.md` location. This is a fixed
 * package path, not extension or personal-configuration discovery.
 */
export async function loadSpecialistInstructions(
	role: SpecialistRole,
): Promise<string> {
	const url = new URL(
		`../../agent/subagents/${ROLE_INSTRUCTION_DIRS[role]}/instructions.md`,
		import.meta.url,
	);
	try {
		return await readFile(fileURLToPath(url), "utf8");
	} catch (error) {
		throw new PawlSpecialistError(
			"instructions_unavailable",
			`The instruction markdown for the ${role} specialist could not be read: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

/**
 * Runtime-owned contract appended to the authored role instructions, so a
 * child knows the only way to return. The authored markdown stays the base.
 */
const SPECIALIST_RESULT_CONTRACT =
	"\n\n---\nWhen the work is done, call the finish_result tool once with the complete structured result. A text reply is not a result and will be treated as a failure. You have no other tools: you cannot delegate, ask the user questions, write files, or run commands.";

// ---- Dispatcher ----------------------------------------------------------- //

/**
 * The slice of the parent run context a delegation needs: the shared policy
 * (one budget/deadline object across root and children) and the parent run's
 * abort signal (root cancellation and disposal settle every child).
 */
export interface SpecialistRunContext {
	readonly policy: RuntimePolicy;
	readonly signal: AbortSignal;
}

export interface PawlSpecialistDispatcherOptions {
	/** The session's shared account-bound model. */
	readonly model: Model<Api>;
	/** The session's shared stream function (Task 4 in production). */
	readonly streamFn: RuntimeAgentStreamFn;
	/** The session-wide mutation coordinator shared with every child. */
	readonly mutations: MutationCoordinator;
	/** Resolves the active parent run context; undefined outside a live run. */
	readonly resolveRun: () => SpecialistRunContext | undefined;
	readonly loadInstructions?: (role: SpecialistRole) => Promise<string>;
	readonly maxConcurrent?: number;
}

export interface PawlSpecialistDispatcher {
	/** The single root-facing delegation tool. */
	readonly tools: readonly AgentTool<Tool["parameters"], unknown>[];
	/** Number of children currently running (0 when settled). */
	readonly activeChildren: number;
	/** Aborts every active child and settles its delegation. Idempotent. */
	readonly dispose: () => Promise<void>;
}

interface ChildEntry {
	readonly controller: AbortController;
	readonly settled: Promise<void>;
	readonly finish: () => void;
	agent: Agent | undefined;
}

/** A refusal encoded as a provider error stream; the child streamFn never throws. */
function refusedStream(
	model: Model<Api>,
	message: string,
	reason: "error" | "aborted",
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const failure: AssistantMessage = {
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
		stopReason: reason,
		errorMessage: message,
		timestamp: Date.now(),
	};
	stream.push({ type: "error", reason, error: failure });
	stream.end();
	return stream;
}

export function createPawlSpecialistDispatcher(
	options: PawlSpecialistDispatcherOptions,
): PawlSpecialistDispatcher {
	const maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT_SPECIALISTS;
	const loadInstructions =
		options.loadInstructions ?? loadSpecialistInstructions;
	const active = new Set<ChildEntry>();
	let disposed = false;

	const stopEntry = (entry: ChildEntry, message: string): void => {
		entry.controller.abort(
			new PawlSpecialistError("specialist_cancelled", message),
		);
	};

	const dispose = async (): Promise<void> => {
		disposed = true;
		const entries = [...active];
		for (const entry of entries) {
			entry.agent?.clearAllQueues();
			stopEntry(entry, "The dispatcher was disposed with the parent");
			entry.agent?.abort();
		}
		await Promise.allSettled(entries.map((entry) => entry.settled));
	};

	const delegateTool = definePawlTool({
		name: DELEGATE_TOOL_NAME,
		label: "Delegate to specialist",
		description:
			"Delegate bounded work to one specialist child agent (planner, generator, well-architected or infra-auditor) with an explicit prompt and optional data. The child returns exactly one validated structured result via its finish_result tool; JSON-shaped text is not a result. Children share the session's account, model and budgets, cannot delegate, ask questions, write files or run commands.",
		executionMode: "parallel",
		replay: "safe",
		schema: delegateSchema,
		execute: async (_toolCallId, input, signal) => {
			if (disposed) {
				throw new PawlSpecialistError(
					"dispatcher_disposed",
					"The specialist dispatcher was disposed; no new delegations may start",
				);
			}
			const run = options.resolveRun();
			if (!run) {
				throw new PawlSpecialistError(
					"no_active_run",
					"Delegation requires an active parent run; refusing to run a specialist outside the runtime",
				);
			}
			if (run.signal.aborted) {
				throw new PawlSpecialistError(
					"specialist_cancelled",
					"The parent run is no longer active; the specialist was not started",
				);
			}
			if (active.size >= maxConcurrent) {
				throw new PawlSpecialistError(
					"specialist_limit",
					`Specialist limit reached: at most ${maxConcurrent} specialist children may run concurrently; wait for an active specialist to finish`,
				);
			}
			// Registration is synchronous before the first await, so the
			// concurrency limit check is atomic against parallel delegations.
			const controller = new AbortController();
			let resolveSettled: () => void = () => {};
			const settled = new Promise<void>((resolve) => {
				resolveSettled = resolve;
			});
			const entry: ChildEntry = {
				controller,
				settled,
				finish: resolveSettled,
				agent: undefined,
			};
			active.add(entry);
			const stopFromParent = (): void => {
				stopEntry(entry, "The parent run was cancelled or disposed");
			};
			run.signal.addEventListener("abort", stopFromParent, { once: true });
			signal?.addEventListener("abort", stopFromParent, { once: true });
			try {
				const roleConfig = SPECIALIST_ROLE_CONFIG[input.role];
				const instructions = await loadInstructions(input.role);

				// ---- Child-only finish_result (generated from the role schema) ----

				let hasResult = false;
				let captured: z.output<typeof roleConfig.resultSchema> | undefined;
				let pendingMutationRefusal = false;
				const finishTool = definePawlTool({
					name: FINISH_RESULT_TOOL_NAME,
					label: "Record specialist result",
					description:
						"Record the final structured result for the parent and stop. A text reply is not a result.",
					executionMode: "sequential",
					replay: "safe",
					schema: z.strictObject({ result: roleConfig.resultSchema }),
					execute: async (_finishCallId, finishInput) => {
						if (hasResult) {
							return {
								content: [
									{
										type: "text",
										text: "A result was already recorded; stopping.",
									},
								],
								details: {},
								terminate: true,
							};
						}
						// A child cannot bypass pending mutations: while the shared
						// coordinator holds or queues work, completion would leave
						// unexecuted side-effect work behind.
						if (options.mutations.held || options.mutations.queued > 0) {
							pendingMutationRefusal = true;
							throw new PawlSpecialistError(
								"pending_mutations",
								"finish_result refused: the session mutation coordinator still holds or queues side-effect work; a specialist cannot settle while side-effect work is unexecuted",
							);
						}
						hasResult = true;
						captured = finishInput.result;
						return {
							content: [
								{ type: "text", text: "Specialist result recorded; stopping." },
							],
							details: {},
							terminate: true,
						};
					},
				});

				// ---- Child provider guard: shared policy, shared cancellation ----

				const childStreamFn: RuntimeAgentStreamFn = (
					model,
					context,
					callerOptions?: SimpleStreamOptions,
				): AssistantMessageEventStream => {
					const currentRun = options.resolveRun();
					const cancelled =
						controller.signal.aborted || currentRun?.signal.aborted === true;
					if (cancelled) {
						return refusedStream(
							model,
							"The specialist was cancelled with the parent run; the model request was not dispatched",
							currentRun?.policy.signal.aborted ? "error" : "aborted",
						);
					}
					if (!currentRun) {
						return refusedStream(
							model,
							"The parent run is no longer active; the model request was not dispatched",
							"error",
						);
					}
					// Shared budget: atomic reservation on the ONE session policy.
					const decision = currentRun.policy.checkBeforeModel({
						model: {
							contextWindow: model.contextWindow,
							maxTokens: model.maxTokens,
						},
						context,
					});
					if (!decision.allowed) {
						return refusedStream(model, decision.message, "error");
					}
					// Shared per-request timeout, capped by the remaining run budget.
					const signals: AbortSignal[] = [
						currentRun.signal,
						currentRun.policy.signal,
						controller.signal,
					];
					if (callerOptions?.signal) signals.push(callerOptions.signal);
					let requestTimerClear: (() => void) | undefined;
					const timeoutMs = currentRun.policy.modelRequestTimeoutMs();
					if (timeoutMs > 0) {
						const requestDeadline = new AbortController();
						signals.push(requestDeadline.signal);
						const timer = setTimeout(() => {
							requestDeadline.abort(
								new PawlSpecialistError(
									"model_request_timeout",
									"The specialist model request exceeded its budget",
								),
							);
						}, timeoutMs);
						requestTimerClear = () => clearTimeout(timer);
					}
					const combined = AbortSignal.any(signals);
					const inner = options.streamFn(model, context, { signal: combined });
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
								error: {
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
										cost: {
											input: 0,
											output: 0,
											cacheRead: 0,
											cacheWrite: 0,
											total: 0,
										},
									},
									stopReason: "error",
									errorMessage:
										error instanceof Error ? error.message : String(error),
									timestamp: Date.now(),
								},
							});
							outer.end();
						} finally {
							requestTimerClear?.();
						}
					})();
					return outer;
				};

				// ---- The real child agent ----

				const restricted = new Set<string>();
				const child = new Agent({
					initialState: {
						systemPrompt: `${instructions}${SPECIALIST_RESULT_CONTRACT}`,
						model: options.model,
						tools: [finishTool],
						thinkingLevel: "off",
					},
					streamFn: childStreamFn,
					toolExecution: "sequential",
					beforeToolCall: async ({ toolCall }) => {
						if (controller.signal.aborted) {
							return {
								block: true,
								reason: "The specialist was cancelled with the parent run",
								terminate: true,
							};
						}
						if (toolCall.name !== FINISH_RESULT_TOOL_NAME) {
							// No nested delegation and no other capability: children can
							// only finish. The block terminates the child immediately.
							restricted.add(toolCall.name);
							return {
								block: true,
								reason: `Specialist children may only call ${FINISH_RESULT_TOOL_NAME}; "${toolCall.name}" is not available to specialists and nested delegation is not permitted`,
								terminate: true,
							};
						}
						// Shared tool-execution budget, reserved immediately before execution.
						const decision = run.policy.checkBeforeTool(toolCall.name);
						if (!decision.allowed) {
							return {
								block: true,
								reason: decision.message,
								terminate: true,
							};
						}
						return undefined;
					},
				});
				entry.agent = child;
				controller.signal.addEventListener(
					"abort",
					() => {
						child.clearAllQueues();
						child.abort();
					},
					{ once: true },
				);
				if (controller.signal.aborted) {
					child.clearAllQueues();
					child.abort();
				}

				const promptText =
					input.data === undefined
						? input.prompt
						: `${input.prompt}\n\n${input.data}`;
				try {
					await child.prompt(promptText);
					await child.waitForIdle();
				} catch (error) {
					throw new PawlSpecialistError(
						"specialist_failed",
						`The ${input.role} specialist agent failed: ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				}

				// ---- Visible outcome classification (one bounded attempt) ----

				if (hasResult) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{ role: input.role, result: captured },
									null,
									2,
								),
							},
						],
						details: {},
					} satisfies AgentToolResult<Record<string, never>>;
				}
				// The shared policy is the authoritative cause: budget/deadline
				// exhaustion also aborts the parent run and therefore this child's
				// controller, so exhaustion must be classified before cancellation.
				if (run.policy.signal.aborted) {
					const childError = child.state.errorMessage;
					throw new PawlSpecialistError(
						"specialist_failed",
						`The ${input.role} specialist could not finish because the shared run budget was exhausted${
							childError
								? `: ${childError}`
								: " before it could return a result"
						}`,
					);
				}
				if (controller.signal.aborted) {
					const reason = controller.signal.reason;
					throw reason instanceof PawlSpecialistError
						? reason
						: new PawlSpecialistError(
								"specialist_cancelled",
								`The ${input.role} specialist was cancelled before returning a result`,
							);
				}
				if (run.signal.aborted) {
					throw new PawlSpecialistError(
						"specialist_cancelled",
						`The ${input.role} specialist was cancelled with the parent run`,
					);
				}
				const failedChildResults = child.state.messages.filter(
					(message): message is ToolResultMessage =>
						message.role === "toolResult" && message.isError,
				);
				const invalidFinish = failedChildResults.filter(
					(message) => message.toolName === FINISH_RESULT_TOOL_NAME,
				).length;
				// Restricted-tool attempts surface as failed tool results for tools
				// the child does not have (immediate "not found" results never reach
				// the preflight hook) — they are still visible evidence of an attempt.
				const restrictedNames = new Set([
					...restricted,
					...failedChildResults
						.map((message) => message.toolName)
						.filter((name) => name !== FINISH_RESULT_TOOL_NAME),
				]);
				if (pendingMutationRefusal) {
					throw new PawlSpecialistError(
						"pending_mutations",
						`The ${input.role} specialist could not settle: finish_result was refused while the session mutation coordinator held or queued side-effect work`,
					);
				}
				if (invalidFinish > 0) {
					throw new PawlSpecialistError(
						"specialist_invalid_result",
						`The ${input.role} specialist returned an invalid result ${invalidFinish} time(s); the payload never satisfied the ${input.role} result schema, so no result was recorded`,
					);
				}
				if (restrictedNames.size > 0) {
					throw new PawlSpecialistError(
						"specialist_no_result",
						`The ${input.role} specialist tried to use restricted tools (${[...restrictedNames].join(", ")}); children may only call ${FINISH_RESULT_TOOL_NAME} and no result was recorded`,
					);
				}
				throw new PawlSpecialistError(
					"specialist_no_result",
					`The ${input.role} specialist ended without calling ${FINISH_RESULT_TOOL_NAME}; JSON-shaped text is not a result and nothing was recorded`,
				);
			} finally {
				run.signal.removeEventListener("abort", stopFromParent);
				signal?.removeEventListener("abort", stopFromParent);
				active.delete(entry);
				entry.finish();
			}
		},
	});

	return {
		tools: [delegateTool],
		get activeChildren() {
			return active.size;
		},
		dispose,
	};
}
