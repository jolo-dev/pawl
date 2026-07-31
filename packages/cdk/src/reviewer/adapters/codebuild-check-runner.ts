import {
	CloudWatchLogsClient,
	GetLogEventsCommand,
	type GetLogEventsCommandInput,
	type GetLogEventsCommandOutput,
} from "@aws-sdk/client-cloudwatch-logs";
import {
	BatchGetBuildsCommand,
	type BatchGetBuildsCommandInput,
	type BatchGetBuildsCommandOutput,
	type Build,
	CodeBuildClient,
	StartBuildCommand,
	type StartBuildCommandInput,
	type StartBuildCommandOutput,
} from "@aws-sdk/client-codebuild";
import type { RepositoryCheckConfig } from "../domain/repository-config";
import type { RequestRef, ReviewCycleSnapshot } from "../domain/review-request";
import type {
	CheckResult,
	CheckRunInput,
	CheckRunner,
	CheckRunResult,
} from "../ports/check-runner";

/** Narrow transport seam so tests can inject canned CodeBuild/CloudWatch responses. */
export interface CodeBuildTransport {
	startBuild(input: StartBuildCommandInput): Promise<StartBuildCommandOutput>;
	batchGetBuilds(
		input: BatchGetBuildsCommandInput,
	): Promise<BatchGetBuildsCommandOutput>;
	getLogEvents(
		input: GetLogEventsCommandInput,
	): Promise<GetLogEventsCommandOutput>;
}

/** Default transport wrapping the real SDK clients. */
export class CodeBuildRuntimeTransport implements CodeBuildTransport {
	readonly #codebuild: CodeBuildClient;
	readonly #logs: CloudWatchLogsClient;
	constructor(codebuild?: CodeBuildClient, logs?: CloudWatchLogsClient) {
		this.#codebuild = codebuild ?? new CodeBuildClient({});
		this.#logs = logs ?? new CloudWatchLogsClient({});
	}
	async startBuild(
		input: StartBuildCommandInput,
	): Promise<StartBuildCommandOutput> {
		return this.#codebuild.send(new StartBuildCommand(input));
	}
	async batchGetBuilds(
		input: BatchGetBuildsCommandInput,
	): Promise<BatchGetBuildsCommandOutput> {
		return this.#codebuild.send(new BatchGetBuildsCommand(input));
	}
	async getLogEvents(
		input: GetLogEventsCommandInput,
	): Promise<GetLogEventsCommandOutput> {
		return this.#logs.send(new GetLogEventsCommand(input));
	}
}

export interface CodeBuildCheckRunnerOptions {
	readonly transport: CodeBuildTransport;
	/** Repository name → CodeBuild project name. */
	readonly projectNames: Readonly<Record<string, string>>;
	readonly clock?: () => Date;
	readonly sleep?: (ms: number) => Promise<void>;
	readonly pollIntervalMs?: number;
	readonly maxPollMs?: number;
	readonly maxLogBytes?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_MS = 900_000;
const DEFAULT_MAX_LOG_BYTES = 4_096;

/**
 * Encodes a repository name into a Lambda environment-variable suffix that
 * uniquely identifies its CodeBuild project (`CODEBUILD_PROJECT_<SAFE>`).
 * Non-alphanumerics collapse to `_`; the result is upper-cased.
 */
export function projectEnvVarSuffix(repository: string): string {
	return repository.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

/** Full env var name (`CODEBUILD_PROJECT_<SAFE>`) for a repository. */
export function projectEnvVar(repository: string): string {
	return `CODEBUILD_PROJECT_${projectEnvVarSuffix(repository)}`;
}

const CHECK_START_PREFIX = "<<<CHECK:";
const CHECK_EXIT_PREFIX = "<<<CHECK:";

/**
 * Runs repository-configured checks at the exact immutable source commit via
 * CodeBuild. Synchronous from the caller's view: start → poll → read logs.
 * Runs inside the workflow's durable `run-review` step.
 */
export class CodeBuildCheckRunner implements CheckRunner {
	readonly #transport: CodeBuildTransport;
	readonly #projectNames: Readonly<Record<string, string>>;
	readonly #clock: () => Date;
	readonly #sleep: (ms: number) => Promise<void>;
	readonly #pollIntervalMs: number;
	readonly #maxPollMs: number;
	readonly #maxLogBytes: number;

	constructor(options: CodeBuildCheckRunnerOptions) {
		this.#transport = options.transport;
		this.#projectNames = options.projectNames;
		this.#clock = options.clock ?? (() => new Date());
		this.#sleep =
			options.sleep ??
			((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
		this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		this.#maxPollMs = options.maxPollMs ?? DEFAULT_MAX_POLL_MS;
		this.#maxLogBytes = options.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES;
	}

	async run(input: CheckRunInput): Promise<CheckRunResult> {
		const projectName = this.#projectNames[input.request.repository];
		if (projectName === undefined) {
			return {
				status: "infrastructure-failure",
				code: "UNKNOWN_REPOSITORY",
				message: `no CodeBuild project configured for repository ${input.request.repository}`,
				retryable: false,
			};
		}
		const buildspec = generateBuildspec(input.checks, input.installCommand);
		const startOutput = await this.#transport.startBuild({
			projectName,
			sourceVersion: input.snapshot.sourceRevision,
			buildspecOverride: buildspec,
			environmentVariablesOverride: [
				{
					name: "PAWL_CHECK_RUN_ID",
					type: "PLAINTEXT",
					value: this.#clock().toISOString(),
				},
			],
		});
		const buildId = startOutput.build?.id;
		if (buildId === undefined) {
			return {
				status: "infrastructure-failure",
				code: "NO_BUILD_ID",
				message: "StartBuild returned no build id",
				retryable: true,
			};
		}

		const terminal = await this.#pollUntilTerminal(buildId);
		if (terminal.status === "timed-out") {
			return {
				status: "timed-out",
				message: `build ${buildId} did not terminate within ${this.#maxPollMs}ms`,
			};
		}

		const { status, build } = terminal;

		if (status === "FAULT") {
			return {
				status: "infrastructure-failure",
				code: "FAULT",
				message: "CodeBuild fault",
				retryable: true,
			};
		}
		if (status === "STOPPED") {
			return {
				status: "infrastructure-failure",
				code: "STOPPED",
				message: "CodeBuild build stopped",
				retryable: false,
			};
		}
		if (status === "TIMED_OUT") {
			return { status: "timed-out", message: "CodeBuild build timed out" };
		}

		// SUCCEEDED or FAILED — parse per-check results from logs.
		const logs = await this.#readLogs(build);
		const checks = parseCheckResults(input.checks, logs, this.#maxLogBytes);
		return { status: "completed", checks };
	}

	async #pollUntilTerminal(buildId: string): Promise<
		| { readonly status: "timed-out"; readonly build?: never }
		| {
				readonly status:
					| "SUCCEEDED"
					| "FAILED"
					| "FAULT"
					| "STOPPED"
					| "TIMED_OUT";
				readonly build: Build;
		  }
	> {
		const deadline = this.#clock().getTime() + this.#maxPollMs;
		// eslint-disable-next-line no-constant-condition
		while (true) {
			const output = await this.#transport.batchGetBuilds({ ids: [buildId] });
			const build = output.builds?.[0];
			const status = build?.buildStatus;
			if (
				build !== undefined &&
				(status === "SUCCEEDED" ||
					status === "FAILED" ||
					status === "FAULT" ||
					status === "STOPPED" ||
					status === "TIMED_OUT")
			) {
				return { status, build };
			}
			if (this.#clock().getTime() >= deadline) {
				return { status: "timed-out" };
			}
			await this.#sleep(this.#pollIntervalMs);
		}
	}

	async #readLogs(build: Build): Promise<string> {
		const logConfig = build.logs?.cloudWatchLogs;
		const groupName = logConfig?.groupName;
		const streamName = logConfig?.streamName;
		if (groupName === undefined || streamName === undefined) return "";
		const output = await this.#transport.getLogEvents({
			logGroupName: groupName,
			logStreamName: streamName,
			startFromHead: true,
		});
		return (output.events ?? []).map((event) => event.message ?? "").join("\n");
	}
}

/** Generate a CodeBuild buildspec that runs each check with exit-code markers. */
export function generateBuildspec(
	checks: readonly RepositoryCheckConfig[],
	installCommand?: string,
): string {
	const phases: string[] = [];
	if (installCommand !== undefined && installCommand.trim() !== "") {
		phases.push(`  install:
    commands:
      - ${escapeShell(installCommand)}`);
	}
	const buildCommands: string[] = [];
	for (const check of checks) {
		buildCommands.push(
			`      - echo "${CHECK_START_PREFIX}${check.name}:START>>>"`,
		);
		buildCommands.push(
			`      - ${escapeShell(check.command)}; __code=$?; echo "${CHECK_EXIT_PREFIX}${check.name}:EXIT:$__code>>>"; test $__code -eq 0`,
		);
	}
	phases.push(`  build:
    commands:${buildCommands.length === 0 ? " []" : `\n${buildCommands.join("\n")}`}`);
	return `version: 0.2
phases:
${phases.join("\n")}
`;
}

function escapeShell(command: string): string {
	// The command is already a validated shell string from the config; emit as-is.
	// CodeBuild runs each list entry as a separate shell command.
	return command;
}

/** Parse per-check exit markers from the raw log and bound/scrub each check's log. */
function parseCheckResults(
	checks: readonly RepositoryCheckConfig[],
	rawLog: string,
	maxLogBytes: number,
): CheckResult[] {
	const lines = rawLog.split("\n");
	const results: CheckResult[] = [];
	for (const check of checks) {
		const startMarker = `${CHECK_START_PREFIX}${check.name}:START>>>`;
		const exitMarker = `${CHECK_EXIT_PREFIX}${check.name}:EXIT:`;
		const startIdx = lines.findIndex((line) => line.includes(startMarker));
		const exitIdx = lines.findIndex((line) => line.includes(exitMarker));
		let exitCode = 0;
		let checkLines: string[] = [];
		if (startIdx >= 0 && exitIdx > startIdx) {
			checkLines = lines.slice(startIdx + 1, exitIdx);
			const exitLine = lines[exitIdx] ?? "";
			const match = exitLine.match(/EXIT:(\d+)/);
			exitCode = match ? Number.parseInt(match[1] ?? "0", 10) : 0;
		} else if (exitIdx >= 0) {
			const exitLine = lines[exitIdx] ?? "";
			const match = exitLine.match(/EXIT:(\d+)/);
			exitCode = match ? Number.parseInt(match[1] ?? "0", 10) : 0;
		}
		const { boundedLog, logTruncated } = boundAndScrub(
			checkLines.join("\n"),
			maxLogBytes,
		);
		results.push({
			name: check.name,
			status: exitCode === 0 ? "passed" : "failed",
			exitCode,
			durationMs: 0,
			boundedLog,
			logTruncated,
		});
	}
	return results;
}

function boundAndScrub(
	text: string,
	maxBytes: number,
): { boundedLog: string; logTruncated: boolean } {
	const scrubbed = scrubLog(text);
	if (Buffer.byteLength(scrubbed, "utf8") <= maxBytes) {
		return { boundedLog: scrubbed, logTruncated: false };
	}
	const truncated = scrubbed.slice(0, maxBytes);
	return { boundedLog: truncated, logTruncated: true };
}

/** Redact AWS access-key IDs and request IDs from log text. */
export function scrubLog(text: string): string {
	return text
		.replace(/AKIA[0-9A-Z]{16}/g, "AKIA[REDACTED]")
		.replace(/RequestId: [0-9a-f-]{8,36}/gi, "RequestId: [REDACTED]");
}

// Re-export types for callers.
export type {
	CheckResult,
	CheckRunInput,
	CheckRunResult,
	RequestRef,
	ReviewCycleSnapshot,
};
