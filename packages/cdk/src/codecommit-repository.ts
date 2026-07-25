import { Token } from "aws-cdk-lib";
import { type IRepository, Repository } from "aws-cdk-lib/aws-codecommit";
import type { Construct } from "constructs";
import { z } from "zod";

/**
 * Zod schema validating an AWS CodeCommit repository name.
 *
 * - 1–100 characters
 * - Letters, digits, `.`, `_`, and `-` only
 * - Must not end in `.git`
 *
 * @see [AWS CodeCommit RepositoryName](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-codecommit-repository.html#cfn-codecommit-repository-repositoryname)
 */
export const CodeCommitRepositoryNameSchema = z
	.string()
	.trim()
	.min(1)
	.max(100)
	.regex(/^[A-Za-z0-9._-]+$/)
	.refine((repositoryName) => !repositoryName.endsWith(".git"), {
		message: "Repository name must not end with .git",
	});

/**
 * Zod schema validating an AWS CodeCommit branch name that is safe to use as a Git ref.
 *
 * - 1–256 characters
 * - Must satisfy CodeCommit's branch pattern and Git ref safety checks
 * - Cannot begin with `-`, contain `HEAD`, end in `.lock`, contain `..`,
 *   `@{`, control characters, spaces, `~`, `^`, `:`, `?`, `*`, `[`, `\`,
 *   repeated `/`, or begin/end with `/` or `.`
 * - Slash-delimited components must not begin with `.` or end with `.lock`
 *
 * @see [AWS CodeCommit BranchName](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-codecommit-repository-code.html#cfn-codecommit-repository-code-branchname)
 */
export const CodeCommitBranchNameSchema = z
	.string()
	.min(1)
	.max(256)
	.refine((branchName) => !branchName.startsWith("-"), {
		message: "Branch name must not start with a hyphen",
	})
	.refine((branchName) => !branchName.includes("HEAD"), {
		message: "Branch name must not contain HEAD",
	})
	.refine(
		(branchName) =>
			branchName.split("/").every((component) => !component.endsWith(".lock")),
		{
			message: "Branch name components must not end with .lock",
		},
	)
	.refine((branchName) => !branchName.includes(".."), {
		message: "Branch name must not contain two consecutive dots",
	})
	.refine((branchName) => !branchName.includes("@{"), {
		message: "Branch name must not contain @{",
	})
	.refine((branchName) => branchName !== "@", {
		message: "Branch name must not be @",
	})
	.refine(
		(branchName) =>
			branchName.split("").every((character) => {
				const codePoint = character.charCodeAt(0);
				return codePoint > 31 && codePoint !== 127;
			}),
		{
			message: "Branch name must not contain control characters",
		},
	)
	.refine((branchName) => !/[ ~^:?*[\\]/.test(branchName), {
		message: "Branch name contains a character that is unsafe in a Git ref",
	})
	.refine((branchName) => !branchName.includes("//"), {
		message: "Branch name must not contain repeated slashes",
	})
	.refine(
		(branchName) => !branchName.startsWith("/") && !branchName.endsWith("/"),
		{
			message: "Branch name must not start or end with a slash",
		},
	)
	.refine(
		(branchName) =>
			branchName.split("/").every((component) => !component.startsWith(".")),
		{
			message: "Branch name components must not start with a dot",
		},
	)
	.refine((branchName) => !branchName.endsWith("."), {
		message: "Branch name must not end with a dot",
	});

function validateRepositoryName(repositoryName: string): string {
	return Token.isUnresolved(repositoryName)
		? repositoryName
		: CodeCommitRepositoryNameSchema.parse(repositoryName);
}

/**
 * Selects an existing CodeCommit repository by exactly one form of identity.
 *
 * Provide either a `repositoryName` string (imported by name) or a concrete
 * `repository` resource (preserves identity and cross-stack references).
 * Providing both or neither is a runtime error.
 */
export type RepositoryTarget =
	| {
			repositoryName: string;
			repository?: never;
	  }
	| {
			repository: IRepository;
			repositoryName?: never;
	  };

/**
 * Resolves a CodeCommit repository target to both its `IRepository` and a validated name.
 *
 * When a concrete `repository` is supplied, its `repositoryName` is validated
 * (unless it is an unresolved CDK token) and the resource identity is preserved.
 * When only a `repositoryName` is supplied, the repository is imported by name.
 *
 * @param scope - The construct scope for imported repositories.
 * @param id - The construct id for the imported repository.
 * @param target - The exact-one repository target.
 * @returns The resolved repository and its validated name.
 * @throws {Error} when both or neither target variant is provided.
 */
export function normalizeRepositoryTarget(
	scope: Construct,
	id: string,
	target: RepositoryTarget,
): { repository: IRepository; repositoryName: string } {
	const hasRepository = target.repository !== undefined;
	const hasRepositoryName = target.repositoryName !== undefined;
	if (hasRepository === hasRepositoryName) {
		throw new Error(
			"CodeCommit repository target must provide exactly one of repository or repositoryName",
		);
	}

	if (target.repository !== undefined) {
		const repositoryName = validateRepositoryName(
			target.repository.repositoryName,
		);
		return { repository: target.repository, repositoryName };
	}

	const repositoryName = validateRepositoryName(target.repositoryName);
	return {
		repository: Repository.fromRepositoryName(scope, id, repositoryName),
		repositoryName,
	};
}
