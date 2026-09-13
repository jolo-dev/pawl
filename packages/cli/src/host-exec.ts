import { spawn } from "node:child_process";
import { type ExecFn, PawlHarness } from "./harness";
import { projectDir } from "./project-dir";

/**
 * Build an {@link ExecFn} that runs commands on the host in `cwd`.
 *
 * Authored eve tools run in the app runtime — not the sandbox — so a
 * `PawlHarness` constructed inside a tool operates on the user's real project
 * directory. Commands that exit nonzero reject, which `PawlHarness` already
 * treats as "file absent / directory unreadable".
 *
 * Built on `node:child_process` rather than `Bun.spawn` because eve bundles
 * authored modules for its Node runtime and rejects runtime-specific imports.
 */
export function createHostExec(cwd: string): ExecFn {
	return async (cmd, args) => {
		const proc = spawn(cmd, args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
		proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

		const exitCode = await new Promise<number>((resolve, reject) => {
			proc.once("error", reject);
			proc.once("close", (code) => resolve(code ?? 1));
		});

		const stdout = Buffer.concat(stdoutChunks).toString("utf8");
		const stderr = Buffer.concat(stderrChunks).toString("utf8");
		if (exitCode !== 0) {
			throw new Error(
				`${cmd} exited with ${exitCode}: ${stderr.trim() || stdout.trim()}`,
			);
		}
		return { stdout };
	};
}

/**
 * A `PawlHarness` bound to the project the agent is operating on.
 *
 * Every pawl tool needs the same wiring; centralising it keeps the tools to a
 * single line and gives tests one seam to substitute.
 */
export function createPawlHarness(cwd: string = projectDir()): PawlHarness {
	return new PawlHarness({ cwd, exec: createHostExec(cwd) });
}
