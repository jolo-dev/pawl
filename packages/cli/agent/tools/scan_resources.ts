import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { createHostExec } from "../../src/host-exec";
import { classifyDrift } from "../../src/infra/drift";
import { buildScanReport } from "../../src/infra/report";
import {
	buildScanners,
	DEFERRED_SERVICES,
	runScanners,
} from "../../src/infra/scan";
import { loadSynthesizedResources } from "../../src/infra/synth";
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
 * and an unreadable caller identity both abort, because either one silently
 * turned into an empty comparison would report "no drift" when the truth is
 * "no data".
 */
export default defineTool({
	description:
		"Scan the AWS account for deployed resources and compare them with this project's synthesized CDK output. Returns drift (resources declared but not deployed, resources created outside the code, and resources carrying Pawl provenance that no synthesized resource matches) together with the coverage the scan achieved. Analysis only: this tool changes nothing. A partial scan is reported with its gaps, so absence of drift is only meaningful when coverage is complete.",
	inputSchema: scanResourcesInputSchema,
	async execute({ services, skipSynth, maxEntries }) {
		const cwd = projectDir();
		const exec = createHostExec(cwd);
		const region = process.env.AWS_REGION ?? "us-east-1";
		const credentials = fromNodeProviderChain();

		const synthesized = await loadSynthesizedResources({
			cwd,
			exec,
			skipSynth,
		});

		const sts = new STSClient({ region, credentials });
		const identity = await sts.send(new GetCallerIdentityCommand({}));
		const accountId = identity.Account ?? "unknown";

		const all = buildScanners({ accountId, region, credentials });
		const scanners = services?.length
			? all.filter((scanner) => services.includes(scanner.service))
			: all;

		const scan = await runScanners(scanners);
		const entries = classifyDrift({
			synthesized: synthesized.resources,
			deployed: scan.resources,
		});

		return {
			...buildScanReport({
				accountId,
				region,
				synthesizedCount: synthesized.resources.length,
				deployedCount: scan.resources.length,
				coverage: scan.coverage,
				entries,
				maxEntries,
			}),
			stacks: synthesized.stacks,
			/** Named so a gap is never mistaken for an absence of resources. */
			notScanned: DEFERRED_SERVICES,
		};
	},
});
