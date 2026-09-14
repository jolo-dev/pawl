import { describe, expect, test } from "bun:test";
import type { ProjectScanOutcome } from "../src/infra/project-scan";
import type { ScanReport } from "../src/infra/report";
import {
	COST_DATA_LIMITATION,
	composeAccountSection,
} from "../src/infra/review-context";

const report = (over: Partial<ScanReport> = {}): ScanReport => ({
	accountId: "123456789012",
	region: "eu-central-1",
	synthesizedCount: 4,
	deployedCount: 6,
	drift: { matched: 2, notDeployed: 2, unmanaged: 3, foreign: 1 },
	coverage: {
		total: 3,
		scanned: 3,
		denied: 0,
		error: 0,
		unsupported: 0,
		complete: true,
		gaps: [],
	},
	entries: [],
	truncated: 0,
	...over,
});

const outcome = (
	over: Partial<ProjectScanOutcome> = {},
): ProjectScanOutcome => ({
	report: report(),
	suggestions: [],
	suggestionSummary: [{ construct: "LambdaFunction", count: 3 }],
	suggestionsTruncated: 0,
	stacks: ["PawlStack"],
	notScanned: ["sns", "iam"],
	...over,
});

describe("composeAccountSection", () => {
	test("states that nothing was consulted rather than omitting the section", () => {
		const section = composeAccountSection({ status: "skipped" });

		expect(section).toContain("No account scan was requested");
		expect(section).toContain("unknown");
	});

	test("says which failure stopped the scan", () => {
		const section = composeAccountSection({
			status: "failed",
			error: "cdk synth failed: exit 1",
		});

		expect(section).toContain("cdk synth failed: exit 1");
		expect(section).toContain(
			"do not present any conclusion about deployed resources",
		);
	});

	test("reports counts and candidates when coverage is complete", () => {
		const section = composeAccountSection({
			status: "included",
			outcome: outcome(),
		});

		expect(section).toContain("Account 123456789012, region eu-central-1");
		expect(section).toContain("2 declared but not deployed");
		expect(section).toContain("3 deployed and created outside");
		expect(section).toContain("LambdaFunction × 3");
		expect(section).toContain("an absence of drift here is meaningful");
	});

	test("names the gaps and forbids a clean-account claim when coverage is partial", () => {
		const section = composeAccountSection({
			status: "included",
			outcome: outcome({
				report: report({
					coverage: {
						total: 7,
						scanned: 6,
						denied: 1,
						error: 0,
						unsupported: 0,
						complete: false,
						gaps: [
							{
								service: "s3",
								status: "denied",
								message: "AccessDeniedException",
							},
						],
					},
				}),
			}),
		});

		expect(section).toContain("6 of 7 services were read");
		expect(section).toContain("s3 (denied: AccessDeniedException)");
		expect(section).toContain(
			"pawl cannot read these services at all: sns, iam",
		);
		expect(section).toContain("do not describe the account as clean");
	});

	test("says so explicitly when pawl already manages everything it can see", () => {
		const section = composeAccountSection({
			status: "included",
			outcome: outcome({ suggestionSummary: [] }),
		});

		expect(section).toContain("already managed by pawl");
	});
});

describe("COST_DATA_LIMITATION", () => {
	test("denies having billing data", () => {
		expect(COST_DATA_LIMITATION).toContain("No billing data was retrieved");
		expect(COST_DATA_LIMITATION).toContain("Cost Explorer");
		expect(COST_DATA_LIMITATION).toContain("never measured spend");
	});
});
