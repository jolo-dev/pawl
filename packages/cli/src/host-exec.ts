import { type ExecFn, PawlHarness } from "./harness";

/**
 * Build an {@link ExecFn} that runs commands on the host in `cwd`.
 *
 * Authored eve tools run in the app runtime — not the sandbox — so a
 * `PawlHarness` constructed inside a tool operates on the user's real project
 * directory. Commands that exit nonzero reject, which `PawlHarness` already
 * treats as "file absent / directory unreadable".
 */
export function createHostExec(cwd: string): ExecFn {
	return async (cmd, args) => {
		const proc = Bun.spawn([cmd, ...args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (exitCode !== 0) {
			throw new Error(
				`${cmd} exited with ${exitCode}: ${stderr.trim() || stdout.trim()}`,
			);
		}
		return { stdout };
	};
}

/**
 * A `PawlHarness` bound to the host working directory.
 *
 * Every pawl tool needs the same wiring; centralising it keeps the tools to a
 * single line and gives tests one seam to substitute.
 */
export function createPawlHarness(cwd: string = process.cwd()): PawlHarness {
	return new PawlHarness({ cwd, exec: createHostExec(cwd) });
}
