import { describe, expect, test } from "bun:test";
import {
	formatCodeCommitRepositoriesResult,
	runCodeCommitRepositories,
} from "../src/codecommit-repositories";

describe("codecommit repositories CLI command", () => {
	test("returns normalized JSON for the default repository page using the shared service", async () => {
		const calls: unknown[] = [];
		const result = await runCodeCommitRepositories({
			argv: [],
			service: {
				listRepositories: async (request) => {
					calls.push(request);
					return { items: [{ id: "repository-id", name: "portal" }] };
				},
			},
		});

		expect(calls).toEqual([{}]);
		expect(formatCodeCommitRepositoriesResult(result)).toBe(
			'{\n  "items": [\n    {\n      "id": "repository-id",\n      "name": "portal"\n    }\n  ]\n}',
		);
	});

	test("forwards pagination options and rejects an invalid page size without calling the service", async () => {
		const calls: unknown[] = [];
		const service = {
			listRepositories: async (request: unknown) => {
				calls.push(request);
				return { items: [] };
			},
		};

		await runCodeCommitRepositories({
			argv: ["--max-results", "20", "--next-token", "next-page"],
			service,
		});
		expect(calls).toEqual([{ maxResults: 20, nextToken: "next-page" }]);

		await expect(
			runCodeCommitRepositories({
				argv: ["--max-results", "invalid"],
				service,
			}),
		).rejects.toThrow("--max-results must be an integer between 1 and 1000.");
		expect(calls).toHaveLength(1);
	});
});
