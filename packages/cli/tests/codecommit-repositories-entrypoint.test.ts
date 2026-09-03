import { describe, expect, test } from "bun:test";
import type { CodeCommitService } from "@pawl/codecommit";
import { runCodeCommitRepositoriesCommand } from "../src/codecommit-repositories/entrypoint";

describe("codecommit repositories dispatch", () => {
	test("writes shared-service output to stdout and safe failures to stderr", async () => {
		const output: string[] = [];
		const errors: string[] = [];
		const service: Pick<CodeCommitService, "listRepositories"> = {
			listRepositories: async () => ({ items: [{ name: "portal" }] }),
		};

		expect(
			await runCodeCommitRepositoriesCommand({
				argv: [],
				service,
				stderr: (message) => errors.push(message),
				stdout: (message) => output.push(message),
			}),
		).toBe(0);
		expect(output).toEqual([
			'{\n  "items": [\n    {\n      "name": "portal"\n    }\n  ]\n}',
		]);
		expect(errors).toEqual([]);

		expect(
			await runCodeCommitRepositoriesCommand({
				argv: ["--max-results", "0"],
				service,
				stderr: (message) => errors.push(message),
				stdout: (message) => output.push(message),
			}),
		).toBe(1);
		expect(errors).toEqual([
			"--max-results must be an integer between 1 and 1000.",
		]);
	});
});
