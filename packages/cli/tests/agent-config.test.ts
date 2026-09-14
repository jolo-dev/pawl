import { expect, test } from "bun:test";
import path from "node:path";

const agentDir = path.join(import.meta.dir, "../agent");

test("agent.ts takes its model config from the shared helper", async () => {
	const source = await Bun.file(path.join(agentDir, "agent.ts")).text();
	// The helper returns model and context window together, so they cannot
	// disagree about which model is configured.
	expect(source).toContain("pawlModelConfig()");
});

test("every subagent shares the same model config helper", async () => {
	for (const id of ["planner", "generator", "well-architected"]) {
		const source = await Bun.file(
			path.join(agentDir, "subagents", id, "agent.ts"),
		).text();
		expect(source).toContain("pawlModelConfig()");
	}
});

test("the Bedrock provider is given a credential provider, not just env keys", async () => {
	const source = await Bun.file(
		path.join(agentDir, "lib", "bedrock.ts"),
	).text();
	// @ai-sdk/amazon-bedrock ignores ~/.aws/config and the SSO cache unless a
	// credential provider is supplied, which is pawl's entire auth model.
	expect(source).toContain("@aws-sdk/credential-providers");
	expect(source).toContain("credentialProvider");
	expect(source).toContain("fromNodeProviderChain");
});

test("instructions carry the AWS scope guard and the two-phase workflow", async () => {
	const instructions = await Bun.file(
		path.join(agentDir, "instructions.md"),
	).text();
	expect(instructions).toContain("Sorry, I cannot help you here");
	expect(instructions).toContain(".pawl/plan.md");
});

test("each declared subagent has a description and an agent config", async () => {
	for (const id of [
		"planner",
		"generator",
		"well-architected",
		"infra-auditor",
	]) {
		const source = await Bun.file(
			path.join(agentDir, "subagents", id, "agent.ts"),
		).text();
		expect(source).toContain("description:");
		expect(source).toContain("defineAgent");
	}
});

test("the infra auditor is told never to imply completeness", async () => {
	const instructions = await Bun.file(
		path.join(agentDir, "subagents", "infra-auditor", "instructions.md"),
	).text();

	// The scan's whole safety story rests on a partial read never being
	// summarised as a clean account, so the instruction is asserted, not assumed.
	expect(instructions).toContain("coverageWarning");
	expect(instructions).toContain("incomplete");
	expect(instructions).toContain("Never describe the account as clean");
});

test("the infra auditor does not depend on a skill it cannot see", async () => {
	const instructions = await Bun.file(
		path.join(agentDir, "subagents", "infra-auditor", "instructions.md"),
	).text();

	// eve scopes skills per agent and subagents get none, so referencing one
	// here would silently do nothing. It must be self-contained.
	expect(instructions).not.toContain("load_skill");
	expect(instructions).not.toContain("pawl-constructs");
});

test("the infra auditor is barred from claims the scan cannot support", async () => {
	const instructions = await Bun.file(
		path.join(agentDir, "subagents", "infra-auditor", "instructions.md"),
	).text();

	expect(instructions).toContain("Do not estimate cost");
	expect(instructions).toContain("Do not recommend deleting");
});

test("the authored surface imports no removed dependency", async () => {
	const proc = Bun.spawnSync([
		"grep",
		"-rIl",
		"-e",
		"pi-coding-agent",
		"-e",
		"@flue/runtime",
		"agent",
	]);
	expect(proc.exitCode).not.toBe(0);
});

test("every authored tool imports the host harness, never a sandbox handle", async () => {
	const toolsDir = path.join(agentDir, "tools");
	const glob = new Bun.Glob("*.ts");
	for await (const file of glob.scan(toolsDir)) {
		const source = await Bun.file(path.join(toolsDir, file)).text();
		expect(source).not.toContain("ctx.getSandbox");
	}
});
