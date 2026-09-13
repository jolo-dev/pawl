import { spawn } from "node:child_process";

/**
 * Open a URL in the user's default browser.
 *
 * Uses the platform opener directly instead of a shell so the CLI stays free of
 * runtime-specific packages: `aws-credentials.ts` is reachable from authored
 * eve modules, and eve refuses to bundle non-portable imports.
 */
export async function openInBrowser(url: string): Promise<void> {
	const [command, args] =
		process.platform === "darwin"
			? ["open", [url]]
			: process.platform === "win32"
				? ["cmd", ["/c", "start", "", url]]
				: ["xdg-open", [url]];

	await new Promise<void>((resolve) => {
		const child = spawn(command as string, args as string[], {
			stdio: "ignore",
		});
		// Resolve on close, not spawn: callers (and tests) need the opener to
		// have actually run before the login flow continues.
		child.once("error", () => resolve());
		child.once("close", () => resolve());
	});
}
