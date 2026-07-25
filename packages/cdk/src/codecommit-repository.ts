import { Token } from "aws-cdk-lib";
import { type IRepository, Repository } from "aws-cdk-lib/aws-codecommit";
import type { Construct } from "constructs";
import { z } from "zod";

/** A valid AWS CodeCommit repository name. */
export const CodeCommitRepositoryNameSchema = z
	.string()
	.trim()
	.min(1)
	.max(100)
	.regex(/^[A-Za-z0-9._-]+$/)
	.refine((repositoryName) => !repositoryName.endsWith(".git"), {
		message: "Repository name must not end with .git",
	});

/** A valid AWS CodeCommit branch name that is safe to use as a Git ref. */
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

/** Selects an existing CodeCommit repository by exactly one form of identity. */
export type RepositoryTarget =
	| {
			repositoryName: string;
			repository?: never;
	  }
	| {
			repository: IRepository;
			repositoryName?: never;
	  };

/** Resolves a CodeCommit repository target to both its resource and valid name. */
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
