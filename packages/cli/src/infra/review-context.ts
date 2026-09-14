/**
 * The account section of a review prompt.
 *
 * A review that cannot see deployed resources must say so, and a review that
 * saw only part of them must name the gap. Composition lives here, apart from the
 * tools, so the honesty rules are testable rather than buried in prompt strings.
 */

import type { ExecFn } from "../harness";
import { type ProjectScanOutcome, runProjectScan } from "./project-scan";

/**
 * Gather the account context for a review, degrading rather than failing.
 *
 * A review must still produce something useful when the account cannot be read,
 * but it must never quietly look like it read one — hence `failed` carries the
 * reason into the prompt.
 */
export async function collectReviewScanContext(options: {
	readonly cwd: string;
	readonly region: string;
	readonly exec: ExecFn;
	readonly scanAccount?: boolean | undefined;
}): Promise<ReviewScanContext> {
	if (options.scanAccount === false) return { status: "skipped" };
	try {
		const outcome = await runProjectScan({
			cwd: options.cwd,
			region: options.region,
			exec: options.exec,
		});
		return { status: "included", outcome };
	} catch (error: unknown) {
		return {
			status: "failed",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** Stated on every cost review, because pawl never retrieves billing data. */
export const COST_DATA_LIMITATION = [
	"## Cost data",
	"",
	"No billing data was retrieved. pawl does not call the Cost Explorer API, so any cost figure in this review is an estimate derived from resource configuration, never measured spend. Present estimates as estimates and say plainly that no billing data was available.",
].join("\n");

export type ReviewScanContext =
	| { readonly status: "skipped" }
	| { readonly status: "failed"; readonly error: string }
	| { readonly status: "included"; readonly outcome: ProjectScanOutcome };

function coverageLine(outcome: ProjectScanOutcome): string {
	const { coverage } = outcome.report;
	if (coverage.complete) {
		return `Coverage: all ${coverage.total} services were read, so an absence of drift here is meaningful.`;
	}
	const gaps = coverage.gaps
		.map((gap) =>
			gap.message
				? `${gap.service} (${gap.status}: ${gap.message})`
				: `${gap.service} (${gap.status})`,
		)
		.join(", ");
	return [
		`Coverage: ${coverage.scanned} of ${coverage.total} services were read.`,
		`Not read: ${gaps}.`,
		`pawl cannot read these services at all: ${outcome.notScanned.join(", ")}.`,
		"Because coverage is incomplete, do not describe the account as clean or free of a problem, and state which services were not read.",
	].join("\n");
}

/**
 * Render the account context for a review prompt.
 *
 * `skipped` and `failed` both produce a section, because an absent account
 * section reads as "there was nothing to find" rather than "nobody looked".
 */
export function composeAccountSection(context: ReviewScanContext): string {
	if (context.status === "skipped") {
		return [
			"## Account context",
			"",
			"No account scan was requested, so this review is based on the project's code alone. Treat every statement about deployed resources as unknown, and say that no account data was consulted.",
		].join("\n");
	}

	if (context.status === "failed") {
		return [
			"## Account context",
			"",
			`The account could not be read: ${context.error}`,
			"This review is therefore based on the project's code alone. Say that the account was not read and why, and do not present any conclusion about deployed resources as a finding.",
		].join("\n");
	}

	const { report, suggestionSummary } = context.outcome;
	const candidates = suggestionSummary.length
		? suggestionSummary
				.map((entry) => `- ${entry.construct} × ${entry.count}`)
				.join("\n")
		: "- none: every resource pawl can see is already managed by pawl.";

	return [
		"## Account context",
		"",
		`Account ${report.accountId}, region ${report.region}.`,
		`The project synthesizes ${report.synthesizedCount} resources across ${context.outcome.stacks.length} stack(s); the account reported ${report.deployedCount}.`,
		"",
		"### Drift",
		`- ${report.drift.notDeployed} declared but not deployed.`,
		`- ${report.drift.unmanaged} deployed and created outside the infrastructure code.`,
		`- ${report.drift.foreign} deployed with Pawl provenance but no synthesized counterpart (ambiguous: it may belong to another project sharing this team and stage).`,
		`- ${report.drift.matched} matched.`,
		"",
		"### Pawl construct candidates (resources pawl does not manage)",
		candidates,
		"",
		coverageLine(context.outcome),
	].join("\n");
}
