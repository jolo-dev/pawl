import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecFn } from "../src/harness";
import { runProjectScan } from "../src/infra/project-scan";
import type { ResourceScanner, ScannerFactory } from "../src/infra/scan";
import { SynthError } from "../src/infra/synth";

/**
 * A real directory with a real cdk.json, because `hasCdkProject` checks the
 * filesystem rather than trusting the caller.
 */
function makeProjectDir(): string {
	const cwd = mkdtempSync(join(tmpdir(), "pawl-scan-"));
	writeFileSync(
		join(cwd, "cdk.json"),
		JSON.stringify({ app: "npx tsx app.ts" }),
	);
	return cwd;
}

const cdkOut = (cwd: string): Record<string, string> => ({
	[`${cwd}/cdk.out/manifest.json`]: JSON.stringify({
		artifacts: {
			PawlStack: {
				type: "aws:cloudformation:stack",
				properties: {
					stackName: "PawlStack",
					templateFile: "PawlStack.template.json",
				},
			},
			someAsset: { type: "cdk:asset-manifest" },
		},
	}),
	[`${cwd}/cdk.out/PawlStack.template.json`]: JSON.stringify({
		Resources: {
			MyFunction1A2B: {
				Type: "AWS::Lambda::Function",
				Properties: { FunctionName: "platform-dev-myapi-lambda" },
			},
		},
	}),
});

const fakeExec =
	(files: Record<string, string>): ExecFn =>
	async (cmd, args) => {
		if (cmd === "npx") return { stdout: "" };
		const path = args[0] ?? "";
		const content = files[path];
		if (content === undefined) throw new Error(`no such file: ${path}`);
		return { stdout: content };
	};

const lambdaScanner: ScannerFactory = (): ResourceScanner => ({
	service: "lambda",
	async scan() {
		return [
			{
				service: "lambda",
				resourceKind: "AWS::Lambda::Function",
				physicalName: "platform-dev-myapi-lambda",
				tags: {},
			},
			{
				service: "lambda",
				resourceKind: "AWS::Lambda::Function",
				physicalName: "hand-made-function",
				tags: {},
			},
		];
	},
});

const denier: ScannerFactory = (): ResourceScanner => ({
	service: "s3",
	async scan() {
		const error = new Error("nope");
		error.name = "AccessDeniedException";
		throw error;
	},
});

const CWD = makeProjectDir();
const files = cdkOut(CWD);

const base = {
	cwd: CWD,
	region: "eu-central-1",
	exec: fakeExec(files),
	scannerFactories: [lambdaScanner, denier],
	resolveAccountId: async () => "123456789012",
} as const;

describe("runProjectScan", () => {
	test("synthesizes, scans and classifies in one pass", async () => {
		const outcome = await runProjectScan({ ...base });

		expect(outcome.report.accountId).toBe("123456789012");
		expect(outcome.report.region).toBe("eu-central-1");
		expect(outcome.report.synthesizedCount).toBe(1);
		expect(outcome.report.deployedCount).toBe(2);
		expect(outcome.stacks).toEqual(["PawlStack"]);
	});

	test("pairs the declared function and leaves the hand-made one unmanaged", async () => {
		const outcome = await runProjectScan({ ...base });

		expect(outcome.report.drift.matched).toBe(1);
		expect(outcome.report.drift.unmanaged).toBe(1);
	});

	test("suggests a construct only for the resource pawl does not manage", async () => {
		const outcome = await runProjectScan({ ...base });

		expect(outcome.suggestions).toHaveLength(1);
		expect(outcome.suggestions[0]?.resourceName).toBe("hand-made-function");
		expect(outcome.suggestionSummary).toEqual([
			{ construct: "LambdaFunction", count: 1 },
		]);
	});

	test("records a denied service as a coverage gap", async () => {
		const outcome = await runProjectScan({ ...base });

		expect(outcome.report.coverage.complete).toBe(false);
		expect(outcome.report.coverage.denied).toBe(1);
		expect(outcome.report.coverage.gaps[0]?.service).toBe("s3");
	});

	test("names the services pawl cannot read at all", async () => {
		const outcome = await runProjectScan({ ...base });

		expect(outcome.notScanned).toContain("sns");
		expect(outcome.notScanned).toContain("iam");
	});

	test("filters to the requested services", async () => {
		const outcome = await runProjectScan({ ...base, services: ["lambda"] });

		expect(outcome.report.coverage.total).toBe(1);
		expect(outcome.report.coverage.denied).toBe(0);
	});

	test("throws rather than reporting an empty project when synthesis fails", async () => {
		const failing: ExecFn = async (cmd) => {
			if (cmd === "npx") throw new Error("cdk exploded");
			throw new Error("unreachable");
		};

		await expect(
			runProjectScan({ ...base, exec: failing }),
		).rejects.toBeInstanceOf(SynthError);
	});

	test("caps suggestions and reports how many were dropped", async () => {
		const outcome = await runProjectScan({ ...base, maxEntries: 1 });
		expect(outcome.suggestionsTruncated).toBe(0);
	});
});
