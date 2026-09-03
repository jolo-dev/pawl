import type { CodeCommitService } from "@pawl/codecommit";
import {
	formatCodeCommitRepositoriesResult,
	runCodeCommitRepositories,
} from "./index";

export interface RunCodeCommitRepositoriesCommandOptions {
	readonly argv: readonly string[];
	readonly service: Pick<CodeCommitService, "listRepositories">;
	readonly stderr: (message: string) => void;
	readonly stdout: (message: string) => void;
}

export const runCodeCommitRepositoriesCommand = async ({
	argv,
	service,
	stderr,
	stdout,
}: RunCodeCommitRepositoriesCommandOptions): Promise<0 | 1> => {
	try {
		const result = await runCodeCommitRepositories({ argv, service });
		stdout(formatCodeCommitRepositoriesResult(result));
		return 0;
	} catch (error) {
		stderr(
			error instanceof Error
				? error.message
				: "CodeCommit repositories command failed.",
		);
		return 1;
	}
};
