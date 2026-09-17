import { spawn } from "node:child_process";
import { z } from "zod";
import type {
	CheckedChildEnvironment,
	ExecutionContext,
} from "./execution-context";
import {
	HOST_GRACEFUL_CLEANUP_MS,
	HOST_REAP_TIMEOUT_MS,
	PolicyExhaustedError,
	type RuntimePolicy,
} from "./policy";

/**
 * Controlled local subprocess execution for the Pi runtime proof.
 *
 * `createControlledExec(context, policy)` is an internal executor, not a
 * model-invoked shell. Its working directory and environment are bound to the
 * Task 3 execution context: every call runs in the selected project directory
 * with a neutralized environment and checked credential snapshot supplied by
 * `context.withChildEnvironment`, and every call accepts a shared signal and a
 * bounded deadline (the Task 6 host-command budget, itself capped by the
 * remaining run budget). On macOS/Linux the child is spawned as the leader of
 * an owned process group; deadlines and cancellation signal that whole group
 * gracefully (SIGTERM) and, after `HOST_GRACEFUL_CLEANUP_MS`, forcibly
 * (SIGKILL), then reap the pipes within `HOST_REAP_TIMEOUT_MS`. No PIDs or
 * process groups outside the owned group are ever signalled. Cleanup failures
 * and uncertain outcomes (for example a submitted AWS operation that local
 * cancellation cannot undo) propagate; results are never retried.
 */

export class ControlledExecError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ControlledExecError";
	}
}

/** Per-stream capture cap for bounded child output. */
export const HOST_CAPTURE_MAX_BYTES = 64 * 1024;

/**
 * Explicit truncation marker for an oversized stream capture. The received
 * byte count is included so a truncated capture is never mistaken for the
 * child's complete output.
 */
export const captureMarker = (
	stream: "stdout" | "stderr",
	totalBytes: number,
): string =>
	`\n[pawl: truncated — ${stream} received ${totalBytes} UTF-8 bytes; host capture is capped at ${HOST_CAPTURE_MAX_BYTES} bytes]`;

export interface ControlledExecRequest {
	readonly command: string;
	readonly args?: readonly string[];
	/** Optional tighter per-invocation budget; always capped by the shared budget. */
	readonly timeoutMs?: number;
	/** Additional cancellation source; the shared signals always apply. */
	readonly signal?: AbortSignal;
	/** Inherited environment to neutralize (defaults to the executor's own process.env). */
	readonly env?: Readonly<Record<string, string>>;
}

export interface ControlledExecResult {
	readonly command: string;
	readonly args: readonly string[];
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly stdoutTruncated: boolean;
	readonly stderrTruncated: boolean;
}

export interface ControlledExecDependencies {
	/** Platform override for fail-closed tests; defaults to `process.platform`. */
	readonly platform?: NodeJS.Platform;
}

export interface ControlledExec {
	run(request: ControlledExecRequest): Promise<ControlledExecResult>;
}

const requestSchema = z.strictObject({
	command: z.string().min(1),
	args: z.array(z.string()).optional(),
	timeoutMs: z.number().int().positive().optional(),
	signal: z.instanceof(AbortSignal).optional(),
	env: z.record(z.string(), z.string()).optional(),
});

const supportedPlatforms = new Set<NodeJS.Platform>(["darwin", "linux"]);

interface Capture {
	push(chunk: Buffer): void;
	readonly truncated: boolean;
	finish(): string;
}

/**
 * Captures a stream up to the cap, keeps draining past it (so a chatty child
 * can never deadlock on a full pipe), and marks the capture truncated.
 */
function createCapture(stream: "stdout" | "stderr"): Capture {
	const chunks: Buffer[] = [];
	let buffered = 0;
	let total = 0;
	let truncated = false;
	return {
		push(chunk: Buffer) {
			total += chunk.length;
			if (truncated) return;
			const remaining = HOST_CAPTURE_MAX_BYTES - buffered;
			if (chunk.length <= remaining) {
				chunks.push(chunk);
				buffered += chunk.length;
				return;
			}
			chunks.push(chunk.subarray(0, remaining));
			buffered = HOST_CAPTURE_MAX_BYTES;
			truncated = true;
		},
		get truncated() {
			return truncated;
		},
		finish(): string {
			const text = truncateToUtf8Boundary(Buffer.concat(chunks)).toString(
				"utf8",
			);
			return truncated ? `${text}${captureMarker(stream, total)}` : text;
		},
	};
}

/** Avoid decoding an incomplete multibyte character split by the capture cap. */
function truncateToUtf8Boundary(buffer: Buffer): Buffer {
	const length = buffer.length;
	if (length === 0) return buffer;
	let start = length - 1;
	let lead = buffer.at(start);
	while (lead !== undefined && (lead & 0xc0) === 0x80) {
		start -= 1;
		lead = buffer.at(start);
	}
	if (lead === undefined) return buffer; // invalid UTF-8; the decoder reports replacements
	const distance = length - 1 - start;
	const expected =
		(lead & 0x80) === 0
			? 0
			: (lead & 0xe0) === 0xc0
				? 1
				: (lead & 0xf0) === 0xe0
					? 2
					: (lead & 0xf8) === 0xf0
						? 3
						: -1;
	if (expected <= 0 || distance >= expected) return buffer;
	return buffer.subarray(0, start);
}

export function createControlledExec(
	context: ExecutionContext,
	policy: RuntimePolicy,
	dependencies: ControlledExecDependencies = {},
): ControlledExec {
	const platform = dependencies.platform ?? process.platform;
	if (!supportedPlatforms.has(platform)) {
		throw new ControlledExecError(
			`Controlled subprocess execution with owned process-group cleanup is not proven on ${platform}; failing closed instead of using a weaker path`,
		);
	}

	async function run(
		request: ControlledExecRequest,
	): Promise<ControlledExecResult> {
		const parsed = requestSchema.parse(request);
		policy.signal.throwIfAborted();
		const budget = policy.hostCommandTimeoutMs();
		const timeoutMs = Math.min(parsed.timeoutMs ?? budget, budget);
		if (timeoutMs <= 0) {
			throw new PolicyExhaustedError({
				code: "run_deadline",
				message:
					"Run deadline leaves no host-command budget; no subprocess may start",
			});
		}
		const args = parsed.args ?? [];
		// Every cancellation source — the shared policy signal and the caller's
		// request signal — is combined once here so the Task 3 deadline, lease
		// retirement and neutralized environment all observe the same signal.
		const sharedSignal = parsed.signal
			? AbortSignal.any([policy.signal, parsed.signal])
			: policy.signal;
		let running: Promise<unknown> | undefined;
		try {
			// Task 3 owns the neutralized environment, the checked snapshot, the
			// private credential files, lifetime refusal and flag rejection; its
			// finally removes the temporary directory after this run settles.
			return (await context.withChildEnvironment(
				{ timeoutMs, args, env: parsed.env, signal: sharedSignal },
				(child: CheckedChildEnvironment) => {
					running = runProcess(parsed.command, args, child);
					return running;
				},
			)) as ControlledExecResult;
		} catch (error) {
			// Cancellation rejects before settlement: hold the caller until the
			// owned process group has actually settled, then surface the reason.
			if (running) await running.then(undefined, () => {});
			throw error;
		}
	}

	function runProcess(
		command: string,
		args: readonly string[],
		child: CheckedChildEnvironment,
	): Promise<ControlledExecResult> {
		const stdout = createCapture("stdout");
		const stderr = createCapture("stderr");
		const proc = spawn(command, [...args], {
			cwd: context.projectDir,
			env: { ...child.env },
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		});
		proc.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
		proc.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

		/** Signal only the child's own process group; ESRCH means it settled. */
		const signalGroup = (name: NodeJS.Signals): boolean => {
			const pid = proc.pid;
			if (pid === undefined) return false;
			try {
				process.kill(-pid, name);
				return true;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
				throw error;
			}
		};

		return new Promise<ControlledExecResult>((resolve, reject) => {
			let settled = false;
			let graceTimer: NodeJS.Timeout | undefined;
			let terminated = false;

			const settle = (conclude: () => void) => {
				if (settled) return;
				settled = true;
				if (graceTimer) clearTimeout(graceTimer);
				child.signal.removeEventListener("abort", onAbort);
				conclude();
			};

			const beginTermination = () => {
				if (terminated) return;
				terminated = true;
				signalGroup("SIGTERM");
				graceTimer = setTimeout(() => {
					if (signalGroup("SIGKILL")) {
						// Bounded reaping: allow the group one final window to release
						// the pipes, then settle fail-closed with an uncertain outcome.
						setTimeout(() => {
							proc.stdout?.destroy();
							proc.stderr?.destroy();
							settle(() =>
								reject(
									new ControlledExecError(
										"The child process group could not be reaped after forced termination; pipes are released and any submitted AWS operation has an uncertain outcome",
									),
								),
							);
						}, HOST_REAP_TIMEOUT_MS);
					}
				}, HOST_GRACEFUL_CLEANUP_MS);
			};

			const onAbort = () => beginTermination();
			if (child.signal.aborted) onAbort();
			else child.signal.addEventListener("abort", onAbort, { once: true });

			proc.once("error", (error) => {
				settle(() => {
					proc.stdout?.destroy();
					proc.stderr?.destroy();
					reject(error instanceof Error ? error : new Error(String(error)));
				});
			});
			proc.once("close", (code, exitSignal) => {
				settle(() => {
					const result: ControlledExecResult = {
						command,
						args: [...args],
						exitCode: code ?? 0,
						stdout: stdout.finish(),
						stderr: stderr.finish(),
						stdoutTruncated: stdout.truncated,
						stderrTruncated: stderr.truncated,
					};
					if (child.signal.aborted || terminated) {
						// Cancellation dominates; the caller already observes the abort
						// reason, so settle the inner promise for cleanup ordering.
						resolve(result);
						return;
					}
					if (code === null) {
						reject(
							new ControlledExecError(
								`Child process exited on signal ${exitSignal}; its outcome is uncertain`,
							),
						);
						return;
					}
					if (code !== 0) {
						const detail = stderr.finish().trim() || stdout.finish().trim();
						reject(
							new ControlledExecError(
								`${command} exited with code ${code}${detail ? `: ${detail}` : ""}`,
							),
						);
						return;
					}
					resolve(result);
				});
			});
		});
	}

	return Object.freeze({ run });
}
