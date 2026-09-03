import { z } from "zod";

const pageSizeSchema = z.number().int().min(1).max(1_000).optional();
const continuationTokenSchema = z.string().min(1).optional();

export const repositoryNameSchema = z
	.string()
	.min(1)
	.max(100)
	.regex(/^[A-Za-z0-9._-]+$/)
	.refine((name) => !name.endsWith(".git"));

export const listRepositoriesRequestSchema = z.object({
	maxResults: pageSizeSchema,
	nextToken: continuationTokenSchema,
});

export const getRepositoryRequestSchema = z.object({
	repositoryName: repositoryNameSchema,
});

export const listBranchesRequestSchema = getRepositoryRequestSchema.extend({
	maxResults: pageSizeSchema,
	nextToken: continuationTokenSchema,
});

export const pullRequestStatusSchema = z.enum(["OPEN", "CLOSED"]);

export const listPullRequestsRequestSchema = getRepositoryRequestSchema.extend({
	maxResults: pageSizeSchema,
	nextToken: continuationTokenSchema,
	pullRequestStatus: pullRequestStatusSchema,
});

export type ListRepositoriesRequest = z.input<
	typeof listRepositoriesRequestSchema
>;
export type GetRepositoryRequest = z.input<typeof getRepositoryRequestSchema>;
export type ListBranchesRequest = z.input<typeof listBranchesRequestSchema>;
export type PullRequestStatus = z.infer<typeof pullRequestStatusSchema>;
export type ListPullRequestsRequest = z.input<
	typeof listPullRequestsRequestSchema
>;
export type CodeCommitOperation =
	| "getRepository"
	| "listBranches"
	| "listPullRequests"
	| "listRepositories";
export type CodeCommitErrorCategory =
	| "authorization"
	| "conflict"
	| "not-found"
	| "throttled"
	| "unknown"
	| "validation";

export interface CodeCommitRepositorySummary {
	readonly id?: string;
	readonly name: string;
}

export interface ListRepositoriesResult {
	readonly items: readonly CodeCommitRepositorySummary[];
	readonly nextToken?: string;
}

export interface ListRepositoriesResponse {
	readonly repositories?: readonly {
		readonly repositoryId?: string;
		readonly repositoryName?: string;
	}[];
	readonly nextToken?: string;
}

export interface RepositoryMetadataResponse {
	readonly repositoryMetadata?: {
		readonly accountId?: string;
		readonly creationDate?: Date;
		readonly defaultBranch?: string;
		readonly description?: string;
		readonly lastModifiedDate?: Date;
		readonly repositoryArn?: string;
		readonly repositoryId?: string;
		readonly repositoryName?: string;
	};
}

export interface RepositoryMetadata {
	readonly accountId?: string;
	readonly arn?: string;
	readonly createdAt?: string;
	readonly defaultBranch?: string;
	readonly description?: string;
	readonly id?: string;
	readonly name: string;
	readonly updatedAt?: string;
}

export interface ListBranchesResponse {
	readonly branches?: readonly string[];
	readonly nextToken?: string;
}

export interface ListBranchesResult {
	readonly items: readonly string[];
	readonly nextToken?: string;
}

export interface ListPullRequestsResponse {
	readonly nextToken?: string;
	readonly pullRequestIds?: readonly string[];
}

export interface PullRequestSummary {
	readonly id: string;
}

export interface ListPullRequestsResult {
	readonly items: readonly PullRequestSummary[];
	readonly nextToken?: string;
}

export interface CodeCommitClientPort {
	getRepository(input: {
		readonly repositoryName: string;
	}): Promise<RepositoryMetadataResponse>;
	listBranches(input: {
		readonly maxResults?: number;
		readonly nextToken?: string;
		readonly repositoryName: string;
	}): Promise<ListBranchesResponse>;
	listPullRequests(input: {
		readonly maxResults?: number;
		readonly nextToken?: string;
		readonly pullRequestStatus: PullRequestStatus;
		readonly repositoryName: string;
	}): Promise<ListPullRequestsResponse>;
	listRepositories(input: {
		readonly maxResults?: number;
		readonly nextToken?: string;
	}): Promise<ListRepositoriesResponse>;
}

export class CodeCommitServiceError extends Error {
	readonly name = "CodeCommitServiceError";

	constructor(
		readonly category: CodeCommitErrorCategory,
		readonly operation: CodeCommitOperation,
		message: string,
		readonly cause?: unknown,
	) {
		super(message);
	}
}

const operationMessages: Record<
	CodeCommitOperation,
	Record<CodeCommitErrorCategory, string>
> = {
	getRepository: {
		authorization:
			"CodeCommit authorization failed while reading the repository.",
		conflict: "CodeCommit could not read the repository because of a conflict.",
		"not-found": "The requested CodeCommit repository was not found.",
		throttled: "CodeCommit temporarily throttled the repository request.",
		unknown: "CodeCommit could not read the repository.",
		validation: "Invalid request for reading a CodeCommit repository.",
	},
	listBranches: {
		authorization: "CodeCommit authorization failed while listing branches.",
		conflict: "CodeCommit could not list branches because of a conflict.",
		"not-found": "The requested CodeCommit repository was not found.",
		throttled: "CodeCommit temporarily throttled the branch request.",
		unknown: "CodeCommit could not list branches.",
		validation: "Invalid request for listing CodeCommit branches.",
	},
	listPullRequests: {
		authorization:
			"CodeCommit authorization failed while listing pull requests.",
		conflict: "CodeCommit could not list pull requests because of a conflict.",
		"not-found": "The requested CodeCommit repository was not found.",
		throttled: "CodeCommit temporarily throttled the pull request.",
		unknown: "CodeCommit could not list pull requests.",
		validation: "Invalid request for listing CodeCommit pull requests.",
	},
	listRepositories: {
		authorization:
			"CodeCommit authorization failed while listing repositories.",
		conflict: "CodeCommit could not list repositories because of a conflict.",
		"not-found": "The requested CodeCommit repository was not found.",
		throttled: "CodeCommit temporarily throttled the repository request.",
		unknown: "CodeCommit could not list repositories.",
		validation: "Invalid request for listing CodeCommit repositories.",
	},
};

const errorName = (error: unknown): string | undefined =>
	typeof error === "object" &&
	error !== null &&
	"name" in error &&
	typeof error.name === "string"
		? error.name
		: undefined;

const errorStatusCode = (error: unknown): number | undefined => {
	if (typeof error !== "object" || error === null || !("$metadata" in error)) {
		return undefined;
	}
	const metadata = error.$metadata;
	return typeof metadata === "object" &&
		metadata !== null &&
		"httpStatusCode" in metadata &&
		typeof metadata.httpStatusCode === "number"
		? metadata.httpStatusCode
		: undefined;
};

const categorizeError = (error: unknown): CodeCommitErrorCategory => {
	const name = errorName(error);
	if (
		name === "AccessDeniedException" ||
		name === "EncryptionKeyAccessDeniedException"
	)
		return "authorization";
	if (
		name === "RepositoryDoesNotExistException" ||
		name === "PullRequestDoesNotExistException"
	)
		return "not-found";
	if (name === "RepositoryNameExistsException") return "conflict";
	if (
		name === "ThrottlingException" ||
		name === "LimitExceededException" ||
		errorStatusCode(error) === 429
	)
		return "throttled";
	if (name?.startsWith("Invalid") === true) return "validation";
	return "unknown";
};

export class CodeCommitService {
	constructor(private readonly client: CodeCommitClientPort) {}

	async listRepositories(
		request: ListRepositoriesRequest = {},
	): Promise<ListRepositoriesResult> {
		const input = this.parse(
			listRepositoriesRequestSchema,
			request,
			"listRepositories",
		);
		const response = await this.call("listRepositories", () =>
			this.client.listRepositories(input),
		);
		return {
			items: (response.repositories ?? [])
				.filter(
					(
						repository,
					): repository is typeof repository & { repositoryName: string } =>
						repository.repositoryName !== undefined,
				)
				.map((repository) => ({
					id: repository.repositoryId,
					name: repository.repositoryName,
				})),
			nextToken: response.nextToken,
		};
	}

	async getRepository(
		request: GetRepositoryRequest,
	): Promise<RepositoryMetadata> {
		const input = this.parse(
			getRepositoryRequestSchema,
			request,
			"getRepository",
		);
		const response = await this.call("getRepository", () =>
			this.client.getRepository(input),
		);
		const repository = response.repositoryMetadata;
		if (repository?.repositoryName === undefined) {
			throw this.error("unknown", "getRepository");
		}
		return {
			accountId: repository.accountId,
			arn: repository.repositoryArn,
			createdAt: repository.creationDate?.toISOString(),
			defaultBranch: repository.defaultBranch,
			description: repository.description,
			id: repository.repositoryId,
			name: repository.repositoryName,
			updatedAt: repository.lastModifiedDate?.toISOString(),
		};
	}

	async listBranches(
		request: ListBranchesRequest,
	): Promise<ListBranchesResult> {
		const input = this.parse(
			listBranchesRequestSchema,
			request,
			"listBranches",
		);
		const response = await this.call("listBranches", () =>
			this.client.listBranches(input),
		);
		return { items: response.branches ?? [], nextToken: response.nextToken };
	}

	async listPullRequests(
		request: ListPullRequestsRequest,
	): Promise<ListPullRequestsResult> {
		const input = this.parse(
			listPullRequestsRequestSchema,
			request,
			"listPullRequests",
		);
		const response = await this.call("listPullRequests", () =>
			this.client.listPullRequests(input),
		);
		return {
			items: (response.pullRequestIds ?? []).map((id) => ({ id })),
			nextToken: response.nextToken,
		};
	}

	private async call<T>(
		operation: CodeCommitOperation,
		action: () => Promise<T>,
	): Promise<T> {
		try {
			return await action();
		} catch (error) {
			if (error instanceof CodeCommitServiceError) throw error;
			throw this.error(categorizeError(error), operation, error);
		}
	}

	private error(
		category: CodeCommitErrorCategory,
		operation: CodeCommitOperation,
		cause?: unknown,
	): CodeCommitServiceError {
		return new CodeCommitServiceError(
			category,
			operation,
			operationMessages[operation][category],
			cause,
		);
	}

	private parse<TSchema extends z.ZodType>(
		schema: TSchema,
		request: unknown,
		operation: CodeCommitOperation,
	): z.output<TSchema> {
		const result = schema.safeParse(request);
		if (!result.success)
			throw this.error("validation", operation, result.error);
		return result.data;
	}
}
