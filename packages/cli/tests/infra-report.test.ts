import { describe, expect, test } from "bun:test";
import type { DeployedResource, DriftEntry } from "../src/infra/drift";
import { buildScanReport } from "../src/infra/report";

const entry = (status: DriftEntry["status"], name: string): DriftEntry => ({
	status,
	...(status === "not-deployed"
		? {
				synthesized: {
					stackName: "PawlStack",
					logicalId: name,
					resourceKind: "AWS::Lambda::Function",
				},
			}
		: {
				deployed: {
					service: "lambda",
					resourceKind: "AWS::Lambda::Function",
					physicalName: name,
					tags: {},
				},
			}),
	basis: status === "matched" ? "physical-name" : "none",
	reason: name,
});

const base = {
	accountId: "123456789012",
	region: "eu-central-1",
	synthesizedCount: 4,
	deployedCount: 4,
	coverage: [
		{ service: "lambda", status: "scanned" as const, resourceCount: 3 },
		{
			service: "s3",
			status: "denied" as const,
			resourceCount: 0,
			message: "AccessDenied",
		},
	],
};

describe("buildScanReport", () => {
	test("counts drift by status and names the coverage gaps", () => {
		const report = buildScanReport({
			...base,
			entries: [
				entry("matched", "a"),
				entry("not-deployed", "b"),
				entry("unmanaged", "c"),
				entry("foreign", "d"),
			],
		});

		expect(report.drift).toEqual({
			matched: 1,
			notDeployed: 1,
			unmanaged: 1,
			foreign: 1,
		});
		expect(report.coverage.complete).toBe(false);
		expect(report.coverage.gaps).toEqual([
			{ service: "s3", status: "denied", message: "AccessDenied" },
		]);
		expect(report.coverage.scanned).toBe(1);
		expect(report.coverage.total).toBe(2);
	});

	test("keeps drift ahead of matches when truncating", () => {
		const report = buildScanReport({
			...base,
			entries: [
				entry("matched", "m1"),
				entry("matched", "m2"),
				entry("matched", "m3"),
				entry("unmanaged", "u1"),
				entry("foreign", "f1"),
			],
			maxEntries: 2,
		});

		// The interesting entries must survive the cap, not the boring ones.
		expect(report.entries.map((e) => e.status)).toEqual([
			"unmanaged",
			"foreign",
		]);
		expect(report.truncated).toBe(3);
	});

	test("reports nothing truncated when everything fits", () => {
		const report = buildScanReport({
			...base,
			entries: [entry("matched", "a")],
		});

		expect(report.truncated).toBe(0);
		expect(report.entries).toHaveLength(1);
	});

	test("carries an empty scan without inventing a result", () => {
		const report = buildScanReport({
			accountId: "1",
			region: "eu-west-1",
			synthesizedCount: 0,
			deployedCount: 0,
			coverage: [],
			entries: [],
		});

		expect(report.drift.matched).toBe(0);
		expect(report.coverage.complete).toBe(true);
		expect(report.entries).toEqual([]);
	});

	test("keeps the deployed resource kind on a drift entry for suggestions", () => {
		const deployed: DeployedResource = {
			service: "s3",
			resourceKind: "AWS::S3::Bucket",
			physicalName: "pawlstack-sitebucket-abc",
			tags: { team: "platform", stage: "dev" },
		};
		const report = buildScanReport({
			...base,
			entries: [
				{
					status: "foreign",
					deployed,
					basis: "provenance",
					reason: "tagged by pawl",
				},
			],
		});

		expect(report.entries[0]?.resourceKind).toBe("AWS::S3::Bucket");
		expect(report.entries[0]?.name).toBe("pawlstack-sitebucket-abc");
	});
});
