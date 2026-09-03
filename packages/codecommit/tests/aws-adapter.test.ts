import { describe, expect, test } from "bun:test";
import {
	GetRepositoryCommand,
	ListBranchesCommand,
	ListPullRequestsCommand,
	ListRepositoriesCommand,
} from "@aws-sdk/client-codecommit";
import { AwsCodeCommitClientAdapter } from "../src/aws-adapter";

describe("AwsCodeCommitClientAdapter", () => {
	test("constructs CodeCommit commands and maps their outputs to Pawl port DTOs", async () => {
		const commands: unknown[] = [];
		const adapter = new AwsCodeCommitClientAdapter({
			send: async (command) => {
				commands.push(command);
				if (command instanceof ListRepositoriesCommand) {
					return {
						repositories: [{ repositoryId: "id", repositoryName: "portal" }],
						nextToken: "repositories-next",
					};
				}
				if (command instanceof GetRepositoryCommand) {
					return { repositoryMetadata: { repositoryName: "portal" } };
				}
				if (command instanceof ListBranchesCommand) {
					return { branches: ["main"], nextToken: "branches-next" };
				}
				return { pullRequestIds: ["42"], nextToken: "pull-requests-next" };
			},
		});

		expect(
			await adapter.listRepositories({
				maxResults: 20,
				nextToken: "repositories-previous",
			}),
		).toEqual({
			repositories: [{ repositoryId: "id", repositoryName: "portal" }],
			nextToken: "repositories-next",
		});
		expect(await adapter.getRepository({ repositoryName: "portal" })).toEqual({
			repositoryMetadata: { repositoryName: "portal" },
		});
		expect(
			await adapter.listBranches({
				maxResults: 20,
				nextToken: "branches-previous",
				repositoryName: "portal",
			}),
		).toEqual({
			branches: ["main"],
			nextToken: "branches-next",
		});
		expect(
			await adapter.listPullRequests({
				maxResults: 20,
				nextToken: "pull-requests-previous",
				pullRequestStatus: "OPEN",
				repositoryName: "portal",
			}),
		).toEqual({
			pullRequestIds: ["42"],
			nextToken: "pull-requests-next",
		});

		expect(commands).toHaveLength(4);
		expect(commands[0]).toBeInstanceOf(ListRepositoriesCommand);
		expect(commands[0]).toMatchObject({
			input: { nextToken: "repositories-previous" },
		});
		expect(commands[1]).toBeInstanceOf(GetRepositoryCommand);
		expect(commands[1]).toMatchObject({ input: { repositoryName: "portal" } });
		expect(commands[2]).toBeInstanceOf(ListBranchesCommand);
		expect(commands[2]).toMatchObject({
			input: { nextToken: "branches-previous", repositoryName: "portal" },
		});
		expect(commands[3]).toBeInstanceOf(ListPullRequestsCommand);
		expect(commands[3]).toMatchObject({
			input: {
				maxResults: 20,
				nextToken: "pull-requests-previous",
				pullRequestStatus: "OPEN",
				repositoryName: "portal",
			},
		});
	});
});
