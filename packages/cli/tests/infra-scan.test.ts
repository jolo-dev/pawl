import { describe, expect, test } from "bun:test";
import type { DeployedResource } from "../src/infra/drift";
import {
	coverageSummary,
	type ResourceScanner,
	runScanners,
	ScanUnsupportedError,
} from "../src/infra/scan";

const makeResource = (
	service: string,
	physicalName: string,
): DeployedResource => ({
	service,
	resourceKind: "AWS::Lambda::Function",
	physicalName,
	tags: {},
});

const scanner = (
	service: string,
	behaviour: () => Promise<DeployedResource[]>,
): ResourceScanner => ({ service, scan: behaviour });

const awsError = (name: string, statusCode?: number): Error => {
	const error = new Error(`${name} from the fixture`);
	error.name = name;
	Object.assign(error, {
		$metadata: statusCode === undefined ? {} : { httpStatusCode: statusCode },
	});
	return error;
};

describe("runScanners", () => {
	test("collects resources and marks a reader as scanned", async () => {
		const result = await runScanners([
			scanner("lambda", async () => [makeResource("lambda", "fn-a")]),
		]);

		expect(result.resources).toHaveLength(1);
		expect(result.coverage).toEqual([
			{ service: "lambda", status: "scanned", resourceCount: 1 },
		]);
	});

	test("an empty reader is scanned, not unknown", async () => {
		const result = await runScanners([scanner("sqs", async () => [])]);

		// Reading a service and finding nothing is a fact; failing to read it is
		// not, and the two must never collapse into the same result.
		expect(result.coverage[0]).toEqual({
			service: "sqs",
			status: "scanned",
			resourceCount: 0,
		});
	});

	test("a denied reader is recorded and does not fail the scan", async () => {
		const result = await runScanners([
			scanner("lambda", async () => [makeResource("lambda", "fn-a")]),
			scanner("s3", async () => {
				throw awsError("AccessDeniedException", 403);
			}),
		]);

		expect(result.resources).toHaveLength(1);
		const denied = result.coverage.find((c) => c.service === "s3");
		expect(denied?.status).toBe("denied");
		expect(denied?.resourceCount).toBe(0);
		expect(denied?.message).toContain("AccessDeniedException");
	});

	test("recognises denial by name and by status code", async () => {
		for (const error of [
			awsError("UnauthorizedOperation"),
			awsError("AuthorizationError", 403),
			awsError("SomethingOdd", 403),
		]) {
			const result = await runScanners([
				scanner("kms", async () => {
					throw error;
				}),
			]);
			expect(result.coverage[0]?.status).toBe("denied");
		}
	});

	test("a transport failure is an error, not a denial", async () => {
		const result = await runScanners([
			scanner("cloudfront", async () => {
				throw awsError("NetworkingError", 500);
			}),
		]);

		expect(result.coverage[0]?.status).toBe("error");
	});

	test("a service absent in the region reports unsupported", async () => {
		const result = await runScanners([
			scanner("appsync", async () => {
				throw new ScanUnsupportedError("appsync is unavailable in this region");
			}),
		]);

		expect(result.coverage[0]?.status).toBe("unsupported");
		expect(result.coverage[0]?.message).toContain("unavailable");
	});

	test("reads every service even when an earlier one fails", async () => {
		let reached = false;
		await runScanners([
			scanner("lambda", async () => {
				throw awsError("AccessDeniedException", 403);
			}),
			scanner("dynamodb", async () => {
				reached = true;
				return [makeResource("dynamodb", "tbl-a")];
			}),
		]);

		expect(reached).toBe(true);
	});
});

describe("coverageSummary", () => {
	test("reports a complete scan", () => {
		const summary = coverageSummary([
			{ service: "lambda", status: "scanned", resourceCount: 2 },
			{ service: "sqs", status: "scanned", resourceCount: 0 },
		]);

		expect(summary).toMatchObject({
			total: 2,
			scanned: 2,
			denied: 0,
			error: 0,
			unsupported: 0,
			complete: true,
		});
	});

	test("is incomplete and names the gap when a service was not read", () => {
		const summary = coverageSummary([
			{ service: "lambda", status: "scanned", resourceCount: 2 },
			{ service: "s3", status: "denied", resourceCount: 0 },
			{ service: "kms", status: "error", resourceCount: 0 },
			{ service: "appsync", status: "unsupported", resourceCount: 0 },
		]);

		expect(summary.complete).toBe(false);
		expect(summary.gaps.map((gap) => gap.service).sort()).toEqual([
			"appsync",
			"kms",
			"s3",
		]);
	});

	test("an empty scanner set is complete, because nothing was attempted", () => {
		expect(coverageSummary([]).complete).toBe(true);
	});
});
