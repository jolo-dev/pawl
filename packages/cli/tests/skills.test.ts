import { expect, test } from "bun:test";
import path from "node:path";

test("the planning skill recommends Node.js 24 for Node.js applications", async () => {
	const skill = await Bun.file(
		path.join(import.meta.dir, "../skills/pawl-plan/SKILL.md"),
	).text();
	expect(skill).toContain("**Runtime**: Node.js 24");
});
