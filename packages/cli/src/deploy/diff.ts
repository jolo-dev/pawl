/**
 * The deploy approval artifact.
 *
 * R14 fixed the thing a human approves as the change set, not a bare "deploy?".
 * `cdk diff` already compares the deployed stack with the local synthesis, which
 * is exactly the Synthesized-versus-Deployed comparison this feature rests on,
 * so the artifact costs nothing extra to produce.
 *
 * Counting is best-effort and never invented: `cdk diff` marks additions,
 * changes and removals with `[+]`, `[~]` and `[-]`, but if the output carries no
 * markers this reports `counts: null` rather than "0 to add". Telling a user
 * nothing is changing when the output was merely unrecognised is the same class
 * of error as reporting no drift from an unread account.
 */

import type { ExecFn } from "../harness";

export interface DiffCounts {
	readonly toAdd: number;
	readonly toChange: number;
	readonly toRemove: number;
}

export interface DeployDecision {
	readonly stack: string | null;
	readonly changed: boolean;
	readonly diff: string;
	/** Null when the output contained no recognisable resource markers. */
	readonly counts: DiffCounts | null;
	readonly summary: string;
}

const NO_DIFF_PATTERN = /there were no differences/i;
const ADD_MARKER = /^\[\+\]/;
const CHANGE_MARKER = /^\[~\]/;
const REMOVE_MARKER = /^\[-\]/;

function countResources(diff: string): DiffCounts | null {
	let toAdd = 0;
	let toChange = 0;
	let toRemove = 0;
	let seen = false;

	for (const rawLine of diff.split("\n")) {
		const line = rawLine.trim();
		if (ADD_MARKER.test(line)) {
			toAdd++;
			seen = true;
		} else if (CHANGE_MARKER.test(line)) {
			toChange++;
			seen = true;
		} else if (REMOVE_MARKER.test(line)) {
			toRemove++;
			seen = true;
		}
	}

	return seen ? { toAdd, toChange, toRemove } : null;
}

export function buildDeployDecision(input: {
	readonly diff: string;
	readonly stack?: string | undefined;
}): DeployDecision {
	const diff = input.diff;
	const stack = input.stack ?? null;
	const changed = diff.trim().length > 0 && !NO_DIFF_PATTERN.test(diff);
	const counts = changed ? countResources(diff) : null;

	const summary = !changed
		? "no differences"
		: counts
			? `${counts.toAdd} to add, ${counts.toChange} to change, ${counts.toRemove} to remove`
			: "differences present, but the counts could not be read from cdk output";

	return { stack, changed, diff, counts, summary };
}

/** The text to show a human before they approve. */
export function describeDeployDecision(decision: DeployDecision): string {
	const target = decision.stack ? `stack ${decision.stack}` : "all stacks";
	if (!decision.changed) {
		return `## Deploy preview\n\n${target} has no differences: nothing to deploy.`;
	}
	return [
		"## Deploy preview",
		"",
		`Pending changes to ${target}: ${decision.summary}.`,
		"",
		"```diff",
		decision.diff.trimEnd(),
		"```",
	].join("\n");
}

export async function runCdkDiff(options: {
	readonly cwd: string;
	readonly exec: ExecFn;
	readonly stack?: string | undefined;
}): Promise<string> {
	const args = ["cdk", "diff"];
	if (options.stack) args.push(options.stack);
	const { stdout } = await options.exec("npx", args);
	return stdout;
}

/**
 * Run `cdk deploy`.
 *
 * `--require-approval never` is required, not a convenience: the exec has no TTY,
 * so cdk's own approval prompt would hang the turn forever. Approval happens in
 * eve, where the human is.
 */
export async function runCdkDeploy(options: {
	readonly cwd: string;
	readonly exec: ExecFn;
	readonly stack?: string | undefined;
}): Promise<string> {
	const args = ["cdk", "deploy", "--require-approval", "never"];
	if (options.stack) args.push(options.stack);
	const { stdout } = await options.exec("npx", args);
	return stdout;
}
