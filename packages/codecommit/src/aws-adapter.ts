import {
	CodeCommitClient,
	GetRepositoryCommand,
	type GetRepositoryCommandOutput,
	ListBranchesCommand,
	type ListBranchesCommandOutput,
	ListPullRequestsCommand,
	type ListPullRequestsCommandOutput,
	ListRepositoriesCommand,
	type ListRepositoriesCommandOutput,
} from "@aws-sdk/client-codecommit";
import {
	type CodeCommitClientPort,
	CodeCommitService,
	type ListBranchesResponse,
	type ListPullRequestsResponse,
	type ListRepositoriesResponse,
	type RepositoryMetadataResponse,
} from "./service";

export interface AwsCodeCommitCommandClient {
	send(command: unknown): Promise<unknown>;
}

export class AwsCodeCommitClientAdapter implements CodeCommitClientPort {
	constructor(private readonly client: AwsCodeCommitCommandClient) {}

	async listRepositories(input: {
		readonly maxResults?: number;
		readonly nextToken?: string;
	}): Promise<ListRepositoriesResponse> {
		const output = (await this.client.send(
			new ListRepositoriesCommand({ nextToken: input.nextToken }),
		)) as ListRepositoriesCommandOutput;
		return { repositories: output.repositories, nextToken: output.nextToken };
	}

	async getRepository(input: {
		readonly repositoryName: string;
	}): Promise<RepositoryMetadataResponse> {
		const output = (await this.client.send(
			new GetRepositoryCommand(input),
		)) as GetRepositoryCommandOutput;
		return { repositoryMetadata: output.repositoryMetadata };
	}

	async listBranches(input: {
		readonly maxResults?: number;
		readonly nextToken?: string;
		readonly repositoryName: string;
	}): Promise<ListBranchesResponse> {
		const output = (await this.client.send(
			new ListBranchesCommand({
				nextToken: input.nextToken,
				repositoryName: input.repositoryName,
			}),
		)) as ListBranchesCommandOutput;
		return { branches: output.branches, nextToken: output.nextToken };
	}

	async listPullRequests(input: {
		readonly maxResults?: number;
		readonly nextToken?: string;
		readonly pullRequestStatus: "OPEN" | "CLOSED";
		readonly repositoryName: string;
	}): Promise<ListPullRequestsResponse> {
		const output = (await this.client.send(
			new ListPullRequestsCommand(input),
		)) as ListPullRequestsCommandOutput;
		return {
			pullRequestIds: output.pullRequestIds,
			nextToken: output.nextToken,
		};
	}
}

export const createAwsCodeCommitService = (): CodeCommitService =>
	new CodeCommitService(
		new AwsCodeCommitClientAdapter(
			new CodeCommitClient({}) as unknown as AwsCodeCommitCommandClient,
		),
	);
