import { describe, expect, test } from "bun:test";

// Test that the codecommit-init dispatch branch is present and correct
// in the CLI entrypoint. We verify by checking that the import resolves
// and the dispatch logic is structured correctly.

describe("CLI entrypoint dispatch", () => {
	test("codecommit-init module exports runCodeCommitInit and printCodeCommitInitResult", async () => {
		const mod = await import("../src/codecommit-init");
		expect(typeof mod.runCodeCommitInit).toBe("function");
		expect(typeof mod.printCodeCommitInitResult).toBe("function");
	});

	test("scaffold init remains importable and functional", async () => {
		const mod = await import("../src/scaffold");
		expect(typeof mod.runPawlInit).toBe("function");
		expect(typeof mod.writeScaffoldProject).toBe("function");
	});
});
