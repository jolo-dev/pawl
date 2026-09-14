import { describe, expect, test } from "bun:test";
import architectureTool from "../agent/tools/architecture";
import costTool, { costInputSchema } from "../agent/tools/cost";
import generateTool from "../agent/tools/generate";
import initProjectTool, {
	initProjectInputSchema,
} from "../agent/tools/init_project";
import planTool from "../agent/tools/plan";
import scanResourcesTool, {
	scanResourcesInputSchema,
} from "../agent/tools/scan_resources";
import wellArchitectedTool, {
	wellArchitectedInputSchema,
} from "../agent/tools/well_architected";

/** Tools never touch their context in these tests; the binding is a stub. */
const ctx = {} as never;

describe("pawl workflow tools", () => {
	test("every migrated tool exposes a description and an input schema", () => {
		for (const tool of [
			planTool,
			generateTool,
			wellArchitectedTool,
			costTool,
			architectureTool,
			initProjectTool,
			scanResourcesTool,
		]) {
			expect(tool.description.length).toBeGreaterThan(0);
			expect(tool.inputSchema).toBeDefined();
		}
	});

	test("plan returns the harness planning prompt for this project", async () => {
		const result = await planTool.execute({}, ctx);
		expect(String(result)).toContain("Generate an AWS infrastructure plan");
		expect(String(result)).toContain("## package.json");
		expect(String(result)).toContain(".pawl/plan.md");
	});

	test("plan folds in user notes", async () => {
		const result = await planTool.execute({ notes: "use RDS" }, ctx);
		expect(String(result)).toContain("User notes: use RDS");
	});

	test("generate reads the approved plan", async () => {
		const result = await generateTool.execute({}, ctx);
		expect(String(result)).toContain("Read the approved infrastructure plan");
	});

	test("generate is gated on human approval", () => {
		expect(generateTool.approval).toBeDefined();
		expect(generateTool.approval).not.toBe("not-applicable");
	});

	test("well_architected returns the Well-Architected review prompt", async () => {
		// scanAccount: false keeps a unit test off the network; the account path
		// is covered through `collectReviewScanContext` instead.
		const result = await wellArchitectedTool.execute(
			{ scanAccount: false },
			ctx,
		);
		expect(String(result)).toContain("Well-Architected");
	});

	test("cost returns the cost-optimization prompt", async () => {
		const result = await costTool.execute({ scanAccount: false }, ctx);
		expect(String(result)).toContain("cost optimization");
	});

	test("architecture explains when there is no plan to render", async () => {
		const result = await architectureTool.execute({}, ctx);
		expect(String(result)).toMatch(/plan\.md|No Mermaid diagram/);
	});
});

test("both reviews can consult the account, and both default to doing so", () => {
	for (const schema of [wellArchitectedInputSchema, costInputSchema]) {
		expect(schema.safeParse({}).success).toBe(true);
		expect(schema.safeParse({ scanAccount: false }).success).toBe(true);
		expect(schema.safeParse({ scanAccount: "yes" }).success).toBe(false);
	}
});

test("cost states that it has no billing data", async () => {
	const result = await costTool.execute({ scanAccount: false }, ctx);
	const text = String(result);

	expect(text).toContain("No billing data was retrieved");
	expect(text).toContain("never measured spend");
});

test("a review that skipped the account says so instead of omitting it", async () => {
	const result = await wellArchitectedTool.execute({ scanAccount: false }, ctx);

	expect(String(result)).toContain("No account scan was requested");
});

test("cost describes itself as configuration-derived, not measured", () => {
	expect(costTool.description).toContain("not measured spend");
});

describe("scan_resources", () => {
	test("scans everything when no service filter is given", () => {
		expect(scanResourcesInputSchema.safeParse({}).success).toBe(true);
	});

	test("accepts a service filter and a skipSynth flag", () => {
		const result = scanResourcesInputSchema.safeParse({
			services: ["lambda", "s3"],
			skipSynth: true,
			maxEntries: 50,
		});
		expect(result.success).toBe(true);
	});

	test("rejects a non-positive entry cap", () => {
		expect(scanResourcesInputSchema.safeParse({ maxEntries: 0 }).success).toBe(
			false,
		);
	});

	test("states that it is read-only, so the model cannot mistake it for a mutation", () => {
		expect(scanResourcesTool.description).toContain("changes nothing");
	});
});

describe("init_project", () => {
	test("requires the values a prompt could otherwise collect", () => {
		const result = initProjectInputSchema.safeParse({});
		expect(result.success).toBe(false);
	});

	test("rejects an unknown stage", () => {
		const result = initProjectInputSchema.safeParse({
			projectName: "demo",
			packageManager: "bun",
			awsProfile: "dev",
			testMode: "none",
			team: "platform",
			stage: "staging",
		});
		expect(result.success).toBe(false);
	});

	test("accepts a complete non-interactive request", () => {
		const result = initProjectInputSchema.safeParse({
			projectName: "demo",
			packageManager: "bun",
			awsProfile: "dev",
			testMode: "localstack",
			team: "platform",
			stage: "dev",
			localstackSecretPath: "/pawl/localstack",
		});
		expect(result.success).toBe(true);
	});
});
