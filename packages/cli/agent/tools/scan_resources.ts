import { defineTool } from "eve/tools";
import { z } from "zod";
import { createHostExec } from "../../src/host-exec";
import { runProjectScan } from "../../src/infra/project-scan";
import { projectDir } from "../../src/project-dir";

export const scanResourcesInputSchema = z.object({
	services: z
		.array(z.string())
		.optional()
		.describe(
			"Limit the scan to these service slugs (for example ['lambda','s3']). Omit to scan everything pawl covers.",
		),
	skipSynth: z
		.boolean()
		.optional()
		.describe(
			"Read the existing cdk.out instead of running `cdk synth` again. Only use when the project was just synthesized.",
		),
	maxEntries: z
		.number()
		.int()
		.min(1)
		.max(1000)
		.optional()
		.describe("Cap on drift entries returned. Drift is kept ahead of matches."),
});

/**
 * Read the account and compare it with the project's synthesized output.
 *
 * Two failures are deliberately loud rather than degraded: a broken `cdk synth`
 * and an unreadable caller identity both throw, because either silently turned
 * into an empty comparison would report "no drift" when the truth is "no data".
 */
export default defineTool({
	description:
		"Scan the AWS account for deployed resources, and compare them with this project's synthesized CDK output when the project has one. Returns the deployed resources, the coverage the scan achieved, drift, and candidate Pawl constructs for resources Pawl does not already manage. Analysis only: this tool changes nothing. If the directory has no CDK app the scan still runs and reports `driftUnavailable`, so you get the account inventory without a drift comparison. A partial scan is reported with its gaps, so absence of drift is only meaningful when coverage is complete.",
	inputSchema: scanResourcesInputSchema,
	async execute({ services, skipSynth, maxEntries }) {
		const cwd = projectDir();
		const outcome = await runProjectScan({
			cwd,
			region: process.env.AWS_REGION ?? "us-east-1",
			exec: createHostExec(cwd),
			services,
			skipSynth,
			maxEntries,
		});
		// Surfaced on its own so the model cannot read an account scan as if it
		// were also a drift report: without a CDK app there is nothing to compare
		// the account against.
		return {
			...outcome,
			driftUnavailable: outcome.driftUnavailable ?? undefined,
		};
	},
});
