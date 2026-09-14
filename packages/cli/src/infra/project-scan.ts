/**
 * One project scan, orchestrated once.
 *
 * `scan_resources` and the reviews all need the same five steps — synthesize,
 * identify the caller, read the account, classify drift, suggest constructs — so
 * they share this rather than each re-deriving it. The seams (`scannerFactories`,
 * `resolveAccountId`) exist so the whole flow is testable without an account.
 */

import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { ExecFn } from "../harness";
import { classifyDrift } from "./drift";
import { buildScanReport, type ScanReport } from "./report";
import { DEFERRED_SERVICES, PAWL_SCANNER_FACTORIES } from "./scan/registry";
import { runScanners } from "./scan/run";
import type { ScanCredentialProvider, ScannerFactory } from "./scan/types";
import {
	type Suggestion,
	suggestConstructs,
	summarizeSuggestions,
} from "./suggestions";
import {
	hasCdkProject,
	loadSynthesizedResources,
	NoCdkAppError,
} from "./synth";

/** Exported so callers can pass the same provider the Bedrock model uses. */
export type PawlCredentialProvider = ReturnType<typeof fromNodeProviderChain>;

export interface SuggestionCount {
	readonly construct: string;
	readonly count: number;
}

export interface ProjectScanOutcome {
	/**
	 * Set when the drift comparison could not be made because the directory has
	 * no CDK app. The account scan still ran; only the comparison is missing.
	 */
	readonly driftUnavailable?: string | undefined;
	readonly report: ScanReport;
	readonly suggestions: readonly Suggestion[];
	readonly suggestionSummary: readonly SuggestionCount[];
	readonly suggestionsTruncated: number;
	readonly stacks: readonly string[];
	/** Services pawl cannot read, named rather than omitted. */
	readonly notScanned: readonly string[];
}

/** Resolve the caller's account id, which the report needs to identify itself. */
export async function resolveAccountId(
	region: string,
	credentials: ScanCredentialProvider,
): Promise<string> {
	const sts = new STSClient({ region, credentials });
	const identity = await sts.send(new GetCallerIdentityCommand({}));
	return identity.Account ?? "unknown";
}

export interface RunProjectScanOptions {
	readonly cwd: string;
	readonly region: string;
	readonly credentials?: ScanCredentialProvider | undefined;
	readonly exec: ExecFn;
	readonly services?: readonly string[] | undefined;
	readonly skipSynth?: boolean | undefined;
	readonly maxEntries?: number | undefined;
	/** Test seam: replace the shipped scanners. */
	readonly scannerFactories?: readonly ScannerFactory[] | undefined;
	/** Test seam: replace the STS lookup. */
	readonly resolveAccountId?:
		| ((region: string, credentials: ScanCredentialProvider) => Promise<string>)
		| undefined;
}

export async function runProjectScan(
	options: RunProjectScanOptions,
): Promise<ProjectScanOutcome> {
	const credentials = options.credentials ?? fromNodeProviderChain();
	const accountId = await (options.resolveAccountId ?? resolveAccountId)(
		options.region,
		credentials,
	);

	// A directory with no CDK app still gets a full account scan: reading the
	// account and suggesting Pawl constructs does not depend on the code side.
	// Only the drift comparison is unavailable, and that is reported rather than
	// allowed to fail the whole scan.
	let synthesized: Awaited<ReturnType<typeof loadSynthesizedResources>>;
	try {
		synthesized = await loadSynthesizedResources({
			cwd: options.cwd,
			exec: options.exec,
			skipSynth: options.skipSynth,
		});
	} catch (error: unknown) {
		if (error instanceof NoCdkAppError) {
			synthesized = { resources: [], stacks: [] };
		} else {
			throw error;
		}
	}

	const driftUnavailable =
		synthesized.resources.length === 0 && !hasCdkProject(options.cwd)
			? "no CDK app in this directory, so nothing to compare the account against"
			: undefined;

	const factories = options.scannerFactories ?? PAWL_SCANNER_FACTORIES;
	const scanners = factories.map((factory) =>
		factory({ accountId, region: options.region, credentials }),
	);
	const selected = options.services?.length
		? scanners.filter((scanner) => options.services?.includes(scanner.service))
		: scanners;

	const scan = await runScanners(selected);
	const entries = classifyDrift({
		synthesized: synthesized.resources,
		deployed: scan.resources,
	});

	const suggestions = suggestConstructs(entries);
	const cap = options.maxEntries ?? 200;

	return {
		driftUnavailable,
		report: buildScanReport({
			accountId,
			region: options.region,
			synthesizedCount: synthesized.resources.length,
			deployedCount: scan.resources.length,
			coverage: scan.coverage,
			entries,
			maxEntries: options.maxEntries,
		}),
		suggestions: suggestions.slice(0, cap),
		suggestionSummary: summarizeSuggestions(suggestions),
		suggestionsTruncated: Math.max(0, suggestions.length - cap),
		stacks: synthesized.stacks,
		notScanned: DEFERRED_SERVICES,
	};
}
