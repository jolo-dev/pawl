import {
	AnthropicModelIdSchema,
	BasicTags,
	CodeCommitBranchNameSchema,
	CodeCommitRepositoryNameSchema,
} from "@pawl/cdk";
import { type ZodIssue, type ZodType, z } from "zod";

export interface CodeCommitInitFlags {
	readonly repositoryName?: string;
	readonly syncPath?: string;
	readonly noSync?: true;
	readonly directory?: string;
	readonly branchName?: string;
	readonly autoReviewer?: true;
	readonly noAutoReviewer?: true;
	readonly modelId?: string;
	readonly team?: string;
	readonly stage?: string;
	readonly install?: true;
	readonly noInstall?: true;
	readonly deploy?: true;
	readonly noDeploy?: true;
	readonly awsProfile?: string;
	readonly region?: string;
	/** Option names repeated by the CLI parser, retained for normalization. */
	readonly repeatedOptions?: readonly string[];
}

export interface ValidatedCodeCommitInitCoreConfig {
	readonly repositoryName: string;
	readonly syncPath?: string;
	readonly noSync?: true;
	readonly directory?: string;
	readonly branchName: string;
	readonly autoReviewer: boolean;
	readonly modelId?: string;
	readonly team: string;
	readonly stage: "dev" | "qa" | "prod";
	readonly install?: boolean;
	readonly deploy?: boolean;
	readonly awsProfile?: string;
	readonly region?: string;
}

export interface ValidatedCodeCommitInitConfig
	extends ValidatedCodeCommitInitCoreConfig {
	readonly install: boolean;
	readonly deploy: boolean;
}

export class CodeCommitInitConfigError extends Error {
	readonly issues: readonly ZodIssue[];

	constructor(issues: readonly ZodIssue[]) {
		const details = issues
			.map((issue) => {
				const field = issue.path.join(".") || "config";
				return `${field}: ${issue.message}`;
			})
			.join("; ");
		super(`Invalid CodeCommit init config: ${details}`);
		this.name = "CodeCommitInitConfigError";
		this.issues = issues;
	}
}

const optionalText = z.string().trim().min(1);
const sharedShape = {
	repositoryName: CodeCommitRepositoryNameSchema,
	syncPath: optionalText.optional(),
	noSync: z.literal(true).optional(),
	directory: optionalText.optional(),
	branchName: CodeCommitBranchNameSchema.default("main"),
	autoReviewer: z.literal(true).optional(),
	noAutoReviewer: z.literal(true).optional(),
	modelId: AnthropicModelIdSchema.optional(),
	team: optionalText,
	stage: BasicTags.shape.stage.default("dev"),
	install: z.literal(true).optional(),
	noInstall: z.literal(true).optional(),
	deploy: z.literal(true).optional(),
	noDeploy: z.literal(true).optional(),
	awsProfile: optionalText.optional(),
	region: optionalText.optional(),
	repeatedOptions: z
		.array(z.string())
		.max(0, "Repeated options are not allowed")
		.optional(),
};

type ParsedFlags = z.infer<z.ZodObject<typeof sharedShape>>;

function addChoiceIssue(
	context: z.RefinementCtx,
	path: string,
	positive: boolean,
	negative: boolean,
	required: boolean,
): void {
	const selected = Number(positive) + Number(negative);
	if (selected > 1 || (required && selected !== 1)) {
		context.addIssue({
			code: "custom",
			path: [path],
			message: required
				? `Exactly one ${path} choice is required`
				: `At most one ${path} choice is allowed`,
		});
	}
}

function validateRelationships(
	flags: ParsedFlags,
	context: z.RefinementCtx,
	complete: boolean,
): void {
	addChoiceIssue(
		context,
		"sync",
		flags.syncPath !== undefined,
		flags.noSync === true,
		true,
	);
	addChoiceIssue(
		context,
		"autoReviewer",
		flags.autoReviewer === true,
		flags.noAutoReviewer === true,
		true,
	);
	addChoiceIssue(
		context,
		"install",
		flags.install === true,
		flags.noInstall === true,
		complete,
	);
	addChoiceIssue(
		context,
		"deploy",
		flags.deploy === true,
		flags.noDeploy === true,
		complete,
	);

	if (flags.autoReviewer === true && flags.modelId === undefined) {
		context.addIssue({
			code: "custom",
			path: ["modelId"],
			message: "Model is required when auto-review is enabled",
		});
	}
	if (flags.noAutoReviewer === true && flags.modelId !== undefined) {
		context.addIssue({
			code: "custom",
			path: ["modelId"],
			message: "Model is not allowed when auto-review is disabled",
		});
	}
	if (flags.autoReviewer === true && flags.stage === "prod") {
		context.addIssue({
			code: "custom",
			path: ["stage"],
			message: "Auto-review is not allowed in prod",
		});
	}

	if (flags.deploy === true && flags.noInstall === true) {
		context.addIssue({
			code: "custom",
			path: ["deploy"],
			message: "Deploy requires install",
		});
	}
	if (!complete) {
		if (
			flags.noDeploy === true &&
			(flags.awsProfile !== undefined || flags.region !== undefined)
		) {
			context.addIssue({
				code: "custom",
				path: ["deploy"],
				message: "AWS profile and region are only allowed when deploying",
			});
		}
		return;
	}

	if (flags.deploy === true && flags.install !== true) {
		context.addIssue({
			code: "custom",
			path: ["deploy"],
			message: "Deploy requires install",
		});
	}
	if (flags.deploy === true && flags.awsProfile === undefined) {
		context.addIssue({
			code: "custom",
			path: ["awsProfile"],
			message: "AWS profile is required when deploying",
		});
	}
	if (flags.deploy === true && flags.region === undefined) {
		context.addIssue({
			code: "custom",
			path: ["region"],
			message: "Region is required when deploying",
		});
	}
	if (
		flags.deploy !== true &&
		(flags.awsProfile !== undefined || flags.region !== undefined)
	) {
		context.addIssue({
			code: "custom",
			path: [flags.awsProfile !== undefined ? "awsProfile" : "region"],
			message: "AWS profile and region are only allowed when deploying",
		});
	}
}

const coreFlagsSchema = z
	.strictObject(sharedShape)
	.superRefine((flags, context) =>
		validateRelationships(flags, context, false),
	);
const completeFlagsSchema = z
	.strictObject(sharedShape)
	.superRefine((flags, context) => validateRelationships(flags, context, true));

function parseFlags<T>(schema: ZodType<T>, flags: CodeCommitInitFlags): T {
	const result = schema.safeParse(flags);
	if (!result.success) {
		throw new CodeCommitInitConfigError(result.error.issues);
	}
	return result.data;
}

function normalizeCore(flags: ParsedFlags): ValidatedCodeCommitInitCoreConfig {
	return {
		repositoryName: flags.repositoryName,
		...(flags.syncPath === undefined
			? { noSync: true as const }
			: { syncPath: flags.syncPath }),
		...(flags.directory === undefined ? {} : { directory: flags.directory }),
		branchName: flags.branchName,
		autoReviewer: flags.autoReviewer === true,
		...(flags.modelId === undefined ? {} : { modelId: flags.modelId }),
		team: flags.team,
		stage: flags.stage,
		...(flags.install === true
			? { install: true }
			: flags.noInstall === true
				? { install: false }
				: {}),
		...(flags.deploy === true
			? { deploy: true }
			: flags.noDeploy === true
				? { deploy: false }
				: {}),
		...(flags.awsProfile === undefined ? {} : { awsProfile: flags.awsProfile }),
		...(flags.region === undefined ? {} : { region: flags.region }),
	};
}

/** Validate the project choices needed before TTY install/deploy prompts. */
export function validateCodeCommitInitCoreConfig(
	flags: CodeCommitInitFlags,
): ValidatedCodeCommitInitCoreConfig {
	return normalizeCore(parseFlags(coreFlagsSchema, flags));
}

/** Validate and normalize a complete non-TTY or post-prompt configuration. */
export function validateCodeCommitInitConfig(
	flags: CodeCommitInitFlags,
): ValidatedCodeCommitInitConfig {
	const normalized = normalizeCore(parseFlags(completeFlagsSchema, flags));
	if (normalized.install === undefined || normalized.deploy === undefined) {
		throw new Error("Complete CodeCommit init choices were not normalized");
	}
	return {
		...normalized,
		install: normalized.install,
		deploy: normalized.deploy,
	};
}

/** Alias emphasizing that validation also normalizes defaults and flag pairs. */
export const normalizeCodeCommitInitConfig = validateCodeCommitInitConfig;
