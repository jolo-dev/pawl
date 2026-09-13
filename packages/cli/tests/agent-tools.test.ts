import { describe, expect, test } from "bun:test";
import architectureTool from "../agent/tools/architecture";
import costTool from "../agent/tools/cost";
import generateTool from "../agent/tools/generate";
import initProjectTool from "../agent/tools/init_project";
import planTool from "../agent/tools/plan";
import wellArchitectedTool from "../agent/tools/well_architected";

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
		const result = await wellArchitectedTool.execute({}, ctx);
		expect(String(result)).toContain("Well-Architected");
	});

	test("cost returns the cost-optimization prompt", async () => {
		const result = await costTool.execute({}, ctx);
		expect(String(result)).toContain("cost optimization");
	});

	test("architecture explains when there is no plan to render", async () => {
		const result = await architectureTool.execute({}, ctx);
		expect(String(result)).toMatch(/plan\.md|No Mermaid diagram/);
	});
});

describe("init_project", () => {
	test("requires the values a prompt could otherwise collect", () => {
		const result = initProjectTool.inputSchema.safeParse({});
		expect(result.success).toBe(false);
	});

	test("rejects an unknown stage", () => {
		const result = initProjectTool.inputSchema.safeParse({
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
		const result = initProjectTool.inputSchema.safeParse({
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
