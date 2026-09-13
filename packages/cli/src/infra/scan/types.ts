/**
 * The scanner contract.
 *
 * Every scanner reads one service and reports what it found. Failure is a
 * first-class outcome rather than an exception the caller has to catch: a
 * denied or unavailable service is recorded in the coverage, because a partial
 * read must never be presented as an absence of resources.
 */

import type { DeployedResource } from "../drift";

export type ServiceCoverageStatus =
	| "scanned"
	| "denied"
	| "error"
	| "unsupported";

export interface ServiceCoverage {
	readonly service: string;
	readonly status: ServiceCoverageStatus;
	/** Resources read. Always 0 unless the status is `scanned`. */
	readonly resourceCount: number;
	readonly message?: string | undefined;
}

export interface ScanCredentials {
	readonly accessKeyId: string;
	readonly secretAccessKey: string;
	readonly sessionToken?: string | undefined;
}

/**
 * Resolved per call, not once, so a refreshed SSO token is picked up mid-scan.
 * Structurally compatible with `fromNodeProviderChain()`.
 */
export type ScanCredentialProvider = () => Promise<
	ScanCredentials & { readonly expiration?: Date }
>;

export interface ScanContext {
	readonly accountId: string;
	readonly region: string;
	readonly credentials: ScanCredentialProvider;
}

export interface ResourceScanner {
	/** Service slug, e.g. `lambda`. Unique within a scan. */
	readonly service: string;
	scan(): Promise<readonly DeployedResource[]>;
}

/** Builds a scanner bound to a context. Real factories construct AWS clients. */
export type ScannerFactory = (context: ScanContext) => ResourceScanner;

export interface ResourceScanResult {
	readonly resources: readonly DeployedResource[];
	readonly coverage: readonly ServiceCoverage[];
}

export interface CoverageSummary {
	readonly total: number;
	readonly scanned: number;
	readonly denied: number;
	readonly error: number;
	readonly unsupported: number;
	/** True only when every attempted service was actually read. */
	readonly complete: boolean;
	/** The services that were not read, so a caller can name the gap. */
	readonly gaps: readonly ServiceCoverage[];
}

/** Signals that a service does not exist in the scanned region. */
export class ScanUnsupportedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ScanUnsupportedError";
	}
}
