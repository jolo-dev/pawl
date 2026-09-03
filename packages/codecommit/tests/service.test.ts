import { describe, expect, test } from "bun:test";
import {
	type CodeCommitClientPort,
	CodeCommitService,
	CodeCommitServiceError,
} from "../src/service";

const createClient = (
	overrides: Partial<CodeCommitClientPort> = {},
): CodeCommitClientPort => ({
	getRepository: async (input) => ({
		repositoryMetadata: {
			repositoryName: input.repositoryName,
		},
	}),
	listBranches: async () => ({}),
	listPullRequests: async () => ({}),
	listRepositories: async () => ({}),
	...overrides,
});

describe("CodeCommitService", () => {
	test("returns normalized repository summaries and forwards pagination", async () => {
		const calls: unknown[] = [];
		const service = new CodeCommitService(
			createClient({
				listRepositories: async (input) => {
					calls.push(input);
					return {
						repositories: [
							{
								repositoryId: "repository-id",
								repositoryName: "portal",
							},
						],
						nextToken: "next-page",
					};
				},
			}),
		);

		const page = await service.listRepositories({
			maxResults: 25,
			nextToken: "previous-page",
		});

		expect(calls).toEqual([{ maxResults: 25, nextToken: "previous-page" }]);
		expect(page).toEqual({
			items: [{ id: "repository-id", name: "portal" }],
			nextToken: "next-page",
		});
	});

	test("returns repository metadata and a page of branch names", async () => {
		const service = new CodeCommitService(
			createClient({
				getRepository: async (input) => ({
					repositoryMetadata: {
						accountId: "123456789012",
						creationDate: new Date("2026-01-02T03:04:05.000Z"),
						defaultBranch: "main",
						description: "Portal source",
						lastModifiedDate: new Date("2026-01-03T03:04:05.000Z"),
						repositoryArn:
							"arn:aws:codecommit:eu-central-1:123456789012:portal",
						repositoryId: "repository-id",
						repositoryName: input.repositoryName,
					},
				}),
				listBranches: async (input) => {
					expect(input).toEqual({
						maxResults: 20,
						nextToken: "previous-page",
						repositoryName: "portal",
					});
					return { branches: ["main", "feature/api"], nextToken: "next-page" };
				},
			}),
		);

		expect(await service.getRepository({ repositoryName: "portal" })).toEqual({
			accountId: "123456789012",
			arn: "arn:aws:codecommit:eu-central-1:123456789012:portal",
			createdAt: "2026-01-02T03:04:05.000Z",
			defaultBranch: "main",
			description: "Portal source",
			id: "repository-id",
			name: "portal",
			updatedAt: "2026-01-03T03:04:05.000Z",
		});
		expect(
			await service.listBranches({
				maxResults: 20,
				nextToken: "previous-page",
				repositoryName: "portal",
			}),
		).toEqual({ items: ["main", "feature/api"], nextToken: "next-page" });
	});

	test("returns repository-scoped pull request identifiers with state and pagination", async () => {
		const calls: unknown[] = [];
		const service = new CodeCommitService(
			createClient({
				listPullRequests: async (input) => {
					calls.push(input);
					return { pullRequestIds: ["42", "43"], nextToken: "next-page" };
				},
			}),
		);

		expect(
			await service.listPullRequests({
				maxResults: 10,
				nextToken: "previous-page",
				pullRequestStatus: "OPEN",
				repositoryName: "portal",
			}),
		).toEqual({
			items: [{ id: "42" }, { id: "43" }],
			nextToken: "next-page",
		});
		expect(calls).toEqual([
			{
				maxResults: 10,
				nextToken: "previous-page",
				pullRequestStatus: "OPEN",
				repositoryName: "portal",
			},
		]);
	});

	test("rejects invalid input before calling the client", async () => {
		let calls = 0;
		const service = new CodeCommitService(
			createClient({
				listBranches: async () => {
					calls += 1;
					return {};
				},
			}),
		);

		await expect(
			service.listBranches({ repositoryName: "", nextToken: "" }),
		).rejects.toMatchObject({
			category: "validation",
			operation: "listBranches",
		});
		await expect(
			service.listPullRequests({
				pullRequestStatus: "MERGED" as unknown as "OPEN" | "CLOSED",
				repositoryName: "portal",
			}),
		).rejects.toMatchObject({
			category: "validation",
			operation: "listPullRequests",
		});
		await expect(
			service.listRepositories({ maxResults: 1.5 }),
		).rejects.toMatchObject({
			category: "validation",
			operation: "listRepositories",
		});
		expect(calls).toBe(0);
	});

	test("maps access denial to a safe authorization error", async () => {
		const service = new CodeCommitService(
			createClient({
				listRepositories: async () => {
					throw Object.assign(new Error("request-id=secret"), {
						name: "AccessDeniedException",
					});
				},
			}),
		);

		await expect(service.listRepositories()).rejects.toBeInstanceOf(
			CodeCommitServiceError,
		);
		await expect(service.listRepositories()).rejects.toMatchObject({
			category: "authorization",
			message: "CodeCommit authorization failed while listing repositories.",
			operation: "listRepositories",
		});
	});
});
