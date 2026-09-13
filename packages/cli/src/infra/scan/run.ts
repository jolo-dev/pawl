/**
 * Running a set of scanners, and turning their successes and failures into a
 * result that states its own coverage.
 */

import type { DeployedResource } from "../drift";
import {
	type CoverageSummary,
	type ResourceScanner,
	type ResourceScanResult,
	ScanUnsupportedError,
	type ServiceCoverage,
	type ServiceCoverageStatus,
} from "./types";

const DENIAL_NAMES = [
	"AccessDenied",
	"AccessDeniedException",
	"UnauthorizedOperation",
	"UnauthorizedException",
	"AuthorizationError",
	"AuthFailure",
	"Forbidden",
	"UnrecognizedClientException",
	"ExpiredToken",
	"ExpiredTokenException",
];

function httpStatus(error: unknown): number | undefined {
	const metadata = (error as { $metadata?: { httpStatusCode?: number } })
		?.$metadata;
	return metadata?.httpStatusCode;
}

function errorName(error: unknown): string {
	return error instanceof Error ? error.name : "";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Decide whether a failure was a permission gap, an outage, or an absence. */
export function classifyScanFailure(error: unknown): {
	status: Exclude<ServiceCoverageStatus, "scanned">;
	message: string;
} {
	if (error instanceof ScanUnsupportedError) {
		return { status: "unsupported", message: errorMessage(error) };
	}

	const name = errorName(error);
	const status = httpStatus(error);
	const denied =
		DENIAL_NAMES.some((candidate) => name.includes(candidate)) ||
		status === 401 ||
		status === 403;

	return {
		status: denied ? "denied" : "error",
		message: name ? `${name}: ${errorMessage(error)}` : errorMessage(error),
	};
}

/**
 * Run every scanner, isolating each failure.
 *
 * One denied service must never abort the scan: the whole point is to report
 * what could be read alongside what could not.
 */
export async function runScanners(
	scanners: readonly ResourceScanner[],
): Promise<ResourceScanResult> {
	const resources: DeployedResource[] = [];
	const coverage: ServiceCoverage[] = [];

	for (const scanner of scanners) {
		try {
			const found = await scanner.scan();
			resources.push(...found);
			coverage.push({
				service: scanner.service,
				status: "scanned",
				resourceCount: found.length,
			});
		} catch (error: unknown) {
			const failure = classifyScanFailure(error);
			coverage.push({
				service: scanner.service,
				status: failure.status,
				resourceCount: 0,
				message: failure.message,
			});
		}
	}

	return { resources, coverage };
}

export function coverageSummary(
	coverage: readonly ServiceCoverage[],
): CoverageSummary {
	const count = (status: ServiceCoverageStatus): number =>
		coverage.filter((entry) => entry.status === status).length;
	const gaps = coverage.filter((entry) => entry.status !== "scanned");

	return {
		total: coverage.length,
		scanned: count("scanned"),
		denied: count("denied"),
		error: count("error"),
		unsupported: count("unsupported"),
		complete: gaps.length === 0,
		gaps,
	};
}
