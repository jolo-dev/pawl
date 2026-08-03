import { lstatSync } from "node:fs";
import path from "node:path";
import { Token } from "aws-cdk-lib";
import type { IRepository } from "aws-cdk-lib/aws-codecommit";
import { Construct } from "constructs";
import { z } from "zod";
import { CodeCommit } from "../codecommit";
import {
	CodeCommitBranchNameSchema,
	CodeCommitRepositoryNameSchema,
} from "../codecommit-repository";
import { analyzeCodeCommitSource } from "../codecommit-source";
import type { Stack } from "../stack";
import { PipelineDefinitionError } from "./errors";

type UnionKeys<T> = T extends T ? keyof T : never;
type StrictUnionHelper<T, TAll> = T extends unknown
	? T & Partial<Record<Exclude<UnionKeys<TAll>, keyof T>, never>>
	: never;
type StrictUnion<T> = StrictUnionHelper<T, T>;

/** Exact ownership forms supported by a fluent CodeCommit pipeline source. */
export type CodeCommitPipelineSource = StrictUnion<
	| {
			readonly origin: "codecommit";
			readonly create: true;
			readonly repositoryName: string;
			readonly description?: string;
			readonly branchName?: string;
			readonly sync?: string;
	  }
	| {
			readonly origin: "codecommit";
			readonly create: false;
			readonly repositoryName: string;
			readonly branchName?: string;
	  }
	| {
			readonly origin: "codecommit";
			readonly repository: IRepository;
			readonly repositoryName?: string;
			readonly branchName?: string;
	  }
>;

const repositorySchema = z.custom<IRepository>((value) => {
	if (!Construct.isConstruct(value)) return false;
	const repository = value as Partial<IRepository>;
	return (
		typeof repository.repositoryName === "string" &&
		repository.repositoryName.trim().length > 0 &&
		typeof repository.repositoryArn === "string" &&
		repository.repositoryArn.trim().length > 0 &&
		typeof repository.grantRead === "function" &&
		typeof repository.onCommit === "function"
	);
}, "repository must be an AWS CodeCommit IRepository construct");

const syncSchema = z
	.string()
	.min(1)
	.refine((sync) => sync.trim().length > 0, "sync must not be whitespace");

/**
 * Strict runtime schema for the three CodeCommit pipeline source ownership forms.
 * Unknown fields are rejected so JavaScript and cast callers cannot combine forms.
 */
export const CodeCommitPipelineSourceSchema = z.union([
	z
		.object({
			origin: z.literal("codecommit"),
			create: z.literal(true),
			repositoryName: CodeCommitRepositoryNameSchema,
			description: z.string().max(1_000).optional(),
			branchName: CodeCommitBranchNameSchema.optional(),
			sync: syncSchema.optional(),
		})
		.strict(),
	z
		.object({
			origin: z.literal("codecommit"),
			create: z.literal(false),
			repositoryName: CodeCommitRepositoryNameSchema,
			branchName: CodeCommitBranchNameSchema.optional(),
		})
		.strict(),
	z
		.object({
			origin: z.literal("codecommit"),
			repository: repositorySchema,
			repositoryName: CodeCommitRepositoryNameSchema.optional(),
			branchName: CodeCommitBranchNameSchema.optional(),
		})
		.strict(),
]);

function sourceOwnershipError(message: string): PipelineDefinitionError {
	return new PipelineDefinitionError(
		"SOURCE_OWNERSHIP_CONFLICT",
		message,
		"source",
	);
}

/** Parse and strictly validate a CodeCommit pipeline source at runtime. */
export function parseCodeCommitPipelineSource(
	value: unknown,
): CodeCommitPipelineSource {
	const result = CodeCommitPipelineSourceSchema.safeParse(value);
	if (!result.success) {
		throw sourceOwnershipError(
			`Invalid CodeCommit pipeline source: ${z.prettifyError(result.error)}`,
		);
	}
	return result.data;
}

export interface MaterializedPipelineSource {
	readonly repository: IRepository;
	readonly repositoryName: string;
	readonly branchName: string;
}

export interface CodeCommitSourcePlan {
	readonly repositoryName: string;
	readonly branchName: string;
	materialize(scope: Stack, id: string): MaterializedPipelineSource;
}

function validateRepositoryName(repositoryName: string): string {
	if (Token.isUnresolved(repositoryName)) return repositoryName;
	const result = CodeCommitRepositoryNameSchema.safeParse(repositoryName);
	if (!result.success) {
		throw sourceOwnershipError(
			`Invalid supplied CodeCommit repository name: ${z.prettifyError(result.error)}`,
		);
	}
	return result.data;
}

/**
 * Resolves a sync path relative to the consuming CDK app's current working
 * directory and analyzes it before any construct children are materialized.
 * Analysis validates directory identity, symlink safety, filtered contents,
 * and CodeCommit initial-import limits; packaging remains in {@link CodeCommit}.
 */
function validateSyncPath(sync: string): string {
	const sourcePath = path.resolve(sync);
	try {
		const metadata = lstatSync(sourcePath);
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw new TypeError("sync must identify a real directory");
		}
		analyzeCodeCommitSource({ sourcePath });
		return sourcePath;
	} catch (error) {
		const detail = error instanceof Error ? error.message : "unsupported path";
		throw sourceOwnershipError(`Invalid CodeCommit sync path: ${detail}`);
	}
}

/**
 * Validates and plans a CodeCommit source without creating construct children.
 * Materialization either delegates create/import ownership to the existing Pawl
 * {@link CodeCommit} abstraction or preserves a supplied repository identity.
 */
export function planCodeCommitSource(
	source: CodeCommitPipelineSource,
	options: { readonly requiresConcreteName: boolean },
): CodeCommitSourcePlan {
	const parsed = parseCodeCommitPipelineSource(source);
	const branchName = parsed.branchName ?? "main";

	if (parsed.create === true) {
		const repositoryName = parsed.repositoryName;
		const sourcePath =
			parsed.sync === undefined ? undefined : validateSyncPath(parsed.sync);
		return {
			repositoryName,
			branchName,
			materialize(scope, id) {
				const codeCommit = new CodeCommit(scope, id, {
					repositoryName,
					create:
						sourcePath === undefined
							? { description: parsed.description }
							: {
									sourcePath,
									branchName,
									description: parsed.description,
								},
				});
				return {
					repository: codeCommit.repository,
					repositoryName,
					branchName,
				};
			},
		};
	}

	if (parsed.create === false) {
		const repositoryName = parsed.repositoryName;
		return {
			repositoryName,
			branchName,
			materialize(scope, id) {
				const codeCommit = new CodeCommit(scope, id, { repositoryName });
				return {
					repository: codeCommit.repository,
					repositoryName,
					branchName,
				};
			},
		};
	}

	const suppliedName = validateRepositoryName(parsed.repository.repositoryName);
	const suppliedNameIsToken = Token.isUnresolved(suppliedName);
	if (
		!suppliedNameIsToken &&
		parsed.repositoryName !== undefined &&
		parsed.repositoryName !== suppliedName
	) {
		throw sourceOwnershipError(
			`Supplied repository name '${suppliedName}' does not match fallback '${parsed.repositoryName}'`,
		);
	}
	if (
		suppliedNameIsToken &&
		options.requiresConcreteName &&
		parsed.repositoryName === undefined
	) {
		throw sourceOwnershipError(
			"A literal repositoryName fallback is required for a tokenized supplied repository",
		);
	}
	const repositoryName = parsed.repositoryName ?? suppliedName;
	const repository = parsed.repository;
	return {
		repositoryName,
		branchName,
		materialize() {
			return { repository, repositoryName, branchName };
		},
	};
}
