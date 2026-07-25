import { RemovalPolicy, Stage } from "aws-cdk-lib";
import { Code, type IRepository, Repository } from "aws-cdk-lib/aws-codecommit";
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import { z } from "zod";
import { CodeCommitAutoReviewer } from "./codecommit-auto-reviewer";
import {
	CodeCommitBranchNameSchema,
	CodeCommitRepositoryNameSchema,
} from "./codecommit-repository";
import { CodeCommitReviewEvents } from "./codecommit-review-events";
import {
	analyzeCodeCommitSource,
	createCodeCommitSourceArchive,
} from "./codecommit-source";
import type { LambdaFunction } from "./lambda-function";
import type { Stack } from "./stack";

const anthropicModelIdSchema = z
	.string()
	.min(2)
	.max(256)
	.regex(
		/^(?:[A-Za-z0-9-]+\.)?anthropic\.[A-Za-z0-9][A-Za-z0-9._:-]*$/,
		"modelId must be an Anthropic Bedrock model ID or inference-profile ID",
	);

/**
 * Configuration for the auto-reviewer when opted in via `autoReview`.
 *
 * `modelId` is required; all other fields are optional with documented defaults
 * (see `CodeCommitAutoReviewerConfigSchema`). `repositories` is NOT accepted
 * here — the single repository name passed to `CodeCommit` is used.
 */
const autoReviewConfigSchema = z.object({
	modelId: anthropicModelIdSchema,
	reviewerAlias: z.string().trim().min(1).default("live"),
	reviewerExecutionTimeoutSeconds: z
		.number()
		.int()
		.min(1)
		.max(31_622_400)
		.default(2_592_000),
	reviewerRetentionDays: z.number().int().min(1).max(90).default(14),
	reviewerTimeoutMinutes: z.number().int().min(1).max(15).default(15),
	reviewerMemorySize: z.number().int().min(128).max(10_240).default(512),
	codeBuildComputeSize: z.enum(["SMALL", "MEDIUM", "LARGE"]).default("SMALL"),
	codeBuildNetworkPolicy: z
		.object({
			mode: z.literal("public-test"),
			packageAccess: z.object({
				mode: z.literal("approved-registry"),
				endpoint: z
					.string()
					.trim()
					.url()
					.refine((value) => value.startsWith("https://"), "must be HTTPS"),
			}),
		})
		.default({
			mode: "public-test",
			packageAccess: {
				mode: "approved-registry",
				endpoint: "https://registry.npmjs.org",
			},
		}),
	botArnPatterns: z.string().default(""),
});

export type AutoReviewConfig = z.input<typeof autoReviewConfigSchema>;

const reservedForceIncludePaths = new Set([".git", "node_modules", "cdk.out"]);

const forceIncludePathSchema = z
	.string()
	.min(1)
	.refine(
		(forceIncludePath) =>
			/^[A-Za-z0-9._-]+$/.test(forceIncludePath) &&
			forceIncludePath !== "." &&
			forceIncludePath !== ".." &&
			!reservedForceIncludePaths.has(forceIncludePath) &&
			!forceIncludePath.startsWith(".cdk.staging"),
		"forceIncludePath must be one safe direct child name",
	);

const sourcePathSchema = z
	.string()
	.min(1)
	.refine(
		(sourcePath) => sourcePath.trim().length > 0,
		"sourcePath is required",
	);

const codeCommitCreateSchema = z
	.object({
		sourcePath: sourcePathSchema.optional(),
		branchName: CodeCommitBranchNameSchema.optional(),
		description: z.string().max(1_000).optional(),
		forceIncludePath: forceIncludePathSchema.optional(),
	})
	.superRefine((create, context) => {
		if (create.sourcePath !== undefined) return;
		for (const property of ["branchName", "forceIncludePath"] as const) {
			if (create[property] !== undefined) {
				context.addIssue({
					code: "custom",
					path: [property],
					message: `${property} requires sourcePath`,
				});
			}
		}
	});

export interface CodeCommitCreateProps {
	readonly sourcePath?: string;
	readonly branchName?: string;
	readonly description?: string;
	readonly forceIncludePath?: string;
}

export interface CodeCommitProps {
	/** CodeCommit repository name. */
	readonly repositoryName: string;
	/** When present, creates the repository instead of importing it by name. */
	readonly create?: CodeCommitCreateProps;
	/** Pawl Lambda that receives EventBridge events. */
	readonly router?: LambdaFunction;
	/** Deploys the full durable auto-reviewer for this repository. */
	readonly autoReview?: AutoReviewConfig;
}

/**
 * High-level CodeCommit repository construct with optional review automation.
 *
 * When neither `router` nor `autoReview` is supplied, only the repository is
 * created or imported. `events` is intentionally optional as of the pre-1.0
 * 0.1 API; consumers migrating from 0.0.x must check it before use.
 *
 * A supplied `router` creates `CodeCommitReviewEvents` for the same repository.
 * `autoReview` instead deploys the durable reviewer infrastructure and wires
 * its internally created events to the same concrete repository when created.
 */
export class CodeCommit {
	readonly repository: IRepository;
	readonly events?: CodeCommitReviewEvents;
	readonly autoReviewer?: CodeCommitAutoReviewer;

	constructor(scope: Stack, id: string, props: CodeCommitProps) {
		const repositoryName = CodeCommitRepositoryNameSchema.parse(
			props.repositoryName,
		);
		if (props.router !== undefined && props.autoReview !== undefined) {
			throw new Error(
				"CodeCommit router and autoReview are mutually exclusive",
			);
		}
		const create =
			props.create === undefined
				? undefined
				: codeCommitCreateSchema.parse(props.create);
		const autoReview =
			props.autoReview === undefined
				? undefined
				: autoReviewConfigSchema.parse(props.autoReview);

		let createdRepository: Repository | undefined;
		if (create !== undefined) {
			let code: Code | undefined;
			if (create.sourcePath !== undefined) {
				const analysis = analyzeCodeCommitSource({
					sourcePath: create.sourcePath,
					forceIncludePath: create.forceIncludePath,
				});
				const stage = Stage.of(scope);
				if (stage === undefined) {
					throw new Error("CodeCommit source assets require a CDK Stage");
				}
				const archive = createCodeCommitSourceArchive({
					analysis,
					outputDirectory: stage.assetOutdir,
				});
				const asset = new Asset(scope, `${id}SourceAsset`, {
					path: archive.archivePath,
				});
				if (!asset.isZipArchive) {
					throw new Error("CodeCommit source asset must be a ZIP archive");
				}
				code = Code.fromAsset(asset, create.branchName ?? "main");
			}
			createdRepository = new Repository(scope, `${id}Repository`, {
				repositoryName,
				description: create.description,
				code,
			});
			createdRepository.applyRemovalPolicy(
				RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
			);
			this.repository = createdRepository;
		} else {
			this.repository = Repository.fromRepositoryName(
				scope,
				`${id}Repository`,
				repositoryName,
			);
		}

		if (autoReview !== undefined) {
			this.autoReviewer = new CodeCommitAutoReviewer(
				scope,
				`${id}AutoReviewer`,
				{
					...autoReview,
					reviewerModelId: autoReview.modelId,
					repositories: [repositoryName],
					repositoryResources:
						createdRepository === undefined
							? undefined
							: new Map([[repositoryName, createdRepository]]),
				},
			);
			this.events = this.autoReviewer.eventConstructs.get(repositoryName);
		} else if (props.router !== undefined) {
			this.events = new CodeCommitReviewEvents(scope, `${id}Events`, {
				repository: this.repository,
				router: props.router,
			});
		}
	}
}
