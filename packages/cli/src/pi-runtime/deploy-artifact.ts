import { createHash, randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import {
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	stat,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
	ensurePawlSubdirectory,
	protectPawlLocalFiles,
} from "../pawl-local-files";
import {
	type ApprovalBinding,
	type ApprovalBroker,
	stableStringify,
} from "./approval";
import type { ControlledExecRequest, ControlledExecResult } from "./host-exec";
import type { MutationCoordinator } from "./mutation";

/**
 * Immutable deployment artifact proof (Task 9).
 *
 * A deployment consumes an approved, frozen, integrity-checked synthesized
 * assembly — never a fresh synthesis of mutable project sources.
 *
 * `prepareArtifact` creates an exclusively owned private directory under
 * `<project>/.pawl/artifacts/`, runs the caller's trusted synthesis workflow
 * into it (never touching an existing `cdk.out/`), validates every transitive
 * reference and supported asset form, and publishes a digest over the sorted
 * relative file names and bytes plus the stack selection, target identity and
 * fixed deployment-affecting argument profile. `previewArtifact` and the
 * approved deployment both point the CDK CLI at that frozen assembly with an
 * explicit `--app <assembly-dir>` and explicit stack selection, so nothing is
 * re-synthesized and no deferred asset builder exists.
 *
 * Supported proof subset — everything else is rejected before approval:
 * - top-level stack artifacts (no nested cloud assemblies, no unknown
 *   manifest artifact types) whose `environment` names the exact selected
 *   account/region (account-agnostic or unknown environments fail closed);
 * - asset manifests whose file assets reference already materialized regular
 *   files (`source.path` with packaging `file` or its default) inside the
 *   assembly. Executable-produced sources (whose deferred command could
 *   produce different bytes than the approved manifest), all Docker sources,
 *   deferred `packaging: zip` directories, symlinks and absolute/escaping
 *   references are rejected;
 * - destinations without assume-role targets (`assumeRoleArn`,
 *   `assumeRoleExternalId`, `assumeRoleAdditionalOptions`) and with no region
 *   other than the target region; stacks without CLI assume-role targets
 *   (`assumeRoleArn`, `assumeRoleExternalId`, `assumeRoleAdditionalOptions`,
 *   `lookupRole`). A same-account `cloudFormationExecutionRoleArn` (the
 *   CloudFormation-service role CDK's default synthesizer emits) is allowed;
 *   any other account is rejected. Standard CDK bootstrap assemblies that
 *   declare CLI-assumed roles are therefore outside the Stage 1 subset.
 *
 * The preview diff is read-only: `cdk diff --app <assembly-dir> --change-set
 * false <stacks>` — confirmed against the installed aws-cdk CLI 2.1132.0
 * (`--change-set` is a boolean flag; `false` resolves to the template-only
 * diff method, which creates no CloudFormation change set). The approved
 * deployment runs `cdk deploy --app <assembly-dir> --require-approval never
 * <stacks>` (the executor has no TTY, so CDK's own prompt would hang; the
 * human decision is the approval broker's grant, consumed at this boundary).
 *
 * Immediately before execution, under the session-wide mutation permit, the
 * chain revalidates the checked identity, the frozen integrity (every file
 * unchanged — tampering, deletion, addition and symlink replacement are
 * refused), the approval grant and its expiry. Private ownership and the
 * integrity checks are a trusted-process contract, not protection against a
 * malicious same-user process tampering between a check and CDK opening the
 * files, and this module is not a sandbox: synthesis is arbitrary project
 * code running with the checked environment.
 *
 * A preview that is truncated or shows no differences never authorizes a
 * deployment. No live deployment or asset publishing exists in the proof
 * runner: the executor seam is the Task 7 controlled executor, and tests use
 * fake synthesis/CDK executors.
 */

export class DeployArtifactError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message);
		this.name = "DeployArtifactError";
		if (options?.cause !== undefined) this.cause = options.cause;
	}
}

const deployTargetSchema = z.strictObject({
	accountId: z.string().regex(/^\d{12}$/),
	region: z.string().regex(/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/),
});

export interface DeployTarget {
	readonly accountId: string;
	readonly region: string;
}

/** A frozen file entry: POSIX-style path relative to the assembly root. */
export interface FrozenFile {
	readonly path: string;
	readonly sha256: string;
	readonly bytes: number;
}

export interface PreparedArtifact {
	readonly artifactId: string;
	readonly assemblyDir: string;
	readonly projectDir: string;
	readonly target: DeployTarget;
	readonly stacks: readonly string[];
	readonly files: readonly FrozenFile[];
	/** Digest over files + stacks + target + the fixed argument profile. */
	readonly digest: string;
	readonly createdAt: number;
}

export interface PreparedPreview {
	readonly artifactId: string;
	readonly digest: string;
	readonly target: DeployTarget;
	readonly stacks: readonly string[];
	/** False when either captured stream was truncated. */
	readonly complete: boolean;
	/** False for cdk's explicit "no differences" (or empty) output. */
	readonly changed: boolean;
	/** Human-readable preview: artifact ID/digest/target beside the diff. */
	readonly text: string;
	readonly exitCode: number | null;
}

/** The Task 7 controlled-executor seam (or a fake in tests). */
export interface ArtifactExec {
	run(request: ControlledExecRequest): Promise<ControlledExecResult>;
}

export interface PrepareArtifactOptions {
	readonly projectDir: string;
	readonly target: DeployTarget;
	/** Explicit stack selection; defaults to every stack in the assembly. */
	readonly stacks?: readonly string[];
	/**
	 * Explicit trusted-code synthesis workflow. It receives the exclusively
	 * created private assembly directory and must populate it; production
	 * callers run `cdk synth --output <assembly-dir>` through the Task 7
	 * controlled executor, which binds the checked environment and budget.
	 */
	readonly synthesize: (assemblyDir: string) => Promise<void>;
	readonly dependencies?: { readonly now?: () => number };
}

// ---- CDK CLI invocation profile (fixed; part of the digest) ----

/** `npx cdk …` — resolved from the project directory like the shared scanner. */
const CDK_COMMAND = "npx";

/** Read-only diff argv profile: template mode creates no change set. */
export const diffArgs = (assemblyDir: string, stacks: readonly string[]) => [
	"cdk",
	"diff",
	"--app",
	assemblyDir,
	"--change-set",
	"false",
	...stacks,
];

/** Deployment argv profile against the frozen assembly. */
export const deployArgs = (assemblyDir: string, stacks: readonly string[]) => [
	"cdk",
	"deploy",
	"--app",
	assemblyDir,
	"--require-approval",
	"never",
	...stacks,
];

const DIGEST_VERSION = 1;

/**
 * Deployment-affecting argument profile fixed in this proof. Any future
 * change to these flags is a behavior change and must change the digest.
 */
const ARGUMENT_PROFILE = {
	diff: ["--app <assembly-dir>", "--change-set false", "<stacks>"],
	deploy: ["--app <assembly-dir>", "--require-approval never", "<stacks>"],
} as const;

function computeDigest(
	files: readonly FrozenFile[],
	stacks: readonly string[],
	target: DeployTarget,
): string {
	const payload = {
		version: DIGEST_VERSION,
		files,
		stacks: [...stacks].sort(),
		target,
		arguments: ARGUMENT_PROFILE,
	};
	return `sha256:${createHash("sha256").update(stableStringify(payload)).digest("hex")}`;
}

// ---- assembly manifest schemas (structural subset) ----

const artifactEntrySchema = z.object({
	type: z.string().min(1),
	environment: z.string().optional(),
	properties: z.record(z.string(), z.unknown()).optional(),
});

const assemblyManifestSchema = z.object({
	version: z.string().min(1),
	artifacts: z.record(z.string(), artifactEntrySchema),
});

const fileDestinationSchema = z.object({
	bucketName: z.string().min(1),
	objectKey: z.string().min(1),
	region: z.string().optional(),
	assumeRoleArn: z.string().optional(),
	assumeRoleExternalId: z.string().optional(),
	assumeRoleAdditionalOptions: z.record(z.string(), z.unknown()).optional(),
});

const fileAssetSchema = z.object({
	source: z.object({
		executable: z.array(z.string()).optional(),
		path: z.string().optional(),
		packaging: z.string().optional(),
	}),
	destinations: z.record(z.string(), fileDestinationSchema),
});

const assetManifestSchema = z.object({
	version: z.string().min(1),
	files: z.record(z.string(), fileAssetSchema).optional(),
	dockerImages: z.record(z.string(), z.unknown()).optional(),
});

const STACK_TYPE = "aws:cloudformation:stack";
const ASSET_MANIFEST_TYPE = "cdk:asset-manifest";
const TREE_TYPE = "cdk:tree";
const FEATURE_FLAG_REPORT_TYPE = "cdk:feature-flag-report";
const NESTED_ASSEMBLY_TYPE = "cdk:cloud-assembly";
const SUPPORTED_ARTIFACT_TYPES = new Set([
	STACK_TYPE,
	ASSET_MANIFEST_TYPE,
	TREE_TYPE,
	FEATURE_FLAG_REPORT_TYPE,
]);

const ENVIRONMENT_PATTERN = /^aws:\/\/(\d{12})\/([a-z]{2}(?:-[a-z0-9]+)+-\d+)$/;

function parseOrReject<T>(
	schema: {
		safeParse(value: unknown): { success: boolean; data?: T; error?: unknown };
	},
	value: unknown,
	what: string,
): T {
	const result = schema.safeParse(value);
	if (!result.success || result.data === undefined) {
		throw new DeployArtifactError(
			`Synthesized ${what} does not match the supported schema; failing closed`,
			{ cause: result.error },
		);
	}
	return result.data;
}

/** Resolves a manifest-referenced path inside the assembly, refusing escapes. */
function withinAssembly(
	assemblyDir: string,
	referenced: string,
	what: string,
): string {
	if (referenced.length === 0) {
		throw new DeployArtifactError(`${what} reference is empty`);
	}
	if (isAbsolute(referenced)) {
		throw new DeployArtifactError(
			`${what} reference "${referenced}" is an absolute path; references must stay inside the assembly`,
		);
	}
	const resolved = resolve(assemblyDir, referenced);
	const rel = relative(assemblyDir, resolved);
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
		throw new DeployArtifactError(
			`${what} reference "${referenced}" escapes the assembly directory`,
		);
	}
	return resolved;
}

/** Requires an existing, regular, non-symlink file at the given path. */
async function requireRegularFile(path: string, what: string): Promise<void> {
	let stats: Awaited<ReturnType<typeof lstat>>;
	try {
		stats = await lstat(path);
	} catch (error) {
		throw new DeployArtifactError(
			`${what} at ${path} is missing; every referenced file must already be materialized inside the assembly`,
			{ cause: error },
		);
	}
	if (stats.isSymbolicLink()) {
		throw new DeployArtifactError(
			`Refusing symbolic link at ${path}; assembly references must be real files inside the assembly`,
		);
	}
	if (!stats.isFile()) {
		throw new DeployArtifactError(
			`${what} at ${path} is not a regular file; only materialized regular files are supported`,
		);
	}
}

/**
 * Walks the assembly and freezes every regular file. Symlinks and other
 * special file types anywhere in the assembly are refused; the manifest is
 * sorted by POSIX-style relative path so the digest is stable across
 * platforms and directory traversal order.
 */
async function walkAssembly(assemblyDir: string): Promise<FrozenFile[]> {
	const files: FrozenFile[] = [];
	const visit = async (dir: string): Promise<void> => {
		for (const entry of await readdir(dir)) {
			const full = join(dir, entry);
			const stats = await lstat(full);
			if (stats.isSymbolicLink()) {
				throw new DeployArtifactError(
					`Refusing symbolic link at ${full}; the frozen assembly must contain real files only`,
				);
			}
			if (stats.isDirectory()) {
				await visit(full);
				continue;
			}
			if (!stats.isFile()) {
				throw new DeployArtifactError(
					`Unsupported file type at ${full}; the frozen assembly must contain regular files only`,
				);
			}
			const bytes = await readFile(full);
			files.push({
				path: relative(assemblyDir, full).split(sep).join("/"),
				sha256: createHash("sha256").update(bytes).digest("hex"),
				bytes: bytes.byteLength,
			});
		}
	};
	await visit(assemblyDir);
	files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	return files;
}

/**
 * Validates the synthesized assembly against the supported subset and returns
 * the resolved stack selection. Every selected stack's environment must name
 * the exact target account/region, and all asset manifests in the assembly
 * must only contain supported, materialized file assets.
 */
async function validateAssembly(
	assemblyDir: string,
	target: DeployTarget,
	stacks: readonly string[] | undefined,
): Promise<readonly string[]> {
	const manifestPath = join(assemblyDir, "manifest.json");
	let manifestRaw: Buffer;
	try {
		manifestRaw = await readFile(manifestPath);
	} catch (error) {
		throw new DeployArtifactError(
			`Synthesis produced no readable manifest.json in ${assemblyDir}; the artifact cannot be published`,
			{ cause: error },
		);
	}
	let manifestJson: unknown;
	try {
		manifestJson = JSON.parse(manifestRaw.toString("utf8"));
	} catch (error) {
		throw new DeployArtifactError(
			`manifest.json in ${assemblyDir} is not valid JSON`,
			{ cause: error },
		);
	}
	const manifest = parseOrReject(
		assemblyManifestSchema,
		manifestJson,
		"assembly manifest",
	);
	const entries = Object.entries(manifest.artifacts);
	if (entries.length === 0) {
		throw new DeployArtifactError(
			"The synthesized assembly contains no artifacts",
		);
	}
	for (const [id, artifact] of entries) {
		if (artifact.type === NESTED_ASSEMBLY_TYPE) {
			throw new DeployArtifactError(
				`Artifact "${id}" is a nested cloud assembly; nested assemblies are unsupported in this proof`,
			);
		}
		if (!SUPPORTED_ARTIFACT_TYPES.has(artifact.type)) {
			throw new DeployArtifactError(
				`Artifact "${id}" has unsupported manifest type "${artifact.type}"`,
			);
		}
	}
	// Resolve the stack selection against the synthesized stacks.
	const stackEntries = entries
		.filter(([, artifact]) => artifact.type === STACK_TYPE)
		.map(([id, artifact]) => ({
			id,
			name:
				typeof artifact.properties?.stackName === "string"
					? artifact.properties.stackName
					: id,
			artifact,
		}));
	if (stackEntries.length === 0) {
		throw new DeployArtifactError(
			"The synthesized assembly contains no stacks",
		);
	}
	let selected: typeof stackEntries;
	if (stacks === undefined) {
		selected = stackEntries;
	} else {
		selected = [];
		for (const requested of stacks) {
			const matches = stackEntries.filter((entry) => entry.name === requested);
			if (matches.length === 0) {
				throw new DeployArtifactError(
					`Requested stack "${requested}" does not exist in the synthesized assembly`,
				);
			}
			if (matches.length > 1) {
				throw new DeployArtifactError(
					`Requested stack "${requested}" is ambiguous in the synthesized assembly`,
				);
			}
			const match = matches[0];
			if (match) selected.push(match);
		}
	}
	if (selected.length === 0) {
		throw new DeployArtifactError("The stack selection is empty");
	}
	// Environment binding: unknown/account-agnostic targets fail closed.
	for (const entry of selected) {
		const environment = entry.artifact.environment;
		if (environment === undefined) {
			throw new DeployArtifactError(
				`Stack "${entry.name}" has no target environment; account-agnostic targets are unsupported in this proof`,
			);
		}
		const match = ENVIRONMENT_PATTERN.exec(environment);
		if (!match) {
			throw new DeployArtifactError(
				`Stack "${entry.name}" names an unrecognizable target environment "${environment}"`,
			);
		}
		const accountId = match[1];
		const region = match[2];
		if (accountId !== target.accountId) {
			throw new DeployArtifactError(
				`Stack "${entry.name}" targets account ${accountId}, not the selected execution account ${target.accountId}`,
			);
		}
		if (region !== target.region) {
			throw new DeployArtifactError(
				`Stack "${entry.name}" targets region ${region}, not the selected region ${target.region}`,
			);
		}
		// Assume-role targets exercised by the CLI are unapproved.
		const properties = entry.artifact.properties ?? {};
		for (const field of [
			"assumeRoleArn",
			"assumeRoleExternalId",
			"assumeRoleAdditionalOptions",
			"lookupRole",
		] as const) {
			if (properties[field] !== undefined) {
				throw new DeployArtifactError(
					`Stack "${entry.name}" declares ${field}; assume-role targets are unapproved in this proof`,
				);
			}
		}
		const cfnExecutionRole = properties.cloudFormationExecutionRoleArn;
		if (cfnExecutionRole !== undefined) {
			if (
				typeof cfnExecutionRole !== "string" ||
				!cfnExecutionRole.includes(`:iam::${target.accountId}:`)
			) {
				throw new DeployArtifactError(
					`Stack "${entry.name}" declares a cloudFormationExecutionRoleArn outside the target account ${target.accountId}`,
				);
			}
		}
		// Transitive reference: the template must exist inside the assembly.
		const templateFile = properties.templateFile;
		if (typeof templateFile !== "string") {
			throw new DeployArtifactError(
				`Stack "${entry.name}" does not name a template file`,
			);
		}
		const templatePath = withinAssembly(
			assemblyDir,
			templateFile,
			`Stack "${entry.name}" template`,
		);
		await requireRegularFile(templatePath, `Stack "${entry.name}" template`);
	}
	// Every asset manifest in the assembly must contain only supported,
	// materialized file assets — a deferred builder anywhere would mean the
	// frozen bytes are not the deployed bytes.
	for (const [id, artifact] of entries) {
		if (artifact.type !== ASSET_MANIFEST_TYPE) continue;
		const file = artifact.properties?.file;
		if (typeof file !== "string") {
			throw new DeployArtifactError(
				`Asset manifest artifact "${id}" does not name a manifest file`,
			);
		}
		const manifestFile = withinAssembly(
			assemblyDir,
			file,
			`Asset manifest "${id}"`,
		);
		await requireRegularFile(manifestFile, `Asset manifest "${id}"`);
		let assetJson: unknown;
		try {
			assetJson = JSON.parse((await readFile(manifestFile)).toString("utf8"));
		} catch (error) {
			throw new DeployArtifactError(
				`Asset manifest "${file}" is not valid JSON`,
				{ cause: error },
			);
		}
		const assets = parseOrReject(
			assetManifestSchema,
			assetJson,
			`asset manifest "${file}"`,
		);
		if (assets.dockerImages && Object.keys(assets.dockerImages).length > 0) {
			throw new DeployArtifactError(
				`Asset manifest "${file}" contains Docker image assets; all Docker sources are unsupported in this proof`,
			);
		}
		for (const [assetId, fileAsset] of Object.entries(assets.files ?? {})) {
			if (fileAsset.source.executable !== undefined) {
				throw new DeployArtifactError(
					`File asset "${assetId}" in "${file}" is produced by an executable command; deferred asset builders are unsupported in this proof`,
				);
			}
			if (fileAsset.source.path === undefined) {
				throw new DeployArtifactError(
					`File asset "${assetId}" in "${file}" has no materialized source path`,
				);
			}
			if (
				fileAsset.source.packaging !== undefined &&
				fileAsset.source.packaging !== "file"
			) {
				throw new DeployArtifactError(
					`File asset "${assetId}" in "${file}" uses packaging "${fileAsset.source.packaging}"; deferred packaging (zip directories) is unsupported in this proof`,
				);
			}
			const sourcePath = withinAssembly(
				assemblyDir,
				fileAsset.source.path,
				`File asset "${assetId}" source`,
			);
			await requireRegularFile(
				sourcePath,
				`File asset "${assetId}" source (${fileAsset.source.path})`,
			);
			for (const [destinationId, destination] of Object.entries(
				fileAsset.destinations,
			)) {
				if (
					destination.assumeRoleArn !== undefined ||
					destination.assumeRoleExternalId !== undefined ||
					destination.assumeRoleAdditionalOptions !== undefined
				) {
					throw new DeployArtifactError(
						`Destination "${destinationId}" of asset "${assetId}" declares an assume-role target; unapproved destinations are unsupported in this proof`,
					);
				}
				if (
					destination.region !== undefined &&
					destination.region !== target.region
				) {
					throw new DeployArtifactError(
						`Destination "${destinationId}" of asset "${assetId}" targets region ${destination.region}, not the selected region ${target.region}`,
					);
				}
			}
		}
	}
	// Tree artifacts: the referenced file must also exist inside the assembly.
	for (const [id, artifact] of entries) {
		if (artifact.type !== TREE_TYPE) continue;
		const file = artifact.properties?.file;
		if (typeof file !== "string") continue;
		const treePath = withinAssembly(assemblyDir, file, `Tree artifact "${id}"`);
		await requireRegularFile(treePath, `Tree artifact "${id}"`);
	}
	return selected.map((entry) => entry.name);
}

/**
 * Synthesizes into an exclusively created private assembly, validates the
 * supported subset and publishes the frozen, digested artifact. The created
 * directory is removed again if synthesis/validation fails, so nothing
 * unvalidated is ever left behind as publishable material.
 */
export async function prepareArtifact(
	options: PrepareArtifactOptions,
): Promise<PreparedArtifact> {
	const target = deployTargetSchema.parse(options.target);
	const now = options.dependencies?.now ?? Date.now;
	if (options.stacks !== undefined && options.stacks.length === 0) {
		throw new DeployArtifactError("The stack selection must not be empty");
	}
	const projectDir = await realpath(options.projectDir);
	const pawlDir = join(projectDir, ".pawl");
	const artifactsDir = await ensurePawlSubdirectory(pawlDir, "artifacts");
	await protectPawlLocalFiles(pawlDir);
	const artifactId = `artifact-${now()}-${randomBytes(5).toString("hex")}`;
	const assemblyDir = join(artifactsDir, artifactId);
	try {
		await mkdir(assemblyDir, { mode: 0o700 });
	} catch (error) {
		throw new DeployArtifactError(
			`Cannot create the exclusive artifact directory at ${assemblyDir}`,
			{ cause: error },
		);
	}
	try {
		await options.synthesize(assemblyDir);
		await stat(assemblyDir);
		const stacks = await validateAssembly(assemblyDir, target, options.stacks);
		const files = await walkAssembly(assemblyDir);
		return Object.freeze({
			artifactId,
			assemblyDir,
			projectDir,
			target,
			stacks: Object.freeze(stacks),
			files: Object.freeze(files),
			digest: computeDigest(files, stacks, target),
			createdAt: now(),
		});
	} catch (error) {
		// Never leave unvalidated or partially synthesized material behind.
		rmSync(assemblyDir, { recursive: true, force: true });
		if (error instanceof DeployArtifactError) throw error;
		throw new DeployArtifactError(
			`Artifact preparation failed: ${
				error instanceof Error ? error.message : String(error)
			}`,
			{ cause: error },
		);
	}
}

/**
 * Revalidates the frozen material: every file present, unchanged, no
 * additions, no symlinks, and the recomputed digest equal to the published
 * one. Throws a `DeployArtifactError` on any mismatch.
 */
export async function verifyArtifact(
	artifact: PreparedArtifact,
): Promise<void> {
	let files: FrozenFile[];
	try {
		files = await walkAssembly(artifact.assemblyDir);
	} catch (error) {
		if (error instanceof DeployArtifactError) throw error;
		throw new DeployArtifactError(
			`The frozen artifact at ${artifact.assemblyDir} could not be read`,
			{ cause: error },
		);
	}
	const expected = [...artifact.files].sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
	);
	if (files.length !== expected.length) {
		const actualPaths = new Set(files.map((file) => file.path));
		const expectedPaths = new Set(expected.map((file) => file.path));
		const added = files
			.filter((file) => !expectedPaths.has(file.path))
			.map((file) => file.path);
		const removed = expected
			.filter((file) => !actualPaths.has(file.path))
			.map((file) => file.path);
		throw new DeployArtifactError(
			`The frozen artifact changed: added [${added.join(", ")}], removed [${removed.join(", ")}]; the approved material is no longer intact`,
		);
	}
	for (let index = 0; index < files.length; index += 1) {
		const actual = files[index];
		const wanted = expected[index];
		if (!actual || !wanted) {
			throw new DeployArtifactError(
				"The frozen artifact manifest is inconsistent",
			);
		}
		if (actual.path !== wanted.path) {
			throw new DeployArtifactError(
				`The frozen artifact changed: expected file "${wanted.path}", found "${actual.path}"`,
			);
		}
		if (actual.sha256 !== wanted.sha256 || actual.bytes !== wanted.bytes) {
			throw new DeployArtifactError(
				`The frozen file "${actual.path}" changed since the artifact was published (${actual.sha256} !== ${wanted.sha256}); the approved material is no longer intact`,
			);
		}
	}
	const digest = computeDigest(files, artifact.stacks, artifact.target);
	if (digest !== artifact.digest) {
		throw new DeployArtifactError(
			`The frozen artifact digest changed (${digest} !== ${artifact.digest})`,
		);
	}
}

const NO_DIFFERENCES_PATTERN = /there were no differences/i;

/**
 * Runs the read-only template diff against the frozen assembly and returns
 * the human-facing preview. `complete` is false when either captured stream
 * was truncated; `changed` is false for cdk's explicit no-difference output.
 * A preview with `!complete` or `!changed` never authorizes a deployment.
 */
export async function previewArtifact(
	artifact: PreparedArtifact,
	exec: ArtifactExec,
): Promise<PreparedPreview> {
	const result = await exec.run({
		command: CDK_COMMAND,
		args: diffArgs(artifact.assemblyDir, artifact.stacks),
	});
	const complete = !result.stdoutTruncated && !result.stderrTruncated;
	const changed =
		result.stdout.trim().length > 0 &&
		!NO_DIFFERENCES_PATTERN.test(result.stdout);
	const header = [
		`artifact ${artifact.artifactId}`,
		`digest ${artifact.digest}`,
		`target aws://${artifact.target.accountId}/${artifact.target.region}`,
		`stacks ${artifact.stacks.join(", ")}`,
	].join("\n");
	const body = [
		result.stdout.trimEnd(),
		...(result.stderr.trim().length > 0 ? [result.stderr.trimEnd()] : []),
	]
		.filter((part) => part.length > 0)
		.join("\n");
	const text = body.length > 0 ? `${header}\n\n${body}` : header;
	return {
		artifactId: artifact.artifactId,
		digest: artifact.digest,
		target: artifact.target,
		stacks: artifact.stacks,
		complete,
		changed,
		text,
		exitCode: result.exitCode,
	};
}

export interface DeployApprovalRequest {
	readonly runId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	/** Canonical tool input; part of the approval digest. */
	readonly input: unknown;
}

export interface DeployApprovedArtifactOptions {
	readonly artifact: PreparedArtifact;
	readonly preview: PreparedPreview;
	readonly broker: ApprovalBroker;
	readonly mutations: MutationCoordinator;
	readonly exec: ArtifactExec;
	/** The currently checked identity, revalidated under the permit. */
	readonly currentIdentity: DeployTarget;
	readonly request: DeployApprovalRequest;
}

/**
 * Requests the deployment approval bound to the artifact digest, project and
 * checked target identity, then — only after an explicit approve answer —
 * runs the deployment under the session-wide mutation permit. Inside the
 * permit the chain revalidates the identity, the frozen integrity, and the
 * one-use grant (which also enforces expiry) before the executor consumes
 * only the verified frozen assembly. Denied, cancelled, expired, mismatched,
 * restart-recovered and truncated/no-difference previews never execute.
 */
export async function deployApprovedArtifact(
	options: DeployApprovedArtifactOptions,
): Promise<ControlledExecResult> {
	const { artifact, preview } = options;
	if (!preview.complete) {
		throw new DeployArtifactError(
			"The preview output was truncated; deployment is not authorized until a complete preview is displayed",
		);
	}
	if (!preview.changed) {
		throw new DeployArtifactError(
			"The preview shows no differences; there is nothing to deploy",
		);
	}
	if (
		preview.artifactId !== artifact.artifactId ||
		preview.digest !== artifact.digest ||
		preview.target.accountId !== artifact.target.accountId ||
		preview.target.region !== artifact.target.region
	) {
		throw new DeployArtifactError(
			"The preview does not match the prepared artifact; run a new preview",
		);
	}
	const binding = (): ApprovalBinding => ({
		runId: options.request.runId,
		toolCallId: options.request.toolCallId,
		toolName: options.request.toolName,
		input: options.request.input,
		planDigest: artifact.digest,
		projectDir: artifact.projectDir,
		identity: {
			accountId: artifact.target.accountId,
			region: artifact.target.region,
		},
		previewComplete: preview.complete,
	});
	const outcome = await options.broker.request(binding());
	if (!outcome.granted) {
		throw new DeployArtifactError(
			`Deployment approval was not granted: ${outcome.message}`,
		);
	}
	return options.mutations.run(async (lease) => {
		lease.signal.throwIfAborted();
		// Identity revalidation under the permit: the checked identity must
		// still be the artifact's target.
		if (
			options.currentIdentity.accountId !== artifact.target.accountId ||
			options.currentIdentity.region !== artifact.target.region
		) {
			throw new DeployArtifactError(
				`The checked AWS identity (${options.currentIdentity.accountId}/${options.currentIdentity.region}) no longer matches the artifact target (${artifact.target.accountId}/${artifact.target.region})`,
			);
		}
		// Integrity revalidation under the permit: the frozen material must be
		// byte-for-byte intact (tampering, deletion, addition, symlink).
		await verifyArtifact(artifact);
		// One-use grant consumption at the actual execution boundary; the
		// rebuilt binding also enforces expiry and any input change.
		const consumption = outcome.grant.consume(binding());
		if (!consumption.ok) {
			throw new DeployArtifactError(
				`The approval grant could not be consumed: ${consumption.message}`,
			);
		}
		// The executor consumes ONLY the verified frozen assembly: --app points
		// at the artifact directory, so the CDK CLI never re-synthesizes the
		// project, and no deferred asset builder exists (executable sources and
		// zip packaging were rejected at preparation time).
		return options.exec.run({
			command: CDK_COMMAND,
			args: deployArgs(artifact.assemblyDir, artifact.stacks),
			signal: lease.signal,
		});
	});
}
