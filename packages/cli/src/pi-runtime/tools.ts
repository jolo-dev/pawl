import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Tool } from "@earendil-works/pi-ai";
import { z } from "zod";
import type { ProjectScanOutcome } from "../infra/project-scan";
import type { AuthorizerFactory, RuntimeRunContext } from "./agent";
import type { ApprovalBinding } from "./approval";
import {
	type ArtifactExec,
	type DeployTarget,
	deployApprovedArtifact,
	type PreparedArtifact,
	type PreparedPreview,
	previewArtifact,
} from "./deploy-artifact";
import type { MutationCoordinator } from "./mutation";
import { definePawlTool } from "./tool-schema";

/**
 * Representative Pawl tools behind the runtime policy (Task 11).
 *
 * These adapters are runtime-independent: they import no Eve wrappers and no
 * ambient credential/project discovery. Every AWS or filesystem capability is
 * an injected seam (the session execution context's scan operation, the proof
 * writer, the Task 9 artifact preparation and the Task 7 controlled executor),
 * so the default wiring is fully offline and the live proof factory never
 * carries production deployment capability — deploy tools exist ONLY when a
 * deployment dependency is injected, and an invented tool name fails closed
 * as an unknown tool.
 *
 * Authorization is executable policy, not a prompt instruction:
 * - The preflight authorizer (wired through `createAuthorizer`) grants only
 *   this toolset's registered tools and NEVER issues an approval grant; the
 *   agent's executor wrapper still re-reserves the tool budget, syncs the
 *   durable tool intent before any side effect, consumes grants returned by
 *   an authorizer (none here), and bounds model-facing results.
 * - The approval decisions for `generate` and `deploy_infra` happen INSIDE
 *   the tool execution through the run-scoped ApprovalBroker, mirroring the
 *   reviewed Task 9 chain: broker.request → mutations.run (session-wide
 *   permit) → revalidate identity → consume the one-use grant at the actual
 *   write/execution boundary → write/deploy. A denial, expiry, abort,
 *   restart or any changed binding dimension (arguments, plan/artifact
 *   digest, project, identity) leaves the filesystem and executors untouched.
 * - `replay: "safe"` here means LOCAL re-execution inside a live run is safe
 *   to serialize; it is NOT resume replay. Resume never replays tools
 *   automatically in this proof (Task 8/10), and `replay: "never"` is not
 *   usable for these tools: the agent wraps such tools in the session
 *   mutation permit, which would deadlock against the internal, non-reentrant
 *   `mutations.run` acquisition.
 * - All model-facing outputs are bounded by the runtime's 16 KiB truncation
 *   rule; the tools additionally keep summaries compact. A truncated result
 *   never authorizes a deploy (previewComplete/binding gates).
 *
 * `scan_resources` passes the explicit session execution context through the
 * injected scan dependency. The proof wiring reads an existing `cdk.out`
 * (trusted local code, not a sandbox) and never synthesizes the user's
 * project; coverage/drift limitations (notScanned, driftUnavailable,
 * truncation counts) are preserved in the result, never dropped.
 */

export class PawlToolError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "PawlToolError";
		this.code = code;
	}
}

// ---- Tool name registry (single spelling per concept) ------------------- //

export const PAWL_TOOL_NAMES = {
	askQuestion: "ask_question",
	scanResources: "scan_resources",
	generate: "generate",
	deployPreview: "deploy_preview",
	deployInfra: "deploy_infra",
} as const;

// ---- Schemas (validated through the Task 2 Pi/Zod bridge) ---------------- //

export const askQuestionSchema = z.strictObject({
	question: z.string().min(1),
});

export const scanResourcesSchema = z.strictObject({
	services: z.array(z.string().min(1)).optional(),
	maxEntries: z.number().int().min(1).max(1000).optional(),
});

export const generateSchema = z.strictObject({
	files: z.array(
		z.strictObject({
			path: z.string().min(1),
			content: z.string(),
		}),
	),
});

export const deployPreviewSchema = z.strictObject({
	stacks: z.array(z.string().min(1)).optional(),
});

export const deployInfraSchema = z.strictObject({
	artifactId: z.string().min(1),
});

export type ProposedFile = z.output<typeof generateSchema>["files"][number];

// ---- Injected domain seams ----------------------------------------------- //

/** The session's explicit scan operation (execution context, no ambient fallback). */
export interface PawlScanDependency {
	scan(request: {
		services?: readonly string[];
		maxEntries?: number;
		signal?: AbortSignal;
	}): Promise<ProjectScanOutcome>;
}

/**
 * The generation write seam. `approvedPlanDigest` binds permission to the
 * currently approved plan; `currentIdentity` is re-read at the write boundary;
 * `write` applies ONLY the approved write set (the proof writer may modify
 * only controlled fixture paths; a future real writer plugs in here behind
 * the same policy boundary).
 */
export interface PawlGenerateDependency {
	approvedPlanDigest(): Promise<string>;
	currentIdentity(): DeployTarget;
	write(
		files: readonly ProposedFile[],
		options: { signal?: AbortSignal },
	): Promise<void>;
}

/**
 * The deployment seam (Task 9 verified reference + Task 7 executor). Without
 * this dependency the deploy tools are not registered at all — the proof
 * factory carries no production deployment capability.
 */
export interface PawlDeploymentDependency {
	/** Trusted-code synthesis into a frozen, validated artifact (Task 9). */
	prepare(request: {
		stacks?: readonly string[];
		signal?: AbortSignal;
	}): Promise<PreparedArtifact>;
	/** Controlled preview/deploy executor (or a fake in tests). */
	exec: ArtifactExec;
	/** The currently checked target identity, re-read at the execution boundary. */
	currentIdentity(): DeployTarget;
}

export interface PawlToolsetOptions {
	readonly projectDir: string;
	readonly mutations: MutationCoordinator;
	readonly scan: PawlScanDependency;
	readonly generate?: PawlGenerateDependency;
	readonly deployment?: PawlDeploymentDependency;
}

export interface PawlToolset {
	readonly tools: readonly AgentTool<Tool["parameters"], unknown>[];
	/**
	 * Per-run authorizer factory. It grants this toolset's registered tools
	 * WITHOUT an approval grant (the gated decisions happen inside execution
	 * through the run-scoped broker) and denies every other tool name.
	 */
	readonly createAuthorizer: AuthorizerFactory;
}

// ---- Helpers -------------------------------------------------------------- //

/** Bounded registry of prepared previews, so past previews cannot pile up. */
const MAX_PREPARED_PREVIEWS = 8;

/** Runtime-owned project material that is never model-writable in this proof. */
const RUNTIME_OWNED_PATHS = [".pawl/sessions", ".pawl/artifacts"] as const;

/**
 * Validates one proposed write path BEFORE any approval is surfaced: relative,
 * inside the project, never a runtime-owned directory. A set that cannot be
 * written safely never reaches the approval broker.
 */
function assertWritablePath(projectDir: string, requested: string): void {
	if (isAbsolute(requested)) {
		throw new PawlToolError(
			"invalid_write_path",
			`Refusing absolute write path "${requested}"; proposed files must be relative to the project`,
		);
	}
	const resolved = resolve(projectDir, requested);
	const rel = relative(projectDir, resolved);
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
		throw new PawlToolError(
			"invalid_write_path",
			`Refusing write path "${requested}"; it escapes the project directory`,
		);
	}
	const normalized = rel.split(sep).join("/");
	for (const owned of RUNTIME_OWNED_PATHS) {
		if (normalized === owned || normalized.startsWith(`${owned}/`)) {
			throw new PawlToolError(
				"invalid_write_path",
				`Refusing write path "${requested}"; runtime-owned .pawl material is never model-writable`,
			);
		}
	}
}

function toolResult(text: string): AgentToolResult<Record<string, never>> {
	return { content: [{ type: "text", text }], details: {} };
}

function yesNo(value: boolean): string {
	return value ? "yes" : "no";
}

// ---- Toolset factory ------------------------------------------------------ //

export function createPawlToolset(options: PawlToolsetOptions): PawlToolset {
	const { projectDir, mutations } = options;
	/**
	 * The run context captured by the per-run authorizer factory. Tools need
	 * the run-scoped approval broker; Pi tool execution is sequential and one
	 * run is active at a time, so a single captured context is sufficient. A
	 * tool executed outside an active run (a direct call) fails closed.
	 */
	let activeRun: RuntimeRunContext | undefined;

	const requireRun = (): RuntimeRunContext => {
		if (!activeRun) {
			throw new PawlToolError(
				"no_active_run",
				"Pawl tools execute only inside an active approved run; a direct call outside the runtime cannot ask, write or deploy",
			);
		}
		return activeRun;
	};

	/** Prepared previews by artifact id; deploy_infra consumes them explicitly. */
	const prepared = new Map<
		string,
		{ artifact: PreparedArtifact; preview: PreparedPreview }
	>();

	const rememberPrepared = (
		artifact: PreparedArtifact,
		preview: PreparedPreview,
	) => {
		prepared.set(artifact.artifactId, { artifact, preview });
		while (prepared.size > MAX_PREPARED_PREVIEWS) {
			const oldest = prepared.keys().next().value;
			if (oldest === undefined) break;
			prepared.delete(oldest);
		}
	};

	// ---- ask_question ----

	const askQuestionTool = definePawlTool({
		name: PAWL_TOOL_NAMES.askQuestion,
		label: "Ask the user",
		description:
			"Ask the human a freeform question and wait for their typed answer. Use this when you need information or a decision that is not an approval.",
		executionMode: "sequential",
		replay: "safe",
		schema: askQuestionSchema,
		execute: async (_toolCallId, input) => {
			const run = requireRun();
			const outcome = await run.broker.ask(input.question);
			if (!outcome.answered) {
				throw new PawlToolError(outcome.reason, outcome.message);
			}
			return toolResult(outcome.text);
		},
	});

	// ---- scan_resources ----

	const scanResourcesTool = definePawlTool({
		name: PAWL_TOOL_NAMES.scanResources,
		label: "Scan resources",
		description:
			"Scan the selected AWS account for deployed resources and compare them with the project's existing synthesized CDK output. Analysis only: this tool changes nothing. The result reports the coverage the scan achieved and the services it could not read, so absence of drift is only meaningful when coverage is complete.",
		executionMode: "sequential",
		replay: "safe",
		schema: scanResourcesSchema,
		execute: async (_toolCallId, input, signal) => {
			// Explicit context only: the injected scan seam owns the session's
			// checked identity/region/credentials. No ambient fallback exists.
			const outcome = await options.scan.scan({
				...(input.services === undefined ? {} : { services: input.services }),
				...(input.maxEntries === undefined
					? {}
					: { maxEntries: input.maxEntries }),
				...(signal === undefined ? {} : { signal }),
			});
			return toolResult(JSON.stringify(outcome, null, 2));
		},
	});

	// ---- generate (approval-gated write) ----

	const generateTool = definePawlTool({
		name: PAWL_TOOL_NAMES.generate,
		label: "Generate infrastructure code",
		description:
			"Write infrastructure code files into the project from the approved plan. This needs an explicit human approval bound to the exact file set before anything is written.",
		executionMode: "sequential",
		replay: "safe",
		schema: generateSchema,
		execute: async (toolCallId, input, signal) => {
			const run = requireRun();
			const generate = options.generate;
			if (!generate) {
				throw new PawlToolError(
					"no_generation_capability",
					"Generation is not available in this runtime",
				);
			}
			// Validate the write set BEFORE surfacing any approval.
			if (input.files.length === 0) {
				throw new PawlToolError(
					"empty_write_set",
					"Generation proposed no files; nothing to approve",
				);
			}
			for (const file of input.files) {
				assertWritablePath(projectDir, file.path);
			}
			const identity = generate.currentIdentity();
			const planDigest = await generate.approvedPlanDigest();
			const binding = (): ApprovalBinding => ({
				runId: run.runId,
				toolCallId,
				toolName: PAWL_TOOL_NAMES.generate,
				input: input.files,
				planDigest,
				projectDir,
				identity,
				previewComplete: true,
			});
			const outcome = await run.broker.request(binding());
			if (!outcome.granted) {
				throw new PawlToolError(
					"generation_not_approved",
					`Generation was not approved: ${outcome.message}`,
				);
			}
			await mutations.run(
				async (lease) => {
					lease.signal.throwIfAborted();
					// Identity revalidation at the write boundary: a changed
					// account/region fails closed before anything is written.
					const current = generate.currentIdentity();
					if (
						current.accountId !== identity.accountId ||
						current.region !== identity.region
					) {
						throw new PawlToolError(
							"identity_changed",
							`The checked AWS identity changed (${identity.accountId} → ${current.accountId}); generation must be approved again for the current identity`,
						);
					}
					// One-use consumption at the actual write boundary; the rebuilt
					// binding also enforces expiry and any argument/plan change.
					const consumption = outcome.grant.consume(binding());
					if (!consumption.ok) {
						throw new PawlToolError(
							"grant_unusable",
							`The generation approval could not be consumed: ${consumption.message}`,
						);
					}
					await generate.write(input.files, { signal: lease.signal });
				},
				{ owner: PAWL_TOOL_NAMES.generate, ...(signal ? { signal } : {}) },
			);
			return toolResult(
				`Wrote ${input.files.length} file(s) under the approved plan ${planDigest}: ${input.files.map((file) => file.path).join(", ")}`,
			);
		},
	});

	// ---- deploy_preview ----

	const deployPreviewTool = definePawlTool({
		name: PAWL_TOOL_NAMES.deployPreview,
		label: "Preview deployment",
		description:
			"Prepare the frozen deployment artifact and show a read-only diff of what deploying would change. Read-only: this tool changes nothing. Call deploy_infra with the returned artifact id only after the human agrees to exactly this diff.",
		executionMode: "sequential",
		replay: "safe",
		schema: deployPreviewSchema,
		execute: async (_toolCallId, input, signal) => {
			const deployment = options.deployment;
			if (!deployment) {
				throw new PawlToolError(
					"no_deployment_capability",
					"Deployment tooling is not available in this runtime",
				);
			}
			const artifact = await deployment.prepare({
				...(input.stacks === undefined ? {} : { stacks: input.stacks }),
				...(signal === undefined ? {} : { signal }),
			});
			const preview = await previewArtifact(artifact, deployment.exec);
			rememberPrepared(artifact, preview);
			return toolResult(
				[
					preview.text,
					`complete: ${yesNo(preview.complete)} changed: ${yesNo(preview.changed)}`,
					preview.complete && preview.changed
						? "deploy_infra can deploy this exact artifact after an explicit approval."
						: "Deployment is disabled for this preview.",
				].join("\n"),
			);
		},
	});

	// ---- deploy_infra (approval-gated deploy through Task 9's chain) ----

	const deployInfraTool = definePawlTool({
		name: PAWL_TOOL_NAMES.deployInfra,
		label: "Deploy infrastructure",
		description:
			"Deploy the previously previewed frozen artifact to AWS. This changes real infrastructure and needs an explicit human approval of the exact previewed diff. Call deploy_preview first.",
		executionMode: "sequential",
		replay: "safe",
		schema: deployInfraSchema,
		execute: async (toolCallId, input, _signal) => {
			const run = requireRun();
			const deployment = options.deployment;
			if (!deployment) {
				throw new PawlToolError(
					"no_deployment_capability",
					"Deployment tooling is not available in this runtime",
				);
			}
			const entry = prepared.get(input.artifactId);
			if (!entry) {
				throw new PawlToolError(
					"no_prepared_preview",
					`No prepared preview for artifact "${input.artifactId}"; run deploy_preview first. Previews never survive a restart.`,
				);
			}
			const result = await deployApprovedArtifact({
				artifact: entry.artifact,
				preview: entry.preview,
				broker: run.broker,
				mutations,
				exec: deployment.exec,
				currentIdentity: deployment.currentIdentity(),
				request: {
					runId: run.runId,
					toolCallId,
					toolName: PAWL_TOOL_NAMES.deployInfra,
					input,
				},
			});
			const output = [result.stdout, result.stderr]
				.map((part) => part.trimEnd())
				.filter((part) => part.length > 0)
				.join("\n");
			return toolResult(
				`Deployment command finished with exit code ${result.exitCode}.\n${output}`,
			);
		},
	});

	const registeredTools = [
		askQuestionTool,
		scanResourcesTool,
		...(options.generate ? [generateTool] : []),
		...(options.deployment ? [deployPreviewTool, deployInfraTool] : []),
	];
	const allowedNames = new Set(registeredTools.map((tool) => tool.name));

	return {
		tools: registeredTools,
		createAuthorizer: (run) => {
			activeRun = run;
			return async (request) => {
				if (!allowedNames.has(request.toolName)) {
					return {
						granted: false,
						reason: `${request.toolName} is not a registered Pawl tool`,
					};
				}
				// Execution permission only: the approval decisions for the gated
				// tools happen inside execute through this run's broker, and no
				// grant is ever issued here (questions never grant at preflight).
				return { granted: true };
			};
		},
	};
}
