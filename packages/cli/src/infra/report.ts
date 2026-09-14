/**
 * The model-facing shape of a resource scan.
 *
 * A real account can hold hundreds of resources, and the scan result is a tool
 * result that lands in the root transcript, so the report is bounded. Truncation
 * keeps drift ahead of matches: the interesting entries are the ones that must
 * survive the cap, because "everything matched" is already summarised by the
 * counts.
 */

import type { DeployedResource, DriftEntry, DriftStatus } from "./drift";
import { coverageSummary } from "./scan/run";
import type { CoverageSummary, ServiceCoverage } from "./scan/types";

/** The default cap on entries carried in the report. */
export const DEFAULT_MAX_ENTRIES = 200;

export interface ReportEntry {
	readonly status: DriftStatus;
	/** The deployed name where there is one, otherwise the logical id. */
	readonly name: string;
	readonly resourceKind: string;
	readonly basis: DriftEntry["basis"];
	readonly reason: string;
}

export interface ScanReport {
	readonly accountId: string;
	readonly region: string;
	readonly synthesizedCount: number;
	readonly deployedCount: number;
	readonly drift: {
		readonly matched: number;
		readonly notDeployed: number;
		readonly unmanaged: number;
		readonly foreign: number;
	};
	readonly coverage: {
		readonly total: number;
		readonly scanned: number;
		readonly denied: number;
		readonly error: number;
		readonly unsupported: number;
		readonly complete: boolean;
		readonly gaps: readonly {
			readonly service: string;
			readonly status: ServiceCoverage["status"];
			readonly message?: string | undefined;
		}[];
	};
	readonly entries: readonly ReportEntry[];
	/** How many entries the cap dropped. */
	readonly truncated: number;
}

/** Drift order: the surprising statuses first, a plain match last. */
const STATUS_PRIORITY: Record<DriftStatus, number> = {
	"not-deployed": 0,
	unmanaged: 1,
	foreign: 2,
	matched: 3,
};

function toReportEntry(entry: DriftEntry): ReportEntry {
	const deployed: DeployedResource | undefined = entry.deployed;
	return {
		status: entry.status,
		name:
			deployed?.physicalName ??
			entry.synthesized?.logicalId ??
			(deployed ? deployed.physicalName : "unknown"),
		resourceKind:
			deployed?.resourceKind ?? entry.synthesized?.resourceKind ?? "unknown",
		basis: entry.basis,
		reason: entry.reason,
	};
}

export function buildScanReport(input: {
	readonly accountId: string;
	readonly region: string;
	readonly synthesizedCount: number;
	readonly deployedCount: number;
	readonly coverage: readonly ServiceCoverage[];
	readonly entries: readonly DriftEntry[];
	readonly maxEntries?: number;
}): ScanReport {
	const summary: CoverageSummary = coverageSummary(input.coverage);
	const count = (status: DriftStatus): number =>
		input.entries.filter((entry) => entry.status === status).length;

	const ordered = [...input.entries].sort(
		(a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status],
	);
	const cap = input.maxEntries ?? DEFAULT_MAX_ENTRIES;
	const kept = ordered.slice(0, cap);

	return {
		accountId: input.accountId,
		region: input.region,
		synthesizedCount: input.synthesizedCount,
		deployedCount: input.deployedCount,
		drift: {
			matched: count("matched"),
			notDeployed: count("not-deployed"),
			unmanaged: count("unmanaged"),
			foreign: count("foreign"),
		},
		coverage: {
			total: summary.total,
			scanned: summary.scanned,
			denied: summary.denied,
			error: summary.error,
			unsupported: summary.unsupported,
			complete: summary.complete,
			gaps: summary.gaps.map((gap) => ({
				service: gap.service,
				status: gap.status,
				message: gap.message,
			})),
		},
		entries: kept.map(toReportEntry),
		truncated: ordered.length - kept.length,
	};
}
