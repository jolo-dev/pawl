import type {
	CodeCommitService,
	ListRepositoriesResult,
} from "@pawl/codecommit";

export interface RunCodeCommitRepositoriesOptions {
	readonly argv: readonly string[];
	readonly service: Pick<CodeCommitService, "listRepositories">;
}

const pageSizeError = "--max-results must be an integer between 1 and 1000.";

const parseMaxResults = (value: string): number => {
	if (!/^\d+$/.test(value)) throw new Error(pageSizeError);
	const maxResults = Number(value);
	if (
		!Number.isSafeInteger(maxResults) ||
		maxResults < 1 ||
		maxResults > 1_000
	) {
		throw new Error(pageSizeError);
	}
	return maxResults;
};

const optionValue = (
	argv: readonly string[],
	index: number,
	option: string,
): string => {
	const value = argv[index + 1];
	if (value === undefined || value.startsWith("--")) {
		throw new Error(`${option} requires a value.`);
	}
	return value;
};

export const parseCodeCommitRepositoriesArgs = (
	argv: readonly string[],
): { readonly maxResults?: number; readonly nextToken?: string } => {
	let maxResults: number | undefined;
	let nextToken: string | undefined;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--max-results") {
			if (maxResults !== undefined)
				throw new Error("--max-results may only be provided once.");
			maxResults = parseMaxResults(optionValue(argv, index, argument));
			index += 1;
			continue;
		}
		if (argument === "--next-token") {
			if (nextToken !== undefined)
				throw new Error("--next-token may only be provided once.");
			nextToken = optionValue(argv, index, argument);
			if (nextToken.length === 0)
				throw new Error("--next-token must not be blank.");
			index += 1;
			continue;
		}
		throw new Error(
			`Unknown CodeCommit repositories option: ${argument ?? ""}`,
		);
	}
	return { maxResults, nextToken };
};

export const runCodeCommitRepositories = async ({
	argv,
	service,
}: RunCodeCommitRepositoriesOptions): Promise<ListRepositoriesResult> =>
	service.listRepositories(parseCodeCommitRepositoriesArgs(argv));

export const formatCodeCommitRepositoriesResult = (
	result: ListRepositoriesResult,
): string => JSON.stringify(result, null, 2);
