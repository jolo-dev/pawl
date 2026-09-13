import { expect, test } from "bun:test";
import { createHostExec, createPawlHarness } from "../src/host-exec";

test("host exec returns stdout for a successful command", async () => {
	const exec = createHostExec("/tmp");
	const { stdout } = await exec("echo", ["hello"]);
	expect(stdout.trim()).toBe("hello");
});

test("host exec rejects on a nonzero exit", async () => {
	const exec = createHostExec("/tmp");
	await expect(exec("cat", ["/definitely/missing"])).rejects.toThrow();
});

test("host exec runs in the requested cwd", async () => {
	const exec = createHostExec("/tmp");
	const { stdout } = await exec("pwd", []);
	expect(stdout.trim()).toMatch(/\/tmp$/);
});

test("createPawlHarness scans the host project directory", async () => {
	const harness = createPawlHarness(process.cwd());
	const scan = await harness.scanCodebase();
	expect(scan).toContain("## package.json");
});
