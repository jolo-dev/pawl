import { describe, expect, test } from "bun:test";
import {
	buildDeployDecision,
	describeDeployDecision,
	runCdkDeploy,
	runCdkDiff,
} from "../src/deploy/diff";
import type { ExecFn } from "../src/harness";

const SAMPLE_DIFF = [
	"Stack PawlStack",
	"Resources",
	"[+] AWS::Lambda::Function MyApiLambda MyApiLambda1234",
	"[+] AWS::SQS::Queue Orders OrdersABC",
	"[~] AWS::IAM::Role ApiRole ApiRoleXYZ",
	"[~] AWS::IAM::Policy ApiPolicy ApiPolicyABC ",
	"[~] AWS::IAM::Policy ApiPolicy2 ApiPolicyDEF ",
	"[-] AWS::Logs::LogGroup Legacy Legacy123",
	"",
	"✨  Number of stacks with differences: 1",
].join("\n");

describe("buildDeployDecision", () => {
	test("counts added, changed and removed resources", () => {
		const decision = buildDeployDecision({
			stack: "PawlStack",
			diff: SAMPLE_DIFF,
		});

		expect(decision.changed).toBe(true);
		expect(decision.counts).toEqual({ toAdd: 2, toChange: 3, toRemove: 1 });
		expect(decision.summary).toContain("2 to add");
		expect(decision.summary).toContain("3 to change");
		expect(decision.summary).toContain("1 to remove");
	});

	test("recognises cdk's explicit no-differences output", () => {
		const decision = buildDeployDecision({
			stack: "PawlStack",
			diff: "Stack PawlStack\nThere were no differences\n",
		});

		expect(decision.changed).toBe(false);
		expect(decision.summary).toBe("no differences");
		expect(decision.counts).toBeNull();
	});

	test("treats a whitespace-only diff as no change", () => {
		expect(buildDeployDecision({ diff: "   \n\n" }).changed).toBe(false);
	});

	test("reports counts as unknown rather than zero when output has no markers", () => {
		const decision = buildDeployDecision({
			stack: "PawlStack",
			diff: "some unexpected output shape\n",
		});

		// Claiming "0 to add" from output we do not understand would be a
		// fabricated fact about what is about to be deployed.
		expect(decision.changed).toBe(true);
		expect(decision.counts).toBeNull();
	});

	test("carries the stack when there is one and null when there is not", () => {
		expect(buildDeployDecision({ stack: "A", diff: SAMPLE_DIFF }).stack).toBe(
			"A",
		);
		expect(buildDeployDecision({ diff: SAMPLE_DIFF }).stack).toBeNull();
	});
});

describe("describeDeployDecision", () => {
	test("includes the diff text so it can be shown before approving", () => {
		const text = describeDeployDecision(
			buildDeployDecision({ stack: "PawlStack", diff: SAMPLE_DIFF }),
		);

		expect(text).toContain("PawlStack");
		expect(text).toContain(
			"[+] AWS::Lambda::Function MyApiLambda MyApiLambda1234",
		);
		expect(text).toContain("2 to add");
	});

	test("says nothing is pending when there is no difference", () => {
		const text = describeDeployDecision(
			buildDeployDecision({
				stack: "PawlStack",
				diff: "There were no differences",
			}),
		);

		expect(text).toContain("nothing to deploy");
	});
});

describe("cdk runners", () => {
	test("diff targets the named stack", async () => {
		const calls: { cmd: string; args: string[] }[] = [];
		const exec: ExecFn = async (cmd, args) => {
			calls.push({ cmd, args });
			return { stdout: SAMPLE_DIFF };
		};

		await runCdkDiff({ cwd: "/app", exec, stack: "PawlStack" });

		expect(calls[0]?.cmd).toBe("npx");
		expect(calls[0]?.args).toEqual(["cdk", "diff", "PawlStack"]);
	});

	test("diff covers every stack when none is named", async () => {
		const calls: { cmd: string; args: string[] }[] = [];
		const exec: ExecFn = async (cmd, args) => {
			calls.push({ cmd, args });
			return { stdout: "" };
		};

		await runCdkDiff({ cwd: "/app", exec });

		expect(calls[0]?.args).toEqual(["cdk", "diff"]);
	});

	test("deploy never lets cdk prompt, because it has no terminal", async () => {
		const calls: { cmd: string; args: string[] }[] = [];
		const exec: ExecFn = async (cmd, args) => {
			calls.push({ cmd, args });
			return { stdout: "" };
		};

		await runCdkDeploy({ cwd: "/app", exec, stack: "PawlStack" });

		// The exec has no TTY, so cdk's own approval prompt would hang forever.
		// Approval is eve's job; this is asserted so nobody removes the flag.
		expect(calls[0]?.args).toContain("--require-approval");
		expect(calls[0]?.args).toContain("never");
		expect(calls[0]?.args).toContain("PawlStack");
	});
});
