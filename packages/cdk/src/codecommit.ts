import {
	AssetStaging,
	Stack as CdkStack,
	FileAssetPackaging,
	RemovalPolicy,
	Stage,
} from "aws-cdk-lib";
import {
	Code,
	type CodeConfig,
	type IRepository,
	Repository,
} from "aws-cdk-lib/aws-codecommit";
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import type { Construct } from "constructs";
import { z } from "zod";
import {
	BedrockModelIdSchema,
	CodeCommitAutoReviewer,
} from "./codecommit-auto-reviewer";
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

/**
 * Zod schema validating either a direct Anthropic foundation-model ID or an
 * Anthropic AWS system-defined cross-region inference profile ID for the
 * high-level `CodeCommit` and CLI contract.
 *
 * This intentionally remains Anthropic-specific while refining the safe,
 * provider-agnostic contract used directly by `CodeCommitAutoReviewer`.
 */
export const AnthropicModelIdSchema = BedrockModelIdSchema.refine(
	(modelId) =>
		modelId.replace(/^(?:apac|eu|global|us)\./, "").startsWith("anthropic."),
	"modelId must be a direct Anthropic foundation-model ID or Anthropic system-defined cross-region inference profile ID",
);

/**
 * Zod schema for the auto-reviewer configuration accepted by `CodeCommit`.
 *
 * `modelId` is required; all other fields are optional with documented defaults.
 * `repositories` is NOT accepted here — the single repository name passed to
 * `CodeCommit` is used internally.
 */
const autoReviewConfigSchema = z.object({
	modelId: AnthropicModelIdSchema,
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

const sourceAssetHashSchema = z
	.string()
	.regex(
		/^[0-9a-f]{64}$/,
		"sourceAssetHash must be a 64-character lowercase hex CDK asset hash",
	);

const codeCommitCreateSchema = z
	.object({
		sourcePath: sourcePathSchema.optional(),
		branchName: CodeCommitBranchNameSchema.optional(),
		description: z.string().max(1_000).optional(),
		forceIncludePath: forceIncludePathSchema.optional(),
		sourceAssetHash: sourceAssetHashSchema.optional(),
	})
	.superRefine((create, context) => {
		if (create.sourcePath !== undefined) return;
		for (const property of [
			"branchName",
			"forceIncludePath",
			"sourceAssetHash",
		] as const) {
			if (create[property] !== undefined) {
				context.addIssue({
					code: "custom",
					path: [property],
					message: `${property} requires sourcePath`,
				});
			}
		}
	});

/**
 * Props for creating a new CodeCommit repository.
 *
 * When `sourcePath` is supplied, the directory is analyzed, packaged into a
 * deterministic ZIP, and used to seed the repository's initial commit via
 * CloudFormation's `Code` property. `branchName`, `forceIncludePath`, and
 * `sourceAssetHash` are only valid when `sourcePath` is set.
 */
export interface CodeCommitCreateProps {
	/** Local directory path to analyze and seed as the repository's initial commit. */
	readonly sourcePath?: string;
	/** Initial branch name. Defaults to `main`. Only valid with `sourcePath`. */
	readonly branchName?: string;
	/** Repository description (max 1,000 characters). */
	readonly description?: string;
	/**
	 * One safe direct-child directory name to force-include despite root
	 * `.gitignore` exclusion. Used to ensure generated infrastructure is seeded.
	 * Only valid with `sourcePath`.
	 */
	readonly forceIncludePath?: string;
	/**
	 * Advanced migration override for reusing an existing immutable seed ZIP
	 * asset identity. Must be its exact 64-character lowercase hex CDK asset hash
	 * and is only valid with `sourcePath`.
	 *
	 * This does not change source filtering or archive contents. The caller must
	 * ensure the asset already exists and matches the intended repository creation
	 * seed; CDK will publish the locally generated ZIP under this identity if a
	 * deployment attempts asset publication.
	 */
	readonly sourceAssetHash?: string;
}

/**
 * Props for the high-level {@link CodeCommit} construct.
 */
export interface CodeCommitProps {
	/** CodeCommit repository name (1–100 chars, letters/digits/`.\_\-`, no `.git` suffix). */
	readonly repositoryName: string;
	/** When present, creates the repository instead of importing it by name. */
	readonly create?: CodeCommitCreateProps;
	/** Pawl Lambda that receives EventBridge events. Mutually exclusive with `autoReview`. */
	readonly router?: LambdaFunction;
	/**
	 * Deploys the full durable auto-reviewer (reviewer Lambda, router, state
	 * table, CodeBuild, Bedrock IAM) for this repository. Mutually exclusive
	 * with `router`.
	 */
	readonly autoReview?: AutoReviewConfig;
}

/**
 * High-level CodeCommit repository construct with optional review automation.
 *
 * Supports two modes:
 *
 * **Create mode** (`create` prop supplied): Creates a new
 * `AWS::CodeCommit::Repository` resource. When `create.sourcePath` is set,
 * the source directory is analyzed, packaged into a deterministic ZIP asset,
 * and used to seed the repository's initial branch. Created repositories use
 * `RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE` so failed creation rolls back
 * while established repositories survive stack deletion.
 *
 * **Import mode** (`create` omitted): Imports an existing repository by name
 * without emitting a repository resource.
 *
 * Review automation:
 * - `router` — creates `CodeCommitReviewEvents` for the same repository.
 * - `autoReview` — deploys the full durable auto-reviewer (reviewer Lambda,
 *   router, state table, CodeBuild, Bedrock IAM) and wires event routing.
 * - Neither — repository-only mode with no EventBridge, Lambda, CodeBuild,
 *   DynamoDB, or Bedrock resources.
 * - `router` and `autoReview` are mutually exclusive.
 *
 * **Pre-1.0 API change:** `events` changed from required to optional in v0.1.0.
 * Consumers migrating from v0.0.x must narrow before use:
 * ```ts
 * if (codeCommit.events === undefined) {
 *   throw new Error("Expected review event resources");
 * }
 * ```
 *
 * @example Create and seed a repository:
 * ```ts
 * new CodeCommit(this, "Repo", {
 *   repositoryName: "my-repo",
 *   create: {
 *     sourcePath: path.resolve(__dirname, ".."),
 *     branchName: "main",
 *     forceIncludePath: "infra",
 *   },
 * });
 * ```
 *
 * @example Create with auto-review:
 * ```ts
 * new CodeCommit(this, "Repo", {
 *   repositoryName: "my-repo",
 *   autoReview: { modelId: "eu.anthropic.claude-sonnet-4-6" },
 * });
 * ```
 *
 * @example Import an existing repository with custom router:
 * ```ts
 * new CodeCommit(this, "Repo", {
 *   repositoryName: "existing-repo",
 *   router: myRouterLambda,
 * });
 * ```
 */
class ExistingSourceAssetCode extends Code {
	constructor(
		private readonly archivePath: string,
		private readonly branchName: string,
		private readonly sourceAssetHash: string,
	) {
		super();
	}

	bind(scope: Construct): CodeConfig {
		const stack = CdkStack.of(scope);
		const staging = new AssetStaging(scope, "ExistingSourceAsset", {
			sourcePath: this.archivePath,
		});
		if (!staging.isArchive) {
			throw new Error("CodeCommit source asset must be a ZIP archive");
		}
		// AssetHashType.CUSTOM hashes its input again. Registering the supported
		// FileAssetSource directly preserves the already-resolved CDK identity.
		const location = stack.synthesizer.addFileAsset({
			sourceHash: this.sourceAssetHash,
			fileName: staging.relativeStagedPath(stack),
			packaging: FileAssetPackaging.FILE,
			displayName: `${stack.stackName}/CodeCommitSeed`,
		});
		return {
			code: {
				branchName: this.branchName,
				s3: {
					bucket: location.bucketName,
					key: location.objectKey,
				},
			},
		};
	}
}

export class CodeCommit {
	/** The created or imported CodeCommit repository. */
	readonly repository: IRepository;
	/**
	 * Event routing construct. Defined only when `router` or `autoReview` is supplied.
	 *
	 * **Pre-1.0 breaking change:** This property is optional as of v0.1.0.
	 * Consumers must narrow before use.
	 */
	readonly events?: CodeCommitReviewEvents;
	/** The durable auto-reviewer, if deployed via `autoReview`. */
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
				const branchName = create.branchName ?? "main";
				if (create.sourceAssetHash === undefined) {
					const asset = new Asset(scope, `${id}SourceAsset`, {
						path: archive.archivePath,
					});
					if (!asset.isZipArchive) {
						throw new Error("CodeCommit source asset must be a ZIP archive");
					}
					code = Code.fromAsset(asset, branchName);
				} else {
					code = new ExistingSourceAssetCode(
						archive.archivePath,
						branchName,
						create.sourceAssetHash,
					);
				}
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
